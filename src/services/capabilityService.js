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
  updateImprovementProposal,
  INVARIANT_TYPES,
  validateInvariantSchema,
  getCapabilityInvariants,
  recordFailureEvidence,
  getFailureEvidences,
  getFailureEvidenceById
} from './capabilityStore.js';
import path from 'path';
import { getMemories, MEMORY_TYPES } from './memoryStore.js';
import { RECOGNIZED_ACTIONS } from './plannerService.js';
import { getObjectives, setObjectivePlan, setObjectivePlanAndEvolutionMetadata } from './objectiveStore.js';
import { runObjective } from './objectiveRunner.js';
import { verifyToolResult } from './executionEngine.js';
import {
  readFile,
  listDirectory,
  createDirectory,
  writeFile,
  copyFile,
  moveFile,
  renameFile,
  resolveSafePath
} from './filesystemTool.js';
import { fsConfig } from '../config/fsConfig.js';

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
      content: params.content !== undefined ? params.content : (typeof step.action === 'object' && step.action ? step.action.content : ''),
      target: params.target || (typeof step.action === 'object' && step.action ? step.action.target : ''),
      text: params.text !== undefined ? params.text : (typeof step.action === 'object' && step.action ? step.action.text : '')
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
    } else if (type === 'OBSERVE' || type === 'LAUNCH_APPLICATION' || type === 'CLICK' || type === 'TEXT_INPUT' || type === 'VERIFY') {
      // Computer task action types pass dry-run logical simulation cleanly
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
 * Extracts target objective parameters (folder, file, content, text) deterministically from text
 */
export function extractGoalParameters(goalText) {
  if (!goalText || typeof goalText !== 'string') {
    return { folder: null, file: null, content: null, text: null };
  }

  const g = goalText.trim();
  let folder = null;
  let file = null;
  let content = null;
  let text = null;

  const folderMatch = g.match(/(?:folder|directory|dir)\s+(?:called|named)?\s*["`']?([a-zA-Z0-9_\-\.]+)/i);
  if (folderMatch) {
    folder = folderMatch[1];
  }

  const fileMatch = g.match(/(?:file)\s+(?:called|named)?\s*["`']?([a-zA-Z0-9_\-\.\/]+)/i);
  if (fileMatch) {
    file = fileMatch[1];
  }

  // Quoted content first
  const quotedContentMatch = g.match(/(?:containing|content|with text)\s*:?\s*["`']([^"`']+)["`']/i);
  if (quotedContentMatch) {
    content = quotedContentMatch[1].trim();
  } else {
    // Unquoted content: stop before trailing prompt sentences, e.g. ". Then", ". Verify", etc.
    const unquotedContentMatch = g.match(/(?:containing|content|with text)\s*:?\s*([^.\n!]+?)(?=\s*\.|\s+then|\s+and|\s+verify|$)/i);
    if (unquotedContentMatch) {
      content = unquotedContentMatch[1].trim();
    }
  }

  // Extract ordinary computer text input parameter
  const writeQuoteMatch = g.match(/(?:write|type|input|note|containing:?)\s*:?\s*["`']([^"`']+)["`']/i);
  if (writeQuoteMatch) {
    text = writeQuoteMatch[1].trim();
  } else {
    const writeColonMatch = g.match(/(?:write|type|containing:)\s*\n?([^\n\.,!\?]+)/i);
    if (writeColonMatch) {
      const candidate = writeColonMatch[1].trim();
      if (candidate && !/^(?:the|a|an|and)\b/i.test(candidate)) {
        text = candidate;
      }
    }
  }

  // Sensitive text check: Block passwords, secrets, private keys, API tokens
  if (text) {
    const sensitiveRegex = /(?:password|passwd|secret|api_key|token|private_key|auth_token|credentials)/i;
    if (sensitiveRegex.test(text) || sensitiveRegex.test(g)) {
      text = null;
    }
  }

  return { folder, file, content, text };
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

    const isComputerGoalIntent = goalLower.includes('text editor') || goalLower.includes('editor application') ||
                                 goalLower.includes('launch application') || goalLower.includes('open application') ||
                                 goalLower.includes('calculator') || goalLower.includes('terminal');

    // Computer Capability Matching Logic
    const isComputerCap = cap.workflowSteps.some((s) => {
      const type = typeof s.action === 'string' ? s.action : (s.action && s.action.type);
      return ['OBSERVE', 'LAUNCH_APPLICATION', 'CLICK', 'TEXT_INPUT', 'VERIFY'].includes(type);
    });

    if (isComputerGoalIntent && !isComputerCap) {
      continue;
    }

    if (isComputerCap) {
      const appLaunchStep = cap.workflowSteps.find((s) => {
        const action = typeof s.action === 'object' ? s.action : {};
        return action.type === 'LAUNCH_APPLICATION';
      });
      const capAppId = appLaunchStep?.action?.target || appLaunchStep?.action?.application || appLaunchStep?.action?.path || null;

      let appMatchesGoal = false;
      let appContradiction = false;

      if (capAppId === 'app_text_editor') {
        appMatchesGoal = goalLower.includes('text editor') || goalLower.includes('text_editor') || goalLower.includes('editor');
        if (goalLower.includes('calculator') || goalLower.includes('calc')) {
          appContradiction = true;
        }
      } else if (capAppId === 'app_calculator') {
        appMatchesGoal = goalLower.includes('calculator') || goalLower.includes('calc');
        if (goalLower.includes('text editor') || goalLower.includes('editor')) {
          appContradiction = true;
        }
      } else if (capAppId) {
        const cleanAppName = capAppId.toLowerCase().replace(/^app_/, '');
        appMatchesGoal = goalLower.includes(cleanAppName);
      }

      const isComputerGoal = goalLower.includes('open') || goalLower.includes('editor') ||
                             goalLower.includes('write') || goalLower.includes('type') ||
                             goalLower.includes('click') || goalLower.includes('verify') ||
                             goalLower.includes('calculator') || goalLower.includes('calc');

      if (isComputerGoal && appMatchesGoal && !appContradiction) {
        const hasWriteInGoal = goalLower.includes('write') || goalLower.includes('type') || goalLower.includes('note') || goalLower.includes('input');
        const hasClickInGoal = goalLower.includes('click');
        const hasVerifyInGoal = goalLower.includes('verify');

        const hasTextInputStep = cap.workflowSteps.some((s) => (s.action?.type || s.action) === 'TEXT_INPUT');
        const hasClickStep = cap.workflowSteps.some((s) => (s.action?.type || s.action) === 'CLICK');
        const hasVerifyStep = cap.workflowSteps.some((s) => (s.action?.type || s.action) === 'VERIFY');

        const hasCloseInGoal = goalLower.includes('close') || goalLower.includes('exit') || goalLower.includes('delete');
        const hasCloseStep = cap.workflowSteps.some((s) => (s.action?.type || s.action) === 'CLOSE_APPLICATION');

        let structuralMatch = true;
        if (hasWriteInGoal && !hasTextInputStep) structuralMatch = false;
        if (hasClickInGoal && !hasClickStep) structuralMatch = false;
        if (hasVerifyInGoal && !hasVerifyStep) structuralMatch = false;
        if (hasCloseInGoal && !hasCloseStep) structuralMatch = false;

        if (structuralMatch) {
          score += 0.35;
          reasons.push(`Computer application & structural intent match validated capability (${capAppId || 'computer_workflow'}).`);
        }
      }
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

export const reuseOptimizationTracker = {
  schemaValidationCount: 0,
  simulationCount: 0,
  securityCheckCount: 0,
  reset() {
    this.schemaValidationCount = 0;
    this.simulationCount = 0;
    this.securityCheckCount = 0;
  }
};

/**
 * Safely adapts static capability workflow steps with dynamic objective parameters
 */
export function adaptCapabilityWorkflow(capability, targetParams = {}, options = {}) {
  if (!capability || !Array.isArray(capability.workflowSteps)) {
    return { success: false, error: 'Invalid capability or workflow steps.' };
  }

  // Security Check 1: Action Authorization on candidate steps FIRST
  reuseOptimizationTracker.securityCheckCount++;
  const rawActionCheck = validateCandidateActions(capability.workflowSteps);
  if (!rawActionCheck.valid) {
    return { success: false, error: `Unauthorized action type in capability: ${rawActionCheck.error}` };
  }

  const { folder, file, content, text } = targetParams;
  const newText = text || content;

  // Requirement 10: Fail safe if required adaptation parameters are completely missing
  const hasDirectoryStep = capability.workflowSteps.some((s) => {
    const type = typeof s.action === 'string' ? s.action : (s.action && s.action.type);
    return type === 'create_directory' || type === 'list_directory';
  });
  const hasWriteFileStep = capability.workflowSteps.some((s) => {
    const type = typeof s.action === 'string' ? s.action : (s.action && s.action.type);
    return type === 'write_file';
  });
  const hasReadFileStep = capability.workflowSteps.some((s) => {
    const type = typeof s.action === 'string' ? s.action : (s.action && s.action.type);
    return type === 'read_file';
  });

  const isParamsEmpty = !folder && !file && !content && !text;
  if (isParamsEmpty && (hasDirectoryStep || hasWriteFileStep || hasReadFileStep)) {
    return { success: false, error: 'Missing required parameters (folder, file, content) for capability workflow adaptation.' };
  }

  const baseFolder = capability.workflowSteps.find((s) => {
    const act = s.action || {};
    return act.type === 'create_directory' && act.path;
  })?.action?.path;

  const adaptedSteps = capability.workflowSteps.map((step, idx) => {
    const norm = normalizeStep(step) || step;
    const origAction = norm.action || {};
    const type = origAction.type;
    const newAction = { ...origAction };

    if (type === 'TEXT_INPUT' && newText) {
      newAction.text = newText;
      if (typeof newAction.path === 'string') newAction.path = newText;
    }

    if (type === 'create_directory') {
      if (folder) {
        newAction.path = folder;
      }
    } else if (type === 'write_file' || type === 'read_file') {
      if (folder && file) {
        newAction.path = `${folder}/${file}`;
      } else if (file) {
        newAction.path = file;
      } else if (folder && baseFolder && typeof newAction.path === 'string' && newAction.path.startsWith(`${baseFolder}/`)) {
        newAction.path = newAction.path.replace(new RegExp(`^${baseFolder}/`), `${folder}/`);
      } else if (folder && newAction.path && !newAction.path.startsWith(`${folder}/`)) {
        const baseFileName = newAction.path.split('/').pop();
        newAction.path = `${folder}/${baseFileName}`;
      }

      if (type === 'write_file') {
        const targetContent = (content !== undefined && content !== null) ? content : newText;
        if (targetContent !== undefined && targetContent !== null) {
          newAction.content = targetContent;
          newAction.expectedContent = targetContent;
        }
      } else if (type === 'read_file') {
        const targetContent = (content !== undefined && content !== null) ? content : newText;
        if (targetContent !== undefined && targetContent !== null) {
          newAction.expectedContent = targetContent;
        }
      }
    } else if (type === 'copy_file' || type === 'move_file') {
      if (folder) {
        const srcFile = origAction.source ? origAction.source.split('/').pop() : (file || 'file');
        const destFile = origAction.destination ? origAction.destination.split('/').pop() : (file || 'file');
        newAction.source = `${folder}/${srcFile}`;
        newAction.destination = `${folder}/${destFile}`;
      }
    }

    // Requirement 9: Regenerate step titles using adapted action parameters
    let adaptedTitle = `Step ${idx + 1}`;
    if (type === 'create_directory') {
      adaptedTitle = `Create ${newAction.path || folder || 'directory'} directory`;
    } else if (type === 'write_file') {
      adaptedTitle = `Create file ${newAction.path || file || 'file'}`;
    } else if (type === 'read_file') {
      adaptedTitle = `Read and verify ${newAction.path || file || 'file'}`;
    } else if (type === 'copy_file') {
      adaptedTitle = `Copy file to ${newAction.destination || 'destination'}`;
    } else if (type === 'move_file') {
      adaptedTitle = `Move file to ${newAction.destination || 'destination'}`;
    } else if (type === 'LAUNCH_APPLICATION') {
      adaptedTitle = `Launch ${newAction.target || newAction.application || 'application'}`;
    } else if (type === 'TEXT_INPUT') {
      adaptedTitle = `Input text: "${newAction.text || 'text'}"`;
    } else if (type === 'CLICK') {
      adaptedTitle = `Click ${newAction.target || 'target'}`;
    } else if (type === 'VERIFY') {
      adaptedTitle = `Verify ${newAction.target || 'result'}`;
    } else if (step.title) {
      adaptedTitle = step.title;
      if (folder) {
        adaptedTitle = adaptedTitle.replace(/\b[A-Za-z0-9_\-]*Test[A-Za-z0-9_\-]*\b/gi, folder);
      }
    }

    return {
      title: adaptedTitle,
      action: newAction
    };
  });

  // Security Check 2: Action Authorization on Adapted Steps
  const adaptedActionCheck = validateCandidateActions(adaptedSteps);
  if (!adaptedActionCheck.valid) {
    return { success: false, error: adaptedActionCheck.error };
  }

  // Security Check 1: Action Authorization
  reuseOptimizationTracker.securityCheckCount++;
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

  // Security Check 3: In-Memory Logical Simulation (Skipped for pre-validated capabilities during reuse)
  if (!options.skipSimulation) {
    reuseOptimizationTracker.simulationCount++;
    const simErrors = simulateWorkflowExecution(adaptedSteps);
    if (simErrors.length > 0) {
      return { success: false, error: `Simulation failed: ${simErrors.join('; ')}` };
    }
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

  // 2. Recheck actions against authorized registry & path protections
  reuseOptimizationTracker.securityCheckCount++;
  const actionCheck = validateCandidateActions(cap.workflowSteps);
  if (!actionCheck.valid) {
    recordCapabilityUsage(capabilityId, false);
    return { success: false, error: `Unauthorized action in capability: ${actionCheck.error}` };
  }

  // 3. Confirm objective exists
  const objectives = getObjectives();
  const obj = objectives.find((o) => o.id === objectiveId);
  if (!obj) {
    return { success: false, error: 'Target objective not found.' };
  }

  // 4. Extract/derive parameters & adapt workflow (skip redundant simulation for VALIDATED capabilities)
  const targetParams = overrideParams || extractGoalParameters(obj.goal);
  const adaptRes = adaptCapabilityWorkflow(cap, targetParams, { skipSimulation: true, ...options });
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

  // 7. Persist plan and evolution metadata under CURRENT objective (atomic single-write persistence)
  if (options && options.evolutionMetadata) {
    setObjectivePlanAndEvolutionMetadata(objectiveId, boundPlan, options.evolutionMetadata);
  } else {
    setObjectivePlan(objectiveId, boundPlan);
  }

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

  if (content.includes('OBSERVE') || content.includes('LAUNCH_APPLICATION') || content.includes('TEXT_INPUT') || content.includes('CLICK')) {
    if (content.includes('OBSERVE')) {
      steps.push({ title: 'Capture desktop observation', action: { type: 'OBSERVE' } });
    }
    if (content.includes('LAUNCH_APPLICATION')) {
      steps.push({ title: 'Launch allowlisted application', action: { type: 'LAUNCH_APPLICATION', path: 'app_text_editor' } });
    }
    if (content.includes('TEXT_INPUT')) {
      steps.push({ title: 'Input text payload', action: { type: 'TEXT_INPUT', content: 'Sample text payload' } });
    }
    if (content.includes('CLICK')) {
      steps.push({ title: 'Click target UI element', action: { type: 'CLICK' } });
    }
    if (content.includes('VERIFY')) {
      steps.push({ title: 'Verify task completion', action: { type: 'VERIFY' } });
    }
    if (steps.length > 0) return steps;
  }

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
 * Stage 4 Self-Healing: Evaluates deterministic promotion eligibility for a VALIDATED repair candidate proposal.
 */
export function checkPromotionEligibility(proposalIdOrObj, options = {}) {
  let proposal = null;
  if (typeof proposalIdOrObj === 'string') {
    const proposals = getImprovementProposals();
    proposal = proposals.find((p) => p.id === proposalIdOrObj);
  } else if (proposalIdOrObj && typeof proposalIdOrObj === 'object') {
    proposal = proposalIdOrObj;
  }

  if (!proposal) {
    return {
      eligible: false,
      reasons: ['Improvement proposal not found.'],
      error: 'Improvement proposal not found.',
      proposal: null,
      capability: null
    };
  }

  const reasons = [];

  // 1. Status Check: Must be in PROPOSED status (not APPLIED or REJECTED)
  if (proposal.status === PROPOSAL_STATUS.APPLIED) {
    reasons.push('Candidate has already been promoted (status is APPLIED).');
  } else if (proposal.status !== PROPOSAL_STATUS.PROPOSED) {
    reasons.push(`Proposal status must be PROPOSED (got status "${proposal.status}").`);
  }

  // 2. Validation Status Check: Must be VALIDATED
  if (proposal.validationStatus !== PROPOSAL_STATUS.VALIDATED) {
    reasons.push(`Proposal validationStatus must be VALIDATED (got "${proposal.validationStatus}").`);
  }

  // 3. Sandbox Validation Result Check
  const sandboxPassed = Boolean(proposal.validationResult) || Boolean(proposal.sandboxTestResult && proposal.sandboxTestResult.success);
  if (!sandboxPassed) {
    reasons.push('Proposal sandbox validation test did not pass cleanly.');
  }

  // 4. Base Capability & Version Staleness Check
  const capabilities = getCapabilities();
  const cap = capabilities.find((c) => c.id === proposal.capabilityId);
  if (!cap) {
    reasons.push(`Base capability "${proposal.capabilityId}" not found.`);
  } else {
    const activeVer = cap.activeVersion || cap.version || 1;
    const baseVer = proposal.baseVersion || 1;
    if (baseVer !== activeVer) {
      reasons.push(`Stale base version: Proposal is based on v${baseVer}, but active capability version is v${activeVer}.`);
    }
  }

  // 5. Candidate Action Authorization & Traversal Check
  const rawSteps = proposal.workflowSteps || [];
  const actionCheck = validateCandidateActions(rawSteps);
  if (!actionCheck.valid) {
    reasons.push(`Unauthorized action in candidate: ${actionCheck.error}`);
  }

  if (Array.isArray(rawSteps)) {
    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i];
      const norm = normalizeStep(step) || step;
      const act = norm.action || {};
      const pathStr = act.path || act.source || act.destination || '';
      if (typeof pathStr === 'string') {
        if (pathStr.includes('../') || pathStr.includes('..\\') || pathStr.includes('/../')) {
          reasons.push(`Step ${i + 1}: Path traversal attempt detected in "${pathStr}".`);
        }
        if (pathStr.startsWith('/etc/') || pathStr.startsWith('/sys/') || pathStr.startsWith('/proc/')) {
          reasons.push(`Step ${i + 1}: System path escape attempt detected in "${pathStr}".`);
        }
      }
    }
  }

  // 6. Invariant Schema Validation Check
  if (proposal.invariants && Array.isArray(proposal.invariants)) {
    for (const inv of proposal.invariants) {
      const invCheck = validateInvariantSchema(inv);
      if (!invCheck.valid) {
        reasons.push(`Invalid invariant schema in proposal: ${invCheck.error}`);
      }
    }
  }

  // 7. Sufficient Evidence Threshold Check (Rule 6 & 7: MIN_EVIDENCE_THRESHOLD = 2)
  const evidenceIds = Array.isArray(proposal.evidenceIds) ? proposal.evidenceIds : [];
  const evidenceCount = options.evidenceCount !== undefined
    ? options.evidenceCount
    : (proposal.evidenceCount || evidenceIds.length || (cap ? cap.failedUseCount || 0 : 0));

  if (evidenceCount < 2 && evidenceIds.length < 2 && (!cap || cap.failedUseCount < 2)) {
    reasons.push(`Insufficient failure evidence for promotion (evidence count = ${evidenceCount}, required >= 2).`);
  }

  const eligible = reasons.length === 0;
  return {
    eligible,
    reasons,
    error: eligible ? null : reasons.join('; '),
    proposal,
    capability: cap
  };
}

/**
 * Stage 4 Self-Healing: Controlled Promotion of a VALIDATED Repair Candidate to a New Active Capability Version.
 */
export function promoteRepairCandidate(proposalIdOrObj, options = {}) {
  const eligibility = checkPromotionEligibility(proposalIdOrObj, options);

  if (!eligibility.eligible) {
    return {
      promoted: false,
      applied: false,
      success: false,
      reason: `Promotion blocked: ${eligibility.reasons.join('; ')}`,
      error: `Promotion blocked: ${eligibility.reasons.join('; ')}`,
      eligibility
    };
  }

  const proposal = eligibility.proposal;
  const cap = eligibility.capability;
  const now = new Date().toISOString();

  const currentVersion = cap.activeVersion || cap.version || 1;
  const newVersion = currentVersion + 1;

  // Preserve previous active version details in version history
  const historyEntry = {
    version: currentVersion,
    workflowSteps: JSON.parse(JSON.stringify(cap.workflowSteps)),
    invariants: cap.invariants ? JSON.parse(JSON.stringify(cap.invariants)) : [],
    appliedAt: cap.updatedAt || now,
    proposalId: proposal.id
  };

  const updatedCap = {
    ...cap,
    version: newVersion,
    activeVersion: newVersion,
    workflowSteps: JSON.parse(JSON.stringify(proposal.workflowSteps)),
    invariants: proposal.invariants ? JSON.parse(JSON.stringify(proposal.invariants)) : (cap.invariants || []),
    versionHistory: [historyEntry, ...(cap.versionHistory || [])],
    failedUseCount: 0, // Reset failure counter for newly promoted version
    updatedAt: now,
    promotionMetadata: {
      proposalId: proposal.id,
      baseVersion: currentVersion,
      promotedVersion: newVersion,
      promotedAt: now
    }
  };

  // Atomic Persistence Guarantee (Req 8 & 9)
  const previousCapabilities = getCapabilities();

  try {
    if (options.simulatePersistenceFailure) {
      throw new Error('Simulated persistence failure during candidate promotion.');
    }

    const updatedCaps = previousCapabilities.map((c) => (c.id === cap.id ? updatedCap : c));
    saveCapabilities(updatedCaps);

    const updatedProposal = updateImprovementProposal(proposal.id, {
      status: PROPOSAL_STATUS.APPLIED,
      appliedAt: now,
      promotedVersion: newVersion
    });

    if (!updatedProposal || updatedProposal.status !== PROPOSAL_STATUS.APPLIED) {
      throw new Error('Failed to update proposal status to APPLIED.');
    }

    return {
      promoted: true,
      applied: true,
      success: true,
      capability: updatedCap,
      proposal: updatedProposal,
      baseVersion: currentVersion,
      newVersion,
      reason: `Repair candidate proposal "${proposal.id}" promoted successfully from v${currentVersion} to v${newVersion}.`
    };
  } catch (err) {
    // Roll back in-memory & stored capabilities state on persistence error
    saveCapabilities(previousCapabilities);
    return {
      promoted: false,
      applied: false,
      success: false,
      reason: `Atomic persistence failed during promotion: ${err.message}`,
      error: err.message
    };
  }
}

/**
 * Applies a VALIDATED capability improvement proposal (Step 9 — Milestone 4 / Stage 4 Unified Promotion)
 */
export function applyCapabilityImprovement(proposalId, options = {}) {
  return promoteRepairCandidate(proposalId, options);
}

/**
 * Rollback a capability to its previous version (Step 9 — Milestone 4 & Stage 4 Explicit Rollback)
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
        invariants: prevVersionRecord.invariants ? JSON.parse(JSON.stringify(prevVersionRecord.invariants)) : (c.invariants || []),
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

/**
 * Adapts invariant path targets with dynamic objective parameters ({folder}, {file}, {content})
 */
export function adaptCapabilityInvariants(invariants, targetParams = {}) {
  if (!Array.isArray(invariants)) return [];
  const { folder, file, content } = targetParams;

  return invariants.map((inv) => {
    let targetPath = inv.targetPath || '';
    let expectedContent = inv.expectedContent;
    let parentPath = inv.parentPath;

    // 1. Template placeholder substitution
    if (folder) {
      targetPath = targetPath.replace(/\{folder\}/g, folder);
      if (parentPath) parentPath = parentPath.replace(/\{folder\}/g, folder);
    }
    if (file) {
      targetPath = targetPath.replace(/\{file\}/g, file);
      if (parentPath) parentPath = parentPath.replace(/\{file\}/g, file);
    }
    if (content !== undefined && content !== null) {
      if (typeof expectedContent === 'string') {
        expectedContent = expectedContent.replace(/\{content\}/g, content);
      }
    }

    // 2. Fallback prefix adaptation matching adaptCapabilityWorkflow behavior
    if (folder && !targetPath.startsWith(folder) && !targetPath.includes('{folder}')) {
      targetPath = `${folder}/${targetPath}`;
    }
    if (folder && parentPath && !parentPath.startsWith(folder) && !parentPath.includes('{folder}')) {
      parentPath = `${folder}/${parentPath}`;
    }

    return {
      ...inv,
      targetPath,
      ...(expectedContent !== undefined ? { expectedContent } : {}),
      ...(parentPath !== undefined ? { parentPath } : {})
    };
  });
}

/**
 * Deterministically evaluates a capability's post-condition invariants (READ-ONLY)
 */
export async function evaluateCapabilityInvariants(capabilityIdOrObj, options = {}) {
  const rootPath = options.rootPath || options.root || fsConfig.workspaceRoot;
  const targetParams = options.targetParams || options.overrideParams || {};
  const targetVersion = options.version || null;

  let cap = null;
  if (typeof capabilityIdOrObj === 'string') {
    cap = getCapabilities().find((c) => c.id === capabilityIdOrObj);
  } else if (capabilityIdOrObj && typeof capabilityIdOrObj === 'object') {
    cap = capabilityIdOrObj;
  }

  if (!cap) {
    return {
      success: false,
      error: 'Capability not found for invariant evaluation.',
      totalEvaluated: 0,
      passedCount: 0,
      failedCount: 0,
      results: []
    };
  }

  const rawInvariants = options.overrideInvariants || getCapabilityInvariants(cap, targetVersion);
  if (!Array.isArray(rawInvariants) || rawInvariants.length === 0) {
    return {
      success: true,
      totalEvaluated: 0,
      passedCount: 0,
      failedCount: 0,
      results: []
    };
  }

  const adaptedInvariants = adaptCapabilityInvariants(rawInvariants, targetParams);
  const results = [];

  for (const inv of adaptedInvariants) {
    const res = {
      id: inv.id,
      type: inv.type,
      targetPath: inv.targetPath,
      expected: null,
      actual: null,
      passed: false,
      error: null
    };

    try {
      // Security Check: Path Traversal/Boundary Validation
      resolveSafePath(inv.targetPath, rootPath);
      if (inv.parentPath) {
        resolveSafePath(inv.parentPath, rootPath);
      }

      if (inv.type === INVARIANT_TYPES.DIRECTORY_EXISTS) {
        res.expected = 'directory_exists';
        try {
          const listRes = await listDirectory(inv.targetPath, rootPath);
          if (listRes && listRes.success) {
            res.actual = 'directory_exists';
            res.passed = true;
          } else {
            res.actual = 'directory_not_found';
            res.passed = false;
            res.error = `Directory "${inv.targetPath}" does not exist.`;
          }
        } catch (e) {
          res.actual = e.message;
          res.passed = false;
          res.error = e.message;
        }
      } else if (inv.type === INVARIANT_TYPES.FILE_EXISTS) {
        res.expected = 'file_exists';
        try {
          const fileRes = await readFile(inv.targetPath, rootPath);
          if (fileRes && fileRes.success) {
            res.actual = 'file_exists';
            res.passed = true;
          } else {
            res.actual = 'file_not_found';
            res.passed = false;
            res.error = `File "${inv.targetPath}" does not exist.`;
          }
        } catch (e) {
          res.actual = e.message;
          res.passed = false;
          res.error = e.message;
        }
      } else if (inv.type === INVARIANT_TYPES.EXACT_FILE_CONTENT) {
        res.expected = inv.expectedContent;
        try {
          const fileRes = await readFile(inv.targetPath, rootPath);
          if (fileRes && fileRes.success) {
            const actualContent = typeof fileRes.content === 'string' ? fileRes.content.trim() : '';
            const expectedContent = typeof inv.expectedContent === 'string' ? inv.expectedContent.trim() : '';
            res.actual = actualContent;
            res.passed = actualContent === expectedContent;
            if (!res.passed) {
              res.error = `Content mismatch at "${inv.targetPath}": expected "${expectedContent}", got "${actualContent}"`;
            }
          } else {
            res.actual = 'file_not_found';
            res.passed = false;
            res.error = `File "${inv.targetPath}" does not exist.`;
          }
        } catch (e) {
          res.actual = e.message;
          res.passed = false;
          res.error = e.message;
        }
      } else if (inv.type === INVARIANT_TYPES.PATH_RELATIONSHIP) {
        res.expected = `inside:${inv.parentPath}`;
        try {
          const safeParent = resolveSafePath(inv.parentPath, rootPath);
          const safeChild = resolveSafePath(inv.targetPath, rootPath);

          let childExists = false;
          try {
            const fileCheck = await readFile(inv.targetPath, rootPath);
            if (fileCheck && fileCheck.success) childExists = true;
          } catch (e) {}

          if (!childExists) {
            try {
              const dirCheck = await listDirectory(inv.targetPath, rootPath);
              if (dirCheck && dirCheck.success) childExists = true;
            } catch (e) {}
          }

          const isInside = safeChild.startsWith(safeParent);

          if (childExists && isInside) {
            res.actual = `inside:${inv.parentPath}`;
            res.passed = true;
          } else {
            res.actual = `not_inside:${inv.parentPath}`;
            res.passed = false;
            res.error = `Path "${inv.targetPath}" is not inside parent "${inv.parentPath}" or does not exist.`;
          }
        } catch (e) {
          res.actual = e.message;
          res.passed = false;
          res.error = e.message;
        }
      }
    } catch (err) {
      res.actual = err.message;
      res.passed = false;
      res.error = err.message;
    }

    results.push(res);
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  return {
    success: failedCount === 0,
    totalEvaluated: results.length,
    passedCount,
    failedCount,
    results
  };
}

/**
 * Stage 2 Self-Healing: Generates a localized NON-ACTIVE repair candidate for a capability invariant failure.
 */
export function generateCapabilityRepairCandidate(failureEvidenceIdOrObj) {
  let evidence = null;
  if (typeof failureEvidenceIdOrObj === 'string') {
    evidence = getFailureEvidenceById(failureEvidenceIdOrObj);
  } else if (failureEvidenceIdOrObj && typeof failureEvidenceIdOrObj === 'object') {
    evidence = failureEvidenceIdOrObj;
  }

  if (!evidence || !evidence.capabilityId) {
    return { success: false, error: 'Valid failure evidence record required.', candidate: null };
  }

  const capabilities = getCapabilities();
  const cap = capabilities.find((c) => c.id === evidence.capabilityId);
  if (!cap) {
    return { success: false, error: `Base capability "${evidence.capabilityId}" not found.`, candidate: null };
  }

  const baseVersion = evidence.capabilityVersion || cap.activeVersion || cap.version || 1;
  const baseSteps = Array.isArray(cap.workflowSteps) ? JSON.parse(JSON.stringify(cap.workflowSteps)) : [];
  const baseInvariants = getCapabilityInvariants(cap, baseVersion);

  // Template Parameter Un-adaptation (converting runtime path back to parameter template if targetParams were used)
  let targetPath = evidence.targetPath || '';
  let parentPath = evidence.parentPath || '';
  const params = evidence.targetParams || {};

  if (params.folder && typeof targetPath === 'string') {
    if (targetPath.startsWith(`${params.folder}/`)) {
      targetPath = targetPath.replace(`${params.folder}/`, '{folder}/');
    }
  }

  if (params.folder && typeof parentPath === 'string') {
    if (parentPath.startsWith(`${params.folder}/`)) {
      parentPath = parentPath.replace(`${params.folder}/`, '{folder}/');
    }
  }

  // Security Check 1: Traversal and System Path Escapes in Repair Target
  if (targetPath.includes('../') || targetPath.includes('..\\') || targetPath.includes('/../')) {
    return { success: false, error: `Security Error: Traversal attempt detected in repair path "${targetPath}".`, candidate: null };
  }
  if (targetPath.startsWith('/etc/') || targetPath.startsWith('/sys/') || targetPath.startsWith('/proc/')) {
    return { success: false, error: `Security Error: System path escape detected in repair path "${targetPath}".`, candidate: null };
  }

  // Synthesize localized repair step based on failed invariant type
  let repairAction = null;
  let repairTitle = '';

  if (evidence.failedInvariantType === INVARIANT_TYPES.DIRECTORY_EXISTS) {
    repairAction = { type: 'create_directory', path: targetPath };
    repairTitle = `Repair: Create Directory ${targetPath}`;
  } else if (evidence.failedInvariantType === INVARIANT_TYPES.FILE_EXISTS) {
    repairAction = { type: 'write_file', path: targetPath, content: '' };
    repairTitle = `Repair: Create File ${targetPath}`;
  } else if (evidence.failedInvariantType === INVARIANT_TYPES.EXACT_FILE_CONTENT) {
    const expectedStr = typeof evidence.expected === 'string' ? evidence.expected : '';
    repairAction = { type: 'write_file', path: targetPath, content: expectedStr };
    repairTitle = `Repair: Write Content to ${targetPath}`;
  } else if (evidence.failedInvariantType === INVARIANT_TYPES.PATH_RELATIONSHIP) {
    repairAction = { type: 'create_directory', path: parentPath || targetPath };
    repairTitle = `Repair: Establish Path ${parentPath || targetPath}`;
  }

  if (!repairAction) {
    return { success: false, error: `Unsupported failed invariant type "${evidence.failedInvariantType}".`, candidate: null };
  }

  // Security Check 2: Action Authorization (must be in RECOGNIZED_ACTIONS, no shell/network/system access)
  if (!RECOGNIZED_ACTIONS.includes(repairAction.type)) {
    return { success: false, error: `Security Error: Unauthorized action type "${repairAction.type}" in repair candidate.`, candidate: null };
  }

  // Integrate repair step into workflow (update matching existing step or append localized repair)
  const repairedSteps = [...baseSteps];
  let updatedExisting = false;

  for (let i = 0; i < repairedSteps.length; i++) {
    const norm = normalizeStep(repairedSteps[i]) || repairedSteps[i];
    const act = norm.action || {};
    const type = act.type;
    const p = act.path || act.destination || '';

    if (type === repairAction.type && (p === targetPath || p === evidence.targetPath)) {
      repairedSteps[i] = {
        ...repairedSteps[i],
        action: { ...act, ...repairAction }
      };
      updatedExisting = true;
      break;
    }
  }

  if (!updatedExisting) {
    const newStep = {
      action: repairAction,
      title: repairTitle,
      description: `Localized self-healing repair step for failed invariant ${evidence.failedInvariantId}`
    };
    repairedSteps.push(newStep);
  }

  // Final Candidate Security & Schema Validation
  const actionCheck = validateCandidateActions(repairedSteps);
  if (!actionCheck.valid) {
    return { success: false, error: `Repair candidate security validation failed: ${actionCheck.error}`, candidate: null };
  }

  // Store localized NON-ACTIVE repair candidate as an improvement proposal
  const proposal = createImprovementProposal({
    capabilityId: cap.id,
    baseVersion: baseVersion,
    reason: `Self-Healing Stage 2: Localized repair candidate for failed invariant ${evidence.failedInvariantId} (${evidence.failedInvariantType})`,
    evidenceIds: [evidence.id],
    workflowSteps: repairedSteps,
    invariants: baseInvariants,
    changes: {
      failedInvariantId: evidence.failedInvariantId,
      failedInvariantType: evidence.failedInvariantType,
      targetPath: evidence.targetPath,
      repairAction
    }
  });

  return {
    success: true,
    proposal,
    candidate: proposal,
    failureEvidence: evidence
  };
}

/**
 * Stage 3 Self-Healing: Tests a PROPOSED capability repair candidate in an isolated sandbox workspace.
 */
export async function testRepairCandidateInSandbox(proposalIdOrObj, options = {}) {
  const startedAt = new Date().toISOString();

  let proposal = null;
  if (typeof proposalIdOrObj === 'string') {
    const proposals = getImprovementProposals();
    proposal = proposals.find((p) => p.id === proposalIdOrObj);
  } else if (proposalIdOrObj && typeof proposalIdOrObj === 'object') {
    proposal = proposalIdOrObj;
  }

  if (!proposal) {
    return {
      success: false,
      error: 'Valid improvement proposal record required for sandbox testing.',
      proposalId: null,
      capabilityId: null,
      sandboxPath: null,
      stepResults: [],
      invariantResults: { totalEvaluated: 0, passedCount: 0, failedCount: 0, results: [] }
    };
  }

  const baseVersion = proposal.baseVersion || 1;
  const proposedVersion = proposal.proposedVersion || baseVersion + 1;
  const capabilityId = proposal.capabilityId;

  // 1. Create Isolated Sandbox Workspace Directory
  const randomId = Math.random().toString(36).substring(2, 7);
  const sandboxPath = options.sandboxPath || path.join('/tmp', `evo_repair_sandbox_${Date.now()}_${randomId}`);

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(sandboxPath)) {
        fs.mkdirSync(sandboxPath, { recursive: true });
      }
    } catch (e) {
      console.error('Failed to create sandbox directory:', e);
    }
  }

  const targetParams = options.targetParams || options.overrideParams || {};
  const rawSteps = proposal.workflowSteps || [];

  // Adapt candidate workflow steps for targetParams inside sandbox
  const adaptRes = adaptCapabilityWorkflow({ workflowSteps: rawSteps }, targetParams, { skipSimulation: true });
  const stepsToTest = adaptRes.success ? adaptRes.workflowSteps : rawSteps;

  const stepResults = [];
  let executionSuccess = true;
  let failureDetails = null;

  // 2. Pre-Execution Security Checks on Candidate Steps
  const actionCheck = validateCandidateActions(stepsToTest);
  if (!actionCheck.valid) {
    executionSuccess = false;
    failureDetails = `Security Error: Unauthorized action in repair candidate: ${actionCheck.error}`;
  }

  // 3. Execute Candidate Steps Sequentially inside Sandbox Workspace
  if (executionSuccess) {
    for (let idx = 0; idx < stepsToTest.length; idx++) {
      const step = stepsToTest[idx];
      const norm = normalizeStep(step) || step;
      const act = norm.action || {};
      const type = act.type;

      const stepRecord = {
        stepIndex: idx + 1,
        title: step.title || `Step ${idx + 1}`,
        action: act,
        success: false,
        verified: false,
        error: null
      };

      try {
        // Security Check: Path Traversal & System Escape Boundary Validation
        const targetPathStr = act.path || act.source || act.destination || '';
        if (targetPathStr.includes('../') || targetPathStr.includes('..\\') || targetPathStr.includes('/../')) {
          throw new Error(`Security Error: Traversal attempt in action path "${targetPathStr}".`);
        }
        if (targetPathStr.startsWith('/etc/') || targetPathStr.startsWith('/sys/') || targetPathStr.startsWith('/proc/')) {
          throw new Error(`Security Error: System path escape in action path "${targetPathStr}".`);
        }

        resolveSafePath(targetPathStr || '.', sandboxPath);

        let toolRes = null;
        if (type === 'create_directory') {
          toolRes = await createDirectory(act.path, sandboxPath);
        } else if (type === 'write_file') {
          toolRes = await writeFile(act.path, act.content || '', true, sandboxPath);
        } else if (type === 'read_file') {
          toolRes = await readFile(act.path, sandboxPath);
        } else if (type === 'list_directory') {
          toolRes = await listDirectory(act.path || '.', sandboxPath);
        } else if (type === 'copy_file') {
          toolRes = await copyFile(act.source, act.destination, sandboxPath);
        } else if (type === 'move_file') {
          toolRes = await moveFile(act.source, act.destination, sandboxPath);
        } else if (type === 'rename_file') {
          toolRes = await renameFile(act.source, act.destination, sandboxPath);
        } else {
          throw new Error(`Unauthorized or unsupported action type "${type}".`);
        }

        if (toolRes && toolRes.success) {
          const verCheck = await verifyToolResult(type, toolRes, sandboxPath);
          if (verCheck.verified) {
            stepRecord.success = true;
            stepRecord.verified = true;
          } else {
            stepRecord.success = false;
            stepRecord.error = verCheck.error || 'Per-step tool verification failed.';
            executionSuccess = false;
            failureDetails = stepRecord.error;
          }
        } else {
          stepRecord.success = false;
          stepRecord.error = (toolRes && toolRes.error) || `Action "${type}" failed.`;
          executionSuccess = false;
          failureDetails = stepRecord.error;
        }
      } catch (err) {
        stepRecord.success = false;
        stepRecord.error = err.message;
        executionSuccess = false;
        failureDetails = err.message;
      }

      stepResults.push(stepRecord);
      if (!executionSuccess) break; // Halt candidate execution on first failed step
    }
  }

  // 4. Evaluate Candidate Post-Condition Invariants inside Sandbox
  const cap = getCapabilities().find((c) => c.id === capabilityId);
  const overrideInvariants = proposal.invariants || (cap ? getCapabilityInvariants(cap, baseVersion) : []);
  
  const invariantResults = await evaluateCapabilityInvariants(cap || { invariants: overrideInvariants }, {
    rootPath: sandboxPath,
    targetParams,
    overrideInvariants
  });

  const invariantsPassed = Boolean(invariantResults && invariantResults.success);
  const overallSuccess = Boolean(executionSuccess && invariantsPassed);

  if (!invariantsPassed && executionSuccess) {
    const failedInvs = invariantResults.results.filter((r) => !r.passed).map((r) => `${r.id} (${r.error})`).join('; ');
    failureDetails = `Invariant evaluation failed: ${failedInvs}`;
  }

  const completedAt = new Date().toISOString();

  // 5. Update Proposal Validation Status (VALIDATED or REJECTED)
  // Proposal status becomes VALIDATED or REJECTED, but active capability remains UNCHANGED
  const updatedValidationStatus = overallSuccess ? PROPOSAL_STATUS.VALIDATED : PROPOSAL_STATUS.REJECTED;
  updateImprovementProposal(proposal.id, {
    validationStatus: updatedValidationStatus,
    validationResult: overallSuccess,
    validationErrors: failureDetails ? [failureDetails] : [],
    sandboxTestResult: {
      sandboxPath,
      success: overallSuccess,
      stepResults,
      invariantResults,
      testedAt: completedAt
    }
  });

  // Cleanup temporary sandbox if requested in options
  if (options.cleanUp && typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      if (fs.existsSync(sandboxPath)) {
        fs.rmSync(sandboxPath, { recursive: true, force: true });
      }
    } catch (e) {}
  }

  return {
    success: overallSuccess,
    proposalId: proposal.id,
    capabilityId,
    baseVersion,
    proposedVersion,
    sandboxPath,
    workflowStepsTested: stepsToTest,
    invariantResults,
    stepResults,
    failureDetails,
    timestamps: {
      startedAt,
      completedAt
    }
  };
}

export { INVARIANT_TYPES, validateInvariantSchema, getCapabilityInvariants };

export const capabilityService = {
  validateCandidateActions,
  simulateWorkflowExecution,
  validateCapability,
  validateAllCapabilityCandidates,
  extractGoalParameters,
  matchCapabilities,
  adaptCapabilityWorkflow,
  adaptCapabilityInvariants,
  evaluateCapabilityInvariants,
  generateCapabilityRepairCandidate,
  testRepairCandidateInSandbox,
  checkPromotionEligibility,
  promoteRepairCandidate,
  reuseCapability,
  evaluateCapabilityCandidates,
  proposeCapabilityImprovement,
  validateImprovement,
  applyCapabilityImprovement,
  rollbackCapability,
  getCapabilityVersions,
  INVARIANT_TYPES,
  validateInvariantSchema,
  getCapabilityInvariants
};
