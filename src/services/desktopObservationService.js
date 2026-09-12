/**
 * STAGE 7A — CONTROLLED DESKTOP OBSERVATION SERVICE
 * Provides read-only desktop & application observation capabilities.
 * 
 * IMPORTANT SAFETY BOUNDARIES:
 * - Read-only observation ONLY.
 * - NO mouse / keyboard input simulation or control APIs.
 * - NO arbitrary shell command execution.
 * - NO credential or sensitive data access.
 * - NO direct file modification.
 */

import { recordActionEvent } from './actionEventStore.js';

const SENSITIVE_TERMS = ['password', 'secret', 'token', 'key', 'credential', 'auth', 'private', 'passphrase', 'bearer'];

/**
 * Sanitizes window titles or application metadata to redact sensitive information
 */
export function sanitizeObservationText(text) {
  if (typeof text !== 'string') return '';
  const lower = text.toLowerCase();
  const containsSensitive = SENSITIVE_TERMS.some((term) => lower.includes(term));
  if (containsSensitive) {
    return '[REDACTED_SENSITIVE_TITLE]';
  }
  return text;
}

/**
 * Validates a desktop observation object against the Stage 7A schema
 */
export function validateObservationSchema(observation) {
  if (!observation || typeof observation !== 'object') return false;

  const { observationId, timestamp, activeApplication, windows, snapshot } = observation;

  if (typeof observationId !== 'string' || !observationId.startsWith('obs_')) return false;
  if (!timestamp) return false;
  if (!activeApplication || typeof activeApplication !== 'object') return false;
  if (typeof activeApplication.id !== 'string' || typeof activeApplication.name !== 'string') return false;
  if (!Array.isArray(windows)) return false;
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.available !== 'boolean') return false;

  return true;
}

export class DesktopObservationService {
  constructor() {
    this.observationHistory = [];
    this.maxHistorySize = 50;
    this.mockObservation = null;
  }

  setMockObservation(mockObs) {
    this.mockObservation = mockObs;
  }

  /**
   * Retrieves current active application metadata
   */
  getActiveApplication() {
    let appInfo = {
      id: 'app_evo_desktop',
      name: 'EVO Desktop Platform',
      title: 'EVO Environment Workspace'
    };

    try {
      if (typeof process !== 'undefined' && process.title) {
        const procTitle = process.title || 'electron';
        appInfo = {
          id: `app_${procTitle.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
          name: procTitle,
          title: `EVO Environment - ${procTitle}`
        };
      }
    } catch (e) {
      // Fallback
    }

    return {
      id: appInfo.id,
      name: sanitizeObservationText(appInfo.name),
      title: sanitizeObservationText(appInfo.title)
    };
  }

  /**
   * Retrieves list of currently open windows
   */
  getOpenWindows() {
    const windows = [];

    try {
      if (typeof window === 'undefined' && globalThis.__electronBrowserWindow) {
        const bwList = globalThis.__electronBrowserWindow.getAllWindows() || [];
        bwList.forEach((bw, index) => {
          const bounds = bw.getBounds ? bw.getBounds() : { x: 0, y: 0, width: 1280, height: 800 };
          const title = bw.getTitle ? bw.getTitle() : 'EVO Window';
          const isFocused = bw.isFocused ? bw.isFocused() : index === 0;
          windows.push({
            id: `win_${bw.id || index + 1}`,
            applicationId: 'app_evo_desktop',
            title: sanitizeObservationText(title),
            bounds: {
              x: bounds.x || 0,
              y: bounds.y || 0,
              width: bounds.width || 1280,
              height: bounds.height || 800
            },
            focused: isFocused
          });
        });
      }
    } catch (e) {
      // Fallback
    }

    if (windows.length === 0) {
      const activeApp = this.getActiveApplication();
      windows.push({
        id: 'win_main_1',
        applicationId: activeApp.id,
        title: activeApp.title,
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        focused: true
      });
    }

    return windows;
  }

  /**
   * Retrieves read-only desktop snapshot availability and reference metadata
   * (Does NOT save raw image files to disk by default)
   */
  getDesktopSnapshot() {
    const timestamp = new Date().toISOString();
    const activeApp = this.getActiveApplication();

    return {
      available: true,
      pathOrReference: `ref_desktop_snapshot_${Date.now()}`,
      timestamp,
      resolution: {
        width: 1920,
        height: 1080
      },
      activeApplicationRef: activeApp.id
    };
  }

  /**
   * Retrieves state for a specific application ID
   */
  getApplicationState(applicationId) {
    if (!applicationId || typeof applicationId !== 'string') {
      return {
        applicationId: 'unknown',
        name: 'Unknown Application',
        windows: [],
        status: 'NOT_RUNNING'
      };
    }

    const openWindows = this.getOpenWindows();
    const appWindows = openWindows.filter((w) => w.applicationId === applicationId);
    const isFocused = appWindows.some((w) => w.focused);

    return {
      applicationId,
      name: appWindows.length > 0 ? sanitizeObservationText(appWindows[0].title) : 'Application Process',
      windows: appWindows,
      status: appWindows.length > 0 ? (isFocused ? 'FOCUSED' : 'RUNNING') : 'NOT_RUNNING'
    };
  }

  /**
   * Captures a complete structured read-only desktop observation
   */
  getDesktopObservation(options = {}) {
    if (this.mockObservation) {
      const mockObs = {
        observationId: `obs_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        activeApplication: this.mockObservation.activeApplication || this.getActiveApplication(),
        windows: this.mockObservation.windows || this.getOpenWindows(),
        snapshot: this.mockObservation.snapshot || this.getDesktopSnapshot()
      };
      this.observationHistory.unshift(mockObs);
      return mockObs;
    }

    const timestamp = new Date().toISOString();
    const observationId = `obs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const activeApplication = this.getActiveApplication();
    const windows = this.getOpenWindows();
    const snapshot = this.getDesktopSnapshot();

    const observation = {
      observationId,
      timestamp,
      activeApplication,
      windows,
      snapshot
    };

    if (!validateObservationSchema(observation)) {
      throw new Error('Desktop observation produced an invalid schema structure.');
    }

    this.observationHistory.unshift(observation);
    if (this.observationHistory.length > this.maxHistorySize) {
      this.observationHistory = this.observationHistory.slice(0, this.maxHistorySize);
    }

    if (options.audit !== false) {
      try {
        recordActionEvent({
          objectiveId: options.objectiveId || 'system_desktop_observation',
          tool: 'desktop_observation',
          inputs: { observationId, activeAppId: activeApplication.id },
          outcome: 'SUCCESS',
          verificationResult: { observationId, windowsCount: windows.length },
          durationMs: 5
        });
      } catch (e) {
        // Silently preserve execution if audit store uninitialized
      }
    }

    return observation;
  }

  /**
   * Returns stored observation history
   */
  getObservationHistory() {
    return [...this.observationHistory];
  }
}

export const desktopObservationService = new DesktopObservationService();
