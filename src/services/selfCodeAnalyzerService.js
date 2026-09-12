/**
 * Stage 5B & 5F: EVO Autonomous Self-Code Improvement Analysis Service
 * Analyzes execution evidence & performance/quality metrics to generate structured self-code proposals.
 */

import {
  createSelfCodeProposal,
  getSelfCodeProposals,
  SELF_CODE_PROPOSAL_STATUS
} from './selfCodeProposalStore.js';

import {
  validateProposedFilePath,
  FORBIDDEN_FILE_PATHS
} from './selfCodeSandboxService.js';

import { getFailureEvidences } from './capabilityStore.js';
import { getActiveSelfCodeVersion } from './selfCodeVersionStore.js';
import { actionEventStore } from './actionEventStore.js';
import { evaluationService } from './evaluationService.js';

export const PROBLEM_CATEGORIES = {
  CAPABILITY_WORKFLOW: 'CAPABILITY_WORKFLOW',
  ENVIRONMENTAL_OR_DATA: 'ENVIRONMENTAL_OR_DATA',
  EVO_IMPLEMENTATION: 'EVO_IMPLEMENTATION',
  EVO_PERFORMANCE_INEFFICIENCY: 'EVO_PERFORMANCE_INEFFICIENCY'
};

export const MIN_SELF_CODE_EVIDENCE_THRESHOLD = 2;
export const MIN_PERFORMANCE_EVIDENCE = 3;

/**
 * Classifies an execution failure or evidence record into problem categories
 */
export function classifyProblemCategory(evidenceOrError) {
  if (!evidenceOrError) return PROBLEM_CATEGORIES.ENVIRONMENTAL_OR_DATA;

  // Direct metric object or category check
  if (typeof evidenceOrError === 'object' && evidenceOrError !== null) {
    if (evidenceOrError.metricType || evidenceOrError.category === PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY) {
      return PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY;
    }
    if (evidenceOrError.category === PROBLEM_CATEGORIES.EVO_IMPLEMENTATION) {
      return PROBLEM_CATEGORIES.EVO_IMPLEMENTATION;
    }
  }

  const text = typeof evidenceOrError === 'string'
    ? evidenceOrError
    : JSON.stringify(evidenceOrError);

  const lower = text.toLowerCase();

  // 1. Environmental / Data / Input / Observation / Interaction / Launch Problems
  if (
    lower.includes('enoent') ||
    lower.includes('eacces') ||
    lower.includes('permission denied') ||
    lower.includes('invalid argument') ||
    lower.includes('user missing') ||
    lower.includes('disk full') ||
    lower.includes('network error') ||
    lower.includes('desktop_observation') ||
    lower.includes('desktopobservation') ||
    lower.includes('single_mouse_click') ||
    lower.includes('click_requested') ||
    lower.includes('desktop_interaction') ||
    lower.includes('application_launch') ||
    lower.includes('application launch') ||
    lower.includes('app_launch_requested') ||
    lower.includes('app_launch') ||
    lower.includes('app launch') ||
    lower.includes('application_control') ||
    lower.includes('application control') ||
    lower.includes('text_input') ||
    lower.includes('text input') ||
    lower.includes('request_text_input') ||
    lower.includes('text_input_requested') ||
    lower.includes('supervised_text_input') ||
    lower.includes('computer_task') ||
    lower.includes('create_computer_task') ||
    lower.includes('computer_action') ||
    lower.includes('supervised_computer_task') ||
    lower.includes('computer_autonomy_scope') ||
    lower.includes('request_autonomy_scope') ||
    lower.includes('approve_autonomy_scope') ||
    lower.includes('revoke_autonomy_scope') ||
    lower.includes('plan_autonomy_scope') ||
    lower.includes('validate_planned_scope') ||
    lower.includes('scope_planning') ||
    lower.includes('scope_proposal') ||
    lower.includes('scope_expansion_required') ||
    lower.includes('scope_violation') ||
    lower.includes('autonomy_budget_exceeded') ||
    lower.includes('bounded_autonomy')
  ) {
    return PROBLEM_CATEGORIES.ENVIRONMENTAL_OR_DATA;
  }

  // 2. Capability / Workflow Level Invariant Problems (Handled by Stage 2/3/4 Capability Self-Healing)
  if (
    lower.includes('failedinvariant') ||
    lower.includes('invariant_types') ||
    lower.includes('capability workflow') ||
    lower.includes('reused capability step')
  ) {
    return PROBLEM_CATEGORIES.CAPABILITY_WORKFLOW;
  }

  // 3. Performance / Quality Inefficiency (Stage 5F)
  if (
    lower.includes('duration_regression') ||
    lower.includes('planning_overhead') ||
    lower.includes('redundant_operations') ||
    lower.includes('step_bloat') ||
    lower.includes('performance_inefficiency')
  ) {
    return PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY;
  }

  // 4. EVO Implementation Defect / Engineering Weakness (Targets Self-Code Improvement)
  if (
    lower.includes('planner') ||
    lower.includes('objectiverunner') ||
    lower.includes('evolutionservice') ||
    lower.includes('parsingservice') ||
    lower.includes('executionengine') ||
    lower.includes('execution_engine') ||
    lower.includes('core_implementation_defect') ||
    lower.includes('execution_engine_step_resolution')
  ) {
    return PROBLEM_CATEGORIES.EVO_IMPLEMENTATION;
  }

  // Default fallback for capability level issues
  return PROBLEM_CATEGORIES.CAPABILITY_WORKFLOW;
}

/**
 * Stage 5F: Passive Read-Only Aggregation of Performance & Quality Metrics
 * Performs ZERO writes to execution/event/objective stores.
 */
export function collectPerformanceQualityMetrics(options = {}) {
  const metrics = [];

  // 1. Duration regressions
  const durRes = evaluationService.detectDurationRegressions(options.evaluations || null, options);
  if (durRes.detected && durRes.metric) {
    metrics.push(durRes.metric);
  }

  // 2. Planning overhead / step bloat
  const planRes = evaluationService.detectPlanningOverhead(options.evaluations || null, options);
  if (planRes.detected && planRes.metric) {
    metrics.push(planRes.metric);
  }

  // 3. Redundant operations
  const redRes = actionEventStore.detectRedundantOperations(options.actionEvents || null, options);
  if (redRes.detected && redRes.metric) {
    metrics.push(redRes.metric);
  }

  return metrics;
}

/**
 * Deterministically analyzes evidence records and generates structured self-code proposals
 * Priority is recurrence-weighted with deterministic tie-breaking and automatic fallback
 * to subsequent qualifying weaknesses if the top priority is already addressed/pending.
 */
export function analyzeEvidenceAndGenerateProposal(evidenceList = [], options = {}) {
  let listToAnalyze = Array.isArray(evidenceList) ? [...evidenceList] : [];

  // If list is empty, passively query performance metrics from stores (Read-Only)
  if (listToAnalyze.length === 0) {
    const perfMetrics = collectPerformanceQualityMetrics(options);
    listToAnalyze = [...perfMetrics];
  }

  if (listToAnalyze.length === 0) {
    return {
      generated: false,
      reason: 'No evidence records or performance metrics available for analysis.',
      proposal: null
    };
  }

  // Filter out non-self-code problems (environmental, user, capability-owned)
  const eligibleEvidence = listToAnalyze.filter((ev) => {
    const cat = classifyProblemCategory(ev);
    return cat === PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY || cat === PROBLEM_CATEGORIES.EVO_IMPLEMENTATION;
  });

  if (eligibleEvidence.length === 0) {
    return {
      generated: false,
      reason: 'No self-code implementation defects or performance inefficiencies found in evidence.',
      proposal: null
    };
  }

  // 1. Group eligible evidence into logical weakness groups using existing fields
  const groupsMap = new Map();

  for (const ev of eligibleEvidence) {
    const category = classifyProblemCategory(ev);
    let affectedComponent = 'plannerService';
    let subKey = '';

    if (category === PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY) {
      const metricType = ev.metricType || 'PERFORMANCE_INEFFICIENCY';
      if (metricType === 'PLANNING_OVERHEAD' || metricType === 'REDUNDANT_OPERATIONS') {
        affectedComponent = 'plannerService';
      } else if (metricType === 'DURATION_REGRESSION') {
        affectedComponent = 'executionEngine';
      } else {
        affectedComponent = ev.affectedComponent || 'plannerService';
      }
      subKey = metricType;
    } else {
      affectedComponent = ev.affectedComponent || ev.component || 'plannerService';
      subKey = ev.problemStatement || 'core_implementation_defect';
    }

    const groupKey = `${category}:${affectedComponent}:${subKey}`;

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        groupKey,
        category,
        affectedComponent,
        subKey,
        evidenceItems: [],
        sample: ev
      });
    }

    const grp = groupsMap.get(groupKey);
    grp.evidenceItems.push(ev);
    if (!grp.sample || (ev.problemStatement && !grp.sample.problemStatement)) {
      grp.sample = ev;
    }
  }

  // Calculate evidenceCount and check thresholds for each group
  const qualifyingGroups = [];

  for (const grp of groupsMap.values()) {
    let count = grp.evidenceItems.length;
    if (grp.category === PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY) {
      const sample = grp.sample;
      const sampleSize = sample.sampleSize || sample.evidenceIds?.length || count;
      count = Math.max(count, sampleSize);
    }
    grp.evidenceCount = count;

    const minThresh = grp.category === PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY
      ? (options.minPerformanceThreshold || MIN_PERFORMANCE_EVIDENCE)
      : (options.minThreshold || MIN_SELF_CODE_EVIDENCE_THRESHOLD);

    if (grp.evidenceCount >= minThresh) {
      qualifyingGroups.push(grp);
    }
  }

  if (qualifyingGroups.length === 0) {
    const minCore = options.minThreshold || MIN_SELF_CODE_EVIDENCE_THRESHOLD;
    const minPerf = options.minPerformanceThreshold || MIN_PERFORMANCE_EVIDENCE;
    return {
      generated: false,
      reason: `Insufficient evidence threshold for self-code proposal (core required >= ${minCore}, perf required >= ${minPerf}).`,
      proposal: null
    };
  }

  // 2. Deterministic ordering: Recurrence (evidenceCount) descending, then alphabetical tie-breakers
  qualifyingGroups.sort((a, b) => {
    if (b.evidenceCount !== a.evidenceCount) {
      return b.evidenceCount - a.evidenceCount; // Primary: Recurrence / volume
    }
    if (a.affectedComponent !== b.affectedComponent) {
      return a.affectedComponent.localeCompare(b.affectedComponent); // Tie-breaker 1: Component name
    }
    if (a.subKey !== b.subKey) {
      return a.subKey.localeCompare(b.subKey); // Tie-breaker 2: SubKey / Problem type
    }
    return a.category.localeCompare(b.category); // Tie-breaker 3: Category
  });

  // 3. Fallback iteration over sorted qualifying groups
  const existingProposals = getSelfCodeProposals();
  const skippedDuplicates = [];

  for (let i = 0; i < qualifyingGroups.length; i++) {
    const group = qualifyingGroups[i];
    const sample = group.sample;
    const category = group.category;
    const affectedComponent = group.affectedComponent;

    // Determine target files
    const targetFiles = sample.targetFiles || (
      category === PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY && group.subKey === 'DURATION_REGRESSION'
        ? ['src/services/executionEngine.js']
        : [`src/services/${affectedComponent}.js`]
    );

    // Validate security of target files
    let pathSecure = true;
    let pathError = '';
    for (const tf of targetFiles) {
      const check = validateProposedFilePath(tf);
      if (!check.valid) {
        pathSecure = false;
        pathError = check.error;
        break;
      }
    }

    if (!pathSecure) {
      // Security rejection for this target file
      continue;
    }

    // Check idempotency / duplicate / resolved status
    const duplicate = existingProposals.find((p) => {
      if (p.affectedComponent !== affectedComponent) return false;
      // If proposal is REJECTED or ROLLED_BACK or FAILED, it does not block this group
      if (p.status === SELF_CODE_PROPOSAL_STATUS.REJECTED || p.status === 'ROLLED_BACK' || p.status === 'FAILED') {
        return false;
      }
      // If status is PROPOSED, VALIDATED, APPLIED, or PROMOTED:
      const matchEvidence = Array.isArray(p.evidenceIds) && group.evidenceItems.some((e) => p.evidenceIds.includes(e.id || e.evidenceId));
      const matchProblem = Boolean(p.problemStatement && (group.subKey && p.problemStatement.includes(group.subKey)));
      const sameComponentActive = (p.status === SELF_CODE_PROPOSAL_STATUS.PROPOSED || p.status === SELF_CODE_PROPOSAL_STATUS.VALIDATED || p.status === SELF_CODE_PROPOSAL_STATUS.APPLIED);
      return matchEvidence || matchProblem || sameComponentActive;
    });

    if (duplicate) {
      skippedDuplicates.push({ group, proposal: duplicate });
      continue; // Fallback to next qualifying group
    }

    // Found unaddressed qualifying group! Generate proposal with rationale.
    const rank = i + 1;
    const totalGroups = qualifyingGroups.length;
    const fallbackNotice = skippedDuplicates.length > 0
      ? ` (fallback from ${skippedDuplicates.length} prior duplicate/pending group(s): ${skippedDuplicates.map((d) => d.group.affectedComponent).join(', ')})`
      : '';
    const rationale = `[Priority: count=${group.evidenceCount}, component=${affectedComponent}, rank=${rank}/${totalGroups}${fallbackNotice}]`;

    let problemStatement = '';
    let baseReason = '';
    let expectedImprovement = '';

    if (category === PROBLEM_CATEGORIES.EVO_PERFORMANCE_INEFFICIENCY) {
      problemStatement = `Recurring performance inefficiency (${group.subKey}) detected in ${affectedComponent} across ${group.evidenceCount} distinct objectives.`;
      baseReason = `Automated Stage 5F self-code improvement proposal generated from ${group.evidenceCount} recurring performance metric observations. ${rationale}`;
      expectedImprovement = `Optimizes ${group.subKey} in ${affectedComponent} to improve execution efficiency.`;
    } else {
      problemStatement = sample.problemStatement || `Recurring implementation weakness detected in ${affectedComponent} across ${group.evidenceCount} executions.`;
      baseReason = (sample.reason || `Automated Stage 5B self-code improvement proposal generated from ${group.evidenceCount} recurring core evidence records.`) + ` ${rationale}`;
      expectedImprovement = sample.expectedImprovement || `Resolves core execution defect in ${affectedComponent} and improves step resolution correctness.`;
    }

    const evidenceIds = group.evidenceItems.map((e) => e.id || `ev_${Math.random().toString(36).substring(2, 6)}`);
    const proposedChanges = options.proposedChanges || sample.proposedChanges || [
      {
        filePath: targetFiles[0],
        content: sample.proposedContent || `// Stage 5B/5F Self-Code Improvement Fix for ${affectedComponent}\n`
      }
    ];

    const createRes = createSelfCodeProposal({
      baseVersion: options.baseVersion || getActiveSelfCodeVersion(),
      problemStatement,
      evidenceIds,
      affectedComponent,
      targetFiles,
      reason: baseReason,
      expectedImprovement,
      proposedChanges,
      confidence: options.confidence || 0.85,
      status: SELF_CODE_PROPOSAL_STATUS.PROPOSED
    });

    return {
      generated: true,
      duplicate: false,
      reason: `Self-code improvement proposal generated successfully. ${rationale}`,
      proposal: createRes.proposal,
      evidenceCount: group.evidenceCount
    };
  }

  // If all qualifying groups were skipped as duplicates, return duplicate status with top duplicate proposal
  if (skippedDuplicates.length > 0) {
    return {
      generated: true,
      duplicate: true,
      reason: 'Existing pending or applied self-code proposal found for affected component(s).',
      proposal: skippedDuplicates[0].proposal
    };
  }

  return {
    generated: false,
    reason: 'No qualifying unaddressed self-code proposal could be generated.',
    proposal: null
  };
}

export const selfCodeAnalyzerService = {
  classifyProblemCategory,
  collectPerformanceQualityMetrics,
  analyzeEvidenceAndGenerateProposal,
  PROBLEM_CATEGORIES,
  MIN_SELF_CODE_EVIDENCE_THRESHOLD,
  MIN_PERFORMANCE_EVIDENCE
};
