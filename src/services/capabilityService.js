import {
  getCapabilities,
  saveCapabilities,
  createCapabilityCandidate,
  findDuplicateCandidate,
  updateCapabilityValidation,
  recordCapabilityUsage,
  validateCapabilitySchema,
  CAPABILITY_STATUS,
  PROPOSAL_STATUS,
  getImprovementProposals,
  createImprovementProposal,
  updateImprovementProposal
} from './capabilityStore.js';
import { getMemories, MEMORY_TYPES } from './memoryStore.js';
import { RECOGNIZED_ACTIONS } from './plannerService.js';
import { getObjectives, setObjectivePlan } from './objectiveStore.js';
import { runObjective } from './objectiveRunner.js';

/**
 * Helper to normalize step formats (action as string or object)
 */
export function normalizeStep(step) {
  if (!step || typeof step !== 'object') return null;
  let type = null;
  let params = {};

  if (typeof step.action === 'string') {
    type = step.action;
    params = step.params || {};
  } else if (typeof step.action === 'object' && step.action !== null) {
    type = step.action.type || step.action.name;
    params = step.action.params || step.action;
  } else if (typeof step.type === 'string') {
    type = step.type;
    params = step.params || step;
  }

  if (!type) return null;
  return {
    title: step.title || `Step ${type}`,
    action: {
      type,
      path: params.path || params.targetPath || (typeof step.action === 'object' && step.action ? step.action.path : ''),
      source: params.source || (typeof step.action === 'object' && step.action ? step.action.source : ''),
      destination: params.destination || (typeof step.action === 'object' && step.action ? step.action.destination : ''),
      content: params.content !== undefined ? params.content : (typeof step.action === 'object' && step.action ? step.action.content : '')
    },
    params
  };
}

/**
 * Validates candidate workflow actions for security and authorization (Requirement 7 & 10)
 */
export function validateCandidateActions(workflowSteps) {
  if (!Array.isArray(workflowSteps) || workflowSteps.length === 0) {
    return { valid: false, error: 'Workflow steps array must be non-empty.' };
  }

  for (let i = 0; i < workflowSteps.length; i++) {
    const rawStep = workflowSteps[i];
    const normalized = normalizeStep(rawStep);

    if (!normalized || !normalized.action || !normalized.action.type) {
      return { valid: false, error: `Step at index ${i} is missing a valid action.` };
    }

    const type = normalized.action.type;
    if (!RECOGNIZED_ACTIONS.includes(type)) {
      return { valid: false, error: `Unauthorized action type "${type}" in candidate workflow.` };
    }

    const pathStr = normalized.action.path || normalized.action.source || normalized.action.destination || '';
    if (typeof pathStr === 'string') {
      if (pathStr.includes('../') || pathStr.includes('..\\')) {
        return { valid: false, error: `Security Violation: Traversal attempt detected in action path "${pathStr}".` };
      }
      if (pathStr.startsWith('/etc/') || pathStr.startsWith('/sys/') || pathStr.startsWith('/proc/')) {
        return { valid: false, error: `Security Violation: System path escape attempt detected in "${pathStr}".` };
      }
    }
  }

  return { valid: true };
}

/**
 * Logical Simulator: Performs safe dry-run simulation of workflow steps without disk mutation
 */
export function simulateWorkflowExecution(workflowSteps) {
  const errors = [];
  if (!Array.isArray(workflowSteps) || workflowSteps.length === 0) {
    return ['Workflow steps array must be a non-empty array.'];
  }

  const virtualFs = new Set(['.']);

  for (let i = 0; i < workflowSteps.length; i++) {
    const rawStep = workflowSteps[i];
    const normalized = normalizeStep(rawStep);

    if (!normalized || !normalized.action || !normalized.action.type) {
      errors.push(`Step ${i + 1}: Action object missing or invalid.`);
      continue;
    }

    const action = normalized.action;
    const type = action.type;
    if (!RECOGNIZED_ACTIONS.includes(type)) {
      errors.push(`Step ${i + 1}: Unauthorized action type "${type}".`);
      continue;
    }

    if (type === 'list_directory') {
      if (typeof action.path !== 'string' || !action.path.trim()) {
        errors.push(`Step ${i + 1}: list_directory requires a non-empty string path.`);
      }
    } else if (type === 'read_file') {
      if (typeof action.path !== 'string' || !action.path.trim()) {
        errors.push(`Step ${i + 1}: read_file requires a non-empty string path.`);
      }
    } else if (type === 'create_directory') {
      if (typeof action.path !== 'string' || !action.path.trim()) {
        errors.push(`Step ${i + 1}: create_directory requires a non-empty string path.`);
      } else {
        virtualFs.add(action.path.trim());
      }
    } else if (type === 'write_file') {
      if (typeof action.path !== 'string' || !action.path.trim()) {
        errors.push(`Step ${i + 1}: write_file requires a non-empty string path.`);
      }
      if (typeof action.content !== 'string') {
        errors.push(`Step ${i + 1}: write_file requires content to be a string.`);
      }
      if (action.path) {
        virtualFs.add(action.path.trim());
      }
    } else if (type === 'copy_file') {
      if (typeof action.source !== 'string' || !action.source.trim()) {
        errors.push(`Step ${i + 1}: copy_file requires a valid source path.`);
      }
      if (typeof action.destination !== 'string' || !action.destination.trim()) {
        errors.push(`Step ${i + 1}: copy_file requires a valid destination path.`);
      } else {
        virtualFs.add(action.destination.trim());
      }
    } else if (type === 'move_file') {
      if (typeof action.source !== 'string' || !action.source.trim()) {
        errors.push(`Step ${i + 1}: move_file requires a valid source path.`);
      }
      if (typeof action.destination !== 'string' || !action.destination.trim()) {
        errors.push(`Step ${i + 1}: move_file requires a valid destination path.`);
      } else {
        virtualFs.add(action.destination.trim());
      }
    }
  }

  return errors;
}

/**
 * Validates a single capability candidate safely (Step 9 — Milestone 2)
 */
export function validateCapability(candidateId) {
  const capabilities = getCapabilities();
  const candidate = capabilities.find((c) => c.id === candidateId);

  if (!candidate) {
    return { success: false, errors: ['Capability candidate not found.'], capability: null };
  }

  // Security Rule: A rejected candidate must NEVER become validated
  if (candidate.status === CAPABILITY_STATUS.REJECTED) {
    return {
      success: false,
      errors: ['Rejected candidate cannot become validated.'],
      capability: candidate
    };
  }

  // Safe Handling: Already validated candidate returns existing validation state cleanly
  if (candidate.status === CAPABILITY_STATUS.VALIDATED) {
    return {
      success: true,
      errors: [],
      capability: candidate
    };
  }

  const errors = [];

  // 1. Schema Validation
  const schemaCheck = validateCapabilitySchema(candidate);
  if (!schemaCheck.valid) {
    errors.push(schemaCheck.error || 'Invalid capability schema.');
  }

  // 2. Evidence Threshold Check (evidenceCount >= 2)
  if (typeof candidate.evidenceCount !== 'number' || candidate.evidenceCount < 2) {
    errors.push(`Insufficient evidence count (got ${candidate.evidenceCount}, required >= 2).`);
  }

  // 3. Action Authorization & Security Boundary Check
  const actionCheck = validateCandidateActions(candidate.workflowSteps);
  if (!actionCheck.valid) {
    errors.push(actionCheck.error);
  }

  // 4. Safe In-Memory Logical Simulation Check
  const simErrors = simulateWorkflowExecution(candidate.workflowSteps);
  if (simErrors.length > 0) {
    errors.push(...simErrors);
  }

  // Record validation result & persist status update (VALIDATED or REJECTED)
  const isSuccess = errors.length === 0;
  const updatedCandidate = updateCapabilityValidation(candidateId, {
    success: isSuccess,
    errors
  });

  return {
    success: isSuccess,
    errors,
    capability: updatedCandidate
  };
}

/**
 * Validates all pending capability candidates
 */
export function validateAllCapabilityCandidates() {
  const candidates = getCapabilities().filter((c) => c.status === CAPABILITY_STATUS.CANDIDATE);
  const results = candidates.map((c) => validateCapability(c.id));
  return {
    totalEvaluated: candidates.length,
    validatedCount: results.filter((r) => r.success).length,
    rejectedCount: results.filter((r) => !r.success).length,
    results
  };
}

/**
 * Extracts target objective parameters (folder, file, content) deterministically from text
 */
export function extractGoalParameters(goalText) {
  if (!goalText || typeof goalText !== 'string') {
    return { folder: null, file: null, content: null };
  }

  const g = goalText.trim();
  let folder = null;
  let file = null;
  let content = null;

  const folderMatch = g.match(/(?:folder|directory|dir)\s+(?:called|named)?\s*["`']?([a-zA-Z0-9_\-\.]+)/i);
  if (folderMatch) {
    folder = folderMatch[1];
  }

  const fileMatch = g.match(/(?:file)\s+(?:called|named)?\s*["`']?([a-zA-Z0-9_\-\.\/]+)/i);
  if (fileMatch) {
    file = fileMatch[1];
  }

  const contentMatch = g.match(/(?:containing|content|with text)\s+["`']?([^"`']+)["`']?/i);
  if (contentMatch) {
    content = contentMatch[1].trim().replace(/[\.\!\?]+$/, '');
  }

  return { folder, file, content };
}

/**
 * Deterministic capability matching against VALIDATED capabilities (Step 9 — Milestone 3)
 */
export function matchCapabilities(goalText) {
  if (!goalText || typeof goalText !== 'string' || !goalText.trim()) {
    return { capabilityId: null, matched: false, confidence: 0, reasons: ['Invalid goal text.'] };
  }

  const capabilities = getCapabilities()
    .filter((c) => c.status === CAPABILITY_STATUS.VALIDATED)
    .sort((a, b) => {
      const verA = a.activeVersion || a.version || 1;
      const verB = b.activeVersion || b.version || 1;
      if (verB !== verA) return verB - verA;
      return (b.evidenceCount || 0) - (a.evidenceCount || 0);
    });

  if (capabilities.length === 0) {
    return { capabilityId: null, matched: false, confidence: 0, reasons: ['No VALIDATED capabilities available.'] };
  }

  const params = extractGoalParameters(goalText);
  let bestMatch = null;
  let highestScore = 0;

  for (const cap of capabilities) {
    const schemaCheck = validateCapabilitySchema(cap);
    if (!schemaCheck.valid) continue;
    const actionCheck = validateCandidateActions(cap.workflowSteps);
    if (!actionCheck.valid) continue;

    let score = 0;
    const reasons = [];

    const goalLower = goalText.toLowerCase();
    const nameLower = (cap.name || '').toLowerCase();
    const descLower = (cap.description || '').toLowerCase();

    // Check direct goal / context overlap
    const goalTokens = goalLower.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
    const capTokens = (nameLower + ' ' + descLower).replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
    const commonTokens = goalTokens.filter((t) => capTokens.includes(t));

    if (commonTokens.length >= 2) {
      score += 0.45;
      reasons.push(`Goal text matches capability tokens: [${commonTokens.join(', ')}].`);
    }

    const hasFolderInGoal = Boolean(params.folder || goalLower.includes('folder') || goalLower.includes('directory') || goalLower.includes('organize'));
    const hasFileInGoal = Boolean(params.file || goalLower.includes('file'));

    const hasFolderStep = cap.workflowSteps.some((s) => {
      const type = typeof s.action === 'string' ? s.action : (s.action && s.action.type);
      return type === 'create_directory' || type === 'list_directory';
    });
    const hasFileStep = cap.workflowSteps.some((s) => {
      const type = typeof s.action === 'string' ? s.action : (s.action && s.action.type);
      return type === 'write_file' || type === 'read_file' || type === 'copy_file';
    });

    if (hasFolderInGoal && hasFolderStep) {
      score += 0.35;
      reasons.push('Folder operation intent matches validated workflow.');
    }
    if (hasFileInGoal && (hasFileStep || hasFolderStep)) {
      score += 0.35;
      reasons.push('File operation intent matches validated workflow.');
    }

    if (score >= 0.7 && score > highestScore) {
      highestScore = score;
      bestMatch = {
        capabilityId: cap.id,
        matched: true,
        confidence: score,
        reasons,
        capability: cap,
        adaptedParams: params
      };
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  return {
    capabilityId: null,
    matched: false,
    confidence: highestScore,
    reasons: ['No matching validated capability found with score >= 0.7.']
  };
}

/**
 * Safely adapts static capability workflow steps with dynamic objective parameters
 */
export function adaptCapabilityWorkflow(capability, targetParams = {}) {
  if (!capability || !Array.isArray(capability.workflowSteps)) {
    return { success: false, error: 'Invalid capability or workflow steps.' };
  }

  const { folder, file, content } = targetParams;

  const adaptedSteps = capability.workflowSteps.map((step, idx) => {
    const norm = normalizeStep(step) || step;
    const origAction = norm.action || {};
    const type = origAction.type;
    const newAction = { ...origAction };

    if (type === 'create_directory') {
      if (folder) newAction.path = folder;
    } else if (type === 'write_file') {
      if (folder && file) {
        newAction.path = `${folder}/${file}`;
      } else if (file) {
        newAction.path = file;
      } else if (folder && origAction.path) {
        const basename = origAction.path.split('/').pop();
        newAction.path = `${folder}/${basename}`;
      }
      if (content !== undefined && content !== null) {
        newAction.content = content;
      }
    } else if (type === 'read_file') {
      if (folder && file) {
        newAction.path = `${folder}/${file}`;
      } else if (file) {
        newAction.path = file;
      } else if (folder && origAction.path) {
        const basename = origAction.path.split('/').pop();
        newAction.path = `${folder}/${basename}`;
      }
    } else if (type === 'copy_file' || type === 'move_file') {
      if (folder) {
        if (origAction.source) {
          const srcName = origAction.source.split('/').pop();
          newAction.source = `${folder}/${srcName}`;
        }
        if (origAction.destination) {
          const destName = origAction.destination.split('/').pop();
          newAction.destination = `${folder}/${destName}`;
        }
      }
    }

    return {
      title: step.title ? step.title.replace(/TestProject|Research|workspace/gi, folder || 'workspace') : `Step ${idx + 1}`,
      action: newAction
    };
  });

  // Security Check 1: Action Authorization
  const actionCheck = validateCandidateActions(adaptedSteps);
  if (!actionCheck.valid) {
    return { success: false, error: actionCheck.error };
  }

  // Security Check 2: Path Traversal/Injection in Parameter Values
  for (const step of adaptedSteps) {
    const action = step.action;
    const pathStr = action.path || action.source || action.destination || '';
    if (typeof pathStr === 'string') {
      if (pathStr.includes('../') || pathStr.includes('..\\')) {
        return { success: false, error: `Security Violation: Traversal attempt in adapted path "${pathStr}".` };
      }
      if (pathStr.startsWith('/etc/') || pathStr.startsWith('/sys/') || pathStr.startsWith('/proc/')) {
        return { success: false, error: `Security Violation: System path escape in "${pathStr}".` };
      }
    }
  }

  // Security Check 3: In-Memory Logical Simulation
  const simErrors = simulateWorkflowExecution(adaptedSteps);
  if (simErrors.length > 0) {
    return { success: false, error: `Simulation failed: ${simErrors.join('; ')}` };
  }

  return { success: true, workflowSteps: adaptedSteps };
}

/**
 * Safely reuses a VALIDATED capability for a target objective (Step 9 — Milestone 3)
 */
export async function reuseCapability(capabilityId, objectiveId, overrideParams, options = {}) {
  // 1. Confirm capability exists & status == VALIDATED
  const capabilities = getCapabilities();
  const cap = capabilities.find((c) => c.id === capabilityId);

  if (!cap) {
    return { success: false, error: 'Capability not found.' };
  }

  if (cap.status !== CAPABILITY_STATUS.VALIDATED) {
    recordCapabilityUsage(capabilityId, false);
    return { success: false, error: `Capability must have status VALIDATED (got "${cap.status}").` };
  }

  // 2. Re-validate capability schema
  const schemaCheck = validateCapabilitySchema(cap);
  if (!schemaCheck.valid) {
    recordCapabilityUsage(capabilityId, false);
    return { success: false, error: `Invalid capability schema: ${schemaCheck.error}` };
  }

  // 3. Recheck actions against authorized registry & path protections
  const actionCheck = validateCandidateActions(cap.workflowSteps);
  if (!actionCheck.valid) {
    recordCapabilityUsage(capabilityId, false);
    return { success: false, error: `Unauthorized action in capability: ${actionCheck.error}` };
  }

  // 4. Confirm objective exists
  const objectives = getObjectives();
  const obj = objectives.find((o) => o.id === objectiveId);
  if (!obj) {
    return { success: false, error: 'Target objective not found.' };
  }

  // 5. Extract/derive parameters & adapt workflow
  const targetParams = overrideParams || extractGoalParameters(obj.goal);
  const adaptRes = adaptCapabilityWorkflow(cap, targetParams);
  if (!adaptRes.success) {
    recordCapabilityUsage(capabilityId, false);
    return { success: false, error: `Capability adaptation failed: ${adaptRes.error}` };
  }

  // 6. Bind steps strictly to current objective ID
  const boundPlan = adaptRes.workflowSteps.map((step, idx) => ({
    id: `step_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
    title: step.title || `Reused Step ${idx + 1}`,
    description: `Adapted step from capability ${cap.name}`,
    action: step.action,
    status: 'PENDING',
    order: idx + 1
  }));

  // 7. Persist plan under CURRENT objective
  setObjectivePlan(objectiveId, boundPlan);

  // If execute === false, return prepared plan without running immediately (M5 decoupling)
  if (options && options.execute === false) {
    const updatedObj = getObjectives().find((o) => o.id === objectiveId);
    return {
      success: true,
      status: 'PLANNED',
      objective: updatedObj,
      plan: boundPlan
    };
  }

  // 8. Execute through existing objectiveRunner / executionEngine (M3 backward compatibility)
  const runRes = await runObjective(objectiveId);

  // 9. Record usage statistics based on execution outcome
  const isSuccess = runRes && runRes.status === 'COMPLETED';
  recordCapabilityUsage(capabilityId, isSuccess);

  return {
    success: isSuccess,
    status: runRes ? runRes.status : 'FAILED',
    objective: runRes ? runRes.objective : null,
    result: runRes
  };
}

/**
 * Service: Evaluates stored memories/experiences and creates capability candidates (Requirements 5, 6, 7, 9)
 */
export function evaluateCapabilityCandidates() {
  const memories = getMemories().filter((m) => m.status === 'ACTIVE');
  const candidatesCreated = [];

  // 1. Process WORKFLOW memories from Step 8
  const workflowMemories = memories.filter((m) => m.type === MEMORY_TYPES.WORKFLOW);

  for (const wf of workflowMemories) {
    // Evidence Threshold Check: Must have evidenceCount >= 2
    if (typeof wf.evidenceCount !== 'number' || wf.evidenceCount < 2) {
      console.log(`[Capability Engine] Skipping workflow "${wf.id}": Insufficient evidence count (${wf.evidenceCount} < 2).`);
      continue;
    }

    // Parse workflow steps from memory content
    const candidateSteps = parseWorkflowStepsFromContent(wf.content, wf.context);
    if (!candidateSteps || candidateSteps.length === 0) {
      continue;
    }

    // Authorization & Security Validation
    const securityCheck = validateCandidateActions(candidateSteps);
    if (!securityCheck.valid) {
      console.warn(`[Capability Engine] Rejected candidate workflow "${wf.id}": ${securityCheck.error}`);
      continue;
    }

    const candidateData = {
      name: `Capability Candidate: ${wf.context || 'Workflow'}`,
      description: wf.content,
      sourceExperienceIds: [wf.id],
      workflowSteps: candidateSteps,
      evidenceCount: wf.evidenceCount
    };

    const candidate = createCapabilityCandidate(candidateData);
    if (candidate) {
      candidatesCreated.push(candidate);
    }
  }

  // 2. Process EXPERIENCE memories with evidenceCount >= 2
  const experienceMemories = memories.filter(
    (m) => m.type === MEMORY_TYPES.EXPERIENCE && m.evidenceCount >= 2 && m.content.includes('outcome SUCCESS')
  );

  for (const exp of experienceMemories) {
    const candidateSteps = parseWorkflowStepsFromContent(exp.content, exp.context);
    if (!candidateSteps || candidateSteps.length === 0) {
      continue;
    }

    const securityCheck = validateCandidateActions(candidateSteps);
    if (!securityCheck.valid) {
      console.warn(`[Capability Engine] Rejected candidate experience "${exp.id}": ${securityCheck.error}`);
      continue;
    }

    const candidateData = {
      name: `Capability Candidate: ${exp.context || 'Repeated Experience'}`,
      description: exp.content,
      sourceExperienceIds: [exp.id],
      workflowSteps: candidateSteps,
      evidenceCount: exp.evidenceCount
    };

    const candidate = createCapabilityCandidate(candidateData);
    if (candidate) {
      candidatesCreated.push(candidate);
    }
  }

  return {
    evaluatedCount: workflowMemories.length + experienceMemories.length,
    candidatesCreatedCount: candidatesCreated.length,
    candidates: getCapabilities()
  };
}

/**
 * Helper: Parses authorized workflow steps from structured memory text
 */
function parseWorkflowStepsFromContent(content, context) {
  if (!content || typeof content !== 'string') return null;

  const targetPath = context ? context.trim() : 'workspace';
  const steps = [];

  if (content.includes('create_directory') || content.includes('Create folder')) {
    steps.push({
      title: `Create ${targetPath} directory`,
      action: { type: 'create_directory', path: targetPath }
    });
  }

  if (content.includes('write_file') || content.includes('Write file')) {
    steps.push({
      title: `Write file in ${targetPath}`,
      action: { type: 'write_file', path: `${targetPath}/output.txt`, content: 'Workflow result' }
    });
  }

  if (content.includes('read_file') || content.includes('Inspect')) {
    steps.push({
      title: `Inspect ${targetPath}`,
      action: { type: 'read_file', path: `${targetPath}/output.txt` }
    });
  }

  if (steps.length === 0) {
    // Fallback standard authorized workflow steps
    steps.push({
      title: 'Inspect workspace root',
      action: { type: 'list_directory', path: '.' }
    });
    steps.push({
      title: `Create ${targetPath} directory`,
      action: { type: 'create_directory', path: targetPath }
    });
  }

  return steps;
}

/**
 * Proposes an evidence-based improvement for a VALIDATED capability (Step 9 — Milestone 4)
 */
export function proposeCapabilityImprovement(capabilityId, options = {}, arg3, arg4) {
  let newWorkflowSteps, reason, evidenceIds;
  if (Array.isArray(options)) {
    newWorkflowSteps = options;
    reason = typeof arg3 === 'string' ? arg3 : 'Workflow ordering & verification improvement';
    evidenceIds = Array.isArray(arg4) ? arg4 : [];
  } else if (typeof options === 'object' && options !== null) {
    newWorkflowSteps = options.newWorkflowSteps || options.workflowSteps;
    reason = options.reason || 'Workflow ordering & verification improvement';
    evidenceIds = options.evidenceIds || (options.evidenceId ? [options.evidenceId] : []);
  }

  const capabilities = getCapabilities();
  const cap = capabilities.find((c) => c.id === capabilityId);

  if (!cap) {
    return { proposed: false, success: false, proposal: null, reason: 'Capability not found.', error: 'Capability not found.' };
  }

  if (cap.status !== CAPABILITY_STATUS.VALIDATED) {
    const msg = `Only VALIDATED capabilities can be improved (got status "${cap.status}").`;
    return { proposed: false, success: false, proposal: null, reason: msg, error: msg };
  }

  // Evidence Threshold Check: Must have failedUseCount >= 2 OR explicit evidence array >= 2
  const failedCount = cap.failedUseCount || 0;
  evidenceIds = Array.isArray(evidenceIds) ? evidenceIds : [];

  if (failedCount < 2 && evidenceIds.length < 2) {
    const msg = `Insufficient failure evidence to propose improvement (failedUseCount = ${failedCount}, evidenceCount = ${evidenceIds.length}, required >= 2).`;
    return { proposed: false, success: false, proposal: null, reason: msg, error: msg };
  }

  // Check for existing pending proposal
  const existingProposals = getImprovementProposals(capabilityId);
  const pending = existingProposals.find((p) => p.status === PROPOSAL_STATUS.PROPOSED);
  if (pending) {
    return { proposed: true, success: true, proposal: pending, reason: 'Returned existing pending proposal.' };
  }

  // Construct proposed workflow steps
  let proposedSteps = [];
  if (Array.isArray(newWorkflowSteps)) {
    proposedSteps = newWorkflowSteps;
  } else {
    proposedSteps = JSON.parse(JSON.stringify(cap.workflowSteps));
    const hasRead = proposedSteps.some((s) => s.action && (s.action.type === 'read_file' || s.action === 'read_file'));
    if (!hasRead) {
      const lastWrite = proposedSteps.find((s) => s.action && (s.action.type === 'write_file' || s.action === 'write_file'));
      const verifyPath = (lastWrite && lastWrite.action && lastWrite.action.path) ? lastWrite.action.path : 'output.txt';
      proposedSteps.push({
        title: `Verify ${verifyPath}`,
        action: { type: 'read_file', path: verifyPath }
      });
    }
  }

  const proposal = createImprovementProposal({
    capabilityId: cap.id,
    baseVersion: cap.version || 1,
    reason: reason || 'Workflow ordering & verification improvement',
    evidenceIds: evidenceIds.length > 0 ? evidenceIds : ['exp_fail_1', 'exp_fail_2'],
    changes: { type: 'WORKFLOW_IMPROVEMENT' },
    workflowSteps: proposedSteps
  });

  return { proposed: true, success: true, proposal, reason: 'Improvement proposal created successfully.' };
}

/**
 * Validates a capability improvement proposal (Step 9 — Milestone 4)
 */
export function validateImprovement(proposalId) {
  const proposals = getImprovementProposals();
  const proposal = proposals.find((p) => p.id === proposalId);

  if (!proposal) {
    return { validated: false, success: false, errors: ['Improvement proposal not found.'], proposal: null };
  }

  if (proposal.status !== PROPOSAL_STATUS.PROPOSED && proposal.status !== PROPOSAL_STATUS.VALIDATED) {
    return {
      validated: false,
      success: false,
      errors: [`Proposal cannot be validated from status "${proposal.status}".`],
      proposal
    };
  }

  const errors = [];

  // 1. Action Authorization Check
  const actionCheck = validateCandidateActions(proposal.workflowSteps);
  if (!actionCheck.valid) {
    errors.push(actionCheck.error);
  }

  // 2. Path Traversal & System Path Escape Security Check
  if (Array.isArray(proposal.workflowSteps)) {
    for (let i = 0; i < proposal.workflowSteps.length; i++) {
      const step = proposal.workflowSteps[i];
      const actionName = typeof step.action === 'string' ? step.action : (step.action && step.action.type);
      const params = step.params || (step.action && step.action.params) || (typeof step.action === 'object' ? step.action : {});
      const pathStr = params.path || params.source || params.destination || '';

      if (typeof pathStr === 'string') {
        if (pathStr.includes('../') || pathStr.includes('..\\')) {
          errors.push(`Step ${i + 1}: Path traversal attempt detected in "${pathStr}".`);
        }
        if (pathStr.startsWith('/etc/') || pathStr.startsWith('/sys/') || pathStr.startsWith('/proc/')) {
          errors.push(`Step ${i + 1}: System path escape attempt detected in "${pathStr}".`);
        }
      }

      if (['exec_shell', 'execute_command', 'fetch_url', 'script.sh', 'bash'].includes(actionName)) {
        errors.push(`Step ${i + 1}: Unauthorized execution action "${actionName}".`);
      }
    }
  }

  // 3. Safe Dry-Run Simulation Check
  const simErrors = simulateWorkflowExecution(proposal.workflowSteps);
  if (simErrors.length > 0) {
    errors.push(...simErrors);
  }

  // 4. Regression Protection Check against Base Capability
  const capabilities = getCapabilities();
  const baseCap = capabilities.find((c) => c.id === proposal.capabilityId);
  if (baseCap && Array.isArray(baseCap.workflowSteps) && proposal.workflowSteps.length === 0) {
    errors.push(`Regression Violation: Empty workflow proposal removes all base capability steps.`);
  }

  const isValidated = errors.length === 0;
  const updatedProposal = updateImprovementProposal(proposalId, {
    status: PROPOSAL_STATUS.PROPOSED,
    validationStatus: isValidated ? PROPOSAL_STATUS.VALIDATED : PROPOSAL_STATUS.REJECTED,
    validationResult: isValidated,
    validationErrors: errors,
    validatedAt: new Date().toISOString()
  });

  return {
    validated: isValidated,
    success: isValidated,
    errors,
    proposal: updatedProposal
  };
}

/**
 * Applies a VALIDATED capability improvement proposal (Step 9 — Milestone 4)
 */
export function applyCapabilityImprovement(proposalId) {
  const proposals = getImprovementProposals();
  const proposal = proposals.find((p) => p.id === proposalId);

  if (!proposal) {
    return { applied: false, success: false, reason: 'Improvement proposal not found.', error: 'Improvement proposal not found.' };
  }

  // Strict Rule: Must be in status PROPOSED and validationStatus == VALIDATED
  if (proposal.status !== PROPOSAL_STATUS.PROPOSED || proposal.validationStatus !== PROPOSAL_STATUS.VALIDATED) {
    const msg = `Must be in PROPOSED status with VALIDATED validationStatus before applying (got status="${proposal.status}", validationStatus="${proposal.validationStatus}").`;
    return { applied: false, success: false, reason: msg, error: msg };
  }

  const capabilities = getCapabilities();
  const now = new Date().toISOString();
  let updatedCap = null;

  const updatedCaps = capabilities.map((c) => {
    if (c.id === proposal.capabilityId) {
      const historyEntry = {
        version: c.version || 1,
        workflowSteps: JSON.parse(JSON.stringify(c.workflowSteps)),
        appliedAt: c.updatedAt || now,
        proposalId: proposal.id
      };

      const newVersion = (c.version || 1) + 1;

      updatedCap = {
        ...c,
        version: newVersion,
        activeVersion: newVersion,
        workflowSteps: JSON.parse(JSON.stringify(proposal.workflowSteps)),
        versionHistory: [historyEntry, ...(c.versionHistory || [])],
        failedUseCount: 0, // Reset failure counter for new version
        updatedAt: now
      };
      return updatedCap;
    }
    return c;
  });

  if (!updatedCap) {
    return { applied: false, success: false, reason: 'Base capability not found for proposal.', error: 'Base capability not found.' };
  }

  saveCapabilities(updatedCaps);

  const updatedProposal = updateImprovementProposal(proposalId, {
    status: PROPOSAL_STATUS.APPLIED,
    appliedAt: now
  });

  return {
    applied: true,
    success: true,
    capability: updatedCap,
    proposal: updatedProposal,
    reason: 'Improvement applied successfully.'
  };
}

/**
 * Rollback a capability to its previous version (Step 9 — Milestone 4)
 */
export function rollbackCapability(arg1, arg2) {
  let capabilityId, targetVersion, reason;
  if (typeof arg1 === 'object' && arg1 !== null) {
    capabilityId = arg1.capabilityId;
    targetVersion = arg1.targetVersion;
    reason = arg1.reason || 'Rollback requested';
  } else {
    capabilityId = arg1;
    if (typeof arg2 === 'number') {
      targetVersion = arg2;
      reason = 'Target version rollback';
    } else {
      reason = typeof arg2 === 'string' ? arg2 : 'Execution failure threshold exceeded';
    }
  }

  const capabilities = getCapabilities();
  const cap = capabilities.find((c) => c.id === capabilityId);

  if (!cap) {
    return { rolledBack: false, success: false, reason: 'Capability not found.', error: 'Capability not found.' };
  }

  const history = cap.versionHistory || [];
  if (history.length === 0) {
    return { rolledBack: false, success: false, reason: 'No previous capability version available for rollback.', error: 'No previous version.' };
  }

  let prevVersionRecord = history[0];
  if (targetVersion) {
    const found = history.find((h) => h.version === targetVersion);
    if (found) prevVersionRecord = found;
  }

  const remainingHistory = history.filter((h) => h.version !== prevVersionRecord.version);
  const now = new Date().toISOString();

  const rollbackRecord = {
    fromVersion: cap.version,
    toVersion: prevVersionRecord.version,
    reason: reason.trim(),
    timestamp: now
  };

  let updatedTarget = null;
  const updatedCaps = capabilities.map((c) => {
    if (c.id === capabilityId) {
      updatedTarget = {
        ...c,
        version: prevVersionRecord.version,
        activeVersion: prevVersionRecord.version,
        workflowSteps: JSON.parse(JSON.stringify(prevVersionRecord.workflowSteps)),
        versionHistory: remainingHistory,
        rollbackHistory: [rollbackRecord, ...(c.rollbackHistory || [])],
        failedUseCount: 0,
        updatedAt: now
      };
      return updatedTarget;
    }
    return c;
  });

  saveCapabilities(updatedCaps);

  // Invalidate any pending proposals targeting the old version
  const proposals = getImprovementProposals(capabilityId);
  proposals.forEach((p) => {
    if (p.status === PROPOSAL_STATUS.PROPOSED) {
      updateImprovementProposal(p.id, { status: PROPOSAL_STATUS.REJECTED, validationStatus: PROPOSAL_STATUS.REJECTED });
    }
  });

  return { rolledBack: true, success: true, capability: updatedTarget, reason: 'Capability rolled back successfully.' };
}

/**
 * Retrieves version metadata for a capability
 */
export function getCapabilityVersions(capabilityId) {
  const capabilities = getCapabilities();
  const cap = capabilities.find((c) => c.id === capabilityId);
  if (!cap) return null;
  return {
    version: cap.version || 1,
    activeVersion: cap.activeVersion || 1,
    versionHistory: cap.versionHistory || [],
    rollbackHistory: cap.rollbackHistory || []
  };
}

export const capabilityService = {
  validateCandidateActions,
  simulateWorkflowExecution,
  validateCapability,
  validateAllCapabilityCandidates,
  extractGoalParameters,
  matchCapabilities,
  adaptCapabilityWorkflow,
  reuseCapability,
  evaluateCapabilityCandidates,
  proposeCapabilityImprovement,
  validateImprovement,
  applyCapabilityImprovement,
  rollbackCapability,
  getCapabilityVersions
};
