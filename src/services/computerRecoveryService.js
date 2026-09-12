/**
 * STAGE 8D — INTELLIGENT BOUNDED EXECUTION & RECOVERY SERVICE
 * Intelligently recovers from ordinary computer execution problems (stale observations,
 * window context shifts, transient UI delays, verification glitches) WITHIN an already
 * human-approved immutable autonomy scope without increasing authority.
 * 
 * CORE RECOVERY PRINCIPLES:
 * 1. Recovery is strictly bounded by the existing approved scope.
 * 2. Recovery never expands allowedActions, allowedApplications, maxActions, or maxDurationMs.
 * 3. Hard safety locks (allowSensitiveInput, allowKeyboardShortcuts, allowUnknownTargets) remain immutable false.
 * 4. Recovery stops safely when authority is missing (SCOPE_EXPANSION_REQUIRED).
 * 5. Every recovery attempt is persistently recorded in audit store & runtime learning.
 * 6. Deterministic recovery levels (LEVEL_0 to LEVEL_4) with strict attempt ceilings.
 */

import { desktopObservationService } from './desktopObservationService.js';
import { visualTargetService } from './visualTargetService.js';
import { computerAutonomyService } from './computerAutonomyService.js';
import { computerInteractionService } from './computerInteractionService.js';
import { applicationControlService } from './applicationControlService.js';
import { recordActionEvent } from './actionEventStore.js';
import { createRuntimeLearningRecord, LEARNING_CATEGORIES, LEARNING_STATUS } from './runtimeLearningStore.js';

export const MAX_RECOVERY_ATTEMPTS = 3;
export const MAX_REOBSERVATIONS_PER_FAILURE = 2;
export const MAX_ACTION_RETRIES_PER_FAILURE = 1;
export const RECOVERY_TIME_BUDGET_MS = 30000;
export const RECOVERY_EVENTS_KEY = 'evo_computer_recovery_events';

export const RECOVERY_LEVELS = {
  LEVEL_0: 'LEVEL_0_NONE',
  LEVEL_1: 'LEVEL_1_REOBSERVE',
  LEVEL_2: 'LEVEL_2_REVALIDATE_TARGET',
  LEVEL_3: 'LEVEL_3_RETRY_ACTION',
  LEVEL_4: 'LEVEL_4_VERIFY'
};

export const RECOVERY_STATUS = {
  RECOVERING: 'RECOVERING',
  RE_OBSERVING: 'RE_OBSERVING',
  REVALIDATING_TARGET: 'REVALIDATING_TARGET',
  RETRYING_AUTHORIZED_ACTION: 'RETRYING_AUTHORIZED_ACTION',
  RECOVERY_SUCCEEDED: 'RECOVERY_SUCCEEDED',
  RECOVERY_FAILED_SAFELY: 'RECOVERY_FAILED_SAFELY',
  HUMAN_INTERVENTION_REQUIRED: 'HUMAN_INTERVENTION_REQUIRED',
  SCOPE_EXPANSION_REQUIRED: 'SCOPE_EXPANSION_REQUIRED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  RECOVERY_EXHAUSTED: 'RECOVERY_EXHAUSTED'
};

const memoryRecoveryEvents = [];

/**
 * Classifies an execution failure into structured problem categories
 */
export function classifyExecutionFailure(resultOrError) {
  if (!resultOrError) return 'UNKNOWN_FAILURE';

  const KNOWN_CATEGORIES = [
    'HARD_SAFETY_VIOLATION',
    'SCOPE_VIOLATION',
    'STALE_OBSERVATION',
    'APPLICATION_WINDOW_CHANGED',
    'TARGET_UNAVAILABLE',
    'VERIFICATION_UNAVAILABLE',
    'LAUNCH_DELAY',
    'TRANSIENT_UI_MISMATCH',
    'ACTION_EXECUTION_FAILURE'
  ];

  if (typeof resultOrError === 'string' && KNOWN_CATEGORIES.includes(resultOrError)) {
    return resultOrError;
  }

  const text = typeof resultOrError === 'string'
    ? resultOrError
    : (resultOrError.error || resultOrError.result || resultOrError.details || JSON.stringify(resultOrError));

  const lower = text.toLowerCase();

  if (lower.includes('sensitive') || lower.includes('password') || lower.includes('shortcut') || lower.includes('shell')) {
    return 'HARD_SAFETY_VIOLATION';
  }
  if (lower.includes('scope_violation') || lower.includes('unauthorized') || lower.includes('not in the approved') || lower.includes('not allowed')) {
    return 'SCOPE_VIOLATION';
  }
  if (lower.includes('stale') || lower.includes('observation id') || lower.includes('desktop state changed')) {
    return 'STALE_OBSERVATION';
  }
  if (lower.includes('window') || lower.includes('active application changed') || lower.includes('title')) {
    return 'APPLICATION_WINDOW_CHANGED';
  }
  if (lower.includes('target') || lower.includes('out-of-bounds') || lower.includes('confidence') || lower.includes('not present')) {
    return 'TARGET_UNAVAILABLE';
  }
  if (lower.includes('verification') || lower.includes('not_fully_verified') || lower.includes('incomplete')) {
    return 'VERIFICATION_UNAVAILABLE';
  }
  if (lower.includes('delay') || lower.includes('enoent') || lower.includes('not_running') || lower.includes('timeout')) {
    return 'LAUNCH_DELAY';
  }
  if (lower.includes('mismatch') || lower.includes('bounds')) {
    return 'TRANSIENT_UI_MISMATCH';
  }

  return 'ACTION_EXECUTION_FAILURE';
}

/**
 * Checks whether a recovery operation can be performed within the active approved scope
 */
export function canRecoverWithinScope(failure, task, scope) {
  if (!scope || scope.status !== 'ACTIVE' || scope.mode !== 'BOUNDED') {
    return {
      canRecover: false,
      reason: 'NO_ACTIVE_BOUNDED_SCOPE',
      scopeExpansionRequired: false,
      status: RECOVERY_STATUS.HUMAN_INTERVENTION_REQUIRED
    };
  }

  const failureType = classifyExecutionFailure(failure);

  // 1. Hard Safety & Unapproved Authority Rejections
  if (failureType === 'HARD_SAFETY_VIOLATION' || failureType === 'SCOPE_VIOLATION') {
    return {
      canRecover: false,
      reason: 'SCOPE_EXPANSION_REQUIRED',
      scopeExpansionRequired: true,
      status: RECOVERY_STATUS.SCOPE_EXPANSION_REQUIRED
    };
  }

  // 2. Task Budget Exceeded Check
  const currentActionCount = scope.actionCount ?? scope.executedActionsCount ?? 0;
  if (currentActionCount >= scope.maxActions) {
    return {
      canRecover: false,
      reason: 'BUDGET_EXCEEDED_ACTION_COUNT',
      scopeExpansionRequired: false,
      status: RECOVERY_STATUS.BUDGET_EXCEEDED
    };
  }

  const durationMs = Date.now() - new Date(scope.createdAt).getTime();
  if (durationMs >= scope.maxDurationMs) {
    return {
      canRecover: false,
      reason: 'BUDGET_EXCEEDED_DURATION',
      scopeExpansionRequired: false,
      status: RECOVERY_STATUS.BUDGET_EXCEEDED
    };
  }

  // 3. Recovery Attempt Limit Check
  const attempts = task.recoveryAttemptCount || 0;
  if (attempts >= MAX_RECOVERY_ATTEMPTS) {
    return {
      canRecover: false,
      reason: 'MAX_RECOVERY_ATTEMPTS_REACHED',
      scopeExpansionRequired: false,
      status: RECOVERY_STATUS.RECOVERY_EXHAUSTED
    };
  }

  return {
    canRecover: true,
    reason: 'RECOVERY_PERMITTED_WITHIN_SCOPE',
    scopeExpansionRequired: false,
    status: RECOVERY_STATUS.RECOVERING
  };
}

/**
 * Determines the appropriate deterministic recovery level and action based on failure type
 */
export function determineRecoveryAction(failure, task, scope) {
  const failureType = classifyExecutionFailure(failure);
  const currentAttempts = task.recoveryAttemptCount || 0;

  if (failureType === 'STALE_OBSERVATION' || failureType === 'APPLICATION_WINDOW_CHANGED') {
    return {
      level: RECOVERY_LEVELS.LEVEL_1,
      action: 'RE_OBSERVE',
      description: 'Capture fresh desktop observation state'
    };
  }

  if (failureType === 'TARGET_UNAVAILABLE' || failureType === 'TRANSIENT_UI_MISMATCH') {
    return {
      level: RECOVERY_LEVELS.LEVEL_2,
      action: 'REVALIDATE_TARGET',
      description: 'Re-identify visual target and re-bind coordinates'
    };
  }

  if (failureType === 'ACTION_EXECUTION_FAILURE' || failureType === 'VERIFICATION_UNAVAILABLE' || failureType === 'LAUNCH_DELAY') {
    if (currentAttempts < MAX_ACTION_RETRIES_PER_FAILURE) {
      return {
        level: RECOVERY_LEVELS.LEVEL_3,
        action: 'RETRY_AUTHORIZED_ACTION',
        description: 'Single retry of already authorized step action'
      };
    }
    return {
      level: RECOVERY_LEVELS.LEVEL_4,
      action: 'VERIFY',
      description: 'Perform final verification check'
    };
  }

  return {
    level: RECOVERY_LEVELS.LEVEL_1,
    action: 'RE_OBSERVE',
    description: 'Fallback re-observation'
  };
}

/**
 * Persistently records a recovery audit event
 */
export function recordRecoveryEvent(event) {
  if (!event || typeof event !== 'object') return null;

  const eventId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const recoveryRecord = {
    id: eventId,
    taskId: event.taskId || 'unknown_task',
    scopeId: event.scopeId || 'unknown_scope',
    timestamp: new Date().toISOString(),
    failureType: event.failureType || 'UNKNOWN',
    recoveryLevel: event.recoveryLevel || RECOVERY_LEVELS.LEVEL_1,
    attemptedAction: event.attemptedAction || 'RE_OBSERVE',
    result: event.result || 'EXECUTED',
    reason: event.reason || 'Bounded recovery attempt',
    remainingActionBudget: event.remainingActionBudget ?? 0,
    remainingTimeBudget: event.remainingTimeBudget ?? 0,
    observationId: event.observationId || null
  };

  memoryRecoveryEvents.unshift(recoveryRecord);

  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(RECOVERY_EVENTS_KEY);
      const list = stored ? JSON.parse(stored) : [];
      list.unshift(recoveryRecord);
      if (list.length > 100) list.splice(100);
      localStorage.setItem(RECOVERY_EVENTS_KEY, JSON.stringify(list));
    }
  } catch (e) {}

  // Record audit action event
  try {
    recordActionEvent({
      objectiveId: event.taskId,
      tool: 'bounded_computer_recovery',
      inputs: {
        eventId,
        scopeId: event.scopeId,
        level: event.recoveryLevel,
        action: event.attemptedAction
      },
      outcome: event.result === 'RECOVERED' ? 'SUCCESS' : 'FAILED',
      verificationResult: { status: event.result, level: event.recoveryLevel },
      durationMs: 10
    });
  } catch (e) {}

  return recoveryRecord;
}

/**
 * Retrieves stored recovery audit history for a task
 */
export function getRecoveryHistory(taskId = null) {
  let list = [...memoryRecoveryEvents];
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(RECOVERY_EVENTS_KEY);
      if (stored) {
        list = JSON.parse(stored);
      }
    }
  } catch (e) {}

  if (taskId) {
    return list.filter((r) => r.taskId === taskId);
  }
  return list;
}

/**
 * Performs a bounded, intelligent recovery operation on a failed task step
 */
export async function performRecovery(task, scope, failure, taskService) {
  if (!task || !scope) {
    return {
      success: false,
      status: RECOVERY_STATUS.HUMAN_INTERVENTION_REQUIRED,
      reason: 'Task or scope missing for recovery'
    };
  }

  // 1. Scope & Authority Validation Check
  const scopeCheck = canRecoverWithinScope(failure, task, scope);
  if (!scopeCheck.canRecover) {
    recordRecoveryEvent({
      taskId: task.taskId,
      scopeId: scope.scopeId,
      failureType: classifyExecutionFailure(failure),
      recoveryLevel: RECOVERY_LEVELS.LEVEL_0,
      attemptedAction: 'SAFE_STOP',
      result: scopeCheck.status,
      reason: scopeCheck.reason,
      remainingActionBudget: scope.maxActions - scope.actionCount,
      remainingTimeBudget: scope.maxDurationMs - (Date.now() - new Date(scope.createdAt).getTime())
    });

    return {
      success: false,
      status: scopeCheck.status,
      reason: scopeCheck.reason,
      scopeExpansionRequired: scopeCheck.scopeExpansionRequired
    };
  }

  // 2. Track Recovery Strategy & Attempts
  const recoveryStrategy = determineRecoveryAction(failure, task, scope);
  task.recoveryAttemptCount = (task.recoveryAttemptCount || 0) + 1;
  task.recoveryStatus = RECOVERY_STATUS.RECOVERING;

  const failureType = classifyExecutionFailure(failure);

  let freshObs = null;
  let recoverySuccess = false;

  const steps = Array.isArray(task.steps) ? task.steps : [];
  const currentStep = steps[task.currentStepIndex || 0] || null;

  // Level 1: Re-observe current desktop/window state
  if (recoveryStrategy.level === RECOVERY_LEVELS.LEVEL_1) {
    task.recoveryStatus = RECOVERY_STATUS.RE_OBSERVING;
    freshObs = desktopObservationService.getDesktopObservation({ audit: false });
    task.afterObservationId = freshObs.observationId;

    if (currentStep) {
      currentStep.beforeObservation = freshObs;
    }
    recoverySuccess = true;
  }
  // Level 2: Revalidate target and task context
  else if (recoveryStrategy.level === RECOVERY_LEVELS.LEVEL_2) {
    task.recoveryStatus = RECOVERY_STATUS.REVALIDATING_TARGET;
    freshObs = desktopObservationService.getDesktopObservation({ audit: false });

    if (currentStep && currentStep.targetReference) {
      const reId = await visualTargetService.identifyClickableTarget(freshObs, task.objective);
      if (reId.success && reId.proposal) {
        currentStep.targetReference.x = reId.proposal.target.x;
        currentStep.targetReference.y = reId.proposal.target.y;
        recoverySuccess = true;
      }
    }
  }
  // Level 3: Single retry of authorized step action
  else if (recoveryStrategy.level === RECOVERY_LEVELS.LEVEL_3) {
    task.recoveryStatus = RECOVERY_STATUS.RETRYING_AUTHORIZED_ACTION;
    freshObs = desktopObservationService.getDesktopObservation({ audit: false });

    // Retry action MUST consume action budget
    computerAutonomyService.recordActionExecution(task.taskId);

    if (currentStep && taskService) {
      currentStep.beforeObservation = freshObs;
      if (currentStep.type === 'CLICK') {
        const clickReq = computerInteractionService.requestMouseClick(currentStep.targetReference || { x: 500, y: 300, button: 'left' }, { objectiveId: task.taskId, observation: freshObs });
        currentStep.actionRequestId = clickReq.requestId || clickReq.interactionId;
      } else if (currentStep.type === 'TEXT_INPUT') {
        const textReq = computerInteractionService.requestTextInput(currentStep.targetReference || { x: 400, y: 300 }, currentStep.targetReference?.text || 'Sample text', { objectiveId: task.taskId, observation: freshObs });
        currentStep.actionRequestId = textReq.requestId;
      } else if (currentStep.type === 'LAUNCH_APPLICATION') {
        const launchReq = applicationControlService.requestApplicationLaunch(currentStep.targetReference?.applicationId || 'app_text_editor', { objectiveId: task.taskId });
        currentStep.actionRequestId = launchReq.requestId;
      }

      currentStep.status = 'AWAITING_APPROVAL';
      const retryRes = await taskService.approveComputerAction(task.taskId, currentStep.stepId, {
        scopeId: scope.scopeId,
        isRecoveryRetry: true
      });
      if (retryRes && retryRes.success) {
        recoverySuccess = true;
      }
    }
  }
  // Level 4: Perform final verification
  else if (recoveryStrategy.level === RECOVERY_LEVELS.LEVEL_4) {
    if (taskService) {
      const verifyRes = taskService.verifyComputerTask(task.taskId);
      if (verifyRes && verifyRes.verified) {
        recoverySuccess = true;
      }
    }
  }

  // 3. Persistent Audit Logging
  const remainingActions = scope.maxActions - scope.actionCount;
  const remainingTime = Math.max(0, scope.maxDurationMs - (Date.now() - new Date(scope.createdAt).getTime()));

  recordRecoveryEvent({
    taskId: task.taskId,
    scopeId: scope.scopeId,
    failureType,
    recoveryLevel: recoveryStrategy.level,
    attemptedAction: recoveryStrategy.action,
    result: recoverySuccess ? 'RECOVERED' : 'FAILED_SAFELY',
    reason: recoveryStrategy.description,
    remainingActionBudget: remainingActions,
    remainingTimeBudget: remainingTime,
    observationId: freshObs?.observationId || null
  });

  // 4. Runtime Learning Integration
  try {
    createRuntimeLearningRecord({
      objectiveId: task.taskId,
      goal: `Intelligent bounded recovery for task: ${task.objective}`,
      category: LEARNING_CATEGORIES.DESKTOP_INTERACTION,
      evidenceIds: [freshObs?.observationId].filter(Boolean),
      timestamps: {
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      status: recoverySuccess ? LEARNING_STATUS.COMPLETED : LEARNING_STATUS.FAILED,
      summary: {
        recoveryAttempted: true,
        failureType,
        recoveryLevel: recoveryStrategy.level,
        attemptCount: task.recoveryAttemptCount,
        recoverySuccess
      }
    });
  } catch (e) {}

  if (recoverySuccess) {
    task.recoveryStatus = RECOVERY_STATUS.RECOVERY_SUCCEEDED;
    return {
      success: true,
      status: RECOVERY_STATUS.RECOVERY_SUCCEEDED,
      level: recoveryStrategy.level,
      freshObservationId: freshObs?.observationId || null
    };
  } else {
    task.recoveryStatus = RECOVERY_STATUS.RECOVERY_FAILED_SAFELY;
    return {
      success: false,
      status: RECOVERY_STATUS.RECOVERY_FAILED_SAFELY,
      level: recoveryStrategy.level,
      reason: 'Bounded recovery attempt did not resolve execution problem.'
    };
  }
}

export class ComputerRecoveryService {
  classifyExecutionFailure(result) {
    return classifyExecutionFailure(result);
  }

  canRecoverWithinScope(failure, task, scope) {
    return canRecoverWithinScope(failure, task, scope);
  }

  determineRecoveryAction(failure, task, scope) {
    return determineRecoveryAction(failure, task, scope);
  }

  performRecovery(task, scope, failure, taskService) {
    return performRecovery(task, scope, failure, taskService);
  }

  recordRecoveryEvent(event) {
    return recordRecoveryEvent(event);
  }

  getRecoveryHistory(taskId) {
    return getRecoveryHistory(taskId);
  }
}

export const computerRecoveryService = new ComputerRecoveryService();
export default computerRecoveryService;
