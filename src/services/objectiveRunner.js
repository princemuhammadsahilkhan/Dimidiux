import { executeNextStep } from './executionEngine.js';
import {
  getObjectives,
  saveObjectives,
  updateObjectiveStatus
} from './objectiveStore.js';
import { readFile } from './filesystemTool.js';
import { fsConfig } from '../config/fsConfig.js';
import { evolutionService } from './evolutionService.js';

// In-memory runner locks per objective ID
const activeRunners = new Set();
const pauseRequests = new Set();

export function isRunnerActive(objectiveId) {
  return activeRunners.has(objectiveId);
}

export function requestPause(objectiveId) {
  pauseRequests.add(objectiveId);
}

export function cancelPauseRequest(objectiveId) {
  pauseRequests.delete(objectiveId);
}

export function isPauseRequested(objectiveId) {
  return pauseRequests.has(objectiveId);
}

/**
 * Pre-execution check: Detects if a pending step requires overwrite confirmation
 */
export async function checkStepRequiresConfirmation(step, root = fsConfig.workspaceRoot) {
  if (!step || !step.action) return false;

  const { type, path: filePath, overwriteConfirmation } = step.action;
  if (type === 'write_file' && filePath && !overwriteConfirmation) {
    try {
      const res = await readFile(filePath, root);
      if (res && res.success) {
        return true;
      }
    } catch (e) {
      return false;
    }
  }
  return false;
}

/**
 * Grants explicit overwrite confirmation for a specific step in a specific objective
 */
export function grantStepOverwriteConfirmation(objectiveId, stepId) {
  const objectives = getObjectives();
  const obj = objectives.find((o) => o.id === objectiveId);
  if (!obj || !Array.isArray(obj.plan)) return false;

  const step = obj.plan.find((s) => s.id === stepId);
  if (step && step.action) {
    step.action.overwriteConfirmation = true;
    saveObjectives(objectives);
    return true;
  }
  return false;
}

/**
 * Controlled Objective Runner
 * Sequentially processes approved plan steps with concurrency lock & idempotency.
 */
export async function runObjective(objectiveId, options = {}) {
  const root = options.root || fsConfig.workspaceRoot;
  const onStepCallback = options.onStepCallback || null;

  // Concurrency Guard: Ensure only ONE runner per objective
  if (activeRunners.has(objectiveId)) {
    console.warn(`Runner already active for objective "${objectiveId}". Ignoring duplicate invocation.`);
    return { status: 'ALREADY_RUNNING' };
  }

  activeRunners.add(objectiveId);
  cancelPauseRequest(objectiveId);

  try {
    let objectives = getObjectives();
    let obj = objectives.find((o) => o.id === objectiveId);

    if (!obj) {
      throw new Error(`Objective "${objectiveId}" not found.`);
    }

    if (obj.status === 'COMPLETED') {
      return { status: 'COMPLETED', objective: obj };
    }

    if (obj.status === 'FAILED') {
      return { status: 'FAILED', objective: obj };
    }

    // Set status to IN_PROGRESS
    obj = updateObjectiveStatus(objectiveId, 'IN_PROGRESS', 'Runner started...');

    while (true) {
      // Refresh objective state from persistence (source of truth)
      objectives = getObjectives();
      obj = objectives.find((o) => o.id === objectiveId);
      if (!obj || !Array.isArray(obj.plan)) break;

      // 1. Check for pause request BEFORE starting next step
      if (isPauseRequested(objectiveId)) {
        cancelPauseRequest(objectiveId);
        obj = updateObjectiveStatus(objectiveId, 'PAUSED', 'Execution paused by user.');
        break;
      }

      // 2. Find next PENDING step (IDEMPOTENCY: skip COMPLETED/FAILED steps)
      const nextStep = obj.plan.find((s) => s.status === 'PENDING');
      if (!nextStep) {
        const allCompleted = obj.plan.every((s) => s.status === 'COMPLETED');
        if (allCompleted) {
          obj.status = 'COMPLETED';
          obj.progress = 100;
          obj.currentStep = 'All steps completed successfully.';
          saveObjectives(objectives);
        }
        break;
      }

      // 3. Pre-execution Confirmation Check (e.g. file overwrite protection)
      const requiresConfirmation = await checkStepRequiresConfirmation(nextStep, root);
      if (requiresConfirmation) {
        obj = updateObjectiveStatus(
          objectiveId,
          'PAUSED',
          `Overwrite confirmation required for step "${nextStep.title}" (${nextStep.action.path}).`
        );
        break;
      }

      // 4. Execute atomic step
      const stepRes = await executeNextStep(objectiveId, root);

      if (onStepCallback) {
        onStepCallback(stepRes);
      }

      // 5. If step failed, halt objective execution immediately
      if (stepRes.failed) {
        break;
      }

      // 6. Check if all steps completed after this step
      if (stepRes.done || stepRes.objective.status === 'COMPLETED') {
        break;
      }

      // 7. Check for pause request AFTER atomic step completion
      if (isPauseRequested(objectiveId)) {
        cancelPauseRequest(objectiveId);
        obj = updateObjectiveStatus(objectiveId, 'PAUSED', 'Execution paused by user.');
        break;
      }
    }

    objectives = getObjectives();
    const finalObj = objectives.find((o) => o.id === objectiveId);
    if (finalObj && (finalObj.status === 'COMPLETED' || finalObj.status === 'FAILED')) {
      try {
        await evolutionService.handleObjectiveCompletion(finalObj);
      } catch (e) {
        console.error('Failed to process evolution service on completion:', e);
      }
    }
    return { status: finalObj ? finalObj.status : 'UNKNOWN', objective: finalObj };
  } finally {
    activeRunners.delete(objectiveId);
    cancelPauseRequest(objectiveId);
  }
}
