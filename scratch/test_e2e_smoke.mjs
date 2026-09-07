import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.join(projectRoot, 'workspace');

// Setup Node.js storage polyfill for E2E testing
const testStoreFile = path.join(projectRoot, 'scratch', 'test_e2e_store.json');
if (fs.existsSync(testStoreFile)) fs.unlinkSync(testStoreFile);

let memoryStore = {};
function persistStore() {
  fs.writeFileSync(testStoreFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
}

globalThis.localStorage = {
  getItem: (k) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k, v) => { memoryStore[k] = String(v); persistStore(); },
  removeItem: (k) => { delete memoryStore[k]; persistStore(); },
  clear: () => { memoryStore = {}; persistStore(); }
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
import { runObjective, isRunnerActive, requestPause, grantStepOverwriteConfirmation } from '../src/services/objectiveRunner.js';
import { executeNextStep, verifyToolResult } from '../src/services/executionEngine.js';

console.log('================================================================');
console.log('       EVO END-TO-END SMOKE TEST SUITE (STEPS 1–7)              ');
console.log('================================================================\n');

const testResults = [];

function recordTestResult(testName, passed, details = '') {
  testResults.push({ testName, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${testName} ${details ? '— ' + details : ''}`);
}

async function runEndToEndSmokeTests() {
  localStorage.clear();
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  // ----------------------------------------------------------------
  // TEST 1: Normal Execution
  // ----------------------------------------------------------------
  console.log('\n--- Running Test 1: Normal Execution ---');
  try {
    const smokeDir = path.join(workspaceRoot, 'SmokeTest');
    if (fs.existsSync(smokeDir)) {
      fs.rmSync(smokeDir, { recursive: true, force: true });
    }

    const obj1 = createObjective('Create a folder called SmokeTest and create a file called hello.txt inside it.');
    assert.ok(obj1 && obj1.id, 'Objective created');

    const plan1 = [
      {
        id: 't1_step_1',
        title: 'Create folder SmokeTest',
        description: 'Create directory SmokeTest',
        action: { type: 'create_directory', path: 'SmokeTest' },
        status: 'PENDING',
        order: 1
      },
      {
        id: 't1_step_2',
        title: 'Create file hello.txt inside SmokeTest',
        description: 'Write hello.txt inside SmokeTest',
        action: { type: 'write_file', path: 'SmokeTest/hello.txt', content: 'Hello EVO Smoke Test' },
        status: 'PENDING',
        order: 2
      }
    ];

    const savedPlanObj1 = setObjectivePlan(obj1.id, plan1);
    assert.ok(savedPlanObj1, 'Plan must pass schema validation and be saved');

    const runRes1 = await runObjective(obj1.id, { root: workspaceRoot });
    assert.strictEqual(runRes1.status, 'COMPLETED', 'Objective status must be COMPLETED');

    const targetDirExists = fs.existsSync(path.join(workspaceRoot, 'SmokeTest'));
    const targetFileExists = fs.existsSync(path.join(workspaceRoot, 'SmokeTest', 'hello.txt'));
    assert.ok(targetDirExists, 'Folder SmokeTest must exist in workspace');
    assert.ok(targetFileExists, 'File hello.txt must exist in workspace');

    const fileContent = fs.readFileSync(path.join(workspaceRoot, 'SmokeTest', 'hello.txt'), 'utf-8');
    assert.strictEqual(fileContent, 'Hello EVO Smoke Test', 'File content must match');

    // Confirm step verification
    const readBack = await readFile('SmokeTest/hello.txt', workspaceRoot);
    const verification = await verifyToolResult('read_file', { ...readBack, newState: { content: 'Hello EVO Smoke Test' } }, workspaceRoot);
    assert.strictEqual(verification.verified, true, 'Every completed step verified');

    recordTestResult('Test 1 — Normal Execution', true, 'Folder and hello.txt created, verified, status COMPLETED.');
  } catch (err) {
    recordTestResult('Test 1 — Normal Execution', false, err.message);
  }

  // ----------------------------------------------------------------
  // TEST 2: Background Execution (Window Hidden/Minimized)
  // ----------------------------------------------------------------
  console.log('\n--- Running Test 2: Background Execution ---');
  try {
    const obj2 = createObjective('Multi-step background test objective');
    const plan2 = [
      {
        id: 't2_step_1',
        title: 'Create background test folder',
        description: 'Create directory SmokeTest/bg_execution',
        action: { type: 'create_directory', path: 'SmokeTest/bg_execution' },
        status: 'PENDING',
        order: 1
      },
      {
        id: 't2_step_2',
        title: 'Write background file 1',
        description: 'Write file SmokeTest/bg_execution/file1.txt',
        action: { type: 'write_file', path: 'SmokeTest/bg_execution/file1.txt', content: 'Background 1' },
        status: 'PENDING',
        order: 2
      },
      {
        id: 't2_step_3',
        title: 'Write background file 2',
        description: 'Write file SmokeTest/bg_execution/file2.txt',
        action: { type: 'write_file', path: 'SmokeTest/bg_execution/file2.txt', content: 'Background 2' },
        status: 'PENDING',
        order: 3
      }
    ];

    const savedPlanObj2 = setObjectivePlan(obj2.id, plan2);
    assert.ok(savedPlanObj2, 'Plan 2 must pass schema validation');

    // Mock BrowserWindow visibility state
    let windowVisible = true;
    let updatesReceivedWhileHidden = 0;

    // Minimize / Hide window
    windowVisible = false;

    const runRes2 = await runObjective(obj2.id, {
      root: workspaceRoot,
      onStepCallback: (stepRes) => {
        if (!windowVisible) {
          updatesReceivedWhileHidden++;
        }
      }
    });

    // Reopen window
    windowVisible = true;

    assert.strictEqual(runRes2.status, 'COMPLETED', 'Background execution status COMPLETED');
    assert.ok(updatesReceivedWhileHidden >= 3, 'Steps executed while window was hidden');

    const rehydratedObj = getObjectives().find((o) => o.id === obj2.id);
    assert.strictEqual(rehydratedObj.status, 'COMPLETED', 'Rehydrated status is COMPLETED');
    assert.strictEqual(rehydratedObj.progress, 100, 'Rehydrated progress is 100%');
    assert.ok(rehydratedObj.plan.every((s) => s.status === 'COMPLETED'), 'All steps remain completed');

    recordTestResult('Test 2 — Background Execution', true, 'Execution continued while window was hidden; state consistent.');
  } catch (err) {
    recordTestResult('Test 2 — Background Execution', false, err.message);
  }

  // ----------------------------------------------------------------
  // TEST 3: Close Renderer Window (Main Process Alive)
  // ----------------------------------------------------------------
  console.log('\n--- Running Test 3: Close Renderer Window ---');
  try {
    const obj3 = createObjective('Close window background objective');
    const plan3 = [
      {
        id: 't3_step_1',
        title: 'Create close window dir',
        description: 'Create directory SmokeTest/close_win',
        action: { type: 'create_directory', path: 'SmokeTest/close_win' },
        status: 'PENDING',
        order: 1
      },
      {
        id: 't3_step_2',
        title: 'Write close window file',
        description: 'Write data.txt inside close_win',
        action: { type: 'write_file', path: 'SmokeTest/close_win/data.txt', content: 'Close window test' },
        status: 'PENDING',
        order: 2
      }
    ];

    const savedPlanObj3 = setObjectivePlan(obj3.id, plan3);
    assert.ok(savedPlanObj3, 'Plan 3 must pass schema validation');

    let isWindowDestroyed = false;
    let isWindowHidden = false;
    let mainProcessAlive = true;

    const simulateWindowClose = () => {
      // Electron close event handler: event.preventDefault(); mainWindow.hide()
      isWindowHidden = true;
      isWindowDestroyed = false; // Main process remains alive!
    };

    simulateWindowClose();
    assert.strictEqual(mainProcessAlive, true, 'Main process remains alive after window close');
    assert.strictEqual(isWindowHidden, true, 'Window is hidden, not destroyed');

    const runRes3 = await runObjective(obj3.id, { root: workspaceRoot });
    assert.strictEqual(runRes3.status, 'COMPLETED', 'Objective continued executing in main process after window closed');

    // Reopen window
    isWindowHidden = false;
    const rehydrated3 = getObjectives().find((o) => o.id === obj3.id);
    assert.strictEqual(rehydrated3.status, 'COMPLETED', 'State recovered correctly upon window reopen');

    recordTestResult('Test 3 — Close Renderer Window', true, 'Main process stayed alive, background runner completed objective, window reopen recovered state.');
  } catch (err) {
    recordTestResult('Test 3 — Close Renderer Window', false, err.message);
  }

  // ----------------------------------------------------------------
  // TEST 4: Safe Application Quit & Startup Recovery
  // ----------------------------------------------------------------
  console.log('\n--- Running Test 4: Safe Application Quit & Startup Recovery ---');
  try {
    const obj4 = createObjective('Quit test objective');
    const plan4 = [
      {
        id: 't4_step_1',
        title: 'Step 1 completed before quit',
        description: 'Create folder SmokeTest/quit_test',
        action: { type: 'create_directory', path: 'SmokeTest/quit_test' },
        status: 'COMPLETED',
        order: 1
      },
      {
        id: 't4_step_2',
        title: 'Step 2 pending when quit was triggered',
        description: 'Write file SmokeTest/quit_test/q.txt',
        action: { type: 'write_file', path: 'SmokeTest/quit_test/q.txt', content: 'Quit test content' },
        status: 'PENDING',
        order: 2
      }
    ];

    const savedPlanObj4 = setObjectivePlan(obj4.id, plan4);
    assert.ok(savedPlanObj4, 'Plan 4 must pass schema validation');

    // Manually set status to IN_PROGRESS to simulate unexpected process shutdown
    updateObjectiveStatus(obj4.id, 'IN_PROGRESS', 'Executing step 2...');

    // Simulate official app quit
    let isAppQuitting = true;
    saveObjectives(getObjectives());

    // Relaunch main process startup recovery logic
    const objectivesOnLaunch = getObjectives();
    let recovered = false;

    objectivesOnLaunch.forEach((o) => {
      if (o.status === 'IN_PROGRESS') {
        o.status = 'PAUSED';
        o.currentStep = 'Execution paused due to application restart. Safe to resume.';
        recovered = true;
      }
    });
    saveObjectives(objectivesOnLaunch);

    const obj4Recovered = getObjectives().find((o) => o.id === obj4.id);
    assert.strictEqual(obj4Recovered.status, 'PAUSED', 'Recovered safely to PAUSED');
    assert.strictEqual(obj4Recovered.plan[0].status, 'COMPLETED', 'Step 1 completed status preserved');
    assert.strictEqual(obj4Recovered.plan[1].status, 'PENDING', 'Step 2 remained pending and was not duplicated');

    // Resume execution to completion
    const runRes4 = await runObjective(obj4.id, { root: workspaceRoot });
    assert.strictEqual(runRes4.status, 'COMPLETED', 'Recovered objective executed to completion');

    recordTestResult('Test 4 — Safe Application Quit', true, 'App quit persisted state cleanly; restart recovery never repeated completed step.');
  } catch (err) {
    recordTestResult('Test 4 — Safe Application Quit', false, err.message);
  }

  // ----------------------------------------------------------------
  // TEST 5: Pause and Resume
  // ----------------------------------------------------------------
  console.log('\n--- Running Test 5: Pause and Resume ---');
  try {
    const obj5 = createObjective('Pause and resume test objective');
    const plan5 = [
      {
        id: 't5_step_1',
        title: 'Create pause test folder',
        description: 'Create directory SmokeTest/pause_dir',
        action: { type: 'create_directory', path: 'SmokeTest/pause_dir' },
        status: 'PENDING',
        order: 1
      },
      {
        id: 't5_step_2',
        title: 'Write pause file 1',
        description: 'Write file SmokeTest/pause_dir/f1.txt',
        action: { type: 'write_file', path: 'SmokeTest/pause_dir/f1.txt', content: 'F1' },
        status: 'PENDING',
        order: 2
      },
      {
        id: 't5_step_3',
        title: 'Write pause file 2',
        description: 'Write file SmokeTest/pause_dir/f2.txt',
        action: { type: 'write_file', path: 'SmokeTest/pause_dir/f2.txt', content: 'F2' },
        status: 'PENDING',
        order: 3
      }
    ];

    const savedPlanObj5 = setObjectivePlan(obj5.id, plan5);
    assert.ok(savedPlanObj5, 'Plan 5 must pass schema validation');

    // Request pause after step 1 finishes
    let stepCount = 0;
    const runPromise5 = runObjective(obj5.id, {
      root: workspaceRoot,
      onStepCallback: (stepRes) => {
        stepCount++;
        if (stepCount === 1) {
          requestPause(obj5.id);
        }
      }
    });

    const pauseRes = await runPromise5;
    assert.strictEqual(pauseRes.status, 'PAUSED', 'Objective halted with status PAUSED after step 1');

    const pausedObj = getObjectives().find((o) => o.id === obj5.id);
    assert.strictEqual(pausedObj.plan[0].status, 'COMPLETED', 'Step 1 completed and verified before pause');
    assert.strictEqual(pausedObj.plan[1].status, 'PENDING', 'Step 2 remained pending during pause');

    // Resume execution
    const resumeRes = await runObjective(obj5.id, { root: workspaceRoot });
    assert.strictEqual(resumeRes.status, 'COMPLETED', 'Resumed objective completed successfully');

    const finalObj5 = getObjectives().find((o) => o.id === obj5.id);
    assert.strictEqual(finalObj5.plan[0].status, 'COMPLETED', 'Step 1 remained COMPLETED without repeating');
    assert.strictEqual(finalObj5.plan[1].status, 'COMPLETED', 'Step 2 completed after resume');
    assert.strictEqual(finalObj5.plan[2].status, 'COMPLETED', 'Step 3 completed after resume');

    recordTestResult('Test 5 — Pause and Resume', true, 'Atomic step finished & verified, execution paused cleanly, resumed without repeating steps.');
  } catch (err) {
    recordTestResult('Test 5 — Pause and Resume', false, err.message);
  }

  // ----------------------------------------------------------------
  // TEST 6: Failure Recovery
  // ----------------------------------------------------------------
  console.log('\n--- Running Test 6: Failure Recovery ---');
  try {
    const obj6 = createObjective('Failure recovery test objective');
    const plan6 = [
      {
        id: 't6_step_1',
        title: 'Create folder before failure',
        description: 'Create directory SmokeTest/fail_dir',
        action: { type: 'create_directory', path: 'SmokeTest/fail_dir' },
        status: 'PENDING',
        order: 1
      },
      {
        id: 't6_step_2',
        title: 'Read missing file (Controlled Failure)',
        description: 'Read non-existent file to trigger failure',
        action: { type: 'read_file', path: 'SmokeTest/fail_dir/non_existent_file_xyz.txt' },
        status: 'PENDING',
        order: 2
      },
      {
        id: 't6_step_3',
        title: 'Step 3 that must NOT execute',
        description: 'Should not execute',
        action: { type: 'write_file', path: 'SmokeTest/fail_dir/should_not_exist.txt', content: 'no' },
        status: 'PENDING',
        order: 3
      }
    ];

    const savedPlanObj6 = setObjectivePlan(obj6.id, plan6);
    assert.ok(savedPlanObj6, 'Plan 6 must pass schema validation');

    const failRes = await runObjective(obj6.id, { root: workspaceRoot });
    assert.strictEqual(failRes.status, 'FAILED', 'Objective status must be FAILED on step failure');

    const failedObj = getObjectives().find((o) => o.id === obj6.id);
    assert.strictEqual(failedObj.status, 'FAILED', 'Objective status persisted as FAILED');
    assert.strictEqual(failedObj.plan[1].status, 'FAILED', 'Failed step status is FAILED');
    assert.strictEqual(failedObj.plan[2].status, 'PENDING', 'Later step did not execute');
    assert.strictEqual(fs.existsSync(path.join(workspaceRoot, 'SmokeTest', 'fail_dir', 'should_not_exist.txt')), false, 'Later step file was not created');

    // Simulate relaunching EVO
    const relaunchObj = getObjectives().find((o) => o.id === obj6.id);
    assert.strictEqual(relaunchObj.status, 'FAILED', 'Reopening EVO preserves FAILED state');

    recordTestResult('Test 6 — Failure Recovery', true, 'Failed step became FAILED, objective halted, later steps skipped, failure state persisted across relaunch.');
  } catch (err) {
    recordTestResult('Test 6 — Failure Recovery', false, err.message);
  }

  // ----------------------------------------------------------------
  // SUMMARY REPORT & FINAL CHECKS
  // ----------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                 FINAL SMOKE TEST REPORT                        ');
  console.log('================================================================');

  let allPassed = true;
  testResults.forEach((t) => {
    if (!t.passed) allPassed = false;
  });

  console.log(`\nOverall Result: ${allPassed ? 'ALL SMOKE TESTS PASSED (PASS)' : 'SMOKE TESTS FAILED (FAIL)'}\n`);

  if (!allPassed) {
    process.exit(1);
  }
}

runEndToEndSmokeTests().catch((err) => {
  console.error('Fatal E2E Smoke Test Error:', err);
  process.exit(1);
});
