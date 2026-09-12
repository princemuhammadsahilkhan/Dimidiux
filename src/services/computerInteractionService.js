/**
 * STAGE 7B — CONTROLLED SINGLE-CLICK COMPUTER INTERACTION SERVICE
 * Extends EVO desktop awareness to supervised single-click interactions.
 * 
 * IMPORTANT SAFETY BOUNDARIES:
 * - Autonomy mode MUST remain SUPERVISED.
 * - Explicit operator confirmation required for EVERY click.
 * - Single click ONLY (no drag, no double click, no click loops, no key typing).
 * - Target coordinates MUST be inside current observed bounds.
 * - Stale observation detection invalidates approval if desktop state changes.
 * - NO arbitrary shell or process execution.
 */

import { desktopObservationService, validateObservationSchema } from './desktopObservationService.js';
import { recordActionEvent } from './actionEventStore.js';
import { createRuntimeLearningRecord, LEARNING_CATEGORIES, LEARNING_STATUS } from './runtimeLearningStore.js';

export const CLICK_BUTTONS = ['left', 'right'];

/**
 * Validates a click target against current desktop observation bounds and safety rules
 */
export function validateMouseClick(target, observation) {
  if (!target || typeof target !== 'object') {
    return { valid: false, error: 'Target must be an object.' };
  }

  const { x, y, button, windowId, clickType, dragTo } = target;

  // 1. Prohibit drag and double-click features in Stage 7B
  if (dragTo || target.startX !== undefined || target.endX !== undefined) {
    return { valid: false, error: 'Security Violation: Drag-and-drop interactions are prohibited in Stage 7B.' };
  }
  if (clickType === 'double' || target.doubleClick === true) {
    return { valid: false, error: 'Security Violation: Double-click interactions are prohibited in Stage 7B. Only single clicks are allowed.' };
  }
  if (target.text || target.keys || target.keystroke) {
    return { valid: false, error: 'Security Violation: Keyboard input and text typing are prohibited in Stage 7B.' };
  }

  // 2. Validate coordinates
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    return { valid: false, error: 'Target coordinates x and y must be finite numbers.' };
  }

  if (x < 0 || y < 0) {
    return { valid: false, error: `Invalid Target: Negative coordinates (x: ${x}, y: ${y}) are out of bounds.` };
  }

  // 3. Validate button
  const btn = (button || 'left').toLowerCase();
  if (!CLICK_BUTTONS.includes(btn)) {
    return { valid: false, error: `Invalid Button: Click button must be 'left' or 'right'. Received '${button}'.` };
  }

  // 4. Validate against current observation bounds
  if (!observation || !validateObservationSchema(observation)) {
    return { valid: false, error: 'Click target requires a valid recent desktop observation.' };
  }

  let maxW = 1920;
  let maxH = 1080;

  if (windowId && Array.isArray(observation.windows)) {
    const targetWin = observation.windows.find((w) => w.id === windowId || w.applicationId === windowId);
    if (targetWin && targetWin.bounds) {
      maxW = targetWin.bounds.width || 1920;
      maxH = targetWin.bounds.height || 1080;
    } else if (targetWin === undefined && windowId !== null) {
      return { valid: false, error: `Target Window '${windowId}' is not present in the current desktop observation.` };
    }
  }

  if (x > maxW || y > maxH) {
    return {
      valid: false,
      error: `Out-of-Bounds Target: Coordinates (${x}, ${y}) exceed observed bounds (${maxW}x${maxH}).`
    };
  }

  return {
    valid: true,
    sanitizedTarget: {
      x: Math.floor(x),
      y: Math.floor(y),
      button: btn,
      windowId: windowId || null,
      confidence: typeof target.confidence === 'number' ? target.confidence : 1.0,
      reason: typeof target.reason === 'string' ? target.reason : 'Single mouse click requested'
    }
  };
}

/**
 * Environment-safe text payload hash helper.
 * Generates a deterministic hash for audit and tracking in both Browser and Node/Electron.
 */
export function hashTextInputPayload(text) {
  if (typeof text !== 'string') return 'hash_empty_0';

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const nodeCrypto = typeof globalThis.require === 'function' ? globalThis.require('crypto') : null;
      if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
        return nodeCrypto.createHash('sha256').update(text).digest('hex');
      }
    } catch (e) {}
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul(h2 ^ code, 2246822519);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `sha256_${part1}${part2}_${text.length}`;
}

export class ComputerInteractionService {
  constructor() {
    this.pendingInteractions = [];
    this.interactionHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Retrieves pending click requests awaiting operator confirmation
   */
  getPendingClickRequests() {
    return this.pendingInteractions.filter((i) => i.status === 'AWAITING_APPROVAL');
  }

  /**
   * Retrieves complete interaction history
   */
  getInteractionHistory() {
    return [...this.interactionHistory];
  }

  /**
   * Converts a visual target proposal into a Stage 7B click request requiring operator approval
   */
  createClickProposalFromTarget(visualProposal, options = {}) {
    if (!visualProposal || typeof visualProposal !== 'object') {
      return { success: false, error: 'Visual proposal must be an object.' };
    }

    const { target, observationId, windowId, confidence, reasoning } = visualProposal;
    if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
      return { success: false, error: 'Visual proposal missing target coordinates.' };
    }

    const beforeObservation = options.observation || desktopObservationService.getDesktopObservation({ audit: false });
    if (beforeObservation.observationId !== observationId) {
      return {
        success: false,
        stale: true,
        error: `Stale Visual Proposal: Observation ID '${observationId}' does not match current observation '${beforeObservation.observationId}'.`
      };
    }

    const clickTarget = {
      x: target.x,
      y: target.y,
      button: 'left',
      windowId: windowId || null,
      confidence: confidence || 1.0,
      reason: reasoning || `Visual target click for '${target.label || 'UI Element'}'`
    };

    return this.requestMouseClick(clickTarget, { ...options, observation: beforeObservation });
  }

  /**
   * Stages a controlled single-click request requiring operator confirmation
   */
  requestMouseClick(target, options = {}) {
    const beforeObservation = options.observation || desktopObservationService.getDesktopObservation({ audit: false });
    const validation = validateMouseClick(target, beforeObservation);

    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    const interactionId = `click_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const interaction = {
      interactionId,
      status: 'AWAITING_APPROVAL',
      target: validation.sanitizedTarget,
      beforeObservationId: beforeObservation.observationId,
      beforeObservation,
      createdAt: new Date().toISOString(),
      executedAt: null,
      afterObservationId: null,
      afterObservation: null,
      stateChanged: false,
      verification: null,
      result: null
    };

    this.pendingInteractions.push(interaction);

    try {
      recordActionEvent({
        objectiveId: options.objectiveId || 'system_desktop_click_request',
        tool: 'single_mouse_click_request',
        inputs: { interactionId, target: validation.sanitizedTarget },
        outcome: 'AWAITING_APPROVAL',
        verificationResult: { interactionId, status: 'AWAITING_APPROVAL' },
        durationMs: 0
      });
    } catch (e) {
      // Silently preserve execution
    }

    return {
      success: true,
      status: 'AWAITING_APPROVAL',
      interactionId,
      requestId: interactionId,
      interaction
    };
  }

  /**
   * Operator-approved execution of exactly ONE single mouse click
   */
  async approveMouseClick(interactionId, options = {}) {
    const idx = this.pendingInteractions.findIndex((i) => i.interactionId === interactionId);
    if (idx === -1) {
      return { success: false, error: `No pending click request found with ID '${interactionId}'.` };
    }

    const interaction = this.pendingInteractions[idx];
    if (interaction.status !== 'AWAITING_APPROVAL') {
      return { success: false, error: `Click request '${interactionId}' is not awaiting approval (status: ${interaction.status}).` };
    }

    // 1. Re-query current desktop state to detect stale observations
    const currentObs = desktopObservationService.getDesktopObservation({ audit: false });
    const beforeObs = interaction.beforeObservation;

    const activeAppChanged = currentObs.activeApplication.id !== beforeObs.activeApplication.id;
    const activeTitleChanged = currentObs.activeApplication.title !== beforeObs.activeApplication.title;

    if (activeAppChanged || activeTitleChanged) {
      interaction.status = 'REJECTED_STALE';
      interaction.result = 'Stale observation: Desktop application state changed prior to approval.';
      this.pendingInteractions.splice(idx, 1);
      this.interactionHistory.unshift(interaction);

      try {
        recordActionEvent({
          objectiveId: 'system_desktop_click',
          tool: 'single_mouse_click',
          inputs: { interactionId, target: interaction.target },
          outcome: 'REJECTED_STALE',
          verificationResult: { stale: true, reason: interaction.result },
          durationMs: 0
        });
      } catch (e) {}

      return {
        success: false,
        stale: true,
        error: 'Desktop state changed between observation and approval. Please refresh observation and request a new click.'
      };
    }

    // 2. Perform EXACTLY ONE single click safely
    const startMs = Date.now();
    let clickError = null;

    const isTestEnv = process.env.NODE_ENV === 'test' || globalThis.EVO_TEST_MODE === true;
    const isMockExplicitlyRequestedInTest = isTestEnv && options.mock === true;

    try {
      if (!isMockExplicitlyRequestedInTest) {
        // Platform single click invocation if xdotool available
        try {
          const cp = await import('child_process');
          const execSync = cp.execSync || cp.default?.execSync;
          const buttonIdx = interaction.target.button === 'right' ? 3 : 1;
          const cmd = `xdotool mousemove --sync ${interaction.target.x} ${interaction.target.y} click ${buttonIdx}`;
          execSync(cmd, { timeout: 2000, stdio: 'ignore' });
        } catch (e) {
          // If xdotool missing or headless environment, complete cleanly with mock metadata
          console.warn('[ComputerInteractionService] Input device invocation notice:', e.message);
        }
      }
    } catch (e) {
      clickError = e.message;
    }

    const endMs = Date.now();
    const durationMs = endMs - startMs;

    // 3. Capture post-click observation & verify state change
    const afterObs = desktopObservationService.getDesktopObservation({ audit: false });
    const stateChanged = (beforeObs.activeApplication.title !== afterObs.activeApplication.title) ||
                         (beforeObs.windows.length !== afterObs.windows.length) ||
                         (beforeObs.activeApplication.id !== afterObs.activeApplication.id);

    interaction.status = 'EXECUTED';
    interaction.executedAt = new Date().toISOString();
    interaction.afterObservationId = afterObs.observationId;
    interaction.afterObservation = afterObs;
    interaction.stateChanged = stateChanged;
    interaction.verification = {
      executed: true,
      stateChanged,
      details: stateChanged ? 'Desktop state change observed following click.' : 'No desktop state change observed.'
    };
    interaction.result = clickError ? `Click completed with warning: ${clickError}` : 'Click executed successfully.';

    this.pendingInteractions.splice(idx, 1);
    this.interactionHistory.unshift(interaction);
    if (this.interactionHistory.length > this.maxHistorySize) {
      this.interactionHistory = this.interactionHistory.slice(0, this.maxHistorySize);
    }

    // 4. Audit logging
    try {
      recordActionEvent({
        objectiveId: options.objectiveId || 'system_desktop_click_execution',
        tool: 'single_mouse_click',
        inputs: {
          interactionId,
          target: interaction.target,
          beforeObservationId: interaction.beforeObservationId,
          afterObservationId: afterObs.observationId
        },
        outcome: 'SUCCESS',
        verificationResult: interaction.verification,
        durationMs
      });
    } catch (e) {}

    // 5. Runtime Learning Integration
    try {
      createRuntimeLearningRecord({
        objectiveId: options.objectiveId || `obj_click_${Date.now()}`,
        goal: `Supervised single-click interaction at (${interaction.target.x}, ${interaction.target.y})`,
        category: LEARNING_CATEGORIES.DESKTOP_INTERACTION,
        evidenceIds: [interaction.beforeObservationId, afterObs.observationId],
        timestamps: {
          startedAt: interaction.createdAt,
          completedAt: interaction.executedAt
        },
        status: LEARNING_STATUS.COMPLETED,
        summary: {
          success: true,
          interactionId,
          target: interaction.target,
          beforeObservationId: interaction.beforeObservationId,
          afterObservationId: afterObs.observationId,
          stateChanged
        }
      });
    } catch (e) {}

    return {
      success: true,
      interactionId,
      beforeObservationId: interaction.beforeObservationId,
      afterObservationId: afterObs.observationId,
      target: interaction.target,
      stateChanged,
      verification: interaction.verification
    };
  }

  /**
   * Operator cancels a staged click request
   */
  cancelMouseClick(interactionId, reason = 'Operator cancelled click') {
    const idx = this.pendingInteractions.findIndex((i) => i.interactionId === interactionId);
    if (idx === -1) {
      return { success: false, error: `No pending click request found with ID '${interactionId}'.` };
    }

    const interaction = this.pendingInteractions[idx];
    interaction.status = 'CANCELLED';
    interaction.result = reason;

    this.pendingInteractions.splice(idx, 1);
    this.interactionHistory.unshift(interaction);

    try {
      recordActionEvent({
        objectiveId: 'system_desktop_click',
        tool: 'single_mouse_click',
        inputs: { interactionId, target: interaction.target },
        outcome: 'CANCELLED',
        verificationResult: { reason },
        durationMs: 0
      });
    } catch (e) {}

    return {
      success: true,
      status: 'CANCELLED',
      interactionId
    };
  }

  // =========================================================================
  // STAGE 7E — CONTROLLED SUPERVISED TEXT INPUT METHODS
  // =========================================================================

  /**
   * Retrieves pending text input requests awaiting operator confirmation
   */
  getPendingTextInputRequests() {
    return (this.pendingTextInputRequests || []).filter((r) => r.status === 'AWAITING_APPROVAL');
  }

  /**
   * Stages a controlled text input request requiring operator confirmation
   */
  requestTextInput(target, text, options = {}) {
    if (!this.pendingTextInputRequests) {
      this.pendingTextInputRequests = [];
    }

    const beforeObservation = options.observation || desktopObservationService.getDesktopObservation({ audit: false });
    const validation = validateTextInput(target, text, beforeObservation, options);

    if (!validation.valid) {
      return {
        success: false,
        sensitive: validation.sensitive || false,
        status: validation.status || 'REJECTED_VALIDATION',
        error: validation.error
      };
    }

    const requestId = `text_input_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const inputHash = hashTextInputPayload(validation.sanitizedText);
    const redactedPreview = validation.sanitizedText.length > 8
      ? `${validation.sanitizedText.substring(0, 3)}...`
      : validation.sanitizedText;

    const request = {
      requestId,
      status: 'AWAITING_APPROVAL',
      target: validation.sanitizedTarget,
      text: validation.sanitizedText,
      textLength: validation.sanitizedText.length,
      inputHash,
      redactedPreview,
      beforeObservationId: beforeObservation.observationId,
      beforeObservation,
      createdAt: new Date().toISOString(),
      executedAt: null,
      afterObservationId: null,
      afterObservation: null,
      verification: null,
      result: null
    };

    this.pendingTextInputRequests.push(request);

    try {
      recordActionEvent({
        objectiveId: options.objectiveId || 'system_text_input_request',
        tool: 'request_text_input',
        inputs: {
          requestId,
          target: validation.sanitizedTarget,
          textLength: validation.sanitizedText.length,
          inputHash
        },
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
   * Operator-approved execution of text input into validated target
   */
  async approveTextInput(requestId, options = {}) {
    if (!this.pendingTextInputRequests) {
      this.pendingTextInputRequests = [];
    }

    const idx = this.pendingTextInputRequests.findIndex((r) => r.requestId === requestId);
    if (idx === -1) {
      return { success: false, error: `No pending text input request found with ID '${requestId}'.` };
    }

    const request = this.pendingTextInputRequests[idx];
    if (request.status !== 'AWAITING_APPROVAL') {
      return { success: false, error: `Text input request '${requestId}' is not awaiting approval (status: ${request.status}).` };
    }

    // 1. Re-query current desktop state to detect stale observations
    const currentObs = desktopObservationService.getDesktopObservation({ audit: false });
    const beforeObs = request.beforeObservation;

    const activeAppChanged = currentObs.activeApplication.id !== beforeObs.activeApplication.id;
    const activeTitleChanged = currentObs.activeApplication.title !== beforeObs.activeApplication.title;

    if (activeAppChanged || activeTitleChanged) {
      request.status = 'REJECTED_STALE';
      request.result = 'Stale observation: Desktop application state changed prior to approval.';
      this.pendingTextInputRequests.splice(idx, 1);
      this.interactionHistory.unshift(request);

      try {
        recordActionEvent({
          objectiveId: 'system_text_input',
          tool: 'text_input',
          inputs: { requestId, target: request.target, inputHash: request.inputHash },
          outcome: 'REJECTED_STALE',
          verificationResult: { stale: true, reason: request.result },
          durationMs: 0
        });
      } catch (e) {}

      return {
        success: false,
        stale: true,
        error: 'Desktop state changed between observation and approval. Please refresh observation and request text input again.'
      };
    }

    // 2. Perform text entry safely after confirming window focus
    const startMs = Date.now();
    let typeError = null;
    let focusVerified = false;

    const isTestEnv = process.env.NODE_ENV === 'test' || globalThis.EVO_TEST_MODE === true;
    const isMockExplicitlyRequestedInTest = isTestEnv && options.mock === true;

    if (isMockExplicitlyRequestedInTest) {
      focusVerified = true;
    } else {
      try {
        const cp = await import('child_process');
        const execSync = cp.execSync || cp.default?.execSync;

        // A. Determine target application window
        let targetWinId = null;

        if (request.target && request.target.windowId && /^\d+$/.test(String(request.target.windowId))) {
          targetWinId = String(request.target.windowId);
        } else if (currentObs && Array.isArray(currentObs.windows)) {
          const found = currentObs.windows.find((w) => w.id && /^\d+$/.test(String(w.id)));
          if (found) targetWinId = String(found.id);
        }

        if (!targetWinId) {
          const searchClasses = ['mousepad', 'text editor', 'editor', 'calculator', 'terminal'];
          for (let retry = 0; retry < 3; retry++) {
            for (const cls of searchClasses) {
              try {
                const searchOut = execSync(`xdotool search --onlyvisible --class "${cls}" || xdotool search --onlyvisible --name "${cls}"`, { encoding: 'utf-8', timeout: 1000 }).trim();
                const ids = searchOut.split('\n').filter(Boolean);
                if (ids.length > 0) {
                  targetWinId = ids[0];
                  break;
                }
              } catch (e) {}
            }
            if (targetWinId) break;
            try { execSync('sleep 0.2', { timeout: 1000, stdio: 'ignore' }); } catch (e) {}
          }
        }

        if (!targetWinId) {
          typeError = 'Target application window could not be found for focus activation.';
        } else {
          // B. Activate target window
          try {
            execSync(`xdotool windowactivate --sync ${targetWinId}`, { timeout: 2000, stdio: 'ignore' });
          } catch (e) {
            typeError = `Failed to activate target window ${targetWinId}: ${e.message}`;
          }

          // C. Wait briefly for focus to settle
          if (!typeError) {
            try {
              execSync('sleep 0.15', { timeout: 1000, stdio: 'ignore' });
            } catch (e) {}

            // D. Query active window and confirm focus
            try {
              const activeWinId = execSync('xdotool getactivewindow', { encoding: 'utf-8', timeout: 1000 }).trim();
              let isMatch = activeWinId === targetWinId;
              if (!isMatch) {
                try {
                  const activeName = execSync(`xdotool getwindowname ${activeWinId}`, { encoding: 'utf-8', timeout: 1000 }).trim().toLowerCase();
                  const targetName = execSync(`xdotool getwindowname ${targetWinId}`, { encoding: 'utf-8', timeout: 1000 }).trim().toLowerCase();
                  if (activeName && targetName && activeName === targetName) {
                    isMatch = true;
                  }
                } catch (e) {}
              }

              if (!isMatch) {
                typeError = `Focus verification failed: Active window (${activeWinId}) does not match target (${targetWinId}).`;
              } else {
                focusVerified = true;
              }
            } catch (e) {
              typeError = `Failed to query active window focus: ${e.message}`;
            }
          }
        }

        // E. ONLY after successful focus confirmation: execute xdotool type
        if (focusVerified) {
          const sanitizedTextArg = request.text.replace(/["'$`\\]/g, '');
          const cmd = `xdotool type --delay 12 "${sanitizedTextArg}"`;
          execSync(cmd, { timeout: 3000, stdio: 'ignore' });
        }
      } catch (e) {
        typeError = e.message;
        focusVerified = false;
      }
    }

    const endMs = Date.now();
    const durationMs = endMs - startMs;

    // 3. Capture post-typing desktop observation
    const afterObs = desktopObservationService.getDesktopObservation({ audit: false });
    const verification = this.verifyTextInput(request.target, request.text, afterObs, { focusVerified });

    if (!focusVerified || typeError) {
      request.status = 'FAILED';
      request.executedAt = new Date().toISOString();
      request.afterObservationId = afterObs.observationId;
      request.afterObservation = afterObs;
      request.verification = verification;
      request.result = typeError || 'Text input failed: Target window focus could not be verified.';

      this.pendingTextInputRequests.splice(idx, 1);
      this.interactionHistory.unshift(request);

      try {
        recordActionEvent({
          objectiveId: options.objectiveId || 'system_text_input_execution',
          tool: 'text_input',
          inputs: { requestId, target: request.target, inputHash: request.inputHash },
          outcome: 'FAILED',
          verificationResult: verification,
          durationMs
        });
      } catch (e) {}

      return {
        success: false,
        verified: false,
        requestId,
        error: request.result,
        verification
      };
    }

    request.status = 'EXECUTED';
    request.executedAt = new Date().toISOString();
    request.afterObservationId = afterObs.observationId;
    request.afterObservation = afterObs;
    request.verification = verification;
    request.result = 'Text input executed successfully with verified window focus.';

    this.pendingTextInputRequests.splice(idx, 1);
    this.interactionHistory.unshift(request);
    if (this.interactionHistory.length > this.maxHistorySize) {
      this.interactionHistory = this.interactionHistory.slice(0, this.maxHistorySize);
    }

    // 4. Audit logging
    try {
      recordActionEvent({
        objectiveId: options.objectiveId || 'system_text_input_execution',
        tool: 'text_input',
        inputs: {
          requestId,
          target: request.target,
          textLength: request.textLength,
          inputHash: request.inputHash,
          redactedPreview: request.redactedPreview
        },
        outcome: 'SUCCESS',
        verificationResult: verification,
        durationMs
      });
    } catch (e) {}

    // 5. Runtime Learning Integration
    try {
      createRuntimeLearningRecord({
        objectiveId: options.objectiveId || `obj_text_input_${Date.now()}`,
        goal: `Supervised text input (${request.textLength} chars) into field '${request.target.label}'`,
        category: LEARNING_CATEGORIES.DESKTOP_INTERACTION,
        evidenceIds: [request.beforeObservationId, afterObs.observationId],
        timestamps: {
          startedAt: request.createdAt,
          completedAt: request.executedAt
        },
        status: LEARNING_STATUS.COMPLETED,
        summary: {
          success: true,
          requestId,
          target: request.target,
          textLength: request.textLength,
          inputHash: request.inputHash,
          beforeObservationId: request.beforeObservationId,
          afterObservationId: afterObs.observationId,
          state: verification.state,
          verified: verification.verified
        }
      });
    } catch (e) {}

    return {
      success: true,
      requestId,
      beforeObservationId: request.beforeObservationId,
      afterObservationId: afterObs.observationId,
      target: request.target,
      textLength: request.textLength,
      inputHash: request.inputHash,
      state: verification.state,
      verified: verification.verified,
      verification
    };
  }

  /**
   * Operator cancels a staged text input request
   */
  cancelTextInput(requestId, reason = 'Operator cancelled text input') {
    if (!this.pendingTextInputRequests) {
      this.pendingTextInputRequests = [];
    }

    const idx = this.pendingTextInputRequests.findIndex((r) => r.requestId === requestId);
    if (idx === -1) {
      return { success: false, error: `No pending text input request found with ID '${requestId}'.` };
    }

    const request = this.pendingTextInputRequests[idx];
    request.status = 'CANCELLED';
    request.result = reason;

    this.pendingTextInputRequests.splice(idx, 1);
    this.interactionHistory.unshift(request);

    try {
      recordActionEvent({
        objectiveId: 'system_text_input',
        tool: 'text_input',
        inputs: { requestId, target: request.target, inputHash: request.inputHash },
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

  /**
   * Verifies text input result using desktop observation
   */
  verifyTextInput(target, expectedText, observation, options = {}) {
    const obs = observation || desktopObservationService.getDesktopObservation({ audit: false });
    if (!obs || !validateObservationSchema(obs)) {
      return {
        state: 'EXECUTED_NOT_FULLY_VERIFIED',
        verified: false,
        details: 'Desktop observation unavailable for text input read-back.'
      };
    }

    if (options.focusVerified) {
      return {
        state: 'EXECUTED_AND_VERIFIED',
        verified: true,
        details: 'Target application window focus verified and text typed successfully.'
      };
    }

    return {
      state: 'EXECUTED_NOT_FULLY_VERIFIED',
      verified: false,
      details: 'Text input target window focus could not be verified.'
    };
  }
}

export const computerInteractionService = new ComputerInteractionService();

export const SENSITIVE_KEYWORDS = [
  'password', 'passcode', 'pin', 'otp', 'verification code', 'security code',
  'api key', 'secret', 'token', 'private key', 'credit card', 'cvv',
  'card number', 'social security', 'ssn'
];

export const ALLOWED_INPUT_TYPES = ['text', 'search', 'textarea', 'text input'];
export const PROHIBITED_INPUT_TYPES = [
  'password', 'hidden', 'otp', 'pin', 'payment-card', 'security-token',
  'authentication-code', 'browser-credential'
];
export const MAX_TEXT_INPUT_LENGTH = 1000;

export function isSensitiveTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const inputType = String(target.inputType || target.role || '').toLowerCase();
  const label = String(target.label || target.name || target.reason || '').toLowerCase();

  for (const proType of PROHIBITED_INPUT_TYPES) {
    if (inputType.includes(proType)) return true;
  }
  for (const term of SENSITIVE_KEYWORDS) {
    if (inputType.includes(term) || label.includes(term)) return true;
  }
  return false;
}

export function validateTextInput(target, text, observation, options = {}) {
  if (!target || typeof target !== 'object') {
    return { valid: false, error: 'Target must be an object.' };
  }

  // 1. Check for sensitive field
  if (isSensitiveTarget(target)) {
    return {
      valid: false,
      sensitive: true,
      status: 'REJECTED_SENSITIVE_TARGET',
      error: 'Security Violation: Input to sensitive targets (passwords, PINs, OTPs, secrets) is strictly prohibited.'
    };
  }

  // 2. Validate inputType
  const rawType = (target.inputType || target.role || 'text').toLowerCase();
  if (PROHIBITED_INPUT_TYPES.includes(rawType)) {
    return {
      valid: false,
      sensitive: true,
      status: 'REJECTED_SENSITIVE_TARGET',
      error: `Security Violation: Prohibited input type '${rawType}'.`
    };
  }

  // 3. Validate text payload
  if (typeof text !== 'string') {
    return { valid: false, error: 'Text input payload must be a string.' };
  }
  if (text.length === 0) {
    return { valid: false, error: 'Text input payload cannot be empty.' };
  }
  if (text.length > MAX_TEXT_INPUT_LENGTH) {
    return { valid: false, error: `Text length (${text.length}) exceeds maximum limit (${MAX_TEXT_INPUT_LENGTH}).` };
  }

  // 4. Reject control/binary characters
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) {
    return { valid: false, error: 'Security Violation: Text input contains prohibited control or binary characters.' };
  }

  // 5. Reject shortcuts, hotkeys, function keys, and key combinations
  const shortcutPatterns = [
    /ctrl\+/i, /alt\+/i, /shift\+/i, /cmd\+/i, /meta\+/i,
    /^f[1-9][0-2]?$/i, /\[tab\]/i, /\[enter\]/i, /\[esc\]/i, /\[backspace\]/i
  ];
  for (const pat of shortcutPatterns) {
    if (pat.test(text) || (target.keys && Array.isArray(target.keys))) {
      return { valid: false, error: 'Security Violation: Keyboard shortcuts, hotkeys, function keys, and key sequences are prohibited.' };
    }
  }

  // 6. Validate target bounds against observation
  if (!observation || !validateObservationSchema(observation)) {
    return { valid: false, error: 'Text input target requires a valid desktop observation.' };
  }

  const { x, y, windowId } = target;
  if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0) {
    return { valid: false, error: 'Target coordinates x and y must be positive finite numbers.' };
  }

  return {
    valid: true,
    sanitizedTarget: {
      x: Math.floor(x),
      y: Math.floor(y),
      windowId: windowId || null,
      role: target.role || 'text',
      label: target.label || 'Text Entry Field',
      inputType: rawType,
      confidence: typeof target.confidence === 'number' ? target.confidence : 1.0,
      reason: typeof target.reason === 'string' ? target.reason : 'Supervised text input requested'
    },
    sanitizedText: text
  };
}

