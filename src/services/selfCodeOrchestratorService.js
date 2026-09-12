/**
 * Stage 5D: EVO Autonomous Self-Improvement Orchestrator Service
 * Coordinates Stage 5B Diagnosis, Stage 5A Sandbox Testing, and Stage 5C Controlled Promotion
 */

import {
  getAutonomyPolicy,
  updateAutonomyPolicy,
  resetAutonomyPolicyToDefault,
  createSelfImprovementRun,
  updateSelfImprovementRun,
  getSelfImprovementRuns,
  getSelfImprovementRunById,
  getRecentPromotionsCount,
  getLastPromotionTimestamp,
  getRecentFailedProposalsCount,
  acquirePromotionLock,
  releasePromotionLock,
  isPromotionLocked,
  AUTONOMY_MODES
} from './selfCodeOrchestratorStore.js';

import {
  getSelfCodeProposalById,
  updateSelfCodeProposal,
  SELF_CODE_PROPOSAL_STATUS
} from './selfCodeProposalStore.js';

import {
  selfCodeAnalyzerService,
  classifyProblemCategory,
  analyzeEvidenceAndGenerateProposal
} from './selfCodeAnalyzerService.js';

import {
  selfCodeSandboxService,
  testSelfCodeProposalInSandbox,
  validateProposedFilePath,
  FORBIDDEN_FILE_PATHS
} from './selfCodeSandboxService.js';

import {
  selfCodePromotionService,
  compareSelfCodeCandidate,
  checkSelfCodePromotionEligibility,
  promoteSelfCodeVersion,
  rollbackSelfCodeVersion,
  computeCandidateFingerprint
} from './selfCodePromotionService.js';

import { getActiveSelfCodeVersion } from './selfCodeVersionStore.js';
import { recordActionEvent } from './actionEventStore.js';

/**
 * Audit Event Logger Helper (Req 13)
 */
function logAuditEvent(runId, eventType, data = {}) {
  const timestamp = new Date().toISOString();
  const eventRecord = {
    eventType,
    timestamp,
    ...data
  };

  if (runId) {
    const run = getSelfImprovementRunById(runId);
    if (run) {
      const auditEvents = Array.isArray(run.auditEvents) ? run.auditEvents : [];
      auditEvents.push(eventRecord);
      const logs = Array.isArray(run.logs) ? run.logs : [];
      logs.push(`[${timestamp}] [AUDIT: ${eventType}] ${JSON.stringify(data)}`);
      updateSelfImprovementRun(runId, { auditEvents, logs });
    }
  }

  // Also log to actionEventStore for system-wide auditability if available
  try {
    recordActionEvent({
      objectiveId: data.objectiveId || 'system_self_improvement',
      stepId: data.proposalId || 'self_improvement_step',
      actionType: `SELF_IMPROVEMENT_${eventType.toUpperCase()}`,
      inputData: data,
      outputData: { timestamp, eventType },
      status: 'COMPLETED'
    });
  } catch (e) {
    // Non-blocking fallback
  }

  return eventRecord;
}

/**
 * Checks if changes exceed the change budget (Req 11)
 */
export function validateChangeBudget(proposedChanges = [], customBudget = null) {
  const policy = getAutonomyPolicy();
  const budget = customBudget || policy.changeBudget || { maxFilesChanged: 3, maxLinesChanged: 500 };

  if (!Array.isArray(proposedChanges) || proposedChanges.length === 0) {
    return { valid: false, error: 'No proposed changes provided.' };
  }

  if (proposedChanges.length > budget.maxFilesChanged) {
    return {
      valid: false,
      error: `Change budget exceeded: ${proposedChanges.length} files changed (max allowed: ${budget.maxFilesChanged}).`
    };
  }

  let totalLinesChanged = 0;
  for (const change of proposedChanges) {
    const lines = String(change.content || '').split('\n').length;
    totalLinesChanged += lines;
  }

  if (totalLinesChanged > budget.maxLinesChanged) {
    return {
      valid: false,
      error: `Change budget exceeded: ~${totalLinesChanged} lines changed (max allowed: ${budget.maxLinesChanged}).`
    };
  }

  return { valid: true, totalFiles: proposedChanges.length, totalLines: totalLinesChanged };
}

/**
 * Prevents recursive self-triggering loops (Req 9)
 */
export function isRecursiveOrSelfMetadataEvidence(evidenceList = []) {
  const items = Array.isArray(evidenceList) ? evidenceList : [evidenceList];
  if (!items || items.length === 0) return false;

  for (const ev of items) {
    if (!ev || typeof ev !== 'object') continue;
    const actionType = String(ev.actionType || ev.action || '');
    const errorMsg = String(ev.error || ev.actual || ev.problemStatement || ev.goal || ev.currentStep || '');
    const objId = String(ev.objectiveId || ev.id || '');
    const isSelfImp = Boolean(ev.isSelfImprovement);

    if (isSelfImp) return true;

    // 1. Evidence originating from self-improvement / orchestration / promotion
    if (
      actionType.startsWith('SELF_IMPROVEMENT_') ||
      actionType.includes('PROMOTION') ||
      actionType.includes('SANDBOX') ||
      objId.startsWith('system_self_improvement') ||
      objId.startsWith('obj-self-imp')
    ) {
      return true;
    }

    // 2. Evidence mentioning self-code metadata or sandbox paths
    if (
      errorMsg.includes('/tmp/evo_source_sandbox') ||
      errorMsg.includes('evo_self_improvement') ||
      errorMsg.includes('selfCodeOrchestrator') ||
      errorMsg.toLowerCase().includes('self-code proposal') ||
      errorMsg.toLowerCase().includes('self-improvement')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Main Stage 5D Self-Improvement Pipeline Orchestrator (Req 1 - Req 17)
 */
export async function runSelfImprovementPipeline(evidenceList = [], options = {}) {
  const startedAt = new Date().toISOString();
  const policy = getAutonomyPolicy();
  const mode = options.mode || policy.mode || AUTONOMY_MODES.SUPERVISED;

  // Create structured run record (Req 14)
  const evidenceIds = Array.isArray(evidenceList)
    ? evidenceList.map((e) => e.id || e.evidenceId).filter(Boolean)
    : [];

  const initialActiveVersion = getActiveSelfCodeVersion();

  const runRecord = createSelfImprovementRun({
    evidenceIds,
    baseVersion: initialActiveVersion,
    activeVersion: initialActiveVersion,
    autonomyMode: mode,
    startedAt,
    status: 'STARTED',
    promotionResult: { promoted: false }
  });

  const runId = runRecord.runId;

  // 1. Recursion & Self-Metadata Filter Check (Req 9)
  if (isRecursiveOrSelfMetadataEvidence(evidenceList)) {
    const stopReason = 'Halted: Evidence originates from self-improvement bookkeeping or sandbox test logs.';
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return {
      success: false,
      runId,
      status: 'REJECTED',
      stopReason,
      reason: stopReason
    };
  }

  // 2. Step 1: Evidence Collection & Problem Classification (Stage 5B)
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    const stopReason = 'Halted: No failure evidence provided for self-improvement pipeline.';
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return { success: false, runId, status: 'REJECTED', stopReason };
  }

  // Single observation guard (Req 18 safety checks)
  if (evidenceList.length < 2 && options.allowSingleEvidence !== true) {
    const stopReason = 'Halted: Single failure observation is insufficient for self-code modification (requires evidence >= 2).';
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return { success: false, runId, status: 'REJECTED', stopReason };
  }

  // Classify category
  const firstCategory = classifyProblemCategory(evidenceList[0]);
  logAuditEvent(runId, 'problem_detected', {
    evidenceCount: evidenceList.length,
    classifiedCategory: firstCategory,
    evidenceIds
  });

  // Verify category is EVO_IMPLEMENTATION (Req 5, Req 18)
  if (firstCategory !== 'EVO_IMPLEMENTATION') {
    const stopReason = `Halted: Problem category "${firstCategory}" does not target EVO core implementation defects.`;
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return { success: false, runId, status: 'REJECTED', stopReason };
  }

  // 3. Step 2: Stage 5B Self-Code Proposal Generation
  const proposalGenRes = analyzeEvidenceAndGenerateProposal(evidenceList, options);
  if (!proposalGenRes.generated || !proposalGenRes.proposal) {
    const stopReason = `Halted: Self-code proposal generation failed: ${proposalGenRes.reason || proposalGenRes.error}`;
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return { success: false, runId, status: 'REJECTED', stopReason };
  }

  const proposal = proposalGenRes.proposal;
  const candidateFingerprint = computeCandidateFingerprint(proposal.proposedChanges);

  updateSelfImprovementRun(runId, {
    proposalId: proposal.id,
    candidateFingerprint
  });

  logAuditEvent(runId, 'proposal_generated', {
    proposalId: proposal.id,
    targetFiles: proposal.targetFiles,
    reason: proposal.reason
  });

  // Validate Change Budget (Req 11)
  const budgetCheck = validateChangeBudget(proposal.proposedChanges, options.changeBudget);
  if (!budgetCheck.valid) {
    updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED });
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason: budgetCheck.error,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    logAuditEvent(runId, 'proposal_rejected', { proposalId: proposal.id, reason: budgetCheck.error });
    return { success: false, runId, proposalId: proposal.id, status: 'REJECTED', stopReason: budgetCheck.error };
  }

  // Verify target files security allowlist (Req 12)
  for (const change of proposal.proposedChanges || []) {
    const pathCheck = validateProposedFilePath(change.filePath);
    if (!pathCheck.valid) {
      updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED });
      updateSelfImprovementRun(runId, {
        status: 'REJECTED',
        stopReason: pathCheck.error,
        promotionResult: { promoted: false },
        activeVersion: getActiveSelfCodeVersion(),
        timestamps: { completedAt: new Date().toISOString() }
      });
      logAuditEvent(runId, 'proposal_rejected', { proposalId: proposal.id, reason: pathCheck.error });
      return { success: false, runId, proposalId: proposal.id, status: 'REJECTED', stopReason: pathCheck.error };
    }
  }

  // 4. Step 3: Stage 5A Sandbox Testing
  logAuditEvent(runId, 'proposal_sandboxed', { proposalId: proposal.id });
  const sandboxRes = await testSelfCodeProposalInSandbox(proposal.id, options);
  updateSelfImprovementRun(runId, { sandboxResult: sandboxRes.testResult });

  if (!sandboxRes.success) {
    const stopReason = `Sandbox testing failed: ${sandboxRes.error || 'Regression or build error in sandbox'}`;
    logAuditEvent(runId, 'proposal_rejected', { proposalId: proposal.id, reason: stopReason });
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return { success: false, runId, proposalId: proposal.id, status: 'REJECTED', stopReason };
  }

  logAuditEvent(runId, 'candidate_validated', { proposalId: proposal.id });

  // 5. Step 4: Stage 5C Self-Code Comparison
  const comparison = compareSelfCodeCandidate(proposal.id, options);
  updateSelfImprovementRun(runId, { comparisonResult: comparison });
  logAuditEvent(runId, 'comparison_completed', { proposalId: proposal.id, classification: comparison.classification });

  if (comparison.classification === 'REGRESSED' || comparison.classification === 'INSUFFICIENT_EVIDENCE') {
    const stopReason = `Comparison classified candidate as ${comparison.classification}: ${comparison.reasons.join('; ')}`;
    updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED });
    logAuditEvent(runId, 'proposal_rejected', { proposalId: proposal.id, reason: stopReason });
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return { success: false, runId, proposalId: proposal.id, status: 'REJECTED', stopReason };
  }

  // 6. Step 5: Promotion Eligibility Check
  const eligibility = checkSelfCodePromotionEligibility(proposal.id, options);
  if (!eligibility.eligible) {
    const stopReason = `Promotion eligibility check failed: ${eligibility.reasons.join('; ')}`;
    updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED });
    logAuditEvent(runId, 'proposal_rejected', { proposalId: proposal.id, reason: stopReason });
    updateSelfImprovementRun(runId, {
      status: 'REJECTED',
      stopReason,
      promotionResult: { promoted: false },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });
    return { success: false, runId, proposalId: proposal.id, status: 'REJECTED', stopReason };
  }

  // 7. Step 6: Autonomy Mode Evaluation (SUPERVISED vs AUTONOMOUS) (Req 3, Req 6, Req 7)
  if (mode === AUTONOMY_MODES.SUPERVISED) {
    const approvalReason = 'Supervised mode active: proposal validated in sandbox and prepared. Explicit operator approval required for production promotion.';

    updateSelfCodeProposal(proposal.id, {
      status: SELF_CODE_PROPOSAL_STATUS.AWAITING_APPROVAL,
      approvalReason
    });

    logAuditEvent(runId, 'approval_requested', { proposalId: proposal.id, approvalReason });

    updateSelfImprovementRun(runId, {
      status: 'AWAITING_APPROVAL',
      approvalReason,
      stopReason: approvalReason,
      promotionResult: { promoted: false, pendingApproval: true },
      activeVersion: getActiveSelfCodeVersion(),
      timestamps: { completedAt: new Date().toISOString() }
    });

    return {
      success: true,
      runId,
      proposalId: proposal.id,
      status: SELF_CODE_PROPOSAL_STATUS.AWAITING_APPROVAL,
      approvalRequired: true,
      approvalReason,
      proposal: getSelfCodeProposalById(proposal.id),
      message: 'Pipeline completed sandbox validation and comparison. Production code remains UNCHANGED pending explicit approval.'
    };
  }

  // 8. Step 7: AUTONOMOUS Mode Promotion Controls & Safeguards (Req 5, Req 8, Req 10)
  if (mode === AUTONOMY_MODES.AUTONOMOUS) {
    // Check Cooldown Period (Req 10)
    const lastPromoTs = getLastPromotionTimestamp();
    if (lastPromoTs > 0 && Date.now() - lastPromoTs < policy.cooldownMs && options.ignoreCooldown !== true) {
      const stopReason = `Cooldown active: ${Math.ceil((policy.cooldownMs - (Date.now() - lastPromoTs)) / 1000)}s remaining before next autonomous promotion permitted.`;
      updateSelfCodeProposal(proposal.id, {
        status: SELF_CODE_PROPOSAL_STATUS.AWAITING_APPROVAL,
        approvalReason: stopReason
      });
      logAuditEvent(runId, 'approval_requested', { proposalId: proposal.id, reason: stopReason });
      updateSelfImprovementRun(runId, {
        status: 'AWAITING_APPROVAL',
        stopReason,
        promotionResult: { promoted: false, pendingApproval: true },
        activeVersion: getActiveSelfCodeVersion(),
        timestamps: { completedAt: new Date().toISOString() }
      });
      return { success: false, runId, proposalId: proposal.id, status: 'AWAITING_APPROVAL', stopReason };
    }

    // Check Rate Limit (Req 10)
    const recentPromos = getRecentPromotionsCount(policy.rateLimitWindowMs);
    if (recentPromos >= policy.maxAutonomousPromotionsPerWindow && options.ignoreRateLimit !== true) {
      const stopReason = `Rate limit exceeded: ${recentPromos} autonomous promotions performed within rate limit window (max: ${policy.maxAutonomousPromotionsPerWindow}).`;
      updateSelfCodeProposal(proposal.id, {
        status: SELF_CODE_PROPOSAL_STATUS.AWAITING_APPROVAL,
        approvalReason: stopReason
      });
      logAuditEvent(runId, 'approval_requested', { proposalId: proposal.id, reason: stopReason });
      updateSelfImprovementRun(runId, {
        status: 'AWAITING_APPROVAL',
        stopReason,
        promotionResult: { promoted: false, pendingApproval: true },
        activeVersion: getActiveSelfCodeVersion(),
        timestamps: { completedAt: new Date().toISOString() }
      });
      return { success: false, runId, proposalId: proposal.id, status: 'AWAITING_APPROVAL', stopReason };
    }

    // Check Failure Threshold (Req 10)
    const recentFailures = getRecentFailedProposalsCount();
    if (recentFailures >= policy.maxFailedProposalsBeforeSupervised && options.ignoreFailureThreshold !== true) {
      const stopReason = `Safety threshold reached: ${recentFailures} recent proposal failures require supervised operator review.`;
      updateSelfCodeProposal(proposal.id, {
        status: SELF_CODE_PROPOSAL_STATUS.AWAITING_APPROVAL,
        approvalReason: stopReason
      });
      logAuditEvent(runId, 'approval_requested', { proposalId: proposal.id, reason: stopReason });
      updateSelfImprovementRun(runId, {
        status: 'AWAITING_APPROVAL',
        stopReason,
        promotionResult: { promoted: false, pendingApproval: true },
        activeVersion: getActiveSelfCodeVersion(),
        timestamps: { completedAt: new Date().toISOString() }
      });
      return { success: false, runId, proposalId: proposal.id, status: 'AWAITING_APPROVAL', stopReason };
    }

    // Concurrency Protection (Req 8)
    const lockRes = acquirePromotionLock(runId);
    if (!lockRes.acquired) {
      const stopReason = lockRes.reason;
      updateSelfCodeProposal(proposal.id, {
        status: SELF_CODE_PROPOSAL_STATUS.AWAITING_APPROVAL,
        approvalReason: stopReason
      });
      logAuditEvent(runId, 'approval_requested', { proposalId: proposal.id, reason: stopReason });
      updateSelfImprovementRun(runId, {
        status: 'AWAITING_APPROVAL',
        stopReason,
        promotionResult: { promoted: false, pendingApproval: true },
        activeVersion: getActiveSelfCodeVersion(),
        timestamps: { completedAt: new Date().toISOString() }
      });
      return { success: false, runId, proposalId: proposal.id, status: 'AWAITING_APPROVAL', stopReason };
    }

    try {
      // Re-run promotion eligibility check immediately before application (Req 8)
      const recheck = checkSelfCodePromotionEligibility(proposal.id, options);
      if (!recheck.eligible) {
        const stopReason = `Pre-application promotion eligibility re-check failed: ${recheck.reasons.join('; ')}`;
        updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED });
        logAuditEvent(runId, 'proposal_rejected', { proposalId: proposal.id, reason: stopReason });
        updateSelfImprovementRun(runId, {
          status: 'REJECTED',
          stopReason,
          promotionResult: { promoted: false },
          activeVersion: getActiveSelfCodeVersion(),
          timestamps: { completedAt: new Date().toISOString() }
        });
        return { success: false, runId, proposalId: proposal.id, status: 'REJECTED', stopReason };
      }

      logAuditEvent(runId, 'promotion_started', { proposalId: proposal.id });

      // Execute Controlled Stage 5C Promotion
      const promoteRes = promoteSelfCodeVersion(proposal.id, options);

      if (promoteRes.promoted && promoteRes.success) {
        logAuditEvent(runId, 'promotion_completed', { proposalId: proposal.id, versionId: promoteRes.activeVersion });
        logAuditEvent(runId, 'health_check_passed', { proposalId: proposal.id, versionId: promoteRes.activeVersion });

        updateSelfImprovementRun(runId, {
          status: 'PROMOTED',
          promotionResult: { promoted: true, success: true, activeVersion: promoteRes.activeVersion },
          healthResult: { passed: true },
          activeVersion: promoteRes.activeVersion,
          candidateFingerprint,
          timestamps: { completedAt: new Date().toISOString() }
        });

        return {
          success: true,
          promoted: true,
          runId,
          proposalId: proposal.id,
          activeVersion: promoteRes.activeVersion,
          status: 'PROMOTED',
          proposal: promoteRes.proposal
        };
      } else if (promoteRes.rolledBack || promoteRes.healthCheckFailed) {
        logAuditEvent(runId, 'health_check_failed', { proposalId: proposal.id, error: promoteRes.error || promoteRes.reason });
        logAuditEvent(runId, 'automatic_rollback', { proposalId: proposal.id, reason: promoteRes.reason });

        updateSelfImprovementRun(runId, {
          status: 'ROLLED_BACK',
          stopReason: promoteRes.reason,
          promotionResult: { promoted: false, success: false, rolledBack: true },
          healthResult: { passed: false, error: promoteRes.error || promoteRes.reason },
          rollbackResult: promoteRes,
          activeVersion: getActiveSelfCodeVersion(),
          timestamps: { completedAt: new Date().toISOString() }
        });

        return {
          success: false,
          promoted: false,
          rolledBack: true,
          runId,
          proposalId: proposal.id,
          status: 'ROLLED_BACK',
          reason: promoteRes.reason
        };
      } else {
        logAuditEvent(runId, 'proposal_rejected', { proposalId: proposal.id, reason: promoteRes.reason });

        updateSelfImprovementRun(runId, {
          status: 'REJECTED',
          stopReason: promoteRes.reason,
          promotionResult: { promoted: false, success: false },
          activeVersion: getActiveSelfCodeVersion(),
          timestamps: { completedAt: new Date().toISOString() }
        });

        return {
          success: false,
          promoted: false,
          runId,
          proposalId: proposal.id,
          status: 'REJECTED',
          reason: promoteRes.reason
        };
      }
    } finally {
      releasePromotionLock(runId);
    }
  }

  return { success: false, runId, status: 'REJECTED', stopReason: 'Unknown autonomy mode' };
}

/**
 * Approves and promotes a proposal awaiting approval in SUPERVISED mode (Req 6 & Req 9)
 */
export function approveSelfCodeProposal(proposalId, options = {}) {
  const proposal = getSelfCodeProposalById(proposalId);
  if (!proposal) {
    return { approved: false, success: false, stale: false, error: `Proposal "${proposalId}" not found.` };
  }

  if (proposal.status !== SELF_CODE_PROPOSAL_STATUS.AWAITING_APPROVAL && proposal.status !== SELF_CODE_PROPOSAL_STATUS.VALIDATED) {
    return {
      approved: false,
      success: false,
      stale: false,
      error: `Proposal "${proposalId}" is in status "${proposal.status}" (must be AWAITING_APPROVAL or VALIDATED).`
    };
  }

  // Req 9: Base Version Freshness Check (Active Version Consistency)
  const currentActiveVersion = getActiveSelfCodeVersion();
  const proposalBaseVersion = proposal.baseVersion || proposal.baseCommit;
  if (proposalBaseVersion && proposalBaseVersion !== currentActiveVersion && options.ignoreStale !== true) {
    const err = `Stale approval rejected: Proposal was created on version "${proposalBaseVersion}", but current active version is "${currentActiveVersion}".`;
    updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED, rejectionReason: err });
    return { approved: false, success: false, stale: true, error: err };
  }

  // Req 9: Candidate Fingerprint Check (TOCTOU protection)
  const changes = proposal.proposedChanges || [];
  const currentFingerprint = computeCandidateFingerprint(changes);
  if (proposal.candidateFingerprint && proposal.candidateFingerprint !== currentFingerprint) {
    const err = 'Stale approval rejected: Candidate fingerprint mismatch since proposal creation.';
    updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED, rejectionReason: err });
    return { approved: false, success: false, stale: true, error: err };
  }

  // Req 9: Change Budget Re-verification
  const budgetCheck = validateChangeBudget(changes, options.changeBudget);
  if (!budgetCheck.valid) {
    const err = `Stale approval rejected: ${budgetCheck.error}`;
    updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED, rejectionReason: err });
    return { approved: false, success: false, stale: true, error: err };
  }

  // Req 8: Concurrency Protection (Promotion Lock)
  const lockRes = acquirePromotionLock(`approval_${proposal.id}`);
  if (!lockRes.acquired) {
    return { approved: false, success: false, stale: false, error: lockRes.reason };
  }

  const runRecord = createSelfImprovementRun({
    proposalId: proposal.id,
    baseVersion: currentActiveVersion,
    activeVersion: currentActiveVersion,
    autonomyMode: AUTONOMY_MODES.SUPERVISED,
    status: 'PROMOTING',
    promotionResult: { promoted: false }
  });

  try {
    logAuditEvent(runRecord.runId, 'promotion_started', { proposalId: proposal.id, operatorApproved: true });

    // Re-verify promotion eligibility immediately before application
    const eligibility = checkSelfCodePromotionEligibility(proposal.id, options);
    if (!eligibility.eligible) {
      const err = `Promotion eligibility check failed during approval: ${eligibility.reasons.join('; ')}`;
      updateSelfCodeProposal(proposal.id, { status: SELF_CODE_PROPOSAL_STATUS.REJECTED, rejectionReason: err });
      logAuditEvent(runRecord.runId, 'proposal_rejected', { proposalId: proposal.id, reason: err });
      updateSelfImprovementRun(runRecord.runId, {
        status: 'REJECTED',
        stopReason: err,
        promotionResult: { promoted: false },
        activeVersion: currentActiveVersion
      });
      return { approved: false, success: false, stale: true, error: err };
    }

    const promoteRes = promoteSelfCodeVersion(proposal.id, options);

    if (promoteRes.promoted && promoteRes.success) {
      logAuditEvent(runRecord.runId, 'promotion_completed', { proposalId: proposal.id, versionId: promoteRes.activeVersion });
      logAuditEvent(runRecord.runId, 'health_check_passed', { proposalId: proposal.id, versionId: promoteRes.activeVersion });

      updateSelfImprovementRun(runRecord.runId, {
        status: 'PROMOTED',
        promotionResult: { promoted: true, success: true, activeVersion: promoteRes.activeVersion },
        healthResult: { passed: true },
        activeVersion: promoteRes.activeVersion,
        timestamps: { completedAt: new Date().toISOString() }
      });

      return {
        approved: true,
        promoted: true,
        success: true,
        activeVersion: promoteRes.activeVersion,
        proposal: promoteRes.proposal,
        runId: runRecord.runId
      };
    } else if (promoteRes.rolledBack || promoteRes.healthCheckFailed) {
      logAuditEvent(runRecord.runId, 'health_check_failed', { proposalId: proposal.id, error: promoteRes.error || promoteRes.reason });
      logAuditEvent(runRecord.runId, 'automatic_rollback', { proposalId: proposal.id, reason: promoteRes.reason });

      updateSelfImprovementRun(runRecord.runId, {
        status: 'ROLLED_BACK',
        stopReason: promoteRes.reason,
        promotionResult: { promoted: false, success: false, rolledBack: true },
        healthResult: { passed: false, error: promoteRes.error || promoteRes.reason },
        rollbackResult: promoteRes,
        activeVersion: currentActiveVersion,
        timestamps: { completedAt: new Date().toISOString() }
      });

      return {
        approved: true,
        promoted: false,
        rolledBack: true,
        success: false,
        reason: promoteRes.reason,
        runId: runRecord.runId
      };
    } else {
      logAuditEvent(runRecord.runId, 'proposal_rejected', { proposalId: proposal.id, reason: promoteRes.reason });

      updateSelfImprovementRun(runRecord.runId, {
        status: 'REJECTED',
        stopReason: promoteRes.reason,
        promotionResult: { promoted: false, success: false },
        activeVersion: currentActiveVersion,
        timestamps: { completedAt: new Date().toISOString() }
      });

      return {
        approved: false,
        promoted: false,
        success: false,
        error: promoteRes.reason,
        runId: runRecord.runId
      };
    }
  } finally {
    releasePromotionLock(`approval_${proposal.id}`);
  }
}

export const selfCodeOrchestratorService = {
  getAutonomyPolicy,
  updateAutonomyPolicy,
  resetAutonomyPolicyToDefault,
  validateChangeBudget,
  isRecursiveOrSelfMetadataEvidence,
  runSelfImprovementPipeline,
  approveSelfCodeProposal,
  getSelfImprovementRuns,
  getSelfImprovementRunById
};
