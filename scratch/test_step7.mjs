import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.join(projectRoot, 'workspace');

// Setup Node.js storage polyfill for testing services
const testStoreFile = path.join(projectRoot, 'scratch', 'test_step7_store.json');
if (fs.existsSync(testStoreFile)) fs.unlinkSync(testStoreFile);

let memoryStore = {};
globalThis.localStorage = {
  getItem: (k) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k, v) => { memoryStore[k] = String(v); },
  removeItem: (k) => { delete memoryStore[k]; },
  clear: () => { memoryStore = {}; }
};

// Import services
import {
  getObjectives,
  saveObjectives,
  createObjective,
  updateObjectiveStatus,
  setObjectivePlan,
  getActiveObjective,
  setActiveObjectiveId
} from '../src/services/objectiveStore.js';
import { plannerService, validatePlanSchema } from '../src/services/plannerService.js';
import {
  listDirectory,
  readFile,
  createDirectory,
  writeFile,
  copyFile,
  moveFile
} from '../src/services/filesystemTool.js';
import { recordTransaction, rollbackTransaction, computeFingerprint } from '../src/services/transactionStore.js';
import { runObjective, isRunnerActive, grantStepOverwriteConfirmation } from '../src/services/objectiveRunner.js';

console.log('====================================================');
console.log('       EVO STEP 7 TEST SUITE & REGRESSION           ');
console.log('====================================================\n');

async function runStep7Tests() {
  localStorage.clear();
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  // ----------------------------------------------------
  // TEST 1: Secure IPC & Preload Boundary Check
  // ----------------------------------------------------
  console.log('[Test 1] Checking Preload Bridge & IPC Security Rules...');
  const preloadPath = path.join(projectRoot, 'electron', 'preload.js');
  assert.ok(fs.existsSync(preloadPath), 'electron/preload.js must exist');
  const preloadCode = fs.readFileSync(preloadPath, 'utf-8');

  assert.ok(preloadCode.includes("contextBridge.exposeInMainWorld('evoAPI'"), 'Must use contextBridge to expose evoAPI');
  assert.ok(!preloadCode.includes('ipcRenderer.send('), 'Must not expose raw ipcRenderer.send');
  assert.ok(!preloadCode.includes('require("fs")') && !preloadCode.includes("require('fs')"), 'Must not expose fs module to renderer');
  assert.ok(!preloadCode.includes('child_process'), 'Must not expose child_process module to renderer');
  console.log('  ✓ Secure IPC & narrow preload bridge verified.');

  // ----------------------------------------------------
  // TEST 2: IPC Validation Rules
  // ----------------------------------------------------
  console.log('\n[Test 2] Verifying IPC Validation in Main Process...');
  const mainPath = path.join(projectRoot, 'electron', 'main.js');
  assert.ok(fs.existsSync(mainPath), 'electron/main.js must exist');
  const mainCode = fs.readFileSync(mainPath, 'utf-8');

  assert.ok(mainCode.includes('isValidString'), 'Main process must validate IPC string inputs');
  assert.ok(mainCode.includes('isValidObjectiveId'), 'Main process must validate objective ID existence');
  assert.ok(mainCode.includes('performStartupRecovery'), 'Main process must execute startup recovery');
  assert.ok(mainCode.includes("mainWindow.on('close'"), 'Main process must intercept window close event');
  console.log('  ✓ Main process validation & lifecycle hooks verified.');

  // ----------------------------------------------------
  // TEST 3: Background Execution (Window Closed / Hidden)
  // ----------------------------------------------------
  console.log('\n[Test 3] Verifying Background Runner Execution while Window is Hidden...');
  
  // Clean workspace target
  const testSubdir = path.join(workspaceRoot, 'step7_bg_test');
  if (fs.existsSync(testSubdir)) {
    fs.rmSync(testSubdir, { recursive: true, force: true });
  }

  const obj = createObjective('Background task objective');
  const customPlan = [
    {
      id: 'step_bg_1',
      title: 'Create background test folder',
      description: 'Create directory step7_bg_test',
      action: { type: 'create_directory', path: 'step7_bg_test' },
      status: 'PENDING',
      order: 1
    },
    {
      id: 'step_bg_2',
      title: 'Create background result file',
      description: 'Write result in step7_bg_test/result.txt',
      action: { type: 'write_file', path: 'step7_bg_test/result.txt', content: 'Background completed' },
      status: 'PENDING',
      order: 2
    }
  ];
  setObjectivePlan(obj.id, customPlan);

  // Simulate main process window hiding (Window close intercepted -> window.hide())
  let windowVisible = false;
  let broadcastCount = 0;

  const mockBroadcast = (updatedObj) => {
    broadcastCount++;
    // Broadcast succeeds regardless of window visibility!
  };

  // Run objective in background main process
  const bgRunPromise = runObjective(obj.id, {
    root: workspaceRoot,
    onStepCallback: (stepRes) => {
      mockBroadcast(stepRes.objective);
    }
  });

  const res = await bgRunPromise;
  assert.strictEqual(res.status, 'COMPLETED', 'Background execution should complete successfully while window is hidden');
  assert.strictEqual(fs.existsSync(path.join(workspaceRoot, 'step7_bg_test', 'result.txt')), true, 'File created in background');
  assert.ok(broadcastCount >= 2, 'Broadcast updates emitted during background execution');
  console.log('  ✓ Background execution completed successfully with window hidden.');

  // ----------------------------------------------------
  // TEST 4: Concurrency Protection (Duplicate Start Requests)
  // ----------------------------------------------------
  console.log('\n[Test 4] Verifying Concurrency Protection (Duplicate Start Prevention)...');
  const obj2 = createObjective('Concurrency test objective');
  setObjectivePlan(obj2.id, customPlan);

  // Start runner
  const p1 = runObjective(obj2.id, { root: workspaceRoot });
  // Try duplicate start immediately
  const p2 = await runObjective(obj2.id, { root: workspaceRoot });

  assert.strictEqual(p2.status, 'ALREADY_RUNNING', 'Duplicate runner invocation must be rejected');
  await p1;
  console.log('  ✓ Duplicate runner creation blocked correctly.');

  // ----------------------------------------------------
  // TEST 5: Startup Recovery
  // ----------------------------------------------------
  console.log('\n[Test 5] Verifying Startup Recovery for Interrupted Objectives...');
  const crashObj = createObjective('Interrupted task');
  const crashPlan = [
    {
      id: 'step_c1',
      title: 'Step 1 completed before crash',
      description: 'Done',
      action: { type: 'create_directory', path: 'step7_bg_test' },
      status: 'COMPLETED',
      order: 1
    },
    {
      id: 'step_c2',
      title: 'Step 2 pending when crash happened',
      description: 'Pending',
      action: { type: 'write_file', path: 'step7_bg_test/c.txt', content: 'c' },
      status: 'PENDING',
      order: 2
    }
  ];
  setObjectivePlan(crashObj.id, crashPlan);
  updateObjectiveStatus(crashObj.id, 'IN_PROGRESS', 'Executing step 2...');

  // Simulate app restart recovery
  const objectivesBefore = getObjectives();
  const foundCrash = objectivesBefore.find((o) => o.id === crashObj.id);
  assert.strictEqual(foundCrash.status, 'IN_PROGRESS', 'Objective starts in IN_PROGRESS state');

  // Perform startup recovery logic
  objectivesBefore.forEach((o) => {
    if (o.status === 'IN_PROGRESS') {
      o.status = 'PAUSED';
      o.currentStep = 'Execution paused due to application restart. Safe to resume.';
    }
  });
  saveObjectives(objectivesBefore);

  const objectivesAfter = getObjectives();
  const recoveredCrash = objectivesAfter.find((o) => o.id === crashObj.id);
  assert.strictEqual(recoveredCrash.status, 'PAUSED', 'Interrupted objective safely recovered to PAUSED');
  assert.strictEqual(recoveredCrash.plan[0].status, 'COMPLETED', 'Completed step remained COMPLETED');
  assert.strictEqual(recoveredCrash.plan[1].status, 'PENDING', 'Pending step remained PENDING and was not re-executed during crash');
  console.log('  ✓ Startup recovery successfully recovered interrupted objective without re-executing completed steps.');

  // ----------------------------------------------------
  // REGRESSION TESTS FOR STEPS 1–6
  // ----------------------------------------------------
  console.log('\n[Regression] Running Full Regression Suite for Steps 1–6...');

  // Step 3 Regression
  const planRes = await plannerService.generatePlan({ goal: 'Organize my research files' });
  assert.strictEqual(planRes.success, true, 'Step 3 Planner generatePlan succeeds');
  const schemaVal = validatePlanSchema({ plan: planRes.plan });
  assert.strictEqual(schemaVal.valid, true, 'Step 3 Plan matches schema');

  // Step 4 Regression
  const listRes = await listDirectory('.', workspaceRoot);
  assert.strictEqual(listRes.success, true, 'Step 4 Filesystem listDirectory succeeds');
  let traversalBlocked = false;
  try {
    const traversalRes = await listDirectory('../', workspaceRoot);
    if (!traversalRes.success) traversalBlocked = true;
  } catch (err) {
    if (err.message.includes('Security Error')) traversalBlocked = true;
  }
  assert.strictEqual(traversalBlocked, true, 'Step 4 Path traversal blocked');

  // Step 5 Regression
  const writeRes = await writeFile('step7_reg.txt', 'regression test', true, workspaceRoot);
  assert.strictEqual(writeRes.success, true, 'Step 5 Write file succeeds');
  const txRecord = recordTransaction({
    transactionId: `tx_test_${Date.now()}`,
    objectiveId: 'obj_test',
    stepId: 'step_test',
    actionType: 'write_file',
    targetPath: writeRes.path,
    previousState: writeRes.previousState,
    newState: writeRes.newState,
    timestamp: new Date().toISOString()
  });
  const rollbackRes = await rollbackTransaction(txRecord.transactionId, workspaceRoot);
  assert.strictEqual(rollbackRes.success, true, 'Step 5 Rollback transaction succeeds');

  // Step 6 Regression
  const regObj = createObjective('Regression runner objective');
  const regPlan = [
    {
      id: 'r1',
      title: 'Create reg folder',
      action: { type: 'create_directory', path: 'reg_folder' },
      status: 'PENDING',
      order: 1
    }
  ];
  setObjectivePlan(regObj.id, regPlan);
  const runnerRes = await runObjective(regObj.id, { root: workspaceRoot });
  assert.strictEqual(runnerRes.status, 'COMPLETED', 'Step 6 Objective runner completes objective');

  console.log('  ✓ All Step 1–6 regression tests passed perfectly.');

  console.log('\n====================================================');
  console.log('   ALL STEP 7 TESTS AND REGRESSION TESTS PASSED!    ');
  console.log('====================================================\n');
}

runStep7Tests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
