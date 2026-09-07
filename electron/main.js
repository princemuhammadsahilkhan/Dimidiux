import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Storage Polyfill for Node.js / Electron Main process
const userDataPath = app ? app.getPath('userData') : '/tmp';
const storeFilePath = path.join(userDataPath, 'evo_storage.json');

let memoryStore = {};
try {
  if (fs.existsSync(storeFilePath)) {
    memoryStore = JSON.parse(fs.readFileSync(storeFilePath, 'utf-8'));
  }
} catch (e) {
  memoryStore = {};
}

function persistStore() {
  try {
    const dir = path.dirname(storeFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storeFilePath, JSON.stringify(memoryStore, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to persist store:', e);
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (key) => (key in memoryStore ? memoryStore[key] : null),
    setItem: (key, val) => {
      memoryStore[key] = String(val);
      persistStore();
    },
    removeItem: (key) => {
      delete memoryStore[key];
      persistStore();
    },
    clear: () => {
      memoryStore = {};
      persistStore();
    }
  };
}

// 2. Import existing modular service modules
import {
  getObjectives,
  saveObjectives,
  createObjective,
  updateObjectiveStatus,
  setObjectivePlan,
  setObjectivePlanningFailed,
  getActiveObjective,
  setActiveObjectiveId
} from '../src/services/objectiveStore.js';
import { plannerService } from '../src/services/plannerService.js';
import {
  runObjective,
  requestPause,
  grantStepOverwriteConfirmation,
  isRunnerActive
} from '../src/services/objectiveRunner.js';
import {
  getMemories,
  archiveMemory,
  restoreMemory
} from '../src/services/memoryStore.js';
import {
  searchMemory,
  recordCorrection
} from '../src/services/memoryService.js';
import {
  getCapabilities,
  getImprovementProposals
} from '../src/services/capabilityStore.js';
import {
  evaluateCapabilityCandidates,
  validateCapability,
  validateAllCapabilityCandidates,
  matchCapabilities,
  reuseCapability,
  proposeCapabilityImprovement,
  validateImprovement,
  applyCapabilityImprovement,
  rollbackCapability,
  getCapabilityVersions
} from '../src/services/capabilityService.js';
import { evolutionService } from '../src/services/evolutionService.js';
import { evaluationService } from '../src/services/evaluationService.js';
import { experimentService } from '../src/services/experimentService.js';
import { backgroundSchedulerService } from '../src/services/backgroundSchedulerService.js';
import { objectiveBudgetService } from '../src/services/objectiveBudgetService.js';
import { getActionEvents, getEventsByObjective, reconstructObjectiveTimeline } from '../src/services/actionEventStore.js';
import { systemToolService } from '../src/services/systemTool.js';
import { objectiveSummaryService } from '../src/services/objectiveSummaryService.js';
import { skillFactoryService } from '../src/services/skillFactoryService.js';

let mainWindow = null;
app.isQuitting = false;

function broadcastObjectiveUpdate(objective) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('objective-updated', objective);
  }
}

// 3. Startup Recovery Logic
function performStartupRecovery() {
  const objectives = getObjectives();
  let modified = false;

  objectives.forEach((obj) => {
    if (obj.status === 'IN_PROGRESS') {
      console.log(`[Startup Recovery] Found interrupted objective "${obj.id}" in state IN_PROGRESS. Recovering safely to PAUSED.`);
      obj.status = 'PAUSED';
      obj.currentStep = 'Execution paused due to application restart. Safe to resume.';
      modified = true;
    }
  });

  if (modified) {
    saveObjectives(objectives);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devServerUrl).catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    const distPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(distPath)) {
      mainWindow.loadFile(distPath);
    } else {
      mainWindow.loadURL(devServerUrl);
    }
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// 4. Strict IPC Input Validation
function isValidString(val, maxLen = 1000) {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

function isValidObjectiveId(id) {
  if (!isValidString(id, 100)) return false;
  const objectives = getObjectives();
  return objectives.some((o) => o.id === id);
}

function setupIpcHandlers() {
  ipcMain.handle('get-objectives', () => {
    return getObjectives();
  });

  ipcMain.handle('get-active-objective', () => {
    return getActiveObjective();
  });

  ipcMain.handle('create-objective', (_event, goalText) => {
    if (!isValidString(goalText, 2000)) {
      throw new Error('Invalid IPC parameter: goalText must be a non-empty string.');
    }
    const newObj = createObjective(goalText);
    broadcastObjectiveUpdate(newObj);
    return newObj;
  });

  ipcMain.handle('set-active-objective-id', (_event, id) => {
    if (id !== null && !isValidObjectiveId(id)) {
      throw new Error('Invalid IPC parameter: objective ID does not exist.');
    }
    setActiveObjectiveId(id);
    const active = getActiveObjective();
    broadcastObjectiveUpdate(active);
    return active;
  });

  ipcMain.handle('generate-plan', async (_event, objectiveId) => {
    if (!isValidObjectiveId(objectiveId)) {
      throw new Error('Invalid IPC parameter: invalid objective ID.');
    }

    const objectives = getObjectives();
    const obj = objectives.find((o) => o.id === objectiveId);
    if (!obj) throw new Error('Objective not found.');

    const planningObj = updateObjectiveStatus(objectiveId, 'PLANNING', 'Generating plan...');
    broadcastObjectiveUpdate(planningObj);

    const result = await evolutionService.createOrPrepareObjectivePlan(objectiveId, obj.goal);

    let finalObj;
    if (result.success) {
      const updatedObjs = getObjectives();
      finalObj = updatedObjs.find((o) => o.id === objectiveId);
    } else {
      finalObj = setObjectivePlanningFailed(objectiveId, result.error);
    }

    broadcastObjectiveUpdate(finalObj);
    return finalObj;
  });

  ipcMain.handle('start-runner', async (_event, objectiveId) => {
    if (!isValidObjectiveId(objectiveId)) {
      throw new Error('Invalid IPC parameter: invalid objective ID.');
    }

    if (isRunnerActive(objectiveId)) {
      console.warn(`[IPC] Runner already active for objective ${objectiveId}. Duplicate request ignored.`);
      return { status: 'ALREADY_RUNNING' };
    }

    runObjective(objectiveId, {
      onStepCallback: (stepRes) => {
        if (stepRes && stepRes.objective) {
          broadcastObjectiveUpdate(stepRes.objective);
        }
      }
    }).then((res) => {
      if (res && res.objective) {
        broadcastObjectiveUpdate(res.objective);
      }
    }).catch((err) => {
      console.error('Runner execution error:', err);
    });

    const active = getActiveObjective();
    broadcastObjectiveUpdate(active);
    return { status: 'STARTED' };
  });

  ipcMain.handle('pause-runner', (_event, objectiveId) => {
    if (!isValidObjectiveId(objectiveId)) {
      throw new Error('Invalid IPC parameter: invalid objective ID.');
    }
    requestPause(objectiveId);
    const updated = updateObjectiveStatus(objectiveId, 'PAUSED', 'Execution pause requested...');
    broadcastObjectiveUpdate(updated);
    return updated;
  });

  ipcMain.handle('confirm-and-continue', async (_event, data) => {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid IPC parameter: missing payload.');
    }
    const { objectiveId, stepId } = data;
    if (!isValidObjectiveId(objectiveId) || !isValidString(stepId, 100)) {
      throw new Error('Invalid IPC parameter: invalid objectiveId or stepId.');
    }

    grantStepOverwriteConfirmation(objectiveId, stepId);

    runObjective(objectiveId, {
      onStepCallback: (stepRes) => {
        if (stepRes && stepRes.objective) {
          broadcastObjectiveUpdate(stepRes.objective);
        }
      }
    });

    const active = getActiveObjective();
    broadcastObjectiveUpdate(active);
    return active;
  });

  ipcMain.handle('retry-planning', async (_event, objectiveId) => {
    if (!isValidObjectiveId(objectiveId)) {
      throw new Error('Invalid IPC parameter: invalid objective ID.');
    }
    const objectives = getObjectives();
    const obj = objectives.find((o) => o.id === objectiveId);
    if (!obj) throw new Error('Objective not found.');

    const planningObj = updateObjectiveStatus(objectiveId, 'PLANNING', 'Generating plan...');
    broadcastObjectiveUpdate(planningObj);

    const result = await plannerService.generatePlan({ goal: obj.goal });
    let finalObj;
    if (result.success) {
      finalObj = setObjectivePlan(objectiveId, result.plan);
    } else {
      finalObj = setObjectivePlanningFailed(objectiveId, result.error);
    }

    broadcastObjectiveUpdate(finalObj);
    return finalObj;
  });

  ipcMain.handle('retry-execution', async (_event, objectiveId) => {
    if (!isValidObjectiveId(objectiveId)) {
      throw new Error('Invalid IPC parameter: invalid objective ID.');
    }
    const objectives = getObjectives();
    const found = objectives.find((o) => o.id === objectiveId);
    if (found && Array.isArray(found.plan)) {
      found.plan.forEach((s) => {
        if (s.status === 'FAILED') s.status = 'PENDING';
      });
      found.status = 'PLANNED';
      found.currentStep = 'Plan ready. Retrying execution...';
      saveObjectives(objectives);
      broadcastObjectiveUpdate(found);

      runObjective(objectiveId, {
        onStepCallback: (stepRes) => {
          if (stepRes && stepRes.objective) {
            broadcastObjectiveUpdate(stepRes.objective);
          }
        }
      });
      return found;
    }
    return null;
  });

  ipcMain.handle('quit-app', () => {
    app.isQuitting = true;
    app.quit();
  });

  // Memory IPC Handlers (Step 8)
  ipcMain.handle('get-memories', () => {
    return getMemories();
  });

  ipcMain.handle('search-memory', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { query, context, maxResults } = payload;
    if (!isValidString(query, 1000)) return [];
    return searchMemory(query, context, maxResults || 5);
  });

  ipcMain.handle('record-correction', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { correctionText, context } = payload;
    if (!isValidString(correctionText, 2000)) {
      throw new Error('Invalid IPC parameter: correctionText must be a non-empty string.');
    }
    return recordCorrection(correctionText, context);
  });

  ipcMain.handle('archive-memory', (_event, id) => {
    if (!isValidString(id, 100)) {
      throw new Error('Invalid IPC parameter: memory ID must be a string.');
    }
    return archiveMemory(id);
  });

  ipcMain.handle('restore-memory', (_event, id) => {
    if (!isValidString(id, 100)) {
      throw new Error('Invalid IPC parameter: memory ID must be a string.');
    }
    return restoreMemory(id);
  });

  // Capability Registry IPC Handlers (Step 9 - Milestones 1, 2 & 3)
  ipcMain.handle('get-capabilities', () => {
    return getCapabilities();
  });

  ipcMain.handle('evaluate-capability-candidates', () => {
    return evaluateCapabilityCandidates();
  });

  ipcMain.handle('validate-capability', (_event, candidateId) => {
    if (!isValidString(candidateId, 100)) {
      throw new Error('Invalid IPC parameter: candidateId must be a valid non-empty string.');
    }
    return validateCapability(candidateId);
  });

  ipcMain.handle('validate-all-capabilities', () => {
    return validateAllCapabilityCandidates();
  });

  ipcMain.handle('match-capabilities', (_event, goalText) => {
    if (!isValidString(goalText, 2000)) {
      return { capabilityId: null, matched: false, confidence: 0, reasons: ['Invalid goalText parameter.'] };
    }
    return matchCapabilities(goalText);
  });

  ipcMain.handle('reuse-capability', async (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { capabilityId, objectiveId, overrideParams } = payload;
    if (!isValidString(capabilityId, 100) || !isValidObjectiveId(objectiveId)) {
      throw new Error('Invalid IPC parameter: invalid capabilityId or objectiveId.');
    }
    const res = await reuseCapability(capabilityId, objectiveId, overrideParams);
    const active = getActiveObjective();
    broadcastObjectiveUpdate(active);
    return res;
  });

  // Capability Improvement & Versioning IPC Handlers (Step 9 - Milestone 4)
  ipcMain.handle('get-capability-versions', (_event, capabilityId) => {
    if (!isValidString(capabilityId, 100)) {
      throw new Error('Invalid IPC parameter: capabilityId must be a valid non-empty string.');
    }
    return getCapabilityVersions(capabilityId);
  });

  ipcMain.handle('get-improvement-proposals', (_event, capabilityId) => {
    if (capabilityId && !isValidString(capabilityId, 100)) {
      throw new Error('Invalid IPC parameter: capabilityId must be a valid string if provided.');
    }
    return getImprovementProposals(capabilityId);
  });

  ipcMain.handle('propose-capability-improvement', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { capabilityId, newWorkflowSteps, reason, evidenceIds } = payload;
    if (!isValidString(capabilityId, 100) || !Array.isArray(newWorkflowSteps)) {
      throw new Error('Invalid IPC parameter: invalid capabilityId or newWorkflowSteps.');
    }
    return proposeCapabilityImprovement(capabilityId, newWorkflowSteps, reason, evidenceIds);
  });

  ipcMain.handle('validate-improvement', (_event, proposalId) => {
    if (!isValidString(proposalId, 100)) {
      throw new Error('Invalid IPC parameter: proposalId must be a valid non-empty string.');
    }
    return validateImprovement(proposalId);
  });

  ipcMain.handle('apply-capability-improvement', (_event, proposalId) => {
    if (!isValidString(proposalId, 100)) {
      throw new Error('Invalid IPC parameter: proposalId must be a valid non-empty string.');
    }
    return applyCapabilityImprovement(proposalId);
  });

  ipcMain.handle('rollback-capability', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { capabilityId, targetVersion } = payload;
    if (!isValidString(capabilityId, 100)) {
      throw new Error('Invalid IPC parameter: invalid capabilityId.');
    }
    return rollbackCapability(capabilityId, targetVersion);
  });

  ipcMain.handle('get-evolution-overview', () => {
    return evolutionService.getEvolutionOverview();
  });

  // Evaluation & Reliability Framework IPC Handlers (Step 9 - Milestone 6)
  ipcMain.handle('get-evaluation-summary', () => {
    return evaluationService.getEvaluationSummary();
  });

  ipcMain.handle('evaluate-objective', (_event, objectiveId) => {
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid non-empty string.');
    }
    return evaluationService.evaluateObjective(objectiveId);
  });

  ipcMain.handle('evaluate-capability', (_event, capabilityId) => {
    if (!isValidString(capabilityId, 100)) {
      throw new Error('Invalid IPC parameter: capabilityId must be a valid non-empty string.');
    }
    return evaluationService.evaluateCapability(capabilityId);
  });

  ipcMain.handle('evaluate-capability-version', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { capabilityId, version } = payload;
    if (!isValidString(capabilityId, 100)) {
      throw new Error('Invalid IPC parameter: capabilityId must be a valid non-empty string.');
    }
    if (typeof version !== 'number' && !isValidString(String(version), 50)) {
      throw new Error('Invalid IPC parameter: version must be valid.');
    }
    return evaluationService.evaluateCapabilityVersion(capabilityId, Number(version));
  });

  // Controlled Experimentation & Benchmarking IPC Handlers (Step 9 - Milestone 7)
  ipcMain.handle('create-experiment', (_event, data) => {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid IPC parameter: data must be an object.');
    }
    return experimentService.createExperiment(data);
  });

  ipcMain.handle('get-experiment', (_event, id) => {
    if (!isValidString(id, 100)) {
      throw new Error('Invalid IPC parameter: id must be a valid non-empty string.');
    }
    return experimentService.getExperiment(id);
  });

  ipcMain.handle('list-experiments', () => {
    return experimentService.listExperiments();
  });

  ipcMain.handle('start-experiment', (_event, id) => {
    if (!isValidString(id, 100)) {
      throw new Error('Invalid IPC parameter: id must be a valid non-empty string.');
    }
    return experimentService.startExperiment(id);
  });

  ipcMain.handle('cancel-experiment', (_event, id) => {
    if (!isValidString(id, 100)) {
      throw new Error('Invalid IPC parameter: id must be a valid non-empty string.');
    }
    return experimentService.cancelExperiment(id);
  });

  ipcMain.handle('get-experiment-summary', (_event, id) => {
    if (!isValidString(id, 100)) {
      throw new Error('Invalid IPC parameter: id must be a valid non-empty string.');
    }
    return experimentService.getExperimentSummary(id);
  });

  ipcMain.handle('compare-experiment-groups', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { experimentId, group1, group2 } = payload;
    if (!isValidString(experimentId, 100) || !isValidString(group1, 50) || !isValidString(group2, 50)) {
      throw new Error('Invalid IPC parameter: invalid experimentId, group1, or group2.');
    }
    return experimentService.compareExperimentGroups(experimentId, group1, group2);
  });

  ipcMain.handle('compare-capability-versions', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { capabilityId, versionA, versionB } = payload;
    if (!isValidString(capabilityId, 100)) {
      throw new Error('Invalid IPC parameter: capabilityId must be a valid non-empty string.');
    }
    return experimentService.compareCapabilityVersions(capabilityId, Number(versionA), Number(versionB));
  });

  // V1 Gap Closure IPC Handlers (Step 10)
  ipcMain.handle('schedule-objective', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { objectiveId, options } = payload;
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid string.');
    }
    return backgroundSchedulerService.scheduleObjective(objectiveId, options);
  });

  ipcMain.handle('grant-background-authorization', (_event, objectiveId) => {
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid string.');
    }
    return backgroundSchedulerService.grantBackgroundAuthorization(objectiveId);
  });

  ipcMain.handle('process-scheduled-tasks', () => {
    return backgroundSchedulerService.processScheduledTasks();
  });

  ipcMain.handle('get-scheduled-tasks', () => {
    return backgroundSchedulerService.getScheduledTasks();
  });

  ipcMain.handle('set-objective-budget', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { objectiveId, budgetConfig } = payload;
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid string.');
    }
    return objectiveBudgetService.setObjectiveBudget(objectiveId, budgetConfig);
  });

  ipcMain.handle('get-objective-budget', (_event, objectiveId) => {
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid string.');
    }
    return objectiveBudgetService.getObjectiveBudget(objectiveId);
  });

  ipcMain.handle('get-action-events', () => {
    return getActionEvents();
  });

  ipcMain.handle('get-events-by-objective', (_event, objectiveId) => {
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid string.');
    }
    return getEventsByObjective(objectiveId);
  });

  ipcMain.handle('reconstruct-objective-timeline', (_event, objectiveId) => {
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid string.');
    }
    return reconstructObjectiveTimeline(objectiveId);
  });

  ipcMain.handle('generate-objective-summary', (_event, objectiveId) => {
    if (!isValidString(objectiveId, 100)) {
      throw new Error('Invalid IPC parameter: objectiveId must be a valid string.');
    }
    return objectiveSummaryService.generateObjectiveSummary(objectiveId);
  });

  ipcMain.handle('run-constrained-command', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { command, args, options } = payload;
    if (!isValidString(command, 100)) {
      throw new Error('Invalid IPC parameter: command must be a valid string.');
    }
    return systemToolService.runConstrainedCommand(command, args || [], options || {});
  });

  ipcMain.handle('get-time', () => {
    return systemToolService.getTime();
  });

  ipcMain.handle('get-system-info', () => {
    return systemToolService.getSystemInfo();
  });

  ipcMain.handle('promote-candidate-skill', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid IPC parameter: payload must be an object.');
    }
    const { candidateId, options } = payload;
    if (!isValidString(candidateId, 100)) {
      throw new Error('Invalid IPC parameter: candidateId must be a valid string.');
    }
    return skillFactoryService.promoteCandidateSkill(candidateId, options || {});
  });
}

app.whenReady().then(() => {
  performStartupRecovery();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (app.isQuitting) {
    app.quit();
  }
});
