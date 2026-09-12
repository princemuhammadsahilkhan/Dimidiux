import {
  getCapabilities,
  getProcessedEvolutionObjectiveIds,
  isObjectiveProcessedForEvolution,
  markObjectiveProcessedForEvolution,
  recordCapabilityUsage,
  getImprovementProposals,
  PROPOSAL_STATUS,
  recordFailureEvidence
} from './capabilityStore.js';
import {
  matchCapabilities,
  reuseCapability,
  evaluateCapabilityCandidates,
  validateAllCapabilityCandidates,
  proposeCapabilityImprovement,
  validateImprovement,
  applyCapabilityImprovement,
  promoteRepairCandidate,
  checkPromotionEligibility,
  rollbackCapability,
  evaluateCapabilityInvariants,
  extractGoalParameters,
  generateCapabilityRepairCandidate
} from './capabilityService.js';
import { extractExperienceFromObjective } from './memoryService.js';
import { getMemories } from './memoryStore.js';
import { getObjectives, updateObjectiveEvolutionMetadata, setObjectivePlan } from './objectiveStore.js';
import { plannerService } from './plannerService.js';
import { evaluationService } from './evaluationService.js';
import { getEventsByObjective } from './actionEventStore.js';
import {
  createSelfCodeProposal,
  getSelfCodeProposals,
  getSelfCodeProposalById,
  rejectSelfCodeProposal
} from './selfCodeProposalStore.js';
import {
  selfCodeSandboxService,
  validateProposedFilePath,
  testSelfCodeProposalInSandbox
} from './selfCodeSandboxService.js';
import {
  selfCodeAnalyzerService,
  classifyProblemCategory,
  analyzeEvidenceAndGenerateProposal
} from './selfCodeAnalyzerService.js';
import {
  selfCodePromotionService,
  compareSelfCodeCandidate,
  checkSelfCodePromotionEligibility,
  promoteSelfCodeVersion,
  rollbackSelfCodeVersion
} from './selfCodePromotionService.js';
import {
  getSelfCodeVersionState,
  getActiveSelfCodeVersion
} from './selfCodeVersionStore.js';
import {
  selfCodeOrchestratorService,
  runSelfImprovementPipeline,
  approveSelfCodeProposal
} from './selfCodeOrchestratorService.js';
import {
  getAutonomyPolicy,
  updateAutonomyPolicy,
  resetAutonomyPolicyToDefault,
  getSelfImprovementRuns,
  getSelfImprovementRunById
} from './selfCodeOrchestratorStore.js';

import {
  createRuntimeLearningRecord,
  getRuntimeLearningRecords,
  saveRuntimeLearningRecords,
  getRuntimeLearningRecordByObjective,
  getRuntimeLearningRecordById,
  getSystemLearningOverview,
  LEARNING_CATEGORIES,
  LEARNING_STATUS
} from './runtimeLearningStore.js';
import { isRecursiveOrSelfMetadataEvidence } from './selfCodeOrchestratorService.js';
import { desktopObservationService } from './desktopObservationService.js';
import { computerInteractionService } from './computerInteractionService.js';
import { visualTargetService, validateTargetProposal } from './visualTargetService.js';
import { applicationControlService } from './applicationControlService.js';
import { computerTaskService } from './computerTaskService.js';

export const EXECUTION_MODES = {
  NORMAL_PLAN: 'NORMAL_PLAN',
  REUSED_CAPABILITY: 'REUSED_CAPABILITY'
};

/**
 * EvolutionService — Orchestrator for Step 8 + Step 9 + Stage 5/6 Lifecycle
 */
export class EvolutionService {
  /**
   * 1. Orchestrates Objective Creation / Planning:
   * Checks for a compatible VALIDATED capability match.
   * If MATCH (score >= 0.7): Adapts capability, records evolution metadata at START, binds plan to NEW objective.
   * If NO MATCH: Falls back to standard plannerService.generatePlan (Rule 2: Keep planning separate).
   * Supports options for Controlled Experiments (Milestone 7): { isExperiment, disableReuse, explicitCapabilityId, explicitCapabilityVersion, adaptedParams }
   */
  async createOrPrepareObjectivePlan(objectiveId, goalText, options = {}) {
    const objectives = getObjectives();
    const obj = objectives.find((o) => o.id === objectiveId);
    if (!obj) {
      return { success: false, error: 'Target objective not found.' };
    }

    const {
      isExperiment = false,
      disableReuse = false,
      explicitCapabilityId = null,
      explicitCapabilityVersion = null,
      adaptedParams = {}
    } = options;

    // Milestone 7 Rule: BASELINE group or explicitly disabled reuse
    if (disableReuse) {
      updateObjectiveEvolutionMetadata(objectiveId, {
        capabilityId: null,
        capabilityVersion: null,
        executionMode: EXECUTION_MODES.NORMAL_PLAN,
        reusedCapability: false,
        isExperiment
      });

      const planRes = await plannerService.generatePlan({ goal: goalText });
      if (planRes.success) {
        let planToUse = planRes.plan;
        const prefix = adaptedParams.folder || adaptedParams.targetDir;
        if (prefix) {
          planToUse = planToUse.map((step) => {
            const newAction = { ...step.action };
            if (newAction.path && !newAction.path.startsWith(prefix)) {
              newAction.path = `${prefix}/${newAction.path}`;
            }
            if (newAction.source && !newAction.source.startsWith(prefix)) {
              newAction.source = `${prefix}/${newAction.source}`;
            }
            if (newAction.destination && !newAction.destination.startsWith(prefix)) {
              newAction.destination = `${prefix}/${newAction.destination}`;
            }
            return { ...step, action: newAction };
          });
        }
        setObjectivePlan(objectiveId, planToUse);
        const updatedObj = getObjectives().find((o) => o.id === objectiveId);
        return {
          success: true,
          executionMode: EXECUTION_MODES.NORMAL_PLAN,
          objective: updatedObj,
          plan: planToUse
        };
      }
      return { success: false, error: planRes.error || 'Planning failed.' };
    }

    // Milestone 7 Rule: Explicit Capability & Version Pinning (REUSED / EVOLVED groups)
    if (explicitCapabilityId && explicitCapabilityVersion) {
      const evolutionMetadata = {
        capabilityId: explicitCapabilityId,
        capabilityVersion: explicitCapabilityVersion,
        executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
        reusedCapability: true,
        isExperiment
      };

      const reuseRes = await reuseCapability(explicitCapabilityId, objectiveId, adaptedParams, {
        execute: false,
        evolutionMetadata
      });
      if (reuseRes.success) {
        const updatedObj = getObjectives().find((o) => o.id === objectiveId);
        return {
          success: true,
          executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
          objective: updatedObj,
          plan: updatedObj ? updatedObj.plan : []
        };
      }
    }

    // Step A: Check for reusable validated capability match
    const matchRes = matchCapabilities(goalText);

    if (matchRes && matchRes.matched && matchRes.capabilityId) {
      const cap = getCapabilities().find((c) => c.id === matchRes.capabilityId);
      const capVersion = cap ? (cap.activeVersion || cap.version || 1) : 1;

      // RULE 4 & 5: Capture capabilityId, capabilityVersion, executionMode AT EXECUTION START
      const evolutionMetadata = {
        capabilityId: matchRes.capabilityId,
        capabilityVersion: capVersion,
        executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
        reusedCapability: true,
        matchedConfidence: matchRes.confidence,
        matchedReasons: matchRes.reasons,
        isExperiment
      };

      // Reuse capability (adapts params & binds plan with evolution metadata in single atomic write)
      const reuseRes = await reuseCapability(matchRes.capabilityId, objectiveId, matchRes.adaptedParams, {
        execute: false,
        evolutionMetadata
      });
      if (reuseRes.success) {
        const updatedObj = getObjectives().find((o) => o.id === objectiveId);
        return {
          success: true,
          executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
          objective: updatedObj,
          capability: cap,
          plan: updatedObj ? updatedObj.plan : []
        };
      }
    }

    // Step B: Fallback to standard PlannerService provider (Rule 2)
    updateObjectiveEvolutionMetadata(objectiveId, {
      capabilityId: null,
      capabilityVersion: null,
      executionMode: EXECUTION_MODES.NORMAL_PLAN,
      reusedCapability: false,
      isExperiment
    });

    const planRes = await plannerService.generatePlan({ goal: goalText });
    if (planRes.success) {
      setObjectivePlan(objectiveId, planRes.plan);
      const updatedObj = getObjectives().find((o) => o.id === objectiveId);
      return {
        success: true,
        executionMode: EXECUTION_MODES.NORMAL_PLAN,
        objective: updatedObj,
        plan: planRes.plan
      };
    }

    return {
      success: false,
      error: planRes.error || 'Planning failed.'
    };
  }

  /**
   * 2. Orchestrates Objective Completion (IDEMPOTENT processing, Stage 6A)
   * Processed ONCE per objective ID with unified Runtime Learning Loop.
   */
  async handleObjectiveCompletion(objective) {
    if (!objective || !objective.id) return { processed: false, reason: 'Invalid objective object.' };

    // Idempotency check: Prevent duplicate processing or recursive loops
    if (isObjectiveProcessedForEvolution(objective.id)) {
      const existingRecord = getRuntimeLearningRecordByObjective(objective.id);
      return {
        processed: true,
        alreadyProcessed: true,
        learningRecord: existingRecord,
        reason: 'Objective already processed for evolution and runtime learning.'
      };
    }

    // Milestone 7 Critical Rule: Experiments MUST NOT contaminate EVO evolution state!
    const evoMeta = objective.evolution || objective.evolutionMetadata || {};
    if (evoMeta.isExperiment) {
      markObjectiveProcessedForEvolution(objective.id);
      return {
        processed: true,
        isExperiment: true,
        objectiveId: objective.id,
        reason: 'Experiment run completed without evolution side effects.'
      };
    }

    try {
      const isSuccess = objective.status === 'COMPLETED';
      const evidenceIds = [];
      let expResult = null;
      let evalRecord = null;
      let failureEvidenceId = null;
      let proposalId = null;
      let metricIds = [];

      // Step A: Extract Step 8 Experience
      try {
        expResult = extractExperienceFromObjective(objective);
        if (expResult && expResult.id) {
          evidenceIds.push(expResult.id);
        }
      } catch (e) {
        console.error('EvolutionService: Experience extraction failed:', e);
      }

      // Step B: Record Version-Specific Capability Usage (Rule 4 & 6)
      const reusedCapId = evoMeta.capabilityId;
      const capVersion = evoMeta.capabilityVersion;

      if (reusedCapId) {
        recordCapabilityUsage(reusedCapId, isSuccess, capVersion);

        // Stage 2 Self-Healing: Invariant Check, Failure Evidence Capture & Repair Candidate Generation
        try {
          const targetParams = extractGoalParameters(objective.goal);
          const invEval = await evaluateCapabilityInvariants(reusedCapId, {
            rootPath: objective.root || undefined,
            targetParams,
            version: capVersion
          });

          if (invEval && !invEval.success && Array.isArray(invEval.results)) {
            const failedInvariants = invEval.results.filter((r) => !r.passed);
            for (const failedInv of failedInvariants) {
              const precedingStep = Array.isArray(objective.completedSteps) && objective.completedSteps.length > 0
                ? objective.completedSteps[objective.completedSteps.length - 1]
                : (Array.isArray(objective.plan) && objective.plan.length > 0 ? objective.plan[0] : null);

              const evidence = recordFailureEvidence({
                capabilityId: reusedCapId,
                capabilityVersion: capVersion,
                objectiveId: objective.id,
                failedInvariantId: failedInv.id,
                failedInvariantType: failedInv.type,
                targetPath: failedInv.targetPath,
                expected: failedInv.expected,
                actual: failedInv.actual,
                precedingStep,
                targetParams,
                timestamp: new Date().toISOString()
              });

              if (evidence && evidence.id) {
                evidenceIds.push(evidence.id);
                failureEvidenceId = evidence.id;
              }

              // Generate localized NON-ACTIVE repair candidate
              generateCapabilityRepairCandidate(evidence.id);
            }
          }
        } catch (invErr) {
          console.error('EvolutionService: Failure evidence capture / repair generation failed:', invErr);
        }
      }

      // Step B2: Record Objective Evaluation (Milestone 6)
      try {
        evalRecord = evaluationService.recordObjectiveEvaluation(objective);
        if (evalRecord && evalRecord.id) {
          evidenceIds.push(evalRecord.id);
        }
      } catch (e) {
        console.error('EvolutionService: Objective evaluation recording failed:', e);
      }

      // Step C: Evaluate & Candidate-Create from Experiences (Rule 1 & 8)
      try {
        evaluateCapabilityCandidates();
      } catch (e) {
        console.error('EvolutionService: Candidate evaluation failed:', e);
      }

      // Step D: In-Memory Validation of Candidate Capabilities (Rule 2 & 8)
      try {
        validateAllCapabilityCandidates();
      } catch (e) {
        console.error('EvolutionService: Candidate validation failed:', e);
      }

      // Step E: Failure & Improvement Triggering (Rule 6, 9, 10, 11)
      if (reusedCapId) {
        this.processCapabilityImprovementsAndRollbacks(reusedCapId, capVersion);
      }

      // Step F: Stage 5F Passive Performance & Quality Metric Aggregation
      try {
        const perfMetrics = selfCodeAnalyzerService.collectPerformanceQualityMetrics();
        if (Array.isArray(perfMetrics) && perfMetrics.length > 0) {
          metricIds = perfMetrics.map((m) => m.id);
        }

        const objEvents = getEventsByObjective(objective.id) || [];
        const perfEvents = objEvents.filter((e) =>
          e.actionType === 'DURATION_REGRESSION' ||
          e.actionType === 'PLANNING_OVERHEAD' ||
          e.actionType === 'REDUNDANT_OPERATIONS' ||
          e.status === 'WARNING'
        );
        if (perfEvents.length > 0) {
          const perfEventIds = perfEvents.map((e) => e.id);
          metricIds = Array.from(new Set([...metricIds, ...perfEventIds]));
        }
      } catch (perfErr) {
        console.error('EvolutionService: Performance metric collection failed:', perfErr);
      }

      // Step G: Stage 5B / 5F Self-Code Analysis Check & Recursion Safeguard
      try {
        const isRecursive = isRecursiveOrSelfMetadataEvidence(objective);
        if (!isRecursive) {
          const proposalRes = selfCodeAnalyzerService.analyzeEvidenceAndGenerateProposal();
          if (proposalRes && proposalRes.generated && proposalRes.proposal) {
            proposalId = proposalRes.proposal.id;
          }
        }
      } catch (anaErr) {
        console.error('EvolutionService: Self-code analysis failed:', anaErr);
      }

      // Step H: Construct & Save Runtime Learning Record
      let category = LEARNING_CATEGORIES.USER_EXECUTION;
      if (proposalId) {
        category = LEARNING_CATEGORIES.SELF_CODE_ANALYSIS;
      } else if (metricIds.length > 0) {
        category = LEARNING_CATEGORIES.PERFORMANCE_DIAGNOSIS;
      } else if (reusedCapId) {
        category = LEARNING_CATEGORIES.CAPABILITY_LEARNING;
      }

      const autonomyPolicy = getAutonomyPolicy();
      const proposalGenerated = Boolean(proposalId);
      const approvalRequired = proposalGenerated && autonomyPolicy.mode === 'SUPERVISED';

      const startedAt = objective.createdAt || new Date().toISOString();
      const completedAt = objective.updatedAt || new Date().toISOString();
      const startMs = new Date(startedAt).getTime();
      const endMs = new Date(completedAt).getTime();
      const executionDurationMs = Math.max(0, endMs - startMs);

      const learningRecord = createRuntimeLearningRecord({
        objectiveId: objective.id,
        goal: objective.goal || '',
        category,
        evidenceIds,
        capabilityId: reusedCapId || null,
        capabilityVersion: capVersion || null,
        evaluationId: evalRecord ? evalRecord.id : null,
        performanceMetricIds: metricIds,
        selfCodeProposalId: proposalId,
        timestamps: {
          startedAt,
          completedAt
        },
        status: isSuccess ? LEARNING_STATUS.COMPLETED : LEARNING_STATUS.FAILED,
        summary: {
          success: isSuccess,
          executionMode: evoMeta.executionMode || 'NORMAL_PLAN',
          executionDurationMs,
          stepCount: Array.isArray(objective.plan) ? objective.plan.length : 0,
          experienceCreated: Boolean(expResult),
          evaluationResult: evalRecord ? evalRecord.evaluationResult : null,
          proposalGenerated,
          approvalRequired
        }
      });

      // Mark objective as processed (IDEMPOTENT persistence)
      markObjectiveProcessedForEvolution(objective.id);

      return {
        processed: true,
        objectiveId: objective.id,
        status: objective.status,
        experienceRecorded: Boolean(expResult),
        learningRecord
      };
    } catch (err) {
      console.error('EvolutionService error during objective completion:', err);
      return { processed: false, error: err.message };
    }
  }

  /**
   * 3. Process Capability Improvements & Version-Aware Rollbacks (Rule 6, 9, 11)
   */
  processCapabilityImprovementsAndRollbacks(capabilityId, targetVersion) {
    const capabilities = getCapabilities();
    const cap = capabilities.find((c) => c.id === capabilityId);
    if (!cap) return;

    const ver = targetVersion || cap.activeVersion || cap.version || 1;
    const versionStats = (cap.versionStats && cap.versionStats[ver]) ? cap.versionStats[ver] : null;

    const failedCount = versionStats ? (versionStats.failedUseCount || 0) : (cap.failedUseCount || 0);

    // Rule 9: If version accumulated repeated failures (failedUseCount >= 2), propose & validate improvement
    if (failedCount >= 2) {
      const proposals = getImprovementProposals(capabilityId);
      let pending = proposals.find((p) => p.status === PROPOSAL_STATUS.PROPOSED);

      if (!pending) {
        const propRes = proposeCapabilityImprovement(capabilityId, {
          reason: `Automated improvement proposed due to repeated failures on version ${ver} (failedUseCount = ${failedCount})`,
          baseVersion: ver
        });
        if (propRes.proposed && propRes.proposal) {
          pending = propRes.proposal;
        }
      }

      // Validate proposal (sets validationStatus = VALIDATED, eligibilityStatus = ELIGIBLE)
      if (pending && pending.status === PROPOSAL_STATUS.PROPOSED) {
        validateImprovement(pending.id);
      }

      // Rule 9 CRITICAL: DO NOT automatically apply! Application remains controlled via applyValidatedImprovement.

      // Rule 11: If active version has previous version history and accumulated failures, check rollback eligibility
      if (cap.versionHistory && cap.versionHistory.length > 0 && ver === cap.activeVersion) {
        rollbackCapability(capabilityId, `Automated rollback due to version ${ver} failure threshold (failedUseCount = ${failedCount})`);
      }
    }
  }

  /**
   * 4. Controlled Improvement Application / Stage 4 Candidate Promotion
   * Must be called explicitly for controlled transition (PROPOSED -> VALIDATED -> CONTROLLED APPLY -> NEW VERSION)
   */
  checkPromotionEligibility(proposalIdOrObj, options = {}) {
    return checkPromotionEligibility(proposalIdOrObj, options);
  }

  promoteValidatedCandidate(proposalIdOrObj, options = {}) {
    return promoteRepairCandidate(proposalIdOrObj, options);
  }

  applyValidatedImprovement(proposalId, options = {}) {
    return promoteRepairCandidate(proposalId, options);
  }

  /**
   * 5. Stage 5A: Self-Code Improvement Proposal & Sandbox Testing
   */
  createSelfCodeProposal(data) {
    return createSelfCodeProposal(data);
  }

  getSelfCodeProposals() {
    return getSelfCodeProposals();
  }

  testSelfCodeProposalInSandbox(proposalIdOrObj, options = {}) {
    return testSelfCodeProposalInSandbox(proposalIdOrObj, options);
  }

  validateProposedFilePath(filePath) {
    return validateProposedFilePath(filePath);
  }

  /**
   * 6. Stage 5B: Autonomous Self-Code Improvement Proposal Generation
   */
  classifyProblemCategory(evidenceOrError) {
    return classifyProblemCategory(evidenceOrError);
  }

  analyzeEvidenceAndGenerateProposal(evidenceList = [], options = {}) {
    return analyzeEvidenceAndGenerateProposal(evidenceList, options);
  }

  /**
   * 7. Stage 5C: Controlled Self-Code Promotion, Comparison, Versioning, and Rollback
   */
  compareSelfCodeCandidate(proposalIdOrObj, options = {}) {
    return compareSelfCodeCandidate(proposalIdOrObj, options);
  }

  checkSelfCodePromotionEligibility(proposalIdOrObj, options = {}) {
    return checkSelfCodePromotionEligibility(proposalIdOrObj, options);
  }

  promoteSelfCodeVersion(proposalIdOrObj, options = {}) {
    return promoteSelfCodeVersion(proposalIdOrObj, options);
  }

  rollbackSelfCodeVersion(versionIdOrOptions, reasonStr) {
    return rollbackSelfCodeVersion(versionIdOrOptions, reasonStr);
  }

  getSelfCodeVersionState() {
    return getSelfCodeVersionState();
  }

  getActiveSelfCodeVersion() {
    return getActiveSelfCodeVersion();
  }

  /**
   * 8. Stage 5D: Autonomous Self-Improvement Orchestration
   */
  async runSelfImprovementPipeline(evidenceList = [], options = {}) {
    return runSelfImprovementPipeline(evidenceList, options);
  }

  approveSelfCodeProposal(proposalId, options = {}) {
    return approveSelfCodeProposal(proposalId, options);
  }

  rejectSelfCodeProposal(proposalId, reason = 'Operator rejected proposal') {
    return rejectSelfCodeProposal(proposalId, reason);
  }

  getAutonomyPolicy() {
    return getAutonomyPolicy();
  }

  updateAutonomyPolicy(updates = {}) {
    return updateAutonomyPolicy(updates);
  }

  resetAutonomyPolicyToDefault() {
    return resetAutonomyPolicyToDefault();
  }

  getSelfImprovementRuns() {
    return getSelfImprovementRuns();
  }

  getSelfImprovementRunById(id) {
    return getSelfImprovementRunById(id);
  }

  /**
   * Stage 6A Runtime Learning Facades
   */
  getRuntimeLearningRecords(filter = null) {
    return getRuntimeLearningRecords(filter);
  }

  getRuntimeLearningRecordByObjective(objectiveId) {
    return getRuntimeLearningRecordByObjective(objectiveId);
  }

  getRuntimeLearningRecordById(id) {
    return getRuntimeLearningRecordById(id);
  }

  getSystemLearningOverview() {
    return getSystemLearningOverview();
  }

  /**
   * Stage 7A Desktop Observation Facades
   */
  getDesktopObservation(options = {}) {
    return desktopObservationService.getDesktopObservation(options);
  }

  getActiveApplication() {
    return desktopObservationService.getActiveApplication();
  }

  getOpenWindows() {
    return desktopObservationService.getOpenWindows();
  }

  getDesktopSnapshot() {
    return desktopObservationService.getDesktopSnapshot();
  }

  getApplicationState(applicationId) {
    return desktopObservationService.getApplicationState(applicationId);
  }

  /**
   * Stage 7B Controlled Single-Click Computer Interaction Facades
   */
  requestMouseClick(target, options = {}) {
    return computerInteractionService.requestMouseClick(target, options);
  }

  approveMouseClick(interactionId, options = {}) {
    return computerInteractionService.approveMouseClick(interactionId, options);
  }

  cancelMouseClick(interactionId, reason) {
    return computerInteractionService.cancelMouseClick(interactionId, reason);
  }

  getPendingClickRequests() {
    return computerInteractionService.getPendingClickRequests();
  }

  getInteractionHistory() {
    return computerInteractionService.getInteractionHistory();
  }

  /**
   * Stage 7C Visual Target Understanding Facades
   */
  identifyClickableTarget(observation, objective, options = {}) {
    return visualTargetService.identifyClickableTarget(observation, objective, options);
  }

  validateTargetProposal(proposal, observation) {
    return validateTargetProposal(proposal, observation);
  }

  createClickProposalFromTarget(visualProposal, options = {}) {
    return computerInteractionService.createClickProposalFromTarget(visualProposal, options);
  }

  getVisualTargetProposals() {
    return visualTargetService.getProposalHistory();
  }

  /**
   * Stage 7D Controlled Application Launch Facades
   */
  listAllowedApplications() {
    return applicationControlService.listAllowedApplications();
  }

  requestApplicationLaunch(applicationId, options = {}) {
    return applicationControlService.requestApplicationLaunch(applicationId, options);
  }

  approveApplicationLaunch(requestId, options = {}) {
    return applicationControlService.approveApplicationLaunch(requestId, options);
  }

  cancelApplicationLaunch(requestId, reason) {
    return applicationControlService.cancelApplicationLaunch(requestId, reason);
  }

  verifyApplicationLaunch(applicationId, observation) {
    return applicationControlService.verifyApplicationLaunch(applicationId, observation);
  }

  getPendingLaunchRequests() {
    return applicationControlService.getPendingLaunchRequests();
  }

  /**
   * Stage 7E Controlled Supervised Text Input Facades
   */
  requestTextInput(target, text, options = {}) {
    return computerInteractionService.requestTextInput(target, text, options);
  }

  approveTextInput(requestId, options = {}) {
    return computerInteractionService.approveTextInput(requestId, options);
  }

  cancelTextInput(requestId, reason) {
    return computerInteractionService.cancelTextInput(requestId, reason);
  }

  verifyTextInput(target, expectedText, observation) {
    return computerInteractionService.verifyTextInput(target, expectedText, observation);
  }

  getPendingTextInputRequests() {
    return computerInteractionService.getPendingTextInputRequests();
  }

  /**
   * Stage 7F Controlled Multi-Step Computer Task Facades
   */
  createComputerTask(objective, options = {}) {
    return computerTaskService.createComputerTask(objective, options);
  }

  planComputerTask(objective) {
    return computerTaskService.planComputerTask(objective);
  }

  getComputerTask(taskId) {
    return computerTaskService.getComputerTask(taskId);
  }

  getPendingComputerActions(taskId = null) {
    return computerTaskService.getPendingComputerActions(taskId);
  }

  approveComputerAction(taskId, actionId, options = {}) {
    return computerTaskService.approveComputerAction(taskId, actionId, options);
  }

  cancelComputerTask(taskId, reason) {
    return computerTaskService.cancelComputerTask(taskId, reason);
  }

  pauseComputerTask(taskId, reason) {
    return computerTaskService.pauseComputerTask(taskId, reason);
  }

  resumeComputerTask(taskId) {
    return computerTaskService.resumeComputerTask(taskId);
  }

  verifyComputerTask(taskId) {
    return computerTaskService.verifyComputerTask(taskId);
  }

  /**
   * Stage 8A Scoped Computer Autonomy Policy Facades
   */
  requestAutonomyScope(taskId, details = {}) {
    return computerTaskService.requestAutonomyScope(taskId, details);
  }

  approveAutonomyScope(scopeId, options = {}) {
    return computerTaskService.approveAutonomyScope(scopeId, options);
  }

  revokeAutonomyScope(scopeId, reason = 'Operator revocation') {
    return computerTaskService.revokeAutonomyScope(scopeId, reason);
  }

  getAutonomyScope(identifier = null) {
    return computerTaskService.getAutonomyScope(identifier);
  }

  getAutonomyScopeHistory() {
    return computerTaskService.getAutonomyScopeHistory();
  }

  planAutonomyScope(taskOrObjective) {
    return computerTaskService.planAutonomyScope(taskOrObjective);
  }

  validatePlannedScope(scope, taskOrObjective) {
    return computerTaskService.validatePlannedScope(scope, taskOrObjective);
  }

  recoverComputerTask(taskId) {
    return computerTaskService.recoverComputerTask(taskId);
  }

  getRecoveryHistory(taskId = null) {
    return computerTaskService.getRecoveryHistory(taskId);
  }

  /**
   * 8. Returns High-Level Evolution System Overview
   */
  getEvolutionOverview() {
    const memories = getMemories();
    const capabilities = getCapabilities();
    const proposals = getImprovementProposals();
    const processedObjectiveIds = getProcessedEvolutionObjectiveIds();

    const candidates = capabilities.filter((c) => c.status === 'CANDIDATE');
    const validated = capabilities.filter((c) => c.status === 'VALIDATED');
    const rejected = capabilities.filter((c) => c.status === 'REJECTED');

    return {
      totalMemoriesCount: memories.length,
      capabilitiesCount: capabilities.length,
      candidatesCount: candidates.length,
      validatedCount: validated.length,
      rejectedCount: rejected.length,
      proposalsCount: proposals.length,
      processedObjectivesCount: processedObjectiveIds.length,
      capabilities,
      proposals
    };
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
