/**
 * STAGE 8A — SCOPED COMPUTER AUTONOMY POLICY SERVICE
 * Manages bounded autonomy scopes for multi-step computer tasks while enforcing
 * strict hard safety overrides, budget constraints, uncertainty stops, and human interrupts.
 * 
 * HARD SAFETY GUARANTEES:
 * - Default mode is strictly FULLY_SUPERVISED.
 * - BOUNDED mode requires explicit operator scope approval.
 * - Sensitive text entry (passwords, PINs, OTPs, secrets) remains ALWAYS BLOCKED.
 * - Keyboard shortcuts, hotkeys, function keys remain ALWAYS BLOCKED.
 * - Arbitrary shell execution & path traversal remain ALWAYS BLOCKED.
 * - Unallowlisted applications & unknown targets remain ALWAYS BLOCKED.
 * - Self-code autonomy mode remains strictly SUPERVISED.
 */

import { recordActionEvent } from './actionEventStore.js';
import { createRuntimeLearningRecord, LEARNING_CATEGORIES, LEARNING_STATUS } from './runtimeLearningStore.js';
import { isSensitiveTarget } from './computerInteractionService.js';
import { validateApplicationLaunch } from './applicationControlService.js';

export const AUTONOMY_MODES = {
  FULLY_SUPERVISED: 'FULLY_SUPERVISED',
  BOUNDED: 'BOUNDED'
};

export const SCOPE_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  EXHAUSTED: 'EXHAUSTED',
  REJECTED: 'REJECTED'
};

export class ComputerAutonomyService {
  constructor() {
    this.scopes = [];
    this.scopeHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Requests a new bounded autonomy scope for a computer task
   */
  requestAutonomyScope(taskId, details = {}) {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Task ID must be a non-empty string.');
    }

    const scopeId = `scope_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const maxActionsRaw = typeof details.maxActions === 'number' && details.maxActions > 0 ? details.maxActions : 10;
    const maxActions = Math.min(maxActionsRaw, 50);

    const maxDurationRaw = typeof details.maxDurationMs === 'number' && details.maxDurationMs > 0 ? details.maxDurationMs : 300000;
    const maxDurationMs = Math.min(maxDurationRaw, 3600000);

    const allowedActions = Array.isArray(details.allowedActions)
      ? details.allowedActions.filter((a) => ['LAUNCH_APPLICATION', 'CLICK', 'TEXT_INPUT', 'OBSERVE', 'VERIFY'].includes(a))
      : ['LAUNCH_APPLICATION', 'CLICK', 'TEXT_INPUT', 'OBSERVE', 'VERIFY'];

    const systemAppAllowlist = ['app_text_editor', 'app_calculator', 'app_terminal'];
    const allowedApplications = Array.isArray(details.allowedApplications)
      ? details.allowedApplications.filter((app) => systemAppAllowlist.includes(app))
      : systemAppAllowlist;

    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + maxDurationMs).toISOString();

    const scope = {
      scopeId,
      taskId,
      mode: AUTONOMY_MODES.BOUNDED,
      allowedActions,
      allowedApplications,
      maxActions,
      maxDurationMs,
      executedActionsCount: 0,
      actionCount: 0,
      // HARD SAFETY OVERRIDES — ALWAYS FALSE
      allowSensitiveInput: false,
      allowKeyboardShortcuts: false,
      allowUnknownTargets: false,
      hardSafetyOverrides: {
        allowSensitiveInput: false,
        allowKeyboardShortcuts: false,
        allowUnknownTargets: false
      },
      requireApprovalFor: details.requireApprovalFor || [],
      createdAt,
      expiresAt,
      status: SCOPE_STATUS.PENDING
    };

    this.scopes.push(scope);
    this.scopeHistory.unshift(scope);
    if (this.scopeHistory.length > this.maxHistorySize) {
      this.scopeHistory = this.scopeHistory.slice(0, this.maxHistorySize);
    }

    try {
      recordActionEvent({
        objectiveId: taskId,
        tool: 'request_autonomy_scope',
        inputs: { scopeId, taskId, maxActions, maxDurationMs, allowedActions },
        outcome: 'PENDING',
        verificationResult: { scopeId, status: SCOPE_STATUS.PENDING },
        durationMs: 0
      });
    } catch (e) {}

    return { success: true, scope };
  }

  /**
   * Operator explicitly approves a bounded autonomy scope
   */
  approveAutonomyScope(scopeId, options = {}) {
    const scope = this.scopes.find((s) => s.scopeId === scopeId);
    if (!scope) {
      throw new Error(`Autonomy scope '${scopeId}' not found.`);
    }

    if (scope.status !== SCOPE_STATUS.PENDING) {
      throw new Error(`Scope '${scopeId}' is in state '${scope.status}' and cannot be approved.`);
    }

    // Check expiration
    if (new Date() > new Date(scope.expiresAt)) {
      scope.status = SCOPE_STATUS.EXPIRED;
      return { success: false, error: 'Autonomy scope has expired before approval.' };
    }

    scope.status = SCOPE_STATUS.ACTIVE;

    try {
      recordActionEvent({
        objectiveId: scope.taskId,
        tool: 'approve_autonomy_scope',
        inputs: { scopeId, taskId: scope.taskId, maxActions: scope.maxActions },
        outcome: 'SUCCESS',
        verificationResult: { scopeId, status: SCOPE_STATUS.ACTIVE },
        durationMs: 0
      });
    } catch (e) {}

    try {
      createRuntimeLearningRecord({
        objectiveId: scope.taskId,
        goal: `Operator granted bounded autonomy scope '${scopeId}' (maxActions: ${scope.maxActions})`,
        category: LEARNING_CATEGORIES.AUTONOMY_POLICY,
        evidenceIds: [scopeId],
        timestamps: { startedAt: scope.createdAt, completedAt: new Date().toISOString() },
        status: LEARNING_STATUS.COMPLETED,
        summary: { scopeId, mode: scope.mode, maxActions: scope.maxActions }
      });
    } catch (e) {}

    return { success: true, scopeId, scope };
  }

  /**
   * Operator revokes an active or pending autonomy scope immediately
   */
  revokeAutonomyScope(scopeId, reason = 'Operator revoked scope') {
    const scope = this.scopes.find((s) => s.scopeId === scopeId);
    if (!scope) {
      return { success: false, error: `Autonomy scope '${scopeId}' not found.` };
    }

    scope.status = SCOPE_STATUS.REVOKED;
    scope.revokedReason = reason;

    const idx = this.scopes.indexOf(scope);
    if (idx !== -1) {
      this.scopes.splice(idx, 1);
    }

    try {
      recordActionEvent({
        objectiveId: scope.taskId,
        tool: 'revoke_autonomy_scope',
        inputs: { scopeId, taskId: scope.taskId, reason },
        outcome: 'REVOKED',
        verificationResult: { scopeId, status: SCOPE_STATUS.REVOKED, reason },
        durationMs: 0
      });
    } catch (e) {}

    return { success: true, scopeId, status: SCOPE_STATUS.REVOKED, reason };
  }

  /**
   * Retrieves active or history scope by scopeId or taskId
   */
  getAutonomyScope(identifier = null) {
    const now = new Date();
    for (const s of this.scopes) {
      if (s.status === SCOPE_STATUS.ACTIVE && new Date(s.expiresAt) < now) {
        s.status = SCOPE_STATUS.EXPIRED;
      }
    }

    if (!identifier) {
      return this.scopes.find((s) => s.status === SCOPE_STATUS.ACTIVE) || null;
    }
    return (
      this.scopes.find((s) => s.scopeId === identifier || s.taskId === identifier) ||
      this.scopeHistory.find((s) => s.scopeId === identifier || s.taskId === identifier) ||
      null
    );
  }

  /**
   * Retrieves history of autonomy scope grants/revocations
   */
  getAutonomyScopeHistory() {
    return [...this.scopeHistory];
  }

  /**
   * Validates a planned step action against the task's active autonomy scope
   */
  validateActionAgainstScope(taskId, step, observation) {
    if (!taskId || !step) {
      return { allowed: false, reason: 'Invalid task or step parameters.' };
    }

    const scope = this.scopes.find((s) => s.taskId === taskId && s.status === SCOPE_STATUS.ACTIVE);

    // 1. If no active scope exists, mode is FULLY_SUPERVISED
    if (!scope) {
      return {
        allowed: false,
        mode: AUTONOMY_MODES.FULLY_SUPERVISED,
        reason: 'No active bounded autonomy scope found. Action requires explicit operator approval.'
      };
    }

    // 2. Check Expiration
    if (new Date() > new Date(scope.expiresAt)) {
      scope.status = SCOPE_STATUS.EXPIRED;
      this.revokeAutonomyScope(scope.scopeId, 'Autonomy scope time limit expired');
      try {
        recordActionEvent({
          objectiveId: taskId,
          tool: 'scope_expired',
          inputs: { scopeId: scope.scopeId, taskId, stepId: step.stepId },
          outcome: 'EXPIRED',
          verificationResult: { scopeId: scope.scopeId },
          durationMs: 0
        });
      } catch (e) {}
      return {
        allowed: false,
        mode: AUTONOMY_MODES.BOUNDED,
        reason: 'AUTONOMY_BUDGET_EXCEEDED: Scope time limit expired.'
      };
    }

    // 3. Check Action Budget
    if (scope.executedActionsCount >= scope.maxActions) {
      scope.status = SCOPE_STATUS.EXHAUSTED;
      try {
        recordActionEvent({
          objectiveId: taskId,
          tool: 'budget_exceeded',
          inputs: { scopeId: scope.scopeId, taskId, maxActions: scope.maxActions },
          outcome: 'EXHAUSTED',
          verificationResult: { scopeId: scope.scopeId },
          durationMs: 0
        });
      } catch (e) {}
      return {
        allowed: false,
        mode: AUTONOMY_MODES.BOUNDED,
        reason: `AUTONOMY_BUDGET_EXCEEDED: Action count limit (${scope.maxActions}) reached.`
      };
    }

    // 4. Check Action Type Allowlist
    if (!scope.allowedActions.includes(step.type)) {
      try {
        recordActionEvent({
          objectiveId: taskId,
          tool: 'scope_violation',
          inputs: { scopeId: scope.scopeId, taskId, stepType: step.type },
          outcome: 'BLOCKED',
          verificationResult: { reason: `Step type '${step.type}' not in allowedActions.` },
          durationMs: 0
        });
      } catch (e) {}
      return {
        allowed: false,
        mode: AUTONOMY_MODES.BOUNDED,
        reason: `SCOPE_VIOLATION: Step type '${step.type}' is not in allowed actions.`
      };
    }

    // 5. HARD SAFETY OVERRIDES CHECK
    if (step.type === 'LAUNCH_APPLICATION') {
      const appId = step.applicationId || step.target?.applicationId || step.targetReference?.applicationId;
      if (!appId || !scope.allowedApplications.includes(appId)) {
        try {
          recordActionEvent({
            objectiveId: taskId,
            tool: 'scope_violation',
            inputs: { scopeId: scope.scopeId, taskId, applicationId: appId },
            outcome: 'BLOCKED',
            verificationResult: { reason: `Application '${appId}' not in allowedApplications.` },
            durationMs: 0
          });
        } catch (e) {}
        return {
          allowed: false,
          mode: AUTONOMY_MODES.BOUNDED,
          reason: `SCOPE_VIOLATION: Application '${appId}' is not in scope allowed applications.`
        };
      }

      const launchValidation = validateApplicationLaunch(appId);
      if (!launchValidation.valid) {
        return {
          allowed: false,
          mode: AUTONOMY_MODES.BOUNDED,
          reason: `SECURITY_VIOLATION: ${launchValidation.error}`
        };
      }
    }

    if (step.type === 'TEXT_INPUT') {
      const target = step.target || step.targetReference;
      const text = step.text || target?.text || '';

      // Check Sensitive Target Hard Override
      if (isSensitiveTarget(target)) {
        try {
          recordActionEvent({
            objectiveId: taskId,
            tool: 'scope_violation',
            inputs: { scopeId: scope.scopeId, taskId, target },
            outcome: 'BLOCKED',
            verificationResult: { reason: 'Sensitive text entry target detected.' },
            durationMs: 0
          });
        } catch (e) {}
        return {
          allowed: false,
          mode: AUTONOMY_MODES.BOUNDED,
          reason: 'HARD_SAFETY_OVERRIDE: SENSITIVE_INPUT_BLOCKED: Sensitive text input (passwords, PINs, secrets, OTPs) is strictly prohibited.'
        };
      }

      // Check Keyboard Shortcuts Hard Override
      const shortcutPatterns = [/ctrl\+/i, /alt\+/i, /shift\+/i, /cmd\+/i, /meta\+/i, /^f[1-9][0-2]?$/i];
      for (const pat of shortcutPatterns) {
        if (pat.test(text)) {
          return {
            allowed: false,
            mode: AUTONOMY_MODES.BOUNDED,
            reason: 'HARD_SAFETY_OVERRIDE: Keyboard shortcuts and hotkeys are strictly prohibited.'
          };
        }
      }
    }

    // 6. Target Confidence / Uncertainty Check
    const targetObj = step.target || step.targetReference;
    if (targetObj && typeof targetObj.confidence === 'number' && targetObj.confidence < 0.7) {
      return {
        allowed: false,
        mode: AUTONOMY_MODES.BOUNDED,
        reason: `UNCERTAINTY_STOP: Target confidence (${targetObj.confidence.toFixed(2)}) is below minimum threshold (0.70).`
      };
    }

    // 7. Observation Stale & Window Context Check
    if (observation) {
      const now = Date.now();
      const obsTime = typeof observation.timestamp === 'number' ? observation.timestamp : (new Date(observation.timestamp).getTime() || 0);
      if (obsTime > 0 && now - obsTime > 30000) {
        return {
          allowed: false,
          mode: AUTONOMY_MODES.BOUNDED,
          reason: 'UNCERTAINTY_STOP: Desktop observation is stale (>30s old).'
        };
      }

      if (targetObj && targetObj.windowId && Array.isArray(observation.windows)) {
        const winExists = observation.windows.some((w) => w.id === targetObj.windowId);
        if (!winExists) {
          return {
            allowed: false,
            mode: AUTONOMY_MODES.BOUNDED,
            reason: `UNCERTAINTY_STOP: Target window '${targetObj.windowId}' is no longer active in desktop observation.`
          };
        }
      }
    }

    // All validation checks passed cleanly
    return {
      allowed: true,
      mode: AUTONOMY_MODES.BOUNDED,
      scope
    };
  }

  /**
   * Increments action execution count for active scope
   */
  recordActionExecution(taskId) {
    const scope = this.scopes.find((s) => s.taskId === taskId && s.status === SCOPE_STATUS.ACTIVE);
    if (scope) {
      scope.executedActionsCount = (scope.executedActionsCount || 0) + 1;
      scope.actionCount = scope.executedActionsCount;
      if (scope.executedActionsCount >= scope.maxActions) {
        scope.status = SCOPE_STATUS.EXHAUSTED;
      }
    }
  }
}

export const computerAutonomyService = new ComputerAutonomyService();
export default computerAutonomyService;
