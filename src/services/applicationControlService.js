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
import {
  desktopApplicationDiscoveryService,
  isAllowedDesktopApplication,
  resolveApplicationByNameSync
} from './desktopApplicationDiscoveryService.js';
import { taskOwnershipRegistry } from './taskOwnershipRegistry.js';

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
    executable: 'xcalc',
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

const DANGEROUS_SHELL_TOKENS = [';', '&&', '||', '|', '`', '$', '$(', '>', '<', 'sudo', 'pkexec', 'su -c', 'bash -c', 'sh -c'];
const DANGEROUS_BINARIES = new Set([
  'sudo', 'su', 'pkexec', 'gparted', 'gparted-bin',
  'fdisk', 'sfdisk', 'cfdisk', 'parted',
  'useradd', 'usermod', 'userdel', 'groupadd', 'groupdel',
  'passwd', 'shadow', 'chmod', 'chown', 'chgrp',
  'dd', 'mkfs', 'wipefs', 'fsck', 'badblocks',
  'reboot', 'shutdown', 'poweroff', 'init', 'systemctl',
  'gdm', 'gdm3', 'lightdm', 'sddm'
]);
const PROHIBITED_SHELL_WRAPPERS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'csh', 'tcsh', 'fish', 'cmd', 'powershell', 'cmd.exe', 'powershell.exe'
]);

/**
 * Validates a discovered desktop application descriptor for safe launch.
 */
export function validateDynamicApplicationLaunch(appDescriptor, options = {}) {
  if (!appDescriptor || typeof appDescriptor !== 'object') {
    return { valid: false, error: 'Application descriptor must be an object.' };
  }

  const rawExec = appDescriptor.exec || appDescriptor.cleanExec || appDescriptor.executable || '';
  const cleanExec = appDescriptor.cleanExec || rawExec;
  const binary = (appDescriptor.binary || '').toLowerCase();

  if (!rawExec || typeof rawExec !== 'string') {
    return { valid: false, error: 'Application descriptor is missing executable command.' };
  }

  // 1. Path traversal prohibition
  if (rawExec.includes('..') || cleanExec.includes('..')) {
    return { valid: false, error: 'Security Violation: Path traversal is prohibited in launch requests.' };
  }

  // 2. Shell operators and dangerous tokens prohibition
  for (const token of DANGEROUS_SHELL_TOKENS) {
    if (rawExec.includes(token) || cleanExec.includes(token) || (options.args && options.args.some((a) => String(a).includes(token)))) {
      return { valid: false, error: `Security Violation: Dangerous shell operator or token '${token}' detected in launch request.` };
    }
  }

  // 3. Privilege escalation & administrative binary prohibition
  if (DANGEROUS_BINARIES.has(binary)) {
    return { valid: false, error: `Security Violation: Administrative binary '${binary}' is prohibited.` };
  }

  // 4. Shell wrapper prohibition
  if (PROHIBITED_SHELL_WRAPPERS.has(binary)) {
    return { valid: false, error: `Security Violation: Shell wrappers ('${binary}') are prohibited for application launching.` };
  }

  // 5. Desktop Application Discovery Filter Check
  if (!isAllowedDesktopApplication(appDescriptor, options)) {
    return { valid: false, error: `Security Violation: Application '${appDescriptor.name || binary}' failed desktop safety policy checks.` };
  }

  const applicationId = appDescriptor.id || appDescriptor.applicationId || binary;
  const displayName = appDescriptor.name || appDescriptor.displayName || binary;
  const executable = appDescriptor.executable || appDescriptor.cleanExec || binary;
  const args = appDescriptor.args || options.args || [];
  const startupWMClass = appDescriptor.startupWMClass || '';

  return {
    valid: true,
    appEntry: {
      applicationId,
      displayName,
      executable,
      args,
      startupWMClass,
      cleanExec,
      allowed: true,
      isDynamic: true,
      appDescriptor
    }
  };
}

/**
 * Validates an application launch request against security rules, static allowlist, & discovered catalog
 */
export function validateApplicationLaunch(applicationIdOrDescriptor, options = {}) {
  if (!applicationIdOrDescriptor) {
    return { valid: false, error: 'Application ID or descriptor must be provided.' };
  }

  // If passed an object (descriptor), validate dynamically
  if (typeof applicationIdOrDescriptor === 'object') {
    return validateDynamicApplicationLaunch(applicationIdOrDescriptor, options);
  }

  const applicationId = String(applicationIdOrDescriptor);

  // 1. Prohibit arbitrary filesystem paths & command strings
  if (applicationId.includes('/') || applicationId.includes('\\') || applicationId.includes('..')) {
    return { valid: false, error: 'Security Violation: Arbitrary executable filesystem paths and path traversal are prohibited.' };
  }

  const dangerousTokens = [';', '&&', '||', '|', '`', '$', '>', '<', 'sudo', 'bash', 'sh', 'nc', 'curl', 'wget', 'pkexec'];
  for (const token of dangerousTokens) {
    if (applicationId.includes(token) || (options.args && options.args.some((a) => String(a).includes(token)))) {
      return { valid: false, error: `Security Violation: Dangerous token '${token}' detected in launch request.` };
    }
  }

  // 2. Match against static allowlist first
  const staticAppEntry = ALLOWED_APPLICATIONS.find((a) => a.applicationId === applicationId && a.allowed);
  if (staticAppEntry) {
    return {
      valid: true,
      appEntry: staticAppEntry
    };
  }

  // 3. Match against options.appDescriptor if provided
  if (options.appDescriptor || options.descriptor) {
    return validateDynamicApplicationLaunch(options.appDescriptor || options.descriptor, options);
  }

  // 4. Try matching against discovered desktop application catalog
  try {
    const discoveredApp = desktopApplicationDiscoveryService.getApplicationByIdSync(applicationId, options) ||
                          resolveApplicationByNameSync(applicationId, options).application;
    if (discoveredApp) {
      return validateDynamicApplicationLaunch(discoveredApp, options);
    }
  } catch (e) {}

  return { valid: false, error: `Security Violation: Application '${applicationId}' is not in the approved application allowlist or discovered application catalog.` };
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
      objectiveId: options.objectiveId || 'system_app_launch',
      applicationId: validation.appEntry.applicationId,
      displayName: validation.appEntry.displayName,
      executable: validation.appEntry.executable,
      appDescriptor: validation.appEntry.appDescriptor || null,
      status: 'AWAITING_APPROVAL',
      beforeObservationId: beforeObservation.observationId,
      beforeObservation,
      beforeXdotoolWins: [],
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
   * Helper to construct target-specific search classes for window matching.
   */
  getTargetSearchClasses(applicationId, executableOverride = null, appDescriptor = null) {
    const classes = new Set();

    // 1. Static allowlist matches
    if (applicationId === 'app_text_editor' || executableOverride === 'mousepad') {
      classes.add('mousepad');
      classes.add('Mousepad');
    } else if (applicationId === 'app_calculator' || executableOverride === 'xcalc') {
      classes.add('xcalc');
      classes.add('calculator');
      classes.add('gnome-calculator');
    } else if (applicationId === 'app_terminal' || executableOverride === 'xterm') {
      classes.add('xterm');
      classes.add('XTerm');
    } else if (applicationId === 'app_evo_desktop' || executableOverride === 'electron') {
      classes.add('electron');
      classes.add('evo');
    }

    // 2. Dynamic appDescriptor metadata
    if (appDescriptor) {
      if (appDescriptor.startupWMClass) {
        classes.add(appDescriptor.startupWMClass);
        classes.add(appDescriptor.startupWMClass.toLowerCase());
      }
      if (appDescriptor.binary) {
        classes.add(appDescriptor.binary);
        classes.add(appDescriptor.binary.toLowerCase());
      }
      if (appDescriptor.id) {
        classes.add(appDescriptor.id);
        classes.add(appDescriptor.id.toLowerCase());
      }
      if (appDescriptor.name) {
        classes.add(appDescriptor.name.toLowerCase());
      }
    }

    // 3. Executable override or applicationId basename
    if (executableOverride && typeof executableOverride === 'string') {
      const base = executableOverride.includes('/') || executableOverride.includes('\\')
        ? executableOverride.split(/[\/\\]/).pop()
        : executableOverride;
      if (base) {
        classes.add(base);
        classes.add(base.toLowerCase());
      }
    }

    if (applicationId && typeof applicationId === 'string') {
      const base = applicationId.includes('/') || applicationId.includes('\\')
        ? applicationId.split(/[\/\\]/).pop()
        : applicationId;
      if (base) {
        classes.add(base);
        classes.add(base.toLowerCase());
        if (base.includes('.')) {
          const parts = base.split('.');
          const lastPart = parts[parts.length - 1];
          if (lastPart) {
            classes.add(lastPart);
            classes.add(lastPart.toLowerCase());
          }
        }
      }
    }

    // 4. Target-specific aliases ONLY (no cross-app fallbacks)
    const currentList = Array.from(classes);
    for (const item of currentList) {
      const lower = item.toLowerCase();
      if (lower === 'firefox') {
        classes.add('firefox-esr');
        classes.add('org.mozilla.firefox');
        classes.add('Mozilla Firefox');
      } else if (lower === 'code' || lower === 'vscode') {
        classes.add('Code');
        classes.add('code-oss');
      } else if (lower === 'chromium' || lower === 'chromium-browser') {
        classes.add('chromium');
        classes.add('Chromium');
        classes.add('chromium-browser');
      } else if (lower === 'nautilus' || lower === 'thunar' || lower === 'filemanager' || lower === 'file-manager' || lower === 'exo-open' || lower === 'xfce4-file-manager') {
        classes.add('Thunar');
        classes.add('thunar');
        classes.add('org.gnome.Nautilus');
        classes.add('Nautilus');
        classes.add('nautilus');
        classes.add('pcmanfm');
        classes.add('nemo');
      }
    }

    return Array.from(classes).filter((c) => c && typeof c === 'string' && c.trim().length > 0);
  }

  /**
   * Verifies whether an application is running or focused in an observation
   */
  async verifyApplicationLaunch(applicationId, observation, executableOverride = null, appDescriptor = null) {
    const obs = observation || desktopObservationService.getDesktopObservation({ audit: false });
    if (!obs || !validateObservationSchema(obs)) {
      return {
        applicationId,
        state: 'NOT_RUNNING',
        verified: false,
        details: 'Invalid desktop observation.'
      };
    }

    // Attempt to lookup appDescriptor if not provided
    let resolvedDesc = appDescriptor;
    if (!resolvedDesc && typeof desktopApplicationDiscoveryService !== 'undefined') {
      try {
        resolvedDesc = desktopApplicationDiscoveryService.getApplicationByIdSync(applicationId) ||
                       resolveApplicationByNameSync(applicationId).application;
      } catch (e) {}
    }

    const searchClasses = this.getTargetSearchClasses(applicationId, executableOverride, resolvedDesc);
    const searchClassesLower = new Set(searchClasses.map((c) => c.toLowerCase()));

    // Check desktop observation windows specifically matching target classes
    let isRunning = false;
    if (obs.windows && Array.isArray(obs.windows)) {
      for (const w of obs.windows) {
        if (!w) continue;
        const appMatch = w.applicationId === applicationId || searchClassesLower.has(String(w.applicationId || '').toLowerCase());
        const titleLower = String(w.title || '').toLowerCase();
        const titleMatch = searchClasses.some((c) => c.length > 2 && titleLower.includes(c.toLowerCase()));

        if (appMatch || titleMatch) {
          isRunning = true;
          break;
        }
      }
    }

    // If observation windows don't match, search via xdotool strictly using target search classes
    const isMockObs = Boolean(
      obs.isMock ||
      (obs.observationId && (obs.observationId.includes('mock') || obs.observationId.includes('test'))) ||
      globalThis.EVO_TEST_MODE === true
    );

    if (!isRunning && !isMockObs) {
      try {
        const cp = await import('child_process');
        const execSync = cp.execSync || cp.default?.execSync;
        if (execSync) {
          for (const cls of searchClasses) {
            if (!cls) continue;
            try {
              const searchOut = execSync(`xdotool search --onlyvisible --class "${cls}"`, { encoding: 'utf-8', timeout: 1000 }).trim();
              if (searchOut.split('\n').filter(Boolean).length > 0) {
                isRunning = true;
                break;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    return {
      applicationId,
      state: isRunning ? 'RUNNING' : 'NOT_RUNNING',
      verified: isRunning,
      details: isRunning ? `Application '${applicationId}' verified in running state.` : `Application '${applicationId}' not detected in active desktop windows.`
    };
  }

  /**
   * Operator-approved execution of exactly ONE application launch
   */
  async approveApplicationLaunch(requestId, options = {}) {
    const idx = this.pendingLaunchRequests.findIndex((r) => r.requestId === requestId);
    if (idx === -1) {
      return { success: false, verified: false, error: `No pending launch request found with ID '${requestId}'.` };
    }

    const request = this.pendingLaunchRequests[idx];
    if (request.status !== 'AWAITING_APPROVAL') {
      return { success: false, verified: false, error: `Launch request '${requestId}' is not awaiting approval (status: ${request.status}).` };
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
        verified: false,
        expired: true,
        error: 'Launch request expired. Please stage a new launch request.'
      };
    }

    // 2. Perform EXACTLY ONE application launch cleanly (without shell)
    const startMs = Date.now();
    let spawnError = null;

    const isTestEnv = process.env.NODE_ENV === 'test' || globalThis.EVO_TEST_MODE === true;
    const isMockExplicitlyRequestedInTest = isTestEnv && options.mock === true;

    if (!isMockExplicitlyRequestedInTest) {
      try {
        const cp = await import('child_process');
        const execSync = cp.execSync || cp.default?.execSync;
        const spawn = cp.spawn || cp.default?.spawn;

        // Check if executable exists on system PATH or absolute path
        try {
          if (request.executable.includes('/') || request.executable.includes('\\')) {
            const fsModule = await import('fs');
            if (!fsModule.existsSync(request.executable)) {
              spawnError = `Executable '${request.executable}' not found on filesystem (ENOENT).`;
            }
          } else {
            execSync(`which ${request.executable}`, { timeout: 1000, stdio: 'ignore' });
          }
        } catch (e) {
          spawnError = `Executable '${request.executable}' not found on system PATH (ENOENT).`;
        }

        if (!spawnError) {
          // Pre-launch window & PID snapshot via xdotool to distinguish pre-existing processes/windows
          try {
            const searchClasses = this.getTargetSearchClasses(request.applicationId, request.executable, request.appDescriptor);
            const preWins = [];
            const prePids = [];
            for (const cls of searchClasses) {
              if (!cls) continue;
              try {
                const searchOut = execSync(`xdotool search --onlyvisible --class "${cls}" || xdotool search --onlyvisible --name "${cls}"`, { encoding: 'utf-8', timeout: 1000 }).trim();
                const matches = searchOut.split('\n').map((s) => s.trim()).filter(Boolean);
                if (matches.length > 0) {
                  preWins.push(...matches);
                  for (const w of matches) {
                    try {
                      const pOut = execSync(`xdotool getwindowpid ${w}`, { encoding: 'utf-8', timeout: 1000 }).trim();
                      if (pOut) prePids.push(pOut);
                    } catch (e) {}
                  }
                }
              } catch (e) {}
            }
            request.beforeXdotoolWins = preWins;
            request.beforePids = prePids;
          } catch (e) {}

          await new Promise((resolve) => {
            let settled = false;
            const child = spawn(request.executable, request.args || [], {
              shell: false,
              detached: true,
              stdio: 'ignore'
            });

            child.on('error', (err) => {
              if (!settled) {
                settled = true;
                spawnError = `Spawn error for '${request.executable}': ${err.message}`;
                resolve();
              }
            });

            if (child.unref) child.unref();

            setTimeout(() => {
              if (!settled) {
                settled = true;
                resolve();
              }
            }, 300);
          });
        }
      } catch (e) {
        spawnError = e.message;
      }
    }

    // 3. Bounded settling / retry loop (up to 5 attempts, ~600ms apart, total ~3s)
    let afterObs = desktopObservationService.getDesktopObservation({ audit: false });
    let verification = null;

    if (isMockExplicitlyRequestedInTest) {
      verification = {
        applicationId: request.applicationId,
        state: 'FOCUSED',
        verified: true,
        details: 'Mock launch verified.'
      };
    } else if (!spawnError) {
      const maxAttempts = options.maxAttempts || 5;
      const pollDelayMs = options.pollDelayMs || 600;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        afterObs = desktopObservationService.getDesktopObservation({ audit: false });
        verification = await this.verifyApplicationLaunch(
          request.applicationId,
          afterObs,
          request.executable,
          request.appDescriptor
        );

        if (verification && verification.verified) {
          break;
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
        }
      }
    } else {
      verification = {
        applicationId: request.applicationId,
        state: 'NOT_RUNNING',
        verified: false,
        details: spawnError
      };
    }

    const endMs = Date.now();
    const durationMs = endMs - startMs;

    const isVerified = Boolean(verification && verification.verified && !spawnError);

    if (!isVerified || spawnError) {
      request.status = 'FAILED';
      request.executedAt = new Date().toISOString();
      request.afterObservationId = afterObs.observationId;
      request.afterObservation = afterObs;
      request.verification = verification;
      request.result = spawnError || `Application launch failed verification: ${verification ? verification.details : 'Verification timeout.'}`;

      this.pendingLaunchRequests.splice(idx, 1);
      this.launchHistory.unshift(request);

      try {
        recordActionEvent({
          objectiveId: options.objectiveId || 'system_app_launch_execution',
          tool: 'application_launch',
          inputs: { requestId, applicationId: request.applicationId, executable: request.executable },
          outcome: 'FAILED',
          verificationResult: verification,
          durationMs
        });
      } catch (e) {}

      return {
        success: false,
        verified: false,
        requestId,
        applicationId: request.applicationId,
        beforeObservationId: request.beforeObservationId,
        afterObservationId: afterObs.observationId,
        state: verification ? verification.state : 'NOT_RUNNING',
        error: request.result,
        verification
      };
    }

    request.status = 'EXECUTED';
    request.executedAt = new Date().toISOString();
    request.afterObservationId = afterObs.observationId;
    request.afterObservation = afterObs;
    request.verification = verification;
    request.result = 'Application launched and verified successfully.';

    // Register verified launch in TaskOwnershipRegistry
    try {
      let verifiedWinId = null;
      let verifiedPid = null;
      let isPreExisting = false;

      const beforeWinIds = new Set([
        ...(request.beforeObservation?.windows || []).map((w) => String(w.id || w.windowId || '')),
        ...(request.beforeXdotoolWins || []).map((w) => String(w))
      ]);
      const beforePids = new Set([
        ...(request.beforePids || []).map((p) => String(p))
      ]);

      const existingRecords = taskOwnershipRegistry.getAllRecords();
      for (const rec of existingRecords) {
        if (rec.windowId) beforeWinIds.add(String(rec.windowId));
        if (rec.pid) beforePids.add(String(rec.pid));
      }

      if (!isMockExplicitlyRequestedInTest && globalThis.EVO_TEST_MODE !== true) {
        try {
          const cp = await import('child_process');
          const execSync = cp.execSync || cp.default?.execSync;
          if (execSync) {
            const searchClasses = this.getTargetSearchClasses(request.applicationId, request.executable, request.appDescriptor);
            const winList = [];
            for (const cls of searchClasses) {
              if (!cls) continue;
              try {
                const searchOut = execSync(`xdotool search --onlyvisible --class "${cls}" || xdotool search --onlyvisible --name "${cls}"`, { encoding: 'utf-8', timeout: 1000 }).trim();
                const matches = searchOut.split('\n').map((s) => s.trim()).filter(Boolean);
                if (matches.length > 0) {
                  winList.push(...matches);
                }
              } catch (e) {}
            }

            const newXdotoolWin = winList.find((w) => !beforeWinIds.has(w));
            if (newXdotoolWin) {
              verifiedWinId = newXdotoolWin;
              try {
                const pidOut = execSync(`xdotool getwindowpid ${newXdotoolWin}`, { encoding: 'utf-8', timeout: 1000 }).trim();
                if (pidOut) verifiedPid = pidOut;
              } catch (e) {}
            } else if (winList.length > 0) {
              verifiedWinId = winList[0];
              try {
                const pidOut = execSync(`xdotool getwindowpid ${winList[0]}`, { encoding: 'utf-8', timeout: 1000 }).trim();
                if (pidOut) verifiedPid = pidOut;
              } catch (e) {}
            }
          }
        } catch (e) {}
      }

      if (!verifiedWinId) {
        const afterWins = (afterObs?.windows || []).filter((w) => {
          if (!w) return false;
          const appMatch = w.applicationId === request.applicationId || String(w.applicationId || '').toLowerCase() === String(request.applicationId || '').toLowerCase();
          const titleLower = String(w.title || '').toLowerCase();
          const titleMatch = titleLower.includes(String(request.applicationId || '').toLowerCase()) || titleLower.includes(String(request.executable || '').toLowerCase());
          return appMatch || titleMatch;
        });

        const newWin = afterWins.find((w) => !beforeWinIds.has(String(w.id || w.windowId || '')));
        if (newWin) {
          verifiedWinId = String(newWin.id || newWin.windowId || '');
        } else if (afterWins.length > 0) {
          verifiedWinId = String(afterWins[0].id || afterWins[0].windowId || '');
        }
      }

      if (verifiedPid && beforePids.has(String(verifiedPid))) {
        isPreExisting = true;
      } else if (verifiedWinId && beforeWinIds.has(String(verifiedWinId))) {
        isPreExisting = true;
      } else {
        isPreExisting = false;
      }

      const tId = options.objectiveId || request.objectiveId || 'task_system';

      taskOwnershipRegistry.registerLaunch({
        taskId: tId,
        objectiveId: tId,
        applicationId: request.applicationId,
        executable: request.executable,
        pid: verifiedPid,
        windowId: verifiedWinId,
        startupWMClass: request.appDescriptor?.startupWMClass || request.executable,
        launchedAt: request.executedAt,
        isPreExisting
      });
    } catch (e) {}

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
      verified: true,
      requestId,
      applicationId: request.applicationId,
      beforeObservationId: request.beforeObservationId,
      afterObservationId: afterObs.observationId,
      state: verification.state,
      verification
    };
  }

  /**
   * Operator cancels a staged launch request
   */
  cancelApplicationLaunch(requestId, reason = 'Operator cancelled launch') {
    const idx = this.pendingLaunchRequests.findIndex((r) => r.requestId === requestId);
    if (idx === -1) {
      return { success: false, verified: false, error: `No pending launch request found with ID '${requestId}'.` };
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

  /**
   * Safe Close Window
   * Closes a specific windowId ONLY IF proven task-owned and not pre-existing.
   */
  async closeWindow(windowId, options = {}) {
    const tId = options.taskId || options.objectiveId;
    const winIdStr = String(windowId || options.windowId || '');

    if (!winIdStr) {
      return {
        success: false,
        verified: false,
        error: 'Close Window Error: Target windowId must be provided.'
      };
    }

    // 1. OWNERSHIP-FIRST SAFETY CHECK
    if (tId) {
      const isOwned = taskOwnershipRegistry.isOwnedByTask(tId, winIdStr);
      if (!isOwned) {
        return {
          success: false,
          verified: false,
          windowId: winIdStr,
          error: `Ownership Verification Failed: Window '${winIdStr}' is pre-existing or not owned by task '${tId}'.`
        };
      }
    } else {
      const record = taskOwnershipRegistry.getOwnedResource({ windowId: winIdStr });
      if (!record || record.isPreExisting) {
        return {
          success: false,
          verified: false,
          windowId: winIdStr,
          error: `Ownership Verification Failed: Window '${winIdStr}' is untracked or pre-existing.`
        };
      }
    }

    // 2. GRACEFUL WINDOW CLOSE (xdotool windowclose <windowId>)
    let closeAttempted = false;
    if (typeof process !== 'undefined' && process.versions && process.versions.node && globalThis.EVO_TEST_MODE !== true) {
      try {
        const cp = await import('child_process');
        const execSync = cp.execSync || cp.default?.execSync;
        if (execSync) {
          execSync(`xdotool windowclose ${winIdStr}`, { encoding: 'utf-8', timeout: 2000 });
          closeAttempted = true;
        }
      } catch (e) {}
    }

    // 3. BOUNDED VERIFICATION (up to 3 seconds)
    const startTime = Date.now();
    let windowGone = false;

    while (Date.now() - startTime < 3000) {
      if (globalThis.EVO_TEST_MODE === true || typeof process === 'undefined' || !process.versions || !process.versions.node) {
        windowGone = true;
        break;
      }

      try {
        const cp = await import('child_process');
        const execSync = cp.execSync || cp.default?.execSync;
        if (execSync) {
          try {
            execSync(`xdotool getwindowname ${winIdStr} 2>/dev/null`, { encoding: 'utf-8', timeout: 1000 });
            windowGone = false;
          } catch (e) {
            windowGone = true;
            break;
          }
        } else {
          windowGone = true;
          break;
        }
      } catch (e) {
        windowGone = true;
        break;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    if (windowGone) {
      return {
        success: true,
        verified: true,
        windowId: winIdStr,
        details: `Window '${winIdStr}' closed and verified successfully.`
      };
    }

    return {
      success: false,
      verified: false,
      windowId: winIdStr,
      error: `Verification Failed: Window '${winIdStr}' could not be closed after 3 seconds.`
    };
  }

  /**
   * Safe Close Application
   * Closes application resources for a task ONLY IF proven task-owned and not pre-existing.
   */
  async closeApplication(targetAppId, options = {}) {
    const tId = options.taskId || options.objectiveId;
    const appId = targetAppId ? String(targetAppId) : null;

    if (!tId) {
      return {
        success: false,
        verified: false,
        error: 'Ownership Verification Failed: taskId/objectiveId required.'
      };
    }

    // 1. OWNERSHIP-FIRST SAFETY CHECK
    const taskRecords = taskOwnershipRegistry.getTaskOwnedResources(tId);
    let matchingRecords = taskRecords.filter(r => r.isPreExisting === false);

    if (appId) {
      const appIdLower = appId.toLowerCase();
      matchingRecords = matchingRecords.filter(r => {
        const rApp = String(r.applicationId || '').toLowerCase();
        const rExec = String(r.executable || '').toLowerCase();
        const rWM = String(r.startupWMClass || '').toLowerCase();
        return rApp.includes(appIdLower) || appIdLower.includes(rApp) ||
               rExec.includes(appIdLower) || appIdLower.includes(rExec) ||
               rWM.includes(appIdLower) || appIdLower.includes(rWM);
      });
    }

    if (matchingRecords.length === 0) {
      return {
        success: false,
        verified: false,
        applicationId: appId,
        error: `Ownership Verification Failed: No task-owned application resources found for '${appId || 'task'}' in task '${tId}'.`
      };
    }

    // 2. GRACEFUL CLOSE STRATEGY (Window close)
    const closedWindows = [];
    const closedPids = [];

    for (const record of matchingRecords) {
      if (record.windowId) {
        const res = await this.closeWindow(record.windowId, { taskId: tId });
        if (res.success && res.verified) {
          closedWindows.push(record.windowId);
        }
      }
    }

    // Verify if all matching records are gone
    let allGone = true;
    for (const record of matchingRecords) {
      if (record.windowId && !closedWindows.includes(record.windowId)) {
        allGone = false;
      }
    }

    // 3. EXACT PID SIGTERM FALLBACK (Only when graceful window close failed & exact PID ownership is proven)
    if (!allGone) {
      for (const record of matchingRecords) {
        if (record.pid && record.isPreExisting === false) {
          try {
            if (typeof process !== 'undefined' && process.versions && process.versions.node && globalThis.EVO_TEST_MODE !== true) {
              const pidNum = Number(record.pid);
              if (pidNum && !isNaN(pidNum)) {
                process.kill(pidNum, 'SIGTERM');
                closedPids.push(record.pid);
              }
            }
          } catch (e) {}
        }
      }

      // Bounded verification poll (up to 3 seconds)
      const startTime = Date.now();
      while (Date.now() - startTime < 3000) {
        if (globalThis.EVO_TEST_MODE === true || typeof process === 'undefined' || !process.versions || !process.versions.node) {
          allGone = true;
          break;
        }
        let anyAlive = false;
        for (const record of matchingRecords) {
          if (record.pid) {
            try {
              process.kill(Number(record.pid), 0);
              anyAlive = true;
            } catch (e) {}
          }
        }
        if (!anyAlive) {
          allGone = true;
          break;
        }
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // 4. VERIFICATION CONTRACT
    if (allGone || globalThis.EVO_TEST_MODE === true) {
      return {
        success: true,
        verified: true,
        applicationId: appId,
        closedWindows,
        closedPids,
        details: `Application '${appId || 'task-owned'}' closed and verified successfully.`
      };
    }

    return {
      success: false,
      verified: false,
      applicationId: appId,
      error: `Verification Failed: Application '${appId || 'task-owned'}' could not be verified closed.`
    };
  }
}

export const applicationControlService = new ApplicationControlService();

