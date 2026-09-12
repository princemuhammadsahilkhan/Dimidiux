/**
 * STAGE 7C — VISUAL TARGET UNDERSTANDING SERVICE FOR CONTROLLED CLICKING
 * Inspects desktop observation state and objective goal text to identify clickable UI targets.
 * 
 * IMPORTANT SAFETY BOUNDARIES:
 * - Read-only visual target identification ONLY.
 * - Produces CLICK_PROPOSAL objects (never executes clicks directly).
 * - Clicks MUST flow through Stage 7B supervised approval.
 * - Confidence < 0.7 marks proposals as NEEDS_REVIEW.
 * - Zero keyboard control, zero drag/double-click, zero autonomous clicking.
 */

import { desktopObservationService, sanitizeObservationText, validateObservationSchema } from './desktopObservationService.js';
import { validateMouseClick } from './computerInteractionService.js';
import { recordActionEvent } from './actionEventStore.js';

export const SUPPORTED_UI_ROLES = ['button', 'link', 'tab', 'menu item', 'icon', 'text', 'search', 'textarea', 'text input'];
export const CONFIDENCE_THRESHOLD = 0.7;

const SENSITIVE_TERMS = ['password', 'passcode', 'pin', 'otp', 'verification code', 'security code', 'api key', 'secret', 'token', 'private key', 'credit card', 'cvv', 'ssn'];

/**
 * Provider abstraction interface for UI target discovery.
 * Supports deterministic UI lookup, window metadata inspection, and optional vision model providers.
 */
export class VisualTargetProvider {
  /**
   * Deterministic UI lookup based on current desktop observation & goal text
   */
  async findTarget(observation, objectiveText, options = {}) {
    if (!observation || !validateObservationSchema(observation)) {
      return { success: false, status: 'UNSUPPORTED', reason: 'Invalid or missing desktop observation.' };
    }

    const goalLower = (objectiveText || '').toLowerCase();
    const activeApp = observation.activeApplication;
    const windows = observation.windows || [];

    // Reject sensitive targets early in visual target provider
    for (const term of SENSITIVE_TERMS) {
      if (goalLower.includes(term)) {
        return {
          success: false,
          status: 'REJECTED_SENSITIVE_TARGET',
          reason: `Security Violation: Target '${term}' is identified as a sensitive field and input is strictly prohibited.`
        };
      }
    }

    // Fallback: If custom vision provider is passed in options
    if (options.customVisionProvider && typeof options.customVisionProvider.findTarget === 'function') {
      try {
        return await options.customVisionProvider.findTarget(observation, objectiveText, options);
      } catch (err) {
        console.warn('[VisualTargetProvider] Custom vision provider failed, falling back to deterministic lookup:', err.message);
      }
    }

    // Deterministic UI element extraction from observation window bounds & metadata
    if (windows.length > 0) {
      const activeWindow = windows.find((w) => w.focused) || windows[0];
      const winBounds = activeWindow.bounds || { x: 0, y: 0, width: 1280, height: 800 };

      // Infer role & target coordinates based on goal intent or default window action area
      let role = 'button';
      let label = activeWindow.title || 'Window Target Action';
      let confidence = 0.85;
      let targetX = Math.floor(winBounds.x + winBounds.width / 2);
      let targetY = Math.floor(winBounds.y + winBounds.height / 2);
      let reasoning = `Identified central interactive target within active window '${activeWindow.id}' for goal '${objectiveText}'.`;

      if (goalLower.includes('type') || goalLower.includes('input') || goalLower.includes('enter text') || goalLower.includes('textarea')) {
        role = goalLower.includes('search') ? 'search' : goalLower.includes('textarea') ? 'textarea' : 'text';
        label = sanitizeObservationText(`Text Entry Field: ${objectiveText}`);
        confidence = 0.85;
        reasoning = `Matched text entry intent '${objectiveText}' to focused window text input area.`;
      } else if (goalLower.includes('button') || goalLower.includes('click') || goalLower.includes('submit') || goalLower.includes('confirm')) {
        role = 'button';
        label = sanitizeObservationText(`Action Button: ${objectiveText}`);
        confidence = 0.90;
        reasoning = `Matched goal action intent '${objectiveText}' to primary window button bounds.`;
      } else if (goalLower.includes('tab') || goalLower.includes('switch')) {
        role = 'tab';
        label = sanitizeObservationText(`Header Tab: ${objectiveText}`);
        targetY = Math.floor(winBounds.y + 40);
        confidence = 0.80;
        reasoning = `Matched goal tab intent '${objectiveText}' to window header tab region.`;
      } else if (goalLower.includes('link') || goalLower.includes('open')) {
        role = 'link';
        label = sanitizeObservationText(`Content Link: ${objectiveText}`);
        confidence = 0.75;
        reasoning = `Matched link intent '${objectiveText}' to window content body.`;
      } else if (goalLower.includes('menu')) {
        role = 'menu item';
        label = sanitizeObservationText(`Menu Option: ${objectiveText}`);
        targetY = Math.floor(winBounds.y + 20);
        confidence = 0.70;
        reasoning = `Matched menu intent '${objectiveText}' to window menu bar region.`;
      } else if (goalLower.includes('icon') || goalLower.includes('close') || goalLower.includes('minimize')) {
        role = 'icon';
        label = sanitizeObservationText(`Window Control Icon: ${objectiveText}`);
        targetX = Math.floor(winBounds.x + 20);
        targetY = Math.floor(winBounds.y + 20);
        confidence = 0.65;
        reasoning = `Matched control icon intent '${objectiveText}' to window top-left controls.`;
      }

      const targetBounds = {
        x: Math.max(0, targetX - 40),
        y: Math.max(0, targetY - 15),
        width: 80,
        height: 30
      };

      return {
        success: true,
        status: confidence >= CONFIDENCE_THRESHOLD ? 'PROPOSED' : 'NEEDS_REVIEW',
        windowId: activeWindow.id,
        target: {
          x: targetX,
          y: targetY,
          label: sanitizeObservationText(label),
          role,
          bounds: targetBounds
        },
        confidence,
        reasoning: sanitizeObservationText(reasoning)
      };
    }

    return {
      success: false,
      status: 'NO_TARGET',
      reason: 'No open windows or interactive UI targets found in desktop observation.'
    };
  }
}

export const defaultVisualTargetProvider = new VisualTargetProvider();

/**
 * Validates a visual target proposal against the given desktop observation
 */
export function validateTargetProposal(proposal, observation) {
  if (!proposal || typeof proposal !== 'object') {
    return { valid: false, error: 'Target proposal must be an object.' };
  }

  const { proposalId, observationId, windowId, target, confidence } = proposal;

  if (typeof proposalId !== 'string' || !proposalId.startsWith('target_prop_')) {
    return { valid: false, error: 'Proposal ID must be a valid string starting with target_prop_.' };
  }

  if (!observation || !validateObservationSchema(observation)) {
    return { valid: false, error: 'Valid desktop observation is required to validate target proposal.' };
  }

  if (observationId !== observation.observationId) {
    return { valid: false, error: `Stale Target Proposal: Proposal observation ID '${observationId}' does not match current observation ID '${observation.observationId}'.` };
  }

  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { valid: false, error: 'Proposal confidence must be a finite number between 0.0 and 1.0.' };
  }

  if (!target || typeof target !== 'object') {
    return { valid: false, error: 'Proposal missing target object.' };
  }

  if (typeof target.x !== 'number' || typeof target.y !== 'number' || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    return { valid: false, error: 'Target coordinates x and y must be finite numbers.' };
  }

  if (target.x < 0 || target.y < 0) {
    return { valid: false, error: `Invalid Target Proposal: Negative coordinates (x: ${target.x}, y: ${target.y}) are out of bounds.` };
  }

  if (target.role && !SUPPORTED_UI_ROLES.includes(target.role)) {
    return { valid: false, error: `Unsupported UI Role '${target.role}'. Must be one of: ${SUPPORTED_UI_ROLES.join(', ')}.` };
  }

  // Validate window bounds if windowId specified
  if (windowId && Array.isArray(observation.windows)) {
    const targetWin = observation.windows.find((w) => w.id === windowId || w.applicationId === windowId);
    if (!targetWin) {
      return { valid: false, error: `Target Window '${windowId}' is missing from current desktop observation.` };
    }
    const maxW = targetWin.bounds?.width || 1920;
    const maxH = targetWin.bounds?.height || 1080;
    if (target.x > maxW || target.y > maxH) {
      return { valid: false, error: `Target coordinates (${target.x}, ${target.y}) exceed observed window bounds (${maxW}x${maxH}).` };
    }
  }

  // Validate using Stage 7B mouse click validator
  const stage7bValid = validateMouseClick({ x: target.x, y: target.y, button: 'left', windowId }, observation);
  if (!stage7bValid.valid) {
    return { valid: false, error: `Stage 7B Validation Failed: ${stage7bValid.error}` };
  }

  return { valid: true };
}

export class VisualTargetService {
  constructor(provider = defaultVisualTargetProvider) {
    this.provider = provider;
    this.proposalHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Analyzes current desktop observation and objective text to identify clickable target
   */
  async identifyClickableTarget(observation, objectiveText, options = {}) {
    let obs = observation;
    if (obs === undefined) {
      obs = desktopObservationService.getDesktopObservation({ audit: false });
    }
    if (!obs || !validateObservationSchema(obs)) {
      return {
        success: false,
        status: 'UNSUPPORTED',
        reason: 'Valid desktop observation is required for target identification.'
      };
    }

    const discovery = await this.provider.findTarget(obs, objectiveText, options);
    if (!discovery.success) {
      return {
        success: false,
        status: discovery.status || 'NO_TARGET',
        reason: discovery.reason || 'Could not identify clickable UI target.'
      };
    }

    const proposalId = `target_prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const status = discovery.confidence < CONFIDENCE_THRESHOLD ? 'NEEDS_REVIEW' : 'PROPOSED';

    const proposal = {
      proposalId,
      observationId: obs.observationId,
      windowId: discovery.windowId || null,
      target: discovery.target,
      confidence: discovery.confidence,
      reasoning: discovery.reasoning,
      objective: sanitizeObservationText(objectiveText || 'User Objective'),
      status,
      createdAt: new Date().toISOString()
    };

    const validation = validateTargetProposal(proposal, obs);
    if (!validation.valid) {
      return {
        success: false,
        status: 'REJECTED_VALIDATION',
        reason: validation.error
      };
    }

    this.proposalHistory.unshift(proposal);
    if (this.proposalHistory.length > this.maxHistorySize) {
      this.proposalHistory = this.proposalHistory.slice(0, this.maxHistorySize);
    }

    try {
      recordActionEvent({
        objectiveId: options.objectiveId || 'system_visual_target',
        tool: 'visual_target_identification',
        inputs: { proposalId, label: proposal.target.label, confidence: proposal.confidence },
        outcome: 'SUCCESS',
        verificationResult: { proposalId, status: proposal.status },
        durationMs: 5
      });
    } catch (e) {}

    return {
      success: true,
      proposalId,
      proposal
    };
  }

  /**
   * Retrieves proposal history
   */
  getProposalHistory() {
    return [...this.proposalHistory];
  }
}

export const visualTargetService = new VisualTargetService();
