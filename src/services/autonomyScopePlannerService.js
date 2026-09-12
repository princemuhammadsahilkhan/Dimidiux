/**
 * STAGE 8C — INTELLIGENT AUTONOMY SCOPE PLANNER SERVICE
 * Automatically derives the MINIMUM required bounded computer-autonomy scope
 * from a natural-language computer task objective or planned task structure.
 * 
 * IMPORTANT SAFETY BOUNDARIES:
 * - Default operating mode remains FULLY_SUPERVISED.
 * - This service ONLY PLANS proposals; it CANNOT approve scopes or execute actions.
 * - Minimum-scope principle: Includes ONLY required applications and actions.
 * - Rejects over-broad scopes, sensitive inputs, keyboard shortcuts, and arbitrary executables.
 * - Hard safety override flags (allowSensitiveInput, allowKeyboardShortcuts, allowUnknownTargets)
 *   remain IMMUTABLE false under all conditions.
 * - Scope expansion during task execution requires explicit operator re-approval.
 */

import { ALLOWED_APPLICATIONS } from './applicationControlService.js';
import { createRuntimeLearningRecord, LEARNING_CATEGORIES, LEARNING_STATUS } from './runtimeLearningStore.js';

export const ALLOWED_SCOPE_ACTIONS = ['LAUNCH_APPLICATION', 'CLICK', 'TEXT_INPUT', 'OBSERVE', 'VERIFY'];
export const GLOBAL_MAX_ACTIONS_CEILING = 50;
export const GLOBAL_MAX_DURATION_MS_CEILING = 3600000; // 1 hour

const SENSITIVE_KEYWORDS = ['password', 'secret', 'token', 'key', 'credential', 'auth', 'pin', 'otp', 'passphrase', 'ssn', 'credit card'];
const SHORTCUT_KEYWORDS = ['ctrl+', 'alt+', 'cmd+', 'shortcut', 'hotkey', 'f1', 'f5', 'press ctrl', 'press alt'];
const SHELL_KEYWORDS = ['sudo', '/usr/bin/', '/bin/', 'bash', 'sh ', 'cmd.exe', 'powershell', 'system32', 'rm -rf'];

/**
 * Derives minimum required applications from a task objective string or planned step array
 */
export function getMinimumRequiredApplications(taskOrObjective) {
  const text = (typeof taskOrObjective === 'string' ? taskOrObjective : taskOrObjective?.objective || '').toLowerCase();
  const matchedApps = [];

  for (const app of ALLOWED_APPLICATIONS) {
    if (!app.allowed) continue;

    const appId = app.applicationId.toLowerCase();
    const appName = app.displayName.toLowerCase();
    const appExe = app.executable.toLowerCase();

    if (appId === 'app_text_editor') {
      if (text.includes('text editor') || text.includes('editor') || text.includes('note') || text.includes('gedit') || text.includes('write note') || text.includes('type note')) {
        matchedApps.push(app.applicationId);
      }
    } else if (appId === 'app_calculator') {
      if (text.includes('calculator') || text.includes('calc') || text.includes('gnome-calculator') || text.includes('math')) {
        matchedApps.push(app.applicationId);
      }
    } else if (appId === 'app_terminal') {
      if (text.includes('terminal') || text.includes('console') || text.includes('xterm')) {
        matchedApps.push(app.applicationId);
      }
    } else if (appId === 'app_evo_desktop') {
      if (text.includes('evo desktop') || text.includes('evo platform')) {
        matchedApps.push(app.applicationId);
      }
    }
  }

  // Deduplicate
  return Array.from(new Set(matchedApps));
}

/**
 * Derives minimum required actions from a task objective string or planned step array
 */
export function getMinimumRequiredActions(taskOrObjective) {
  const text = (typeof taskOrObjective === 'string' ? taskOrObjective : taskOrObjective?.objective || '').toLowerCase();
  const steps = typeof taskOrObjective === 'object' && Array.isArray(taskOrObjective?.steps) ? taskOrObjective.steps : [];

  const requiredActions = new Set();

  // Always include OBSERVE and VERIFY as fundamental observation capabilities
  requiredActions.add('OBSERVE');
  requiredActions.add('VERIFY');

  // Check step types if steps array exists
  for (const step of steps) {
    if (ALLOWED_SCOPE_ACTIONS.includes(step.type)) {
      requiredActions.add(step.type);
    }
  }

  // Infer from text objective if not explicitly in steps
  if (text.includes('launch') || text.includes('open') || text.includes('start') || text.includes('editor') || text.includes('calculator') || text.includes('terminal')) {
    requiredActions.add('LAUNCH_APPLICATION');
  }

  if (text.includes('click') || text.includes('press') || text.includes('focus') || text.includes('select') || text.includes('button') || text.includes('type') || text.includes('write') || text.includes('input')) {
    requiredActions.add('CLICK');
  }

  if (text.includes('type') || text.includes('write') || text.includes('input') || text.includes('enter') || text.includes('note')) {
    requiredActions.add('TEXT_INPUT');
  }

  return Array.from(requiredActions);
}

/**
 * Automatically computes minimum required bounded autonomy scope from a task or objective
 */
export function planAutonomyScope(taskOrObjective) {
  if (!taskOrObjective) {
    return {
      success: false,
      valid: false,
      status: 'SCOPE_PLANNING_FAILED',
      error: 'Task or objective must be provided.'
    };
  }

  const objectiveText = typeof taskOrObjective === 'string' ? taskOrObjective : (taskOrObjective.objective || '');
  if (typeof objectiveText !== 'string' || !objectiveText.trim()) {
    return {
      success: false,
      valid: false,
      status: 'SCOPE_PLANNING_FAILED',
      error: 'Objective must be a non-empty string.'
    };
  }

  const lower = objectiveText.toLowerCase();

  // 1. Hard Safety Overrides Rejections
  for (const kw of SENSITIVE_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        success: false,
        valid: false,
        status: 'REJECTED_BLOCKED_CAPABILITY',
        reason: 'HARD_SAFETY_OVERRIDE',
        error: `Security Violation: Task objective requests sensitive input ('${kw}'), which is permanently blocked.`,
        scope: null
      };
    }
  }

  for (const kw of SHORTCUT_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        success: false,
        valid: false,
        status: 'REJECTED_BLOCKED_CAPABILITY',
        reason: 'HARD_SAFETY_OVERRIDE',
        error: `Security Violation: Task objective requests keyboard shortcuts ('${kw}'), which are permanently blocked.`,
        scope: null
      };
    }
  }

  for (const kw of SHELL_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        success: false,
        valid: false,
        status: 'REJECTED_BLOCKED_CAPABILITY',
        reason: 'HARD_SAFETY_OVERRIDE',
        error: `Security Violation: Task objective requests shell or path traversal ('${kw}'), which are permanently blocked.`,
        scope: null
      };
    }
  }

  // 2. Check for Unallowlisted or Ambiguous Applications
  if (lower.includes('/usr/bin/') || lower.includes('/bin/') || lower.includes('.exe') || lower.includes('custom-program') || lower.includes('unapproved-app')) {
    return {
      success: false,
      valid: false,
      status: 'SCOPE_PLANNING_UNCERTAIN',
      uncertain: true,
      reason: 'UNALLOWLISTED_APPLICATION',
      error: 'Task requests an unallowlisted application path. Only explicitly approved applications can be scoped.',
      scope: null
    };
  }

  const reqApps = getMinimumRequiredApplications(taskOrObjective);
  if (reqApps.length === 0) {
    // If text asks to "open app" or "do computer task" without specifying an allowlisted app
    if (lower.includes('open') || lower.includes('launch') || lower.includes('app') || lower.includes('application')) {
      return {
        success: false,
        valid: false,
        status: 'SCOPE_PLANNING_UNCERTAIN',
        uncertain: true,
        reason: 'AMBIGUOUS_APPLICATION',
        error: 'Required application cannot be identified with high confidence. Human operator selection required.',
        scope: null
      };
    }
  }

  const reqActions = getMinimumRequiredActions(taskOrObjective);

  // 3. Calculate Conservative Minimum Budget
  const estActionCount = reqActions.length;
  const maxActions = Math.min(Math.max(estActionCount + 2, 3), GLOBAL_MAX_ACTIONS_CEILING);
  const maxDurationMs = Math.min(Math.max(estActionCount * 30000, 120000), GLOBAL_MAX_DURATION_MS_CEILING); // min 2 min

  // 4. Build Explanation
  let explanation = 'Minimum scope derived: ';
  const appNames = reqApps.map((id) => {
    const app = ALLOWED_APPLICATIONS.find((a) => a.applicationId === id);
    return app ? app.displayName : id;
  });

  if (appNames.length > 0) {
    explanation += `${appNames.join(', ')} must be accessed, `;
  }
  explanation += `actions restricted to [${reqActions.join(', ')}], and final outcome verified.`;

  const taskId = typeof taskOrObjective === 'object' ? taskOrObjective.taskId : null;

  const proposedScope = {
    taskId: taskId || null,
    mode: 'BOUNDED',
    allowedApplications: reqApps,
    allowedActions: reqActions,
    maxActions,
    maxDurationMs,
    allowSensitiveInput: false,
    allowKeyboardShortcuts: false,
    allowUnknownTargets: false,
    confidence: 1.0,
    explanation
  };

  const validation = validatePlannedScope(proposedScope, taskOrObjective);
  if (!validation.valid) {
    return {
      success: false,
      valid: false,
      status: 'SCOPE_PLANNING_FAILED',
      error: validation.error,
      scope: null
    };
  }

  return {
    success: true,
    valid: true,
    status: 'PROPOSED',
    confidence: 1.0,
    explanation,
    proposedScope
  };
}

/**
 * Validates a proposed scope against task requirements and safety ceilings
 */
export function validatePlannedScope(scope, taskOrObjective) {
  if (!scope || typeof scope !== 'object') {
    return { valid: false, error: 'Scope proposal must be an object.' };
  }

  // 1. Immutable Hard Safety Overrides Verification
  if (scope.allowSensitiveInput === true || scope.allowKeyboardShortcuts === true || scope.allowUnknownTargets === true) {
    return {
      valid: false,
      error: 'Security Violation: Hard safety override restrictions (allowSensitiveInput, allowKeyboardShortcuts, allowUnknownTargets) cannot be changed to true.'
    };
  }

  // 2. Validate Applications against Allowlist & Over-broadness
  if (!Array.isArray(scope.allowedApplications)) {
    return { valid: false, error: 'Scope allowedApplications must be an array.' };
  }

  for (const appId of scope.allowedApplications) {
    const matched = ALLOWED_APPLICATIONS.find((a) => a.applicationId === appId && a.allowed);
    if (!matched) {
      return { valid: false, error: `Security Violation: Application '${appId}' is not in the approved allowlist.` };
    }
  }

  // Reject over-broad applications if task only needed 1 app
  if (taskOrObjective) {
    const minApps = getMinimumRequiredApplications(taskOrObjective);
    if (minApps.length > 0) {
      const containsExtraApps = scope.allowedApplications.some((a) => !minApps.includes(a));
      if (containsExtraApps) {
        return {
          valid: false,
          error: 'Over-broad Scope Rejection: Proposed scope grants unneeded application access.'
        };
      }
    }

    // Reject over-broad actions
    const minActions = getMinimumRequiredActions(taskOrObjective);
    const containsExtraActions = scope.allowedActions?.some((a) => !minActions.includes(a));
    if (containsExtraActions) {
      return {
        valid: false,
        error: 'Over-broad Scope Rejection: Proposed scope grants unnecessary action types not required by task.'
      };
    }
  }

  // 3. Validate Actions against System Allowed Set
  if (!Array.isArray(scope.allowedActions)) {
    return { valid: false, error: 'Scope allowedActions must be an array.' };
  }

  for (const act of scope.allowedActions) {
    if (!ALLOWED_SCOPE_ACTIONS.includes(act)) {
      return { valid: false, error: `Security Violation: Action type '${act}' is not a supported scope action.` };
    }
  }

  // 4. Validate Budgets
  if (typeof scope.maxActions !== 'number' || scope.maxActions <= 0 || scope.maxActions > GLOBAL_MAX_ACTIONS_CEILING) {
    return { valid: false, error: `Invalid Budget: maxActions must be between 1 and ${GLOBAL_MAX_ACTIONS_CEILING}.` };
  }

  if (typeof scope.maxDurationMs !== 'number' || scope.maxDurationMs <= 0 || scope.maxDurationMs > GLOBAL_MAX_DURATION_MS_CEILING) {
    return { valid: false, error: `Invalid Budget: maxDurationMs must be between 1 and ${GLOBAL_MAX_DURATION_MS_CEILING}.` };
  }

  return {
    valid: true,
    sanitizedScope: {
      taskId: scope.taskId || null,
      mode: 'BOUNDED',
      allowedApplications: [...scope.allowedApplications],
      allowedActions: [...scope.allowedActions],
      maxActions: scope.maxActions,
      maxDurationMs: scope.maxDurationMs,
      allowSensitiveInput: false,
      allowKeyboardShortcuts: false,
      allowUnknownTargets: false,
      explanation: scope.explanation || 'Validated bounded scope'
    }
  };
}

/**
 * Records scope planning metrics and utilization in runtime learning
 */
export function recordScopePlanningLearning(record) {
  try {
    createRuntimeLearningRecord({
      objectiveId: record.objectiveId || `obj_scope_plan_${Date.now()}`,
      goal: `Scope planning for: ${record.objective || 'Computer Task'}`,
      category: LEARNING_CATEGORIES.DESKTOP_INTERACTION,
      evidenceIds: [],
      timestamps: {
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      status: record.userDecision === 'APPROVED' ? LEARNING_STATUS.COMPLETED : LEARNING_STATUS.FAILED,
      summary: {
        scopePlan: true,
        userDecision: record.userDecision || 'PENDING',
        grantedApplications: record.proposedScope?.allowedApplications || [],
        grantedActions: record.proposedScope?.allowedActions || [],
        actualActionsUsed: record.actualActionsUsed || 0,
        unusedGrantedPermissions: record.unusedGrantedPermissions || [],
        efficiencyScore: record.actualActionsUsed ? record.actualActionsUsed / (record.proposedScope?.maxActions || 1) : 1.0
      }
    });
  } catch (e) {}
}

export class AutonomyScopePlannerService {
  planAutonomyScope(taskOrObjective) {
    return planAutonomyScope(taskOrObjective);
  }

  validatePlannedScope(scope, taskOrObjective) {
    return validatePlannedScope(scope, taskOrObjective);
  }

  getMinimumRequiredActions(taskOrObjective) {
    return getMinimumRequiredActions(taskOrObjective);
  }

  getMinimumRequiredApplications(taskOrObjective) {
    return getMinimumRequiredApplications(taskOrObjective);
  }
}

export const autonomyScopePlannerService = new AutonomyScopePlannerService();
export default autonomyScopePlannerService;
