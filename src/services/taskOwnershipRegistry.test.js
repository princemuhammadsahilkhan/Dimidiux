import assert from 'assert';
import { TaskOwnershipRegistry, taskOwnershipRegistry } from './taskOwnershipRegistry.js';
import { applicationControlService } from './applicationControlService.js';

console.log('=== RUNNING TASK OWNERSHIP REGRESSION SUITE ===');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  const reg = new TaskOwnershipRegistry();

  // Test A: New application launch -> ownership recorded
  test('A. New application launch -> ownership recorded', () => {
    reg.clearTaskOwnership();
    const entry = reg.registerLaunch({
      taskId: 'task_100',
      objectiveId: 'obj_100',
      applicationId: 'firefox',
      executable: 'firefox-esr',
      pid: '12345',
      windowId: '0x100001',
      isPreExisting: false
    });

    assert.ok(entry, 'Entry must be created');
    assert.strictEqual(entry.taskId, 'task_100');
    assert.strictEqual(entry.applicationId, 'firefox');
    assert.strictEqual(entry.pid, '12345');
    assert.strictEqual(entry.windowId, '0x100001');
    assert.strictEqual(entry.isPreExisting, false);

    const resources = reg.getTaskOwnedResources('task_100');
    assert.strictEqual(resources.length, 1);
  });

  // Test B: Existing application/window before task -> isPreExisting=true / not task-owned
  test('B. Existing application/window before task -> isPreExisting=true / not task-owned', () => {
    reg.clearTaskOwnership();
    const entry = reg.markPreExisting({
      taskId: 'task_101',
      applicationId: 'firefox',
      executable: 'firefox-esr',
      pid: '9999',
      windowId: '0x999999'
    });

    assert.strictEqual(entry.isPreExisting, true);
    assert.strictEqual(reg.isOwnedByTask('task_101', '0x999999'), false, 'Pre-existing resource MUST NOT be considered task-owned');
  });

  // Test C: New process + new window -> task-owned
  test('C. New process + new window -> task-owned', () => {
    reg.clearTaskOwnership();
    reg.registerLaunch({
      taskId: 'task_102',
      applicationId: 'code',
      pid: '54321',
      windowId: '0x200002',
      isPreExisting: false
    });

    assert.strictEqual(reg.isOwnedByTask('task_102', '0x200002'), true);
    assert.strictEqual(reg.isOwnedByTask('task_102', '54321'), true);
    assert.strictEqual(reg.isOwnedByTask('task_102', 'code'), true);
  });

  // Test D: Launch failure -> no task-owned record
  test('D. Launch failure -> no task-owned record', () => {
    taskOwnershipRegistry.clearTaskOwnership();
    // Simulate failed launch request in applicationControlService
    const req = applicationControlService.requestApplicationLaunch('nonexistent_app_xyz_123', { objectiveId: 'task_fail' });
    const histBefore = taskOwnershipRegistry.getTaskOwnedResources('task_fail').length;

    assert.strictEqual(req.success, false);
    const histAfter = taskOwnershipRegistry.getTaskOwnedResources('task_fail').length;
    assert.strictEqual(histBefore, 0);
    assert.strictEqual(histAfter, 0, 'Failed launch MUST NOT register task ownership');
  });

  // Test E: Multiple apps in one task -> each resource tracked independently
  test('E. Multiple apps in one task -> each resource tracked independently', () => {
    reg.clearTaskOwnership();
    reg.registerLaunch({ taskId: 'task_multi', applicationId: 'firefox', pid: '1001', windowId: '0x1', isPreExisting: false });
    reg.registerLaunch({ taskId: 'task_multi', applicationId: 'code', pid: '1002', windowId: '0x2', isPreExisting: false });
    reg.registerLaunch({ taskId: 'task_multi', applicationId: 'thunar', pid: '1003', windowId: '0x3', isPreExisting: false });

    const list = reg.getTaskOwnedResources('task_multi');
    assert.strictEqual(list.length, 3);
    assert.strictEqual(reg.isOwnedByTask('task_multi', '0x1'), true);
    assert.strictEqual(reg.isOwnedByTask('task_multi', '0x2'), true);
    assert.strictEqual(reg.isOwnedByTask('task_multi', '0x3'), true);
  });

  // Test F: Same app launched twice -> distinguish windows/processes correctly
  test('F. Same app launched twice -> distinguish windows/processes correctly', () => {
    reg.clearTaskOwnership();
    const e1 = reg.registerLaunch({ taskId: 'task_dup', applicationId: 'firefox', pid: '2001', windowId: '0x201', isPreExisting: false });
    const e2 = reg.registerLaunch({ taskId: 'task_dup', applicationId: 'firefox', pid: '2002', windowId: '0x202', isPreExisting: false });

    assert.notStrictEqual(e1.id, e2.id);
    assert.strictEqual(reg.isOwnedByTask('task_dup', '0x201'), true);
    assert.strictEqual(reg.isOwnedByTask('task_dup', '0x202'), true);
    assert.strictEqual(reg.isOwnedByTask('task_dup', '0x999'), false);
  });

  // Test G: Query by taskId/objectiveId works
  test('G. Query by taskId/objectiveId works', () => {
    reg.clearTaskOwnership();
    reg.registerLaunch({ taskId: 'task_query', objectiveId: 'obj_query', applicationId: 'calculator', pid: '777', isPreExisting: false });

    const res1 = reg.getTaskOwnedResources('task_query');
    const res2 = reg.getTaskOwnedResources('obj_query');
    assert.strictEqual(res1.length, 1);
    assert.strictEqual(res2.length, 1);
    assert.strictEqual(res1[0].applicationId, 'calculator');
  });

  // Test H: releaseTaskOwnership() removes only that task's ownership data
  test('H. releaseTaskOwnership() removes only that task\'s ownership data', () => {
    reg.clearTaskOwnership();
    reg.registerLaunch({ taskId: 'task_A', applicationId: 'appA', isPreExisting: false });
    reg.registerLaunch({ taskId: 'task_B', applicationId: 'appB', isPreExisting: false });

    const removed = reg.releaseTaskOwnership('task_A');
    assert.strictEqual(removed, 1);
    assert.strictEqual(reg.getTaskOwnedResources('task_A').length, 0);
    assert.strictEqual(reg.getTaskOwnedResources('task_B').length, 1);
  });

  // Test I: Unknown/untracked window cannot be considered task-owned
  test('I. Unknown/untracked window cannot be considered task-owned', () => {
    reg.clearTaskOwnership();
    reg.registerLaunch({ taskId: 'task_known', applicationId: 'appKnown', windowId: '0xKNOWN', isPreExisting: false });

    assert.strictEqual(reg.isOwnedByTask('task_known', '0xUNKNOWN_RANDOM_WIN'), false);
  });

  console.log(`\n=== TASK OWNERSHIP TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

runTests();
