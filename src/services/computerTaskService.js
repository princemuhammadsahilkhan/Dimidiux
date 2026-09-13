/**
 * STAGE 7F — MULTI-STEP SUPERVISED COMPUTER TASK ORCHESTRATOR
 * Connects application launch, desktop observation, visual target identification,
 * single click, and text input into a controlled multi-step computer-use objective runner.
 * 
 * IMPORTANT SAFETY BOUNDARIES:
 * - Autonomy mode MUST remain SUPERVISED.
 * - One user approval authorizes EXACTLY ONE physical action.
 * - Does NOT bypass Stage 7B click, Stage 7D app launch, or Stage 7E text input approvals.
 * - Physical actions execute strictly sequentially (one action at a time).
 * - Desktop observation re-verification required between actions.
 * - Stale target protection triggers re-observation and target re-identification.
 * - Inherits sensitive field protections and keyboard shortcut rejections.
 */

import { desktopObservationService, validateObservationSchema } from './desktopObservationService.js';
import { applicationControlService } from './applicationControlService.js';
import { computerInteractionService } from './computerInteractionService.js';
import { visualTargetService } from './visualTargetService.js';
import { recordActionEvent } from './actionEventStore.js';
import { createRuntimeLearningRecord, LEARNING_CATEGORIES, LEARNING_STATUS } from './runtimeLearningStore.js';
import { computerAutonomyService } from './computerAutonomyService.js';
import { autonomyScopePlannerService } from './autonomyScopePlannerService.js';
import { computerRecoveryService } from './computerRecoveryService.js';
import { evolutionService } from './evolutionService.js';
import { resolveApplicationByNameSync } from './desktopApplicationDiscoveryService.js';
import { isObjectiveProcessedForEvolution } from './capabilityStore.js';
import { resolveSafePath } from './filesystemTool.js';
import fs from 'fs';

export const ALLOWED_STEP_TYPES = ['OBSERVE', 'LAUNCH_APPLICATION', 'CLICK', 'TEXT_INPUT', 'GUI_SAVE', 'write_file', 'VERIFY', 'CLOSE_WINDOW', 'CLOSE_APPLICATION'];
export const STEP_STATUSES = [
  'PENDING', 'READY', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING',
  'VERIFYING', 'COMPLETED', 'REJECTED', 'STALE', 'FAILED', 'CANCELLED'
];
export const TASK_STATUSES = ['PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Plans a multi-step computer task from an objective goal string
 */
export function planComputerTask(objective) {
  if (!objective || typeof objective !== 'string') {
    throw new Error('Objective must be a non-empty string.');
  }

  const goalLower = objective.toLowerCase();
  const steps = [];
  let stepIdx = 1;

  // Candidate Change: Only add explicit OBSERVE step if no physical actions exist in objective
  const hasPhysicalActions = goalLower.includes('launch') || goalLower.includes('open') || goalLower.includes('editor') || 
                             goalLower.includes('calculator') || goalLower.includes('terminal') || goalLower.includes('type') || 
                             goalLower.includes('input') || goalLower.includes('enter') || goalLower.includes('write') || 
                             goalLower.includes('click') || goalLower.includes('press') || goalLower.includes('button');
  if (!hasPhysicalActions) {
    steps.push({
      stepId: `step_${stepIdx++}_obs`,
      type: 'OBSERVE',
      description: 'Capture initial desktop observation state',
      dependencies: [],
      targetReference: null,
      actionRequestId: null,
      approvalRequired: false,
      status: 'READY'
    });
  }

  // Step 2: Application Launch if requested in goal
  const isAppLaunchRequested = goalLower.includes('launch') || goalLower.includes('open') || goalLower.includes('editor') || 
                               goalLower.includes('calculator') || goalLower.includes('terminal') || goalLower.includes('firefox') || 
                               goalLower.includes('code') || goalLower.includes('file manager') || goalLower.includes('browser');

  if (isAppLaunchRequested) {
    const clauseSplits = objective.split(/\s*(?:,\s*then\s+|;\s*then\s+|\s+then\s+|\s+and\s+finally\s+|\s+and\s+then\s+|,\s*and\s+|\s+and\s+|,|\.)\s*/i).filter(Boolean);

    const requestedAppClauses = clauseSplits.filter(clause => {
      const cLower = clause.toLowerCase().trim();
      const isKeepOpen = cLower.includes('leave it open') || cLower.includes('keep it open') || cLower.includes("don't close") || cLower.includes('do not close') || cLower.startsWith('leave ') || cLower.startsWith('keep ');
      const isCloseClause = cLower.startsWith('close ') || cLower === 'close';
      if (isKeepOpen || isCloseClause) return false;

      return cLower.includes('launch') || cLower.includes('open') || cLower.includes('start') ||
             cLower.includes('editor') || cLower.includes('calculator') || cLower.includes('terminal') ||
             cLower.includes('firefox') || cLower.includes('code') || cLower.includes('file manager') ||
             cLower.includes('browser') || cLower.includes('calc');
    });

    const launchClauses = requestedAppClauses.length > 0 ? requestedAppClauses : [objective];

    for (const clause of launchClauses) {
      let resolvedApp = null;
      try {
        const res = resolveApplicationByNameSync(clause);
        if (res && res.success && res.application) {
          resolvedApp = res.application;
        }
      } catch (e) {}

      let appId = resolvedApp ? resolvedApp.id : null;
      let appName = resolvedApp ? resolvedApp.name : null;

      if (!resolvedApp) {
        const cLower = clause.toLowerCase();
        if (cLower.includes('calculator') || cLower.includes('calc')) {
          appId = 'app_calculator';
          appName = 'Calculator';
        } else if (cLower.includes('terminal')) {
          appId = 'app_terminal';
          appName = 'Terminal Console';
        } else if (cLower.includes('text editor') || cLower.includes('editor')) {
          appId = 'app_text_editor';
          appName = 'Text Editor';
        } else if (cLower.includes('file manager')) {
          appId = 'thunar';
          appName = 'File Manager';
        } else if (cLower.includes('firefox')) {
          appId = 'firefox';
          appName = 'Firefox';
        } else if (cLower.includes('code') || cLower.includes('visual studio code')) {
          appId = 'code';
          appName = 'Visual Studio Code';
        }
      }

      if (!appId) {
        throw new Error(`Planning Error: Application requested in '${clause}' could not be resolved.`);
      }

      steps.push({
        stepId: `step_${stepIdx++}_launch`,
        type: 'LAUNCH_APPLICATION',
        description: `Launch ${resolvedApp ? 'discovered' : 'allowlisted'} application '${appName}' (${appId})`,
        dependencies: steps.length > 0 ? [steps[steps.length - 1].stepId] : [],
        targetReference: { applicationId: appId, appName, appDescriptor: resolvedApp },
        actionRequestId: null,
        approvalRequired: true,
        status: 'PENDING'
      });
    }
  }

  // Step 3: Text Input if text entry is requested in goal
  if (goalLower.includes('type') || goalLower.includes('input') || goalLower.includes('enter') || goalLower.includes('write')) {
    const textMatch = objective.match(/["']([^"']+)["']/);
    const textPayload = textMatch ? textMatch[1] : 'Sample non-sensitive text payload';

    steps.push({
      stepId: `step_${stepIdx++}_text`,
      type: 'TEXT_INPUT',
      description: `Type text payload into focused text field`,
      dependencies: steps.length > 0 ? [steps[steps.length - 1].stepId] : [],
      targetReference: {
        x: 400,
        y: 300,
        role: 'text',
        inputType: 'text',
        label: 'Text Entry Field',
        text: textPayload
      },
      actionRequestId: null,
      approvalRequired: true,
      status: 'PENDING'
    });
  }

  // Step 4: Click if single click is requested in goal
  if (goalLower.includes('click') || goalLower.includes('press') || goalLower.includes('button')) {
    steps.push({
      stepId: `step_${stepIdx++}_click`,
      type: 'CLICK',
      description: 'Execute supervised single mouse click on target UI element',
      dependencies: steps.length > 0 ? [steps[steps.length - 1].stepId] : [],
      targetReference: {
        x: 500,
        y: 300,
        button: 'left',
        label: 'Target Action Button'
      },
      actionRequestId: null,
      approvalRequired: true,
      status: 'PENDING'
    });
  }

  // Step 5: Save Intent detection (if requested in goal)
  const hasSaveIntent = goalLower.includes('save');
  let savePath = null;
  let saveContent = null;
  let saveFilename = null;

  if (hasSaveIntent) {
    const fileMatch = objective.match(/save\s+(?:the\s+file\s+)?as\s+['"]?([a-zA-Z0-9_\-\.]+)['"]?/i) ||
                      objective.match(/as\s+['"]?([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+)['"]?/i) ||
                      objective.match(/named\s+['"]?([a-zA-Z0-9_\-\.]+)['"]?/i);
    saveFilename = fileMatch ? fileMatch[1] : 'EVO_Computer_Test.txt';
    savePath = saveFilename;
    if (goalLower.includes('desktop')) {
      savePath = saveFilename.startsWith('Desktop/') ? saveFilename : `Desktop/${saveFilename}`;
    }

    const textMatch = objective.match(/["']([^"']+)["']/);
    saveContent = textMatch ? textMatch[1] : 'Sample non-sensitive text payload';

    steps.push({
      stepId: `step_${stepIdx++}_save`,
      type: 'GUI_SAVE',
      description: `Save file as '${savePath}' via GUI save operation`,
      dependencies: steps.length > 0 ? [steps[steps.length - 1].stepId] : [],
      targetReference: {
        path: savePath,
        filename: saveFilename,
        content: saveContent,
        expectedContent: saveContent
      },
      action: {
        type: 'GUI_SAVE',
        path: savePath,
        filename: saveFilename,
        content: saveContent,
        expectedContent: saveContent
      },
      actionRequestId: null,
      approvalRequired: true,
      status: 'PENDING'
    });
  }

  // Step 5.5: Explicit Close Intent vs Keep Open Intent
  const isKeepOpenRequested = goalLower.includes('leave it open') ||
                              goalLower.includes('keep it open') ||
                              goalLower.includes("don't close") ||
                              goalLower.includes('do not close') ||
                              /leave\s+[a-z0-9_\-\s]+\s+(?:open|running)/i.test(objective) ||
                              /keep\s+[a-z0-9_\-\s]+\s+open/i.test(objective);

  const isExplicitCloseRequested = !isKeepOpenRequested && (
    goalLower.includes('close firefox') ||
    goalLower.includes('close code') ||
    goalLower.includes('close visual studio code') ||
    goalLower.includes('close file manager') ||
    goalLower.includes('close thunar') ||
    goalLower.includes('close calculator') ||
    goalLower.includes('close editor') ||
    goalLower.includes('close mousepad') ||
    goalLower.includes('close terminal') ||
    goalLower.includes('close window') ||
    goalLower.includes('close application') ||
    /,\s*then\s+close\s+/i.test(objective) ||
    /\s+and\s+then\s+close\s+/i.test(objective) ||
    /\s+then\s+close\s+/i.test(objective) ||
    /\bclose\b/i.test(objective)
  );

  if (isExplicitCloseRequested) {
    let closeTarget = null;
    const closeMatch = objective.match(/close\s+(?:the\s+)?([a-zA-Z0-9_\-\s]+)/i);
    if (closeMatch) {
      closeTarget = closeMatch[1].trim();
    }

    steps.push({
      stepId: `step_${stepIdx++}_close`,
      type: 'CLOSE_APPLICATION',
      description: `Close task-owned application '${closeTarget || 'application'}'`,
      dependencies: steps.length > 0 ? [steps[steps.length - 1].stepId] : [],
      targetReference: { target: closeTarget, applicationId: closeTarget },
      action: { type: 'CLOSE_APPLICATION', target: closeTarget, applicationId: closeTarget },
      actionRequestId: null,
      approvalRequired: true,
      status: 'PENDING'
    });
  }

  // Final Step: Always verify desktop task completion
  const verifyAction = { type: 'VERIFY' };
  if (hasSaveIntent && savePath && saveContent) {
    verifyAction.filePath = savePath;
    verifyAction.path = savePath;
    verifyAction.expectedContent = saveContent;
    verifyAction.isGuiSaveTask = true;
    verifyAction.filename = saveFilename;
  }

  steps.push({
    stepId: `step_${stepIdx++}_verify`,
    type: 'VERIFY',
    description: 'Verify final desktop state and task completion invariants',
    dependencies: steps.length > 0 ? [steps[steps.length - 1].stepId] : [],
    targetReference: verifyAction,
    action: verifyAction,
    actionRequestId: null,
    approvalRequired: false,
    status: 'PENDING'
  });

  return {
    objective,
    steps,
    disableHousekeeping: isKeepOpenRequested,
    explicitCloseRequested: isExplicitCloseRequested
  };
}

export class ComputerTaskService {
  constructor() {
    this.tasks = [];
    this.taskHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Creates and initializes a new controlled multi-step computer task
   */
  createComputerTask(objective, options = {}) {
    if (!objective || typeof objective !== 'string') {
      throw new Error('Objective must be a non-empty string.');
    }

    // Validate supported step types
    let planRes = { steps: [], disableHousekeeping: false, explicitCloseRequested: false };
    try {
      planRes = planComputerTask(objective);
    } catch (e) {}

    let plannedSteps;
    try {
      plannedSteps = options.steps && Array.isArray(options.steps)
        ? options.steps
        : planRes.steps;
    } catch (err) {
      throw new Error(err.message);
    }

    for (const step of plannedSteps) {
      if (!ALLOWED_STEP_TYPES.includes(step.type)) {
        throw new Error(`Invalid step type '${step.type}'. Allowed types: ${ALLOWED_STEP_TYPES.join(', ')}.`);
      }
    }

    const scopePlan = options.proposedScope || autonomyScopePlannerService.planAutonomyScope(objective);
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const task = {
      taskId,
      objective,
      status: 'PLANNED',
      steps: plannedSteps,
      currentStepIndex: 0,
      scopePlan: scopePlan.success ? scopePlan.proposedScope : null,
      scopePlanStatus: scopePlan.status || 'UNPLANNED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beforeObservationId: null,
      afterObservationId: null,
      verification: null,
      disableHousekeeping: options.disableHousekeeping !== undefined ? Boolean(options.disableHousekeeping) : Boolean(planRes.disableHousekeeping),
      explicitCloseRequested: options.explicitCloseRequested !== undefined ? Boolean(options.explicitCloseRequested) : Boolean(planRes.explicitCloseRequested)
    };

    this.tasks.push(task);

    try {
      recordActionEvent({
        objectiveId: taskId,
        tool: 'create_computer_task',
        inputs: { taskId, objective, stepCount: plannedSteps.length },
        outcome: 'PLANNED',
        verificationResult: { taskId, status: 'PLANNED' },
        durationMs: 0
      });
    } catch (e) {}

    // Advance initial step (OBSERVE) automatically
    this.advanceComputerTask(taskId);

    return task;
  }

  /**
   * Retrieves a computer task by ID
   */
  getComputerTask(taskId) {
    return this.tasks.find((t) => t.taskId === taskId) || this.taskHistory.find((t) => t.taskId === taskId) || null;
  }

  /**
   * Retrieves all pending computer action steps requiring operator approval
   */
  getPendingComputerActions(taskId = null) {
    let pending = [];
    const activeTasks = taskId ? this.tasks.filter((t) => t.taskId === taskId) : this.tasks;

    for (const task of activeTasks) {
      if (task.status === 'IN_PROGRESS' || task.status === 'PLANNED') {
        const awaitingStep = task.steps.find((s) => s.status === 'AWAITING_APPROVAL');
        if (awaitingStep) {
          pending.push({
            taskId: task.taskId,
            objective: task.objective,
            stepId: awaitingStep.stepId,
            type: awaitingStep.type,
            description: awaitingStep.description,
            targetReference: awaitingStep.targetReference,
            step: awaitingStep
          });
        }
      }
    }
    return pending;
  }

  /**
   * Checks whether step action can proceed automatically under an active BOUNDED autonomy scope
   */
  async checkScopeAndAutoExecute(task, currentStep) {
    const scopeCheck = computerAutonomyService.validateActionAgainstScope(task.taskId, currentStep, currentStep.beforeObservation);
    if (scopeCheck.allowed && scopeCheck.mode === 'BOUNDED') {
      computerAutonomyService.recordActionExecution(task.taskId);
      return await this.approveComputerAction(task.taskId, currentStep.stepId, { scopeId: scopeCheck.scope?.scopeId });
    }
    if (!scopeCheck.allowed && scopeCheck.mode === 'BOUNDED' && scopeCheck.reason) {
      if (
        scopeCheck.reason.includes('BUDGET_EXCEEDED') ||
        scopeCheck.reason.includes('SCOPE_VIOLATION') ||
        scopeCheck.reason.includes('UNCERTAINTY_STOP') ||
        scopeCheck.reason.includes('HARD_SAFETY_OVERRIDE')
      ) {
        task.status = 'PAUSED';
        if (scopeCheck.reason.includes('SCOPE_VIOLATION')) {
          task.scopeExpansionRequired = true;
          task.scopeExpansionReason = scopeCheck.reason;
        }
      }
    }
    return task;
  }

  /**
   * Advances task state machine safely to the next READY step
   */
  async advanceComputerTask(taskId) {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (!task) return null;

    if (task.status === 'PAUSED' || task.status === 'CANCELLED' || task.status === 'COMPLETED' || task.status === 'FAILED') {
      return task;
    }

    const currentStep = task.steps[task.currentStepIndex];
    if (!currentStep) {
      task.status = 'COMPLETED';
      task.updatedAt = new Date().toISOString();
      return task;
    }

    if (currentStep.status === 'AWAITING_APPROVAL') {
      return await this.checkScopeAndAutoExecute(task, currentStep);
    }

    // Step 1: OBSERVE
    if (currentStep.type === 'OBSERVE' && currentStep.status === 'READY') {
      currentStep.status = 'EXECUTING';
      task.status = 'IN_PROGRESS';
      const obs = desktopObservationService.getDesktopObservation({ audit: false });
      task.beforeObservationId = obs.observationId;
      currentStep.status = 'COMPLETED';
      currentStep.result = { observationId: obs.observationId };

      task.currentStepIndex++;
      if (task.currentStepIndex < task.steps.length) {
        task.steps[task.currentStepIndex].status = 'READY';
        return await this.advanceComputerTask(taskId);
      } else {
        task.status = 'COMPLETED';
        return task;
      }
    }

    // Step 2: LAUNCH_APPLICATION
    if (currentStep.type === 'LAUNCH_APPLICATION' && (currentStep.status === 'READY' || currentStep.status === 'PENDING')) {
      currentStep.status = 'READY';
      const targetApp = currentStep.targetReference?.appDescriptor || currentStep.targetReference?.applicationId || currentStep.action?.applicationId || currentStep.action?.target || currentStep.action?.path || 'app_text_editor';
      const launchReq = applicationControlService.requestApplicationLaunch(targetApp, { objectiveId: taskId });

      if (!launchReq.success) {
        currentStep.status = 'FAILED';
        currentStep.result = launchReq.error;
        task.status = 'FAILED';
        return task;
      }

      currentStep.actionRequestId = launchReq.requestId;
      currentStep.status = 'AWAITING_APPROVAL';
      task.status = 'IN_PROGRESS';
      task.updatedAt = new Date().toISOString();
      return await this.checkScopeAndAutoExecute(task, currentStep);
    }

    // Step 3: CLICK
    if (currentStep.type === 'CLICK' && (currentStep.status === 'READY' || currentStep.status === 'PENDING')) {
      currentStep.status = 'READY';
      currentStep.beforeObservation = desktopObservationService.getDesktopObservation({ audit: false });
      const target = currentStep.targetReference || { x: 500, y: 300, button: 'left' };
      const clickReq = computerInteractionService.requestMouseClick(target, { objectiveId: taskId, observation: currentStep.beforeObservation });

      if (!clickReq.success) {
        currentStep.status = 'FAILED';
        currentStep.result = clickReq.error;
        task.status = 'FAILED';
        return task;
      }

      currentStep.actionRequestId = clickReq.requestId || clickReq.interactionId;
      currentStep.status = 'AWAITING_APPROVAL';
      task.status = 'IN_PROGRESS';
      task.updatedAt = new Date().toISOString();
      return await this.checkScopeAndAutoExecute(task, currentStep);
    }

    // Step 4: TEXT_INPUT
    if (currentStep.type === 'TEXT_INPUT' && (currentStep.status === 'READY' || currentStep.status === 'PENDING')) {
      currentStep.status = 'READY';
      currentStep.beforeObservation = desktopObservationService.getDesktopObservation({ audit: false });
      const target = currentStep.targetReference || { x: 400, y: 300, role: 'text', inputType: 'text', label: 'Text Input Field' };
      const textPayload = currentStep.targetReference?.text || 'Sample text';
      const textReq = computerInteractionService.requestTextInput(target, textPayload, { objectiveId: taskId, observation: currentStep.beforeObservation });

      if (!textReq.success) {
        if (textReq.sensitive) {
          currentStep.status = 'REJECTED';
          currentStep.result = 'REJECTED_SENSITIVE_TARGET';
          task.status = 'PAUSED';
          return task;
        }
        currentStep.status = 'FAILED';
        currentStep.result = textReq.error;
        task.status = 'FAILED';
        return task;
      }

      currentStep.actionRequestId = textReq.requestId;
      currentStep.status = 'AWAITING_APPROVAL';
      task.status = 'IN_PROGRESS';
      task.updatedAt = new Date().toISOString();
      return await this.checkScopeAndAutoExecute(task, currentStep);
    }

    // Step 4.5: GUI_SAVE
    if (currentStep.type === 'GUI_SAVE' && (currentStep.status === 'READY' || currentStep.status === 'PENDING')) {
      currentStep.status = 'READY';
      currentStep.beforeObservation = desktopObservationService.getDesktopObservation({ audit: false });
      const target = currentStep.targetReference || { path: 'Desktop/EVO_Save_Test.txt' };
      const saveReq = computerInteractionService.requestGuiSave(target, { objectiveId: taskId, observation: currentStep.beforeObservation });

      if (!saveReq.success) {
        currentStep.status = 'FAILED';
        currentStep.result = saveReq.error;
        task.status = 'FAILED';
        return task;
      }

      currentStep.actionRequestId = saveReq.requestId;
      currentStep.status = 'AWAITING_APPROVAL';
      task.status = 'IN_PROGRESS';
      task.updatedAt = new Date().toISOString();
      return await this.checkScopeAndAutoExecute(task, currentStep);
    }

    // Step 4.8: CLOSE_WINDOW / CLOSE_APPLICATION
    if ((currentStep.type === 'CLOSE_WINDOW' || currentStep.type === 'CLOSE_APPLICATION') && (currentStep.status === 'READY' || currentStep.status === 'PENDING')) {
      currentStep.status = 'READY';
      currentStep.actionRequestId = `close_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      currentStep.status = 'AWAITING_APPROVAL';
      task.status = 'IN_PROGRESS';
      task.updatedAt = new Date().toISOString();
      return await this.checkScopeAndAutoExecute(task, currentStep);
    }

    // Step 5: VERIFY
    if (currentStep.type === 'VERIFY' && (currentStep.status === 'READY' || currentStep.status === 'PENDING')) {
      currentStep.status = 'COMPLETED';
      const verifyRes = await this.verifyComputerTask(taskId);
      currentStep.result = verifyRes;
      task.status = verifyRes.verified ? 'COMPLETED' : 'FAILED';
      task.updatedAt = new Date().toISOString();

      // Trigger automatic housekeeping cleanup for task-owned resources if verified & not disabled
      if (task.status === 'COMPLETED' && !task.disableHousekeeping && !task.explicitCloseRequested) {
        try {
          const taskResources = taskOwnershipRegistry.getTaskOwnedResources(taskId);
          const evoOwned = taskResources.filter(r => r.isPreExisting === false);
          if (evoOwned.length > 0) {
            const cleanupRes = await applicationControlService.closeApplication(null, { taskId });
            task.housekeepingCleanup = cleanupRes;
          }
        } catch (e) {
          task.housekeepingCleanup = { success: false, verified: false, error: e.message };
        }
      }

      // Record final task learning evidence
      this.recordTaskLearning(task);

      return task;
    }

    return task;
  }

  /**
   * Operator-approved execution of EXACTLY ONE physical action step
   */
  async approveComputerAction(taskId, actionId, options = {}) {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (!task) {
      return { success: false, error: `No active computer task found with ID '${taskId}'.` };
    }

    const step = task.steps.find((s) => s.stepId === actionId || s.actionRequestId === actionId);
    if (!step) {
      return { success: false, error: `No step matching action ID '${actionId}' in task '${taskId}'.` };
    }

    if (step.status !== 'AWAITING_APPROVAL' && step.status !== 'READY' && step.status !== 'APPROVED') {
      return { success: false, error: `Step '${step.stepId}' is not in a valid state for execution (status: ${step.status}).` };
    }

    // Enforce single physical action execution limit
    step.status = 'APPROVED';
    task.updatedAt = new Date().toISOString();

    let execResult = null;

    // Execute Stage 7D Application Launch
    if (step.type === 'LAUNCH_APPLICATION') {
      step.status = 'EXECUTING';
      execResult = await applicationControlService.approveApplicationLaunch(step.actionRequestId, options);
    }
    // Execute Stage 7B Mouse Click
    else if (step.type === 'CLICK') {
      step.status = 'EXECUTING';

      // Stale Target Re-validation
      const currentObs = desktopObservationService.getDesktopObservation({ audit: false });
      const beforeObs = step.beforeObservation || currentObs;
      if (currentObs.activeApplication.id !== beforeObs.activeApplication.id || currentObs.activeApplication.title !== beforeObs.activeApplication.title) {
        step.status = 'STALE';
        // Capture fresh observation & re-identify visual target
        const freshObs = desktopObservationService.getDesktopObservation({ audit: false });
        const reId = await visualTargetService.identifyClickableTarget(freshObs, task.objective);

        if (reId.success && reId.proposal) {
          step.targetReference.x = reId.proposal.target.x;
          step.targetReference.y = reId.proposal.target.y;
        }

        // Re-stage new click request requiring new operator approval
        const newClickReq = computerInteractionService.requestMouseClick(step.targetReference, { objectiveId: taskId, observation: freshObs });
        step.actionRequestId = newClickReq.requestId;
        step.status = 'AWAITING_APPROVAL';

        return {
          success: false,
          stale: true,
          status: 'STALE',
          reidentified: true,
          error: 'Desktop target was stale. Fresh observation captured and target re-identified. Please approve new request.'
        };
      }

      execResult = await computerInteractionService.approveMouseClick(step.actionRequestId, options);
    }
    // Execute Stage 7E Text Input
    else if (step.type === 'TEXT_INPUT') {
      step.status = 'EXECUTING';

      // Stale Target Re-validation
      const currentObs = desktopObservationService.getDesktopObservation({ audit: false });
      const beforeObs = step.beforeObservation || currentObs;
      if (currentObs.activeApplication.id !== beforeObs.activeApplication.id || currentObs.activeApplication.title !== beforeObs.activeApplication.title) {
        step.status = 'STALE';
        const freshObs = desktopObservationService.getDesktopObservation({ audit: false });
        const newTextReq = computerInteractionService.requestTextInput(step.targetReference, step.targetReference.text, { objectiveId: taskId, observation: freshObs });
        step.actionRequestId = newTextReq.requestId;
        step.status = 'AWAITING_APPROVAL';

        return {
          success: false,
          stale: true,
          status: 'STALE',
          reidentified: true,
          error: 'Desktop target was stale. Fresh observation captured. Please approve new text request.'
        };
      }

      execResult = await computerInteractionService.approveTextInput(step.actionRequestId, options);
    }
    // Execute GUI Save
    else if (step.type === 'GUI_SAVE') {
      step.status = 'EXECUTING';
      execResult = await computerInteractionService.approveGuiSave(step.actionRequestId, options);
    }
    // Execute CLOSE_WINDOW
    else if (step.type === 'CLOSE_WINDOW') {
      step.status = 'EXECUTING';
      const targetWin = step.targetReference?.windowId || step.targetReference?.target || step.action?.windowId;
      execResult = await applicationControlService.closeWindow(targetWin, { taskId, objectiveId: taskId });
    }
    // Execute CLOSE_APPLICATION
    else if (step.type === 'CLOSE_APPLICATION') {
      step.status = 'EXECUTING';
      const targetApp = step.targetReference?.applicationId || step.targetReference?.target || step.action?.applicationId || step.action?.target;
      execResult = await applicationControlService.closeApplication(targetApp, { taskId, objectiveId: taskId });
    }

    // Step verification & post-action observation
    step.status = 'VERIFYING';
    const afterObs = desktopObservationService.getDesktopObservation({ audit: false });
    task.afterObservationId = afterObs.observationId;

    const isStepVerified = (step.type === 'LAUNCH_APPLICATION' || step.type === 'CLOSE_WINDOW' || step.type === 'CLOSE_APPLICATION')
      ? Boolean(execResult && execResult.success === true && execResult.verified === true)
      : Boolean(execResult && execResult.success && execResult.verified !== false);

    if (isStepVerified) {
      step.status = 'COMPLETED';
      step.result = execResult;

      // Move to next step
      task.currentStepIndex++;
      if (task.currentStepIndex < task.steps.length) {
        task.steps[task.currentStepIndex].status = 'READY';
        await this.advanceComputerTask(taskId);
      } else {
        task.status = 'COMPLETED';
        this.verifyComputerTask(taskId);
        this.recordTaskLearning(task);
      }

      return {
        success: true,
        taskId,
        stepId: step.stepId,
        status: step.status,
        execResult,
        nextStep: task.steps[task.currentStepIndex] || null
      };
    } else {
      step.status = 'FAILED';
      step.result = execResult ? (execResult.error || execResult.result) : 'Execution failed';

      // STAGE 8D: Intelligent Bounded Recovery Integration
      const scope = computerAutonomyService.getAutonomyScope(task.taskId);
      if (scope && scope.status === 'ACTIVE' && scope.mode === 'BOUNDED' && !options.isRecoveryRetry) {
        const recResult = await computerRecoveryService.performRecovery(task, scope, step.result || 'ACTION_EXECUTION_FAILURE', this);
        if (recResult.success) {
          return {
            success: true,
            recovered: true,
            taskId,
            stepId: step.stepId,
            status: task.status,
            recoveryResult: recResult
          };
        } else if (recResult.status === 'SCOPE_EXPANSION_REQUIRED') {
          task.status = 'PAUSED';
          task.scopeExpansionRequired = true;
          return {
            success: false,
            taskId,
            stepId: step.stepId,
            status: 'SCOPE_EXPANSION_REQUIRED',
            error: 'Scope expansion required to recover task.'
          };
        } else if (recResult.status === 'BUDGET_EXCEEDED') {
          task.status = 'PAUSED';
          return {
            success: false,
            taskId,
            stepId: step.stepId,
            status: 'BUDGET_EXCEEDED',
            error: 'Scope action or time budget exceeded during recovery.'
          };
        }
      }

      task.status = 'FAILED';
      return {
        success: false,
        taskId,
        stepId: step.stepId,
        error: step.result
      };
    }
  }

  /**
   * User cancels an in-progress computer task
   */
  cancelComputerTask(taskId, reason = 'User cancelled computer task') {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (!task) {
      return { success: false, error: `No computer task found with ID '${taskId}'.` };
    }

    // Cancel active step request in underlying service if awaiting approval
    const activeStep = task.steps.find((s) => s.status === 'AWAITING_APPROVAL');
    if (activeStep && activeStep.actionRequestId) {
      if (activeStep.type === 'LAUNCH_APPLICATION') {
        applicationControlService.cancelApplicationLaunch(activeStep.actionRequestId, reason);
      } else if (activeStep.type === 'CLICK') {
        computerInteractionService.cancelMouseClick(activeStep.actionRequestId, reason);
      } else if (activeStep.type === 'TEXT_INPUT') {
        computerInteractionService.cancelTextInput(activeStep.actionRequestId, reason);
      }
      activeStep.status = 'CANCELLED';
    }

    task.status = 'CANCELLED';
    task.updatedAt = new Date().toISOString();

    const idx = this.tasks.findIndex((t) => t.taskId === taskId);
    if (idx !== -1) {
      this.tasks.splice(idx, 1);
      this.taskHistory.unshift(task);
    }

    return {
      success: true,
      status: 'CANCELLED',
      taskId
    };
  }

  /**
   * User pauses an in-progress computer task
   */
  pauseComputerTask(taskId, reason = 'Operator paused task') {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (!task) return { success: false, error: `Task '${taskId}' not found.` };
    task.status = 'PAUSED';
    task.updatedAt = new Date().toISOString();
    return { success: true, taskId, status: 'PAUSED' };
  }

  /**
   * User resumes a paused computer task
   */
  resumeComputerTask(taskId) {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (!task) return { success: false, error: `Task '${taskId}' not found.` };
    if (task.status === 'PAUSED') {
      task.status = 'IN_PROGRESS';
      this.advanceComputerTask(taskId);
    }
    return { success: true, taskId, status: task.status };
  }

  /**
   * Verifies final computer task invariants & desktop outcome
   */
  verifyComputerTask(taskId) {
    const task = this.getComputerTask(taskId);
    if (!task) {
      return { verified: false, details: 'Computer task not found.' };
    }

    const currentObs = desktopObservationService.getDesktopObservation({ audit: false });
    const completedSteps = task.steps.filter((s) => s.status === 'COMPLETED').length;
    const totalSteps = task.steps.length;

    let verified = completedSteps === totalSteps;
    let details = verified
      ? `Computer task '${task.objective}' verified successfully across ${completedSteps} steps.`
      : `Computer task incomplete: ${completedSteps} of ${totalSteps} steps completed.`;

    // Check if task involved GUI Save
    const guiSaveStep = task.steps.find((s) => s.type === 'GUI_SAVE' || s.action?.type === 'GUI_SAVE');
    const isSaveTask = Boolean(guiSaveStep) || task.objective.toLowerCase().includes('save');

    if (isSaveTask) {
      const saveStep = guiSaveStep || task.steps.find((s) => s.targetReference?.path || s.action?.path);
      const targetPath = saveStep?.targetReference?.path || saveStep?.action?.path || 'Desktop/EVO_Save_Test.txt';
      const expectedContent = saveStep?.targetReference?.expectedContent !== undefined
        ? saveStep.targetReference.expectedContent
        : (saveStep?.action?.expectedContent !== undefined ? saveStep.action.expectedContent : saveStep?.targetReference?.content);
      const filename = saveStep?.targetReference?.filename || targetPath.split('/').pop();

      // 1. Filesystem check
      try {
        const resolvedPath = resolveSafePath(targetPath);
        if (!fs.existsSync(resolvedPath)) {
          verified = false;
          details = `GUI save verification failed: Target file '${targetPath}' does not exist on disk.`;
        } else if (expectedContent !== undefined && expectedContent !== null) {
          const actualContent = fs.readFileSync(resolvedPath, 'utf-8');
          if (actualContent.trim() !== String(expectedContent).trim()) {
            verified = false;
            details = `GUI save verification failed: Content mismatch on disk. Expected '${expectedContent}', got '${actualContent.trim()}'.`;
          }
        }
      } catch (e) {
        verified = false;
        details = `GUI save verification failed: Filesystem read error: ${e.message}`;
      }

      // 2. Editor Document & Window State Verification
      if (verified) {
        let dirtyMarkerPresent = false;
        let titleContainsFilename = false;

        const openWins = currentObs.windows || [];
        const activeApp = currentObs.activeApplication;

        const targetWin = openWins.find((w) =>
          w.title && (w.title.includes('Mousepad') || w.title.includes('Editor') || w.title.includes(filename))
        ) || (activeApp ? { title: activeApp.title } : null);

        const stepExecResult = saveStep?.result;
        const savedTitleFromStep = stepExecResult?.savedTitle || stepExecResult?.verification?.savedTitle;

        const evalTitle = savedTitleFromStep || (targetWin ? targetWin.title : '');

        if (evalTitle) {
          if (evalTitle.includes('*') || evalTitle.startsWith('*')) {
            dirtyMarkerPresent = true;
          }
          if (evalTitle.toLowerCase().includes(filename.toLowerCase())) {
            titleContainsFilename = true;
          }
        }

        if (dirtyMarkerPresent) {
          verified = false;
          details = `GUI save verification failed: Application document state is dirty (unsaved marker '*' present in title '${evalTitle}').`;
        } else if (evalTitle && !titleContainsFilename) {
          verified = false;
          details = `GUI save verification failed: Application window title '${evalTitle}' does not correspond to saved filename '${filename}'.`;
        } else if (!saveStep || saveStep.status !== 'COMPLETED' || (stepExecResult && stepExecResult.guiSaved === false)) {
          verified = false;
          details = `GUI save verification failed: GUI save step was not executed and verified through the text editor application UI.`;
        }
      }
    }

    if (!verified) {
      task.status = 'FAILED';
    }

    const verification = {
      verified,
      state: verified ? 'COMPLETED' : 'NOT_FULLY_VERIFIED',
      completedSteps,
      totalSteps,
      beforeObservationId: task.beforeObservationId,
      afterObservationId: currentObs.observationId,
      details
    };

    task.verification = verification;
    return verification;
  }

  /**
   * Records task completion in runtime learning system
   */
  recordTaskLearning(task) {
    if (!task) return;

    // Connect successful, verified computer tasks into the evolution capability pipeline (idempotent)
    if (task.status === 'COMPLETED' && task.verification && task.verification.verified) {
      if (!isObjectiveProcessedForEvolution(task.taskId)) {
        try {
          const evolutionObjective = {
            id: task.taskId,
            goal: task.objective,
            status: 'COMPLETED',
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            plan: (task.steps || []).map((s, idx) => ({
              id: s.stepId || `step_${idx + 1}`,
              title: s.description || s.type,
              status: s.status,
              order: idx + 1,
              action: {
                type: s.type,
                path: s.type === 'TEXT_INPUT'
                  ? (s.targetReference?.applicationId || s.targetReference?.role || s.targetReference?.inputType || 'text')
                  : (s.targetReference?.applicationId || s.targetReference?.role || s.targetReference?.text || ''),
                params: s.targetReference || {}
              }
            }))
          };
          evolutionService.handleObjectiveCompletion(evolutionObjective);
          return;
        } catch (e) {
          console.error('Failed to process computer task evolution completion:', e);
        }
      }
    }

    try {
      createRuntimeLearningRecord({
        objectiveId: task.taskId,
        goal: `Supervised multi-step task: ${task.objective}`,
        category: LEARNING_CATEGORIES.DESKTOP_INTERACTION,
        evidenceIds: [task.beforeObservationId, task.afterObservationId].filter(Boolean),
        timestamps: {
          startedAt: task.createdAt,
          completedAt: task.updatedAt
        },
        status: task.status === 'COMPLETED' ? LEARNING_STATUS.COMPLETED : LEARNING_STATUS.FAILED,
        summary: {
          success: task.status === 'COMPLETED',
          taskId: task.taskId,
          stepCount: task.steps.length,
          completedSteps: task.steps.filter((s) => s.status === 'COMPLETED').length,
          verified: Boolean(task.verification?.verified)
        }
      });
    } catch (e) {}
  }

  getTaskHistory() {
    return [...this.taskHistory];
  }

  /**
   * Stage 8A Autonomy Scope Delegation Methods
   */
  requestAutonomyScope(taskId, details) {
    return computerAutonomyService.requestAutonomyScope(taskId, details);
  }

  async approveAutonomyScope(scopeId, options) {
    const res = computerAutonomyService.approveAutonomyScope(scopeId, options);
    if (res.success && res.scope) {
      await this.advanceComputerTask(res.scope.taskId);
    }
    return res;
  }

  revokeAutonomyScope(scopeId, reason) {
    const res = computerAutonomyService.revokeAutonomyScope(scopeId, reason);
    if (res.success) {
      const scope = computerAutonomyService.getAutonomyScope(scopeId);
      if (scope?.taskId) {
        const task = this.getComputerTask(scope.taskId);
        if (task && task.status === 'IN_PROGRESS') {
          task.status = 'PAUSED';
        }
      }
    }
    return res;
  }

  getAutonomyScope(identifier) {
    return computerAutonomyService.getAutonomyScope(identifier);
  }

  getAutonomyScopeHistory() {
    return computerAutonomyService.getAutonomyScopeHistory();
  }

  planAutonomyScope(taskOrObjective) {
    return autonomyScopePlannerService.planAutonomyScope(taskOrObjective);
  }

  validatePlannedScope(scope, taskOrObjective) {
    return autonomyScopePlannerService.validatePlannedScope(scope, taskOrObjective);
  }

  async recoverComputerTask(taskId) {
    const task = this.getComputerTask(taskId);
    if (!task) return { success: false, error: `Task '${taskId}' not found.` };
    const scope = computerAutonomyService.getAutonomyScope(taskId);
    const currentStep = task.steps[task.currentStepIndex];
    const failure = currentStep?.result || 'MANUAL_RECOVERY_TRIGGER';
    return await computerRecoveryService.performRecovery(task, scope, failure, this);
  }

  getRecoveryHistory(taskId = null) {
    return computerRecoveryService.getRecoveryHistory(taskId);
  }
}

export const computerTaskService = new ComputerTaskService();
export const createComputerTask = (obj, opts) => computerTaskService.createComputerTask(obj, opts);
export const getComputerTask = (id) => computerTaskService.getComputerTask(id);
export const getPendingComputerActions = (id) => computerTaskService.getPendingComputerActions(id);
export const approveComputerAction = (tid, aid, opts) => computerTaskService.approveComputerAction(tid, aid, opts);
export const cancelComputerTask = (id, r) => computerTaskService.cancelComputerTask(id, r);
export const pauseComputerTask = (id, r) => computerTaskService.pauseComputerTask(id, r);
export const resumeComputerTask = (id) => computerTaskService.resumeComputerTask(id);
export const verifyComputerTask = (id) => computerTaskService.verifyComputerTask(id);
export const requestAutonomyScope = (id, d) => computerTaskService.requestAutonomyScope(id, d);
export const approveAutonomyScope = (id, o) => computerTaskService.approveAutonomyScope(id, o);
export const revokeAutonomyScope = (id, r) => computerTaskService.revokeAutonomyScope(id, r);
export const getAutonomyScope = (id) => computerTaskService.getAutonomyScope(id);
export const getAutonomyScopeHistory = () => computerTaskService.getAutonomyScopeHistory();
export const planAutonomyScope = (t) => computerTaskService.planAutonomyScope(t);
export const validatePlannedScope = (s, t) => computerTaskService.validatePlannedScope(s, t);
export const recoverComputerTask = (id) => computerTaskService.recoverComputerTask(id);
export const getRecoveryHistory = (id) => computerTaskService.getRecoveryHistory(id);
export default computerTaskService;
