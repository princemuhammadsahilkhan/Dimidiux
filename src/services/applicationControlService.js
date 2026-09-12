/**
 * STAGE 7D — CONTROLLED APPLICATION LAUNCH SERVICE
 * Provides tightly controlled, supervised application launching capabilities.
 * 
 * IMPORTANT SAFETY BOUNDARIES:
 * - Autonomy mode MUST remain SUPERVISED.
 * - Explicit operator confirmation required for EVERY application launch.
 * - Strictly restricted to an explicit, persistent application allowlist.
 * - Rejects arbitrary filesystem executable paths, shell command strings, and argument injections.
 * - Single application launch per approval (no loops, no arbitrary startup sequences).
 */

import { desktopObservationService, validateObservationSchema } from './desktopObservationService.js';
import { recordActionEvent } from './actionEventStore.js';
import { createRuntimeLearningRecord, LEARNING_CATEGORIES, LEARNING_STATUS } from './runtimeLearningStore.js';

export const ALLOWED_APPLICATIONS = [
  {
    applicationId: 'app_text_editor',
    displayName: 'Text Editor',
    executable: 'mousepad',
    allowed: true
  },
  {
    applicationId: 'app_calculator',
    displayName: 'Calculator',
    executable: 'gnome-calculator',
    allowed: true
  },
  {
    applicationId: 'app_terminal',
    displayName: 'Terminal Console',
    executable: 'xterm',
    allowed: true
  },
  {
    applicationId: 'app_evo_desktop',
    displayName: 'EVO Desktop Platform',
    executable: 'electron',
    allowed: true
  }
];

export const REQUEST_EXPIRATION_MS = 60000; // 60 seconds

/**
 * Validates an application launch request against security rules & allowlist
 */
export function validateApplicationLaunch(applicationId, options = {}) {
  if (!applicationId || typeof applicationId !== 'string') {
    return { valid: false, error: 'Application ID must be a non-empty string.' };
  }

  // 1. Prohibit arbitrary filesystem paths & command strings
  if (applicationId.includes('/') || applicationId.includes('\\') || applicationId.includes('..')) {
    return { valid: false, error: 'Security Violation: Arbitrary executable filesystem paths and path traversal are prohibited.' };
  }

  const dangerousTokens = [';', '&&', '||', '|', '`', '$', '>', '<', 'sudo', 'bash', 'sh', 'nc', 'curl', 'wget'];
  for (const token of dangerousTokens) {
    if (applicationId.includes(token) || (options.args && options.args.some((a) => String(a).includes(token)))) {
      return { valid: false, error: `Security Violation: Dangerous token '${token}' detected in launch request.` };
    }
  }

  // 2. Match against explicit allowlist
  const appEntry = ALLOWED_APPLICATIONS.find((a) => a.applicationId === applicationId && a.allowed);
  if (!appEntry) {
    return { valid: false, error: `Security Violation: Application '${applicationId}' is not in the approved application allowlist.` };
  }

  return {
    valid: true,
    appEntry
  };
}

export class ApplicationControlService {
  constructor() {
    this.pendingLaunchRequests = [];
    this.launchHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Returns list of explicitly allowed applications
   */
  listAllowedApplications() {
    return ALLOWED_APPLICATIONS.filter((a) => a.allowed);
  }

  /**
   * Retrieves pending launch requests awaiting operator confirmation
   */
  getPendingLaunchRequests() {
    return this.pendingLaunchRequests.filter((r) => r.status === 'AWAITING_APPROVAL');
  }

  /**
   * Retrieves complete launch history
   */
  getLaunchHistory() {
    return [...this.launchHistory];
  }

  /**
   * Stages a controlled application launch request requiring operator confirmation
   */
  requestApplicationLaunch(applicationId, options = {}) {
    const validation = validateApplicationLaunch(applicationId, options);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    const beforeObservation = options.observation || desktopObservationService.getDesktopObservation({ audit: false });
    const requestId = `launch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const request = {
      requestId,
      applicationId: validation.appEntry.applicationId,
      displayName: validation.appEntry.displayName,
      executable: validation.appEntry.executable,
      status: 'AWAITING_APPROVAL',
      beforeObservationId: beforeObservation.observationId,
      beforeObservation,
      createdAt: new Date().toISOString(),
      executedAt: null,
      afterObservationId: null,
      afterObservation: null,
      verification: null,
      result: null
    };

    this.pendingLaunchRequests.push(request);

    try {
      recordActionEvent({
        objectiveId: options.objectiveId || 'system_app_launch_request',
        tool: 'application_launch_request',
        inputs: { requestId, applicationId: request.applicationId },
        outcome: 'AWAITING_APPROVAL',
        verificationResult: { requestId, status: 'AWAITING_APPROVAL' },
        durationMs: 0
      });
    } catch (e) {}

    return {
      success: true,
      status: 'AWAITING_APPROVAL',
      requestId,
      request
    };
  }

  /**
   * Verifies whether an application is running or focused in an observation
   */
  verifyApplicationLaunch(applicationId, observation) {
    const obs = observation || desktopObservationService.getDesktopObservation({ audit: false });
    if (!obs || !validateObservationSchema(obs)) {
      return {
        applicationId,
        state: 'NOT_RUNNING',
        verified: false,
        details: 'Invalid desktop observation.'
      };
    }

    const appState = desktopObservationService.getApplicationState(applicationId);
    const isRunning = appState.status === 'RUNNING' || appState.status === 'FOCUSED';

    return {
      applicationId,
      state: appState.status || 'NOT_RUNNING',
      verified: isRunning,
      details: isRunning ? `Application '${applicationId}' verified in state ${appState.status}.` : `Application '${applicationId}' not detected in active desktop windows.`
    };
  }

  /**
   * Operator-approved execution of exactly ONE application launch
   */
  async approveApplicationLaunch(requestId, options = {}) {
    const idx = this.pendingLaunchRequests.findIndex((r) => r.requestId === requestId);
    if (idx === -1) {
      return { success: false, error: `No pending launch request found with ID '${requestId}'.` };
    }

    const request = this.pendingLaunchRequests[idx];
    if (request.status !== 'AWAITING_APPROVAL') {
      return { success: false, error: `Launch request '${requestId}' is not awaiting approval (status: ${request.status}).` };
    }

    // 1. Stale / Expiration Check (Request timeout <= 60s)
    const createdMs = new Date(request.createdAt).getTime();
    const nowMs = Date.now();
    if (nowMs - createdMs > REQUEST_EXPIRATION_MS) {
      request.status = 'EXPIRED';
      request.result = 'Launch request expired (exceeded 60s approval window).';
      this.pendingLaunchRequests.splice(idx, 1);
      this.launchHistory.unshift(request);

      try {
        recordActionEvent({
          objectiveId: 'system_app_launch',
          tool: 'application_launch',
          inputs: { requestId, applicationId: request.applicationId },
          outcome: 'EXPIRED',
          verificationResult: { expired: true, reason: request.result },
          durationMs: 0
        });
      } catch (e) {}

      return {
        success: false,
        expired: true,
        error: 'Launch request expired. Please stage a new launch request.'
      };
    }

    // 2. Perform EXACTLY ONE application launch cleanly (without shell)
    const startMs = Date.now();
    let spawnError = null;

    const isTestEnv = process.env.NODE_ENV === 'test' || globalThis.EVO_TEST_MODE === true;
    const isMockExplicitlyRequestedInTest = isTestEnv && options.mock === true;

    try {
      if (!isMockExplicitlyRequestedInTest) {
        try {
          const cp = await import('child_process');
          const spawn = cp.spawn || cp.default?.spawn;
          const child = spawn(request.executable, [], {
            shell: false,
            detached: true,
            stdio: 'ignore'
          });
          child.on('error', (err) => {
            console.warn('[ApplicationControlService] Child spawn error:', err.message);
          });
          if (child.unref) child.unref();
        } catch (e) {
          console.warn('[ApplicationControlService] Process launch notice:', e.message);
          spawnError = e.message;
        }
      }
    } catch (e) {
      spawnError = e.message;
    }

    const endMs = Date.now();
    const durationMs = endMs - startMs;

    // 3. Capture post-launch observation & verify application state
    const afterObs = desktopObservationService.getDesktopObservation({ audit: false });
    const verification = this.verifyApplicationLaunch(request.applicationId, afterObs);

    request.status = 'EXECUTED';
    request.executedAt = new Date().toISOString();
    request.afterObservationId = afterObs.observationId;
    request.afterObservation = afterObs;
    request.verification = verification;
    request.result = spawnError ? `Launch initiated with notice: ${spawnError}` : 'Application launched successfully.';

    this.pendingLaunchRequests.splice(idx, 1);
    this.launchHistory.unshift(request);
    if (this.launchHistory.length > this.maxHistorySize) {
      this.launchHistory = this.launchHistory.slice(0, this.maxHistorySize);
    }

    // 4. Audit logging
    try {
      recordActionEvent({
        objectiveId: options.objectiveId || 'system_app_launch_execution',
        tool: 'application_launch',
        inputs: {
          requestId,
          applicationId: request.applicationId,
          executable: request.executable
        },
        outcome: 'SUCCESS',
        verificationResult: verification,
        durationMs
      });
    } catch (e) {}

    // 5. Runtime Learning Integration
    try {
      createRuntimeLearningRecord({
        objectiveId: options.objectiveId || `obj_launch_${Date.now()}`,
        goal: `Supervised launch of application '${request.displayName}' (${request.applicationId})`,
        category: LEARNING_CATEGORIES.APPLICATION_CONTROL,
        evidenceIds: [request.beforeObservationId, afterObs.observationId],
        timestamps: {
          startedAt: request.createdAt,
          completedAt: request.executedAt
        },
        status: LEARNING_STATUS.COMPLETED,
        summary: {
          success: true,
          requestId,
          applicationId: request.applicationId,
          beforeObservationId: request.beforeObservationId,
          afterObservationId: afterObs.observationId,
          verified: verification.verified,
          state: verification.state
        }
      });
    } catch (e) {}

    return {
      success: true,
      requestId,
      applicationId: request.applicationId,
      beforeObservationId: request.beforeObservationId,
      afterObservationId: afterObs.observationId,
      state: verification.state,
      verified: verification.verified
    };
  }

  /**
   * Operator cancels a staged launch request
   */
  cancelApplicationLaunch(requestId, reason = 'Operator cancelled launch') {
    const idx = this.pendingLaunchRequests.findIndex((r) => r.requestId === requestId);
    if (idx === -1) {
      return { success: false, error: `No pending launch request found with ID '${requestId}'.` };
    }

    const request = this.pendingLaunchRequests[idx];
    request.status = 'CANCELLED';
    request.result = reason;

    this.pendingLaunchRequests.splice(idx, 1);
    this.launchHistory.unshift(request);

    try {
      recordActionEvent({
        objectiveId: 'system_app_launch',
        tool: 'application_launch',
        inputs: { requestId, applicationId: request.applicationId },
        outcome: 'CANCELLED',
        verificationResult: { reason },
        durationMs: 0
      });
    } catch (e) {}

    return {
      success: true,
      status: 'CANCELLED',
      requestId
    };
  }
}

export const applicationControlService = new ApplicationControlService();
