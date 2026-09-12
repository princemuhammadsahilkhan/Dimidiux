import {
  listDirectory,
  readFile,
  createDirectory,
  writeFile,
  copyFile,
  moveFile,
  renameFile,
  searchFiles,
  resolveSafePath,
  isDesktopTarget
} from './filesystemTool.js';
import { systemToolService } from './systemTool.js';
import {
  getObjectives,
  saveObjectives
} from './objectiveStore.js';
import { recordTransaction, computeFingerprint } from './transactionStore.js';
import { recordActionEvent } from './actionEventStore.js';
import { objectiveBudgetService } from './objectiveBudgetService.js';
import { RECOGNIZED_ACTIONS } from './plannerService.js';
import { fsConfig } from '../config/fsConfig.js';
import { desktopObservationService } from './desktopObservationService.js';
import { applicationControlService } from './applicationControlService.js';
import { computerInteractionService } from './computerInteractionService.js';

export function isHostExecutionAvailable() {
  if (globalThis.EVO_FORCE_BROWSER_MODE === true) {
    return false;
  }
  if (typeof window !== 'undefined' && Boolean(window.evoAPI)) {
    return true;
  }
  if (typeof process !== 'undefined' && process.versions && Boolean(process.versions.node)) {
    return true;
  }
  return false;
}

export function isHostActionRequired(action) {
  if (!action || typeof action !== 'object') return false;

  const hostActionTypes = [
    'LAUNCH_APPLICATION',
    'CLICK',
    'TEXT_INPUT',
    'OBSERVE',
    'run_constrained_command'
  ];

  if (hostActionTypes.includes(action.type)) {
    return true;
  }

  const checkPath = action.path || action.filePath || action.source || action.destination;
  if (checkPath && isDesktopTarget(checkPath)) {
    return true;
  }

  return false;
}

/**
 * Independent Tool Result Verification
 */
export async function verifyToolResult(actionType, result, root = fsConfig.workspaceRoot, action = null) {
  if (!result || typeof result !== 'object') {
    return { verified: false, error: 'Tool returned a non-object result.' };
  }

  if (!result.success) {
    return { verified: false, error: result.error || 'Tool execution returned failure status.' };
  }

  if (actionType === 'list_directory') {
    if (!Array.isArray(result.entries)) {
      return { verified: false, error: 'list_directory result missing "entries" array.' };
    }
    for (let i = 0; i < result.entries.length; i++) {
      const entry = result.entries[i];
      if (!entry || !entry.name || typeof entry.name !== 'string' || !entry.type) {
        return { verified: false, error: `Invalid entry metadata at index ${i} in list_directory.` };
      }
    }
    return { verified: true };
  }

  if (actionType === 'read_file') {
    if (typeof result.content !== 'string') {
      return { verified: false, error: 'read_file result content must be a string.' };
    }
    if (typeof result.size !== 'number' || result.size < 0) {
      return { verified: false, error: 'read_file result size metadata is invalid.' };
    }
    if (action && action.expectedContent && typeof action.expectedContent === 'string') {
      if (result.content.trim() !== action.expectedContent.trim()) {
        return {
          verified: false,
          error: `read_file verification failed: Content mismatch. Expected "${action.expectedContent}", but got "${result.content}".`
        };
      }
    }
    return { verified: true };
  }

  if (actionType === 'create_directory') {
    try {
      const res = await listDirectory(result.path, root);
      if (res && res.success) {
        return { verified: true };
      }
      return { verified: false, error: 'create_directory verification failed: Directory check unsuccessful.' };
    } catch (e) {
      return { verified: false, error: `create_directory verification failed: ${e.message}` };
    }
  }

  if (actionType === 'write_file') {
    try {
      const res = await readFile(result.path, root);
      if (!res || !res.success) {
        return { verified: false, error: 'write_file verification failed: File cannot be read.' };
      }
      if (res.content !== result.newState.content) {
        return { verified: false, error: 'write_file verification failed: Content mismatch.' };
      }
      if (action && action.expectedContent && typeof action.expectedContent === 'string') {
        if (res.content.trim() !== action.expectedContent.trim()) {
          return {
            verified: false,
            error: `write_file verification failed: Requested content mismatch. Expected "${action.expectedContent}", but got "${res.content}".`
          };
        }
      }
      return { verified: true };
    } catch (e) {
      return { verified: false, error: `write_file verification failed: ${e.message}` };
    }
  }

  if (actionType === 'copy_file') {
    try {
      const srcRes = await readFile(result.source, root);
      const destRes = await readFile(result.destination, root);
      if (!srcRes.success || !destRes.success) {
        return { verified: false, error: 'copy_file verification failed: Source or destination unreadable.' };
      }
      if (srcRes.content !== destRes.content) {
        return { verified: false, error: 'copy_file verification failed: Destination content differs from source.' };
      }
      return { verified: true };
    } catch (e) {
      return { verified: false, error: `copy_file verification failed: ${e.message}` };
    }
  }

  if (actionType === 'move_file' || actionType === 'rename_file') {
    try {
      const destRes = await readFile(result.destination, root);
      if (!destRes.success) {
        return { verified: false, error: `${actionType} verification failed: Destination file missing or unreadable.` };
      }
      let sourceExists = true;
      try {
        await readFile(result.source, root);
      } catch (e) {
        sourceExists = false;
      }
      if (sourceExists) {
        return { verified: false, error: `${actionType} verification failed: Original source file still exists.` };
      }
      return { verified: true };
    } catch (e) {
      return { verified: false, error: `${actionType} verification failed: ${e.message}` };
    }
  }

  if (actionType === 'search_files') {
    if (!Array.isArray(result.matches)) {
      return { verified: false, error: 'search_files result missing "matches" array.' };
    }
    return { verified: true };
  }

  if (actionType === 'get_time') {
    if (!result.iso || !result.timestamp) {
      return { verified: false, error: 'get_time result missing required time fields.' };
    }
    return { verified: true };
  }

  if (actionType === 'get_system_info') {
    if (!result.platform || !result.nodeVersion) {
      return { verified: false, error: 'get_system_info result missing platform or nodeVersion.' };
    }
    return { verified: true };
  }

  if (actionType === 'run_constrained_command') {
    if (typeof result.exitCode !== 'number') {
      return { verified: false, error: 'run_constrained_command result missing exitCode.' };
    }
    return { verified: true };
  }

  if (actionType === 'OBSERVE') {
    if (!result || !result.success || !result.observationId) {
      return { verified: false, error: 'OBSERVE result missing valid observationId.' };
    }
    return { verified: true };
  }

  if (actionType === 'LAUNCH_APPLICATION') {
    if (!result || !result.success) {
      return { verified: false, error: result.error || 'LAUNCH_APPLICATION failed.' };
    }
    if (result.verification && result.verification.verified === false) {
      return { verified: false, error: result.verification.details || 'Application launch verification failed.' };
    }
    return { verified: true };
  }

  if (actionType === 'CLICK') {
    if (!result || !result.success) {
      return { verified: false, error: result.error || 'CLICK failed.' };
    }
    return { verified: true };
  }

  if (actionType === 'TEXT_INPUT') {
    if (!result || !result.success) {
      return { verified: false, error: result.error || 'TEXT_INPUT failed.' };
    }
    return { verified: true };
  }

  if (actionType === 'VERIFY') {
    if (!result || !result.success) {
      return { verified: false, error: result?.error || 'VERIFY execution failed.' };
    }

    const checkPath = action?.filePath || action?.path || result.filePath;
    const checkContent = action?.expectedContent !== undefined ? action.expectedContent : result.expectedContent;

    if (checkPath && checkContent !== null && checkContent !== undefined) {
      try {
        const readRes = await readFile(checkPath, root);
        if (!readRes || !readRes.success) {
          return {
            verified: false,
            error: `VERIFY failed: Required file "${checkPath}" does not exist or cannot be read.`
          };
        }
        if (readRes.content.trim() !== String(checkContent).trim()) {
          return {
            verified: false,
            error: `VERIFY failed: File content mismatch. Expected "${checkContent}", but got "${readRes.content}".`
          };
        }
        return { verified: true, fileVerified: true, path: checkPath };
      } catch (err) {
        return {
          verified: false,
          error: `VERIFY failed: File check error for "${checkPath}": ${err.message}`
        };
      }
    }

    if (result.verified !== true) {
      return { verified: false, error: result.error || 'VERIFY verification failed.' };
    }
    return { verified: true };
  }

  return { verified: false, error: `Unrecognized action type: "${actionType}".` };
}

/**
 * Execution Engine: Executes ONE step at a time with strict objective matching, transaction recording & result verification
 */
export async function executeNextStep(objectiveId, root = fsConfig.workspaceRoot) {
  const objectives = getObjectives();
  const index = objectives.findIndex((o) => o.id === objectiveId);
  if (index === -1) {
    throw new Error(`Objective "${objectiveId}" not found.`);
  }

  const obj = objectives[index];

  // EXECUTION SAFETY CHECK: Verify objective ID and plan integrity
  if (obj.id !== objectiveId) {
    obj.status = 'FAILED';
    obj.currentStep = 'Safety Error: Objective ID mismatch detected. Execution halted.';
    saveObjectives(objectives);
    throw new Error('Safety Error: Objective ID mismatch detected.');
  }

  if (!obj.plan || !Array.isArray(obj.plan) || obj.plan.length === 0) {
    throw new Error('Objective has no plan to execute.');
  }

  // Find next pending or in-progress step belonging strictly to this objective
  const stepToExecute = obj.plan.find((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS');
  if (!stepToExecute) {
    const allCompleted = obj.plan.every((s) => s.status === 'COMPLETED');
    if (allCompleted) {
      obj.status = 'COMPLETED';
      obj.progress = 100;
      obj.currentStep = 'All steps completed successfully.';
    } else {
      obj.status = 'FAILED';
      obj.currentStep = 'Execution stopped: Not all plan steps completed successfully.';
    }
    saveObjectives(objectives);
    return { done: allCompleted, objective: obj };
  }

  stepToExecute.status = 'IN_PROGRESS';
  obj.status = 'IN_PROGRESS';
  obj.currentStep = `Executing: ${stepToExecute.title}`;
  saveObjectives(objectives);

  // STEP 10: Objective Budget Enforcement
  const completedCountBefore = obj.plan.filter((s) => s.status === 'COMPLETED').length;
  if (!obj.executionStartedAt) {
    obj.executionStartedAt = new Date().toISOString();
    saveObjectives(objectives);
  }
  const startMs = obj.executionStartedAt
    ? new Date(obj.executionStartedAt).getTime()
    : (obj.createdAt ? new Date(obj.createdAt).getTime() : Date.now());
  const currentDurationMs = Math.max(0, Date.now() - startMs);

  const budgetCheck = objectiveBudgetService.enforceObjectiveBudget(obj.id, {
    durationMs: currentDurationMs,
    actionCount: completedCountBefore + 1,
    retryCount: obj.retryCount || 0
  });

  if (budgetCheck.failed) {
    stepToExecute.status = 'FAILED';
    stepToExecute.failureInfo = {
      failedAt: new Date().toISOString(),
      error: `Budget Exceeded: ${budgetCheck.reason}`
    };
    obj.status = 'FAILED';
    obj.currentStep = `Execution halted: Budget Exceeded: ${budgetCheck.reason}`;
    saveObjectives(objectives);
    return {
      done: false,
      failed: true,
      stepExecuted: stepToExecute,
      objective: obj,
      budgetExceeded: true
    };
  }

  const action = stepToExecute.action;

  // ENVIRONMENT SAFETY CHECK: Host execution availability check for host-dependent actions
  if (isHostActionRequired(action) && !isHostExecutionAvailable()) {
    const errorMsg = 'Host Execution Error: Real computer actions require Electron desktop mode (npm run electron:start).';
    stepToExecute.status = 'FAILED';
    stepToExecute.failureInfo = {
      failedAt: new Date().toISOString(),
      error: errorMsg
    };
    obj.status = 'FAILED';
    obj.currentStep = `Execution halted: ${errorMsg}`;
    saveObjectives(objectives);
    return {
      done: false,
      failed: true,
      stepExecuted: stepToExecute,
      objective: obj,
      hostExecutionError: true
    };
  }

  let toolResult = null;
  let executionError = null;
  const stepStartMs = Date.now();
  const startedAt = new Date(stepStartMs).toISOString();

  try {
    if (!action || typeof action !== 'object' || !action.type) {
      throw new Error(`Step "${stepToExecute.id}" has no valid action object.`);
    }

    if (!RECOGNIZED_ACTIONS.includes(action.type)) {
      throw new Error(`Blocked or unrecognized action type: "${action.type}".`);
    }

    const t = action.type;
    if (t === 'list_directory') {
      toolResult = await listDirectory(action.path, root);
    } else if (t === 'read_file') {
      toolResult = await readFile(action.path, root);
    } else if (t === 'create_directory') {
      toolResult = await createDirectory(action.path, root);
    } else if (t === 'write_file') {
      toolResult = await writeFile(action.path, action.content, action.overwriteConfirmation, root);
    } else if (t === 'copy_file') {
      toolResult = await copyFile(action.source, action.destination, root);
    } else if (t === 'move_file') {
      toolResult = await moveFile(action.source, action.destination, root);
    } else if (t === 'rename_file') {
      toolResult = await renameFile(action.source, action.destination, root);
    } else if (t === 'search_files') {
      toolResult = await searchFiles(action.query, action.path, root);
    } else if (t === 'get_time') {
      toolResult = systemToolService.getTime();
    } else if (t === 'get_system_info') {
      toolResult = systemToolService.getSystemInfo();
    } else if (t === 'run_constrained_command') {
      toolResult = await systemToolService.runConstrainedCommand(action.command, action.args, { timeoutMs: action.timeoutMs });
    } else if (t === 'OBSERVE') {
      const obs = desktopObservationService.getDesktopObservation({ audit: false });
      toolResult = { success: true, observationId: obs.observationId, observation: obs };
    } else if (t === 'LAUNCH_APPLICATION') {
      const appId = action.applicationId || action.path || action.appName || 'app_text_editor';
      const launchReq = applicationControlService.requestApplicationLaunch(appId, { objectiveId: obj.id });
      if (!launchReq.success) {
        throw new Error(launchReq.error || `Failed to stage launch for application '${appId}'.`);
      }
      const isTestEnv = process.env.NODE_ENV === 'test' || globalThis.EVO_TEST_MODE === true;
      const approveRes = await applicationControlService.approveApplicationLaunch(launchReq.requestId, {
        objectiveId: obj.id,
        mock: isTestEnv
      });
      if (!approveRes.success) {
        throw new Error(approveRes.error || `Failed to launch application '${appId}'.`);
      }
      toolResult = {
        success: true,
        applicationId: appId,
        requestId: launchReq.requestId,
        verification: approveRes.verification,
        result: approveRes.result
      };
    } else if (t === 'CLICK') {
      const target = action.target || action.targetReference || { x: 500, y: 300, button: 'left' };
      const clickReq = computerInteractionService.requestMouseClick(target, { objectiveId: obj.id });
      if (!clickReq.success) {
        throw new Error(clickReq.error || 'Failed to stage click request.');
      }
      const isTestEnv = process.env.NODE_ENV === 'test' || globalThis.EVO_TEST_MODE === true;
      const approveRes = await computerInteractionService.approveMouseClick(clickReq.interactionId, {
        objectiveId: obj.id,
        mock: isTestEnv
      });
      if (!approveRes.success) {
        throw new Error(approveRes.error || 'Failed to execute mouse click.');
      }
      toolResult = {
        success: true,
        target: clickReq.interaction?.target,
        verification: approveRes.verification,
        result: approveRes.result
      };
    } else if (t === 'TEXT_INPUT') {
      const text = action.text !== undefined ? action.text : (action.textPayload !== undefined ? action.textPayload : (action.targetReference?.text !== undefined ? action.targetReference.text : ''));
      const target = action.target || action.targetReference || { x: 400, y: 300, role: 'text', inputType: 'text', label: 'Text Entry Field' };
      const textReq = computerInteractionService.requestTextInput(target, text, { objectiveId: obj.id });
      if (!textReq.success) {
        throw new Error(textReq.error || 'Failed to stage text input request.');
      }
      const isTestEnv = process.env.NODE_ENV === 'test' || globalThis.EVO_TEST_MODE === true;
      const approveRes = await computerInteractionService.approveTextInput(textReq.requestId, {
        objectiveId: obj.id,
        mock: isTestEnv
      });
      if (!approveRes.success) {
        throw new Error(approveRes.error || 'Failed to execute text input.');
      }
      toolResult = {
        success: true,
        textLength: text.length,
        verification: approveRes.verification,
        result: approveRes.result
      };
    } else if (t === 'VERIFY') {
      const obs = desktopObservationService.getDesktopObservation({ audit: false });
      toolResult = {
        success: true,
        verified: true,
        observationId: obs.observationId,
        filePath: action.filePath || action.path || null,
        expectedContent: action.expectedContent !== undefined ? action.expectedContent : null
      };
    } else {
      throw new Error(`Unhandled action type: "${t}".`);
    }

    // Independent result verification
    const verification = await verifyToolResult(action.type, toolResult, root, action);
    if (!verification.verified) {
      throw new Error(`Result verification failed: ${verification.error}`);
    }

    const stepEndMs = Date.now();
    const completedAt = new Date(stepEndMs).toISOString();
    const durationMs = Math.max(0, stepEndMs - stepStartMs);

    // STEP 10: Record Action Event for Audit Timeline
    const evoMeta = obj.evolution || {};
    recordActionEvent({
      objectiveId: obj.id,
      stepId: stepToExecute.id,
      tool: t,
      inputs: action.parameters || action,
      startedAt,
      completedAt,
      durationMs,
      outcome: 'SUCCESS',
      verificationResult: verification,
      capabilityId: evoMeta.capabilityId || null,
      capabilityVersion: evoMeta.capabilityVersion || null,
      autonomyMode: evoMeta.executionMode || 'NORMAL'
    });

    // Record Transaction for Mutating Operations
    let txRecord = null;
    if (['create_directory', 'write_file', 'copy_file', 'move_file', 'rename_file'].includes(t)) {
      txRecord = recordTransaction({
        transactionId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        objectiveId: obj.id,
        stepId: stepToExecute.id,
        actionType: t,
        source: action.source || null,
        destination: action.destination || null,
        targetPath: action.path || null,
        previousState: toolResult.previousState || { existed: false },
        newState: toolResult.newState || {
          existed: true,
          fingerprint: toolResult.fingerprint || computeFingerprint(toolResult.content || '')
        },
        timestamp: new Date().toISOString(),
        verificationResult: { verified: true }
      });
    }

    // Mark step COMPLETED
    stepToExecute.status = 'COMPLETED';
    stepToExecute.resultMetadata = {
      executedAt: new Date().toISOString(),
      transactionId: txRecord ? txRecord.transactionId : null,
      summary: t === 'list_directory'
        ? `Found ${toolResult.entries.length} items`
        : t === 'read_file'
        ? `Read ${toolResult.size} bytes`
        : t === 'create_directory'
        ? 'Directory verified'
        : t === 'write_file'
        ? `Written ${toolResult.newState.size} bytes`
        : t === 'copy_file'
        ? 'File copied & verified'
        : t === 'search_files'
        ? `Found ${toolResult.matches.length} matching files`
        : t === 'run_constrained_command'
        ? `Executed command ${toolResult.command} (exitCode ${toolResult.exitCode})`
        : 'Action verified',
      result: toolResult
    };

    const completedCount = obj.plan.filter((s) => s.status === 'COMPLETED').length;
    obj.progress = Math.round((completedCount / obj.plan.length) * 100);
    obj.completedSteps = obj.plan.filter((s) => s.status === 'COMPLETED').map((s) => s.title);

    const remaining = obj.plan.filter((s) => s.status === 'PENDING');
    if (remaining.length === 0) {
      // OBJECTIVE COMPLETION RULE: Only mark COMPLETED if every single step completed
      const allDone = obj.plan.every((s) => s.status === 'COMPLETED');
      if (allDone) {
        obj.status = 'COMPLETED';
        obj.currentStep = 'All steps completed successfully.';
      } else {
        obj.status = 'FAILED';
        obj.currentStep = 'Execution finished with incomplete steps.';
      }
    } else {
      obj.status = 'IN_PROGRESS';
      obj.currentStep = `Next step: ${remaining[0].title}`;
    }

    saveObjectives(objectives);
    return {
      done: remaining.length === 0 && obj.status === 'COMPLETED',
      stepExecuted: stepToExecute,
      objective: obj
    };
  } catch (err) {
    executionError = err.message || 'Execution error';
    const stepEndMs = Date.now();
    const completedAt = new Date(stepEndMs).toISOString();

    const evoMeta = obj.evolution || {};
    recordActionEvent({
      objectiveId: obj.id,
      stepId: stepToExecute.id,
      tool: action ? action.type : 'unknown',
      inputs: action ? (action.parameters || action) : {},
      startedAt,
      completedAt,
      durationMs: Math.max(0, stepEndMs - stepStartMs),
      outcome: 'FAILED',
      errorMessage: executionError,
      capabilityId: evoMeta.capabilityId || null,
      capabilityVersion: evoMeta.capabilityVersion || null,
      autonomyMode: evoMeta.executionMode || 'NORMAL'
    });

    stepToExecute.status = 'FAILED';
    stepToExecute.failureInfo = {
      failedAt: new Date().toISOString(),
      error: executionError
    };

    obj.status = 'FAILED';
    obj.currentStep = `Execution failed on step "${stepToExecute.title}": ${executionError}`;

    saveObjectives(objectives);
    return {
      done: false,
      failed: true,
      stepExecuted: stepToExecute,
      objective: obj
    };
  }
}
