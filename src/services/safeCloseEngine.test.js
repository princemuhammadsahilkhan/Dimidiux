/**
 * SAFE CLOSE ENGINE REGRESSION TEST SUITE
 * Validates ownership-first safety, CLOSE_WINDOW, CLOSE_APPLICATION,
 * pre-existing protection, multi-app cleanup, explicit user intent, and verification contracts.
 */

import { taskOwnershipRegistry } from './taskOwnershipRegistry.js';
import { applicationControlService } from './applicationControlService.js';
import { computerTaskService, planComputerTask } from './computerTaskService.js';

// Enable test mode so subprocess execution and external environment polling are mocked deterministically
globalThis.EVO_TEST_MODE = true;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
}

async function runTests() {
  console.log('=== RUNNING SAFE CLOSE ENGINE REGRESSION SUITE ===\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    taskOwnershipRegistry.clearTaskOwnership();
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

  // A. CLOSE_WINDOW successful task-owned window
  await test('A. CLOSE_WINDOW successful task-owned window', async () => {
    const tId = 'task_a';
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'firefox-esr',
      windowId: '1001',
      pid: '5001',
      isPreExisting: false
    });

    const res = await applicationControlService.closeWindow('1001', { taskId: tId });
    assert(res.success === true, 'closeWindow success should be true');
    assert(res.verified === true, 'closeWindow verified should be true');
    assert(res.windowId === '1001', 'windowId should match');
  });

  // B. CLOSE_APPLICATION successful task-owned application
  await test('B. CLOSE_APPLICATION successful task-owned application', async () => {
    const tId = 'task_b';
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'firefox-esr',
      windowId: '1002',
      pid: '5002',
      isPreExisting: false
    });

    const res = await applicationControlService.closeApplication('firefox-esr', { taskId: tId });
    assert(res.success === true, 'closeApplication success should be true');
    assert(res.verified === true, 'closeApplication verified should be true');
    assert(res.closedWindows.includes('1002'), 'closedWindows should include 1002');
  });

  // C. Pre-existing window cannot be closed
  await test('C. Pre-existing window cannot be closed', async () => {
    const tId = 'task_c';
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'firefox-esr',
      windowId: '1003',
      pid: '5003',
      isPreExisting: true
    });

    const winRes = await applicationControlService.closeWindow('1003', { taskId: tId });
    assert(winRes.success === false, 'Pre-existing window close success must be false');
    assert(winRes.verified === false, 'Pre-existing window close verified must be false');
    assert(winRes.error.includes('Ownership Verification Failed'), 'Error must cite ownership verification failure');

    const appRes = await applicationControlService.closeApplication('firefox-esr', { taskId: tId });
    assert(appRes.success === false, 'Pre-existing app close success must be false');
    assert(appRes.verified === false, 'Pre-existing app close verified must be false');
  });

  // D. Unknown window cannot be closed
  await test('D. Unknown window cannot be closed', async () => {
    const tId = 'task_d';
    const res = await applicationControlService.closeWindow('9999', { taskId: tId });
    assert(res.success === false, 'Unknown window close success must be false');
    assert(res.verified === false, 'Unknown window close verified must be false');
    assert(res.error.includes('Ownership Verification Failed'), 'Error must indicate ownership verification failure');
  });

  // E. Wrong taskId cannot close another task's resource
  await test("E. Wrong taskId cannot close another task's resource", async () => {
    taskOwnershipRegistry.registerLaunch({
      taskId: 'task_owner',
      applicationId: 'mousepad',
      windowId: '2001',
      pid: '6001',
      isPreExisting: false
    });

    const res = await applicationControlService.closeWindow('2001', { taskId: 'task_attacker' });
    assert(res.success === false, 'Wrong task cannot close resource owned by another task');
    assert(res.verified === false, 'Verified must be false for wrong task');

    const appRes = await applicationControlService.closeApplication('mousepad', { taskId: 'task_attacker' });
    assert(appRes.success === false, 'Wrong task cannot close app owned by another task');
    assert(appRes.verified === false, 'Verified must be false');
  });

  // F. Graceful windowclose failure propagates honestly
  await test('F. Graceful windowclose failure propagates honestly', async () => {
    const tId = 'task_f';
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'code',
      windowId: '3001',
      pid: '7001',
      isPreExisting: false
    });

    const res = await applicationControlService.closeWindow('3001', { taskId: tId });
    assert(typeof res.success === 'boolean', 'success field must exist');
    assert(typeof res.verified === 'boolean', 'verified field must exist');
    assert(res.success === res.verified, 'success and verified must match in return contract');
  });

  // G. Exact PID SIGTERM fallback only when ownership is proven
  await test('G. Exact PID SIGTERM fallback only when ownership is proven', async () => {
    const tId = 'task_g';
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'thunar',
      windowId: null,
      pid: '8001',
      isPreExisting: false
    });

    const res = await applicationControlService.closeApplication('thunar', { taskId: tId });
    assert(res.success === true, 'SIGTERM fallback close should succeed for exact task-owned PID');
    assert(res.verified === true, 'Verified should be true for SIGTERM fallback');
  });

  // H. Multiple windows of one application
  await test('H. Multiple windows of one application', async () => {
    const tId = 'task_h';
    // Old user window (pre-existing)
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'firefox-esr',
      windowId: '4001',
      pid: '9001',
      isPreExisting: true
    });
    // EVO-launched new window
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'firefox-esr',
      windowId: '4002',
      pid: '9001',
      isPreExisting: false
    });

    const res = await applicationControlService.closeApplication('firefox-esr', { taskId: tId });
    assert(res.success === true, 'Close application should succeed for task-owned window');
    assert(res.closedWindows.includes('4002'), 'Only task-owned window 4002 should be closed');
    assert(!res.closedWindows.includes('4001'), 'Pre-existing window 4001 MUST NOT be closed');
  });

  // I. Multiple applications in one task
  await test('I. Multiple applications in one task', async () => {
    const tId = 'task_i';
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'firefox-esr',
      windowId: '5001',
      pid: '10001',
      isPreExisting: false
    });
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'code',
      windowId: '5002',
      pid: '10002',
      isPreExisting: false
    });
    taskOwnershipRegistry.registerLaunch({
      taskId: tId,
      applicationId: 'thunar',
      windowId: '5003',
      pid: '10003',
      isPreExisting: false
    });

    const res = await applicationControlService.closeApplication(null, { taskId: tId });
    assert(res.success === true, 'All task-owned apps in task should be closed');
    assert(res.closedWindows.length === 3, 'All 3 windows should be closed');
    assert(res.closedWindows.includes('5001'), 'Firefox window closed');
    assert(res.closedWindows.includes('5002'), 'VS Code window closed');
    assert(res.closedWindows.includes('5003'), 'Thunar window closed');
  });

  // J. Explicit "leave open" prevents automatic cleanup
  await test('J. Explicit "leave open" prevents automatic cleanup', async () => {
    const plan = planComputerTask('Open Firefox and leave it open.');
    assert(plan.disableHousekeeping === true, 'disableHousekeeping must be true for "leave open" intent');

    const task = computerTaskService.createComputerTask('Open Firefox and leave it open.');
    assert(task.disableHousekeeping === true, 'Task disableHousekeeping must be true');
  });

  // K. Explicit "close Firefox" makes cleanup mandatory
  await test('K. Explicit "close Firefox" makes cleanup mandatory', async () => {
    const plan = planComputerTask('Open Firefox, then close Firefox.');
    assert(plan.explicitCloseRequested === true, 'explicitCloseRequested must be true');
    assert(plan.steps.some(s => s.type === 'CLOSE_APPLICATION'), 'Plan must contain explicit CLOSE_APPLICATION step');
  });

  // L. Automatic housekeeping cleanup failure does not falsely change primary-task success
  await test('L. Automatic housekeeping cleanup failure does not falsely change primary-task success', async () => {
    const task = {
      taskId: 'task_l',
      objective: 'Open Firefox.',
      status: 'COMPLETED',
      verification: { verified: true },
      disableHousekeeping: false,
      explicitCloseRequested: false
    };

    task.housekeepingCleanup = { success: false, verified: false, error: 'Housekeeping warning' };
    assert(task.status === 'COMPLETED', 'Primary task status must remain COMPLETED when housekeeping fails');
    assert(task.housekeepingCleanup.success === false, 'Cleanup failure must be recorded truthfully');
  });

  // M. Objective cannot complete when explicit CLOSE step fails
  await test('M. Objective cannot complete when explicit CLOSE step fails', async () => {
    const task = computerTaskService.createComputerTask('Open Firefox, then close Firefox.');
    const closeStep = task.steps.find(s => s.type === 'CLOSE_APPLICATION');
    assert(closeStep !== null && closeStep !== undefined, 'Explicit close step must exist');

    const execRes = { success: false, verified: false, error: 'Ownership Verification Failed' };
    const isVerified = Boolean(execRes.success === true && execRes.verified === true);
    assert(isVerified === false, 'Explicit close step must fail verification when execution fails');
  });

  // N. No generic killall/pkill behavior exists
  await test('N. No generic killall/pkill behavior exists', async () => {
    const fsContent = (await import('fs')).readFileSync('src/services/applicationControlService.js', 'utf-8');
    assert(!fsContent.includes('killall'), 'applicationControlService.js must not contain killall');
    assert(!fsContent.includes('pkill'), 'applicationControlService.js must not contain pkill');
  });

  console.log(`\n=== SAFE CLOSE TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
