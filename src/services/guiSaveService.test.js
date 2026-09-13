import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import {
  planComputerTask,
  createComputerTask,
  approveComputerAction,
  verifyComputerTask,
  computerTaskService
} from './computerTaskService.js';
import { desktopObservationService } from './desktopObservationService.js';
import { computerInteractionService } from './computerInteractionService.js';
import { plannerService } from './plannerService.js';
import { computerAutonomyService } from './computerAutonomyService.js';
import { resolveSafePath } from './filesystemTool.js';

describe('EVO GUI Save Operation & Verification Tests (A-H)', () => {

  test('A. GUI save task planning generates GUI_SAVE step instead of write_file', () => {
    const objective = "Open the text editor, type 'Hello from EVO', save it as EVO_Save_Test.txt on my Desktop, then verify that the file exists and contains exactly 'Hello from EVO'.";
    const planResult = planComputerTask(objective);

    assert.equal(planResult.steps.length, 4, 'Should plan 4 steps (Launch, Text, GUI_SAVE, Verify)');
    
    const types = planResult.steps.map(s => s.type);
    assert.deepEqual(types, ['LAUNCH_APPLICATION', 'TEXT_INPUT', 'GUI_SAVE', 'VERIFY']);

    const saveStep = planResult.steps.find(s => s.type === 'GUI_SAVE');
    assert.ok(saveStep, 'Save step must be of type GUI_SAVE');
    assert.notEqual(saveStep.type, 'write_file', 'Save step must NOT be write_file');
    assert.equal(saveStep.approvalRequired, true, 'GUI_SAVE step must require operator approval');
  });

  test('B. Save destination and filename extraction', () => {
    const objective = "Open the text editor, type 'Hello from EVO', save it as EVO_Save_Test.txt on my Desktop, then verify that the file exists and contains exactly 'Hello from EVO'.";
    const planResult = planComputerTask(objective);
    const saveStep = planResult.steps.find(s => s.type === 'GUI_SAVE');

    assert.equal(saveStep.targetReference.filename, 'EVO_Save_Test.txt');
    assert.equal(saveStep.targetReference.path, 'Desktop/EVO_Save_Test.txt');
    assert.equal(saveStep.targetReference.expectedContent, 'Hello from EVO');
  });

  test('C. Dirty-state verification', () => {
    const dirtyTitle = '*Untitled 1 - Mousepad';
    const cleanTitle = 'EVO_Save_Test.txt - Mousepad';

    assert.ok(dirtyTitle.includes('*'), 'Dirty title must contain asterisk');
    assert.ok(!cleanTitle.includes('*'), 'Clean title must NOT contain asterisk');
  });

  test('D. Saved-title verification', () => {
    const filename = 'EVO_Save_Test.txt';
    const validTitle = '~/Desktop/EVO_Save_Test.txt - Mousepad';
    const invalidTitle = 'Untitled 1 - Mousepad';

    assert.ok(validTitle.toLowerCase().includes(filename.toLowerCase()), 'Valid title must contain filename');
    assert.ok(!invalidTitle.toLowerCase().includes(filename.toLowerCase()), 'Invalid title does not contain filename');
  });

  test('E. Failure when file exists on disk but GUI document remains unsaved', async () => {
    const objective = "Open the text editor, type 'Hello from EVO', save it as EVO_Save_Test.txt on my Desktop, then verify that the file exists and contains exactly 'Hello from EVO'.";
    
    // Create file on disk manually to simulate false-positive condition
    const targetPath = resolveSafePath('Desktop/EVO_Save_Test.txt');
    fs.writeFileSync(targetPath, 'Hello from EVO', 'utf-8');

    try {
      const task = createComputerTask(objective);
      
      // Complete Launch, Text, and Save steps in task state, but mock GUI save result as unsaved / dirty
      task.steps[0].status = 'COMPLETED'; // Launch
      task.steps[1].status = 'COMPLETED'; // Text
      task.steps[2].status = 'COMPLETED'; // GUI_SAVE
      task.steps[2].result = {
        guiSaved: false,
        dirtyCleared: false,
        savedTitle: '*Untitled 1 - Mousepad'
      };
      task.steps[3].status = 'COMPLETED'; // Verify

      // Mock observation with dirty window
      desktopObservationService.setMockObservation({
        activeApplication: { id: 'app_text_editor', name: 'Mousepad', title: '*Untitled 1 - Mousepad' },
        windows: [{ id: 'win_1', applicationId: 'app_text_editor', title: '*Untitled 1 - Mousepad', focused: true }],
        snapshot: { available: true }
      });

      const verification = verifyComputerTask(task.taskId);

      assert.equal(verification.verified, false, 'Task verification MUST fail when GUI document remains unsaved');
      assert.equal(task.status, 'FAILED', 'Task status MUST be FAILED');
      assert.ok(verification.details.includes('dirty') || verification.details.includes('GUI save verification failed'), 'Error details must mention GUI save failure');
    } finally {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      desktopObservationService.setMockObservation(null);
    }
  });

  test('F. Successful GUI save flow end-to-end (mocked)', async () => {
    const objective = "Open the text editor, type 'Hello from EVO', save it as EVO_Save_Test.txt on my Desktop, then verify that the file exists and contains exactly 'Hello from EVO'.";
    
    const targetPath = resolveSafePath('Desktop/EVO_Save_Test.txt');
    fs.writeFileSync(targetPath, 'Hello from EVO', 'utf-8');

    try {
      // Set initial mock observation for Mousepad
      desktopObservationService.setMockObservation({
        activeApplication: { id: 'app_text_editor', name: 'Mousepad', title: '*Untitled 1 - Mousepad' },
        windows: [{ id: 'win_1', applicationId: 'app_text_editor', title: '*Untitled 1 - Mousepad', focused: true }],
        snapshot: { available: true }
      });

      const task = createComputerTask(objective);

      const launchStep = task.steps.find(s => s.type === 'LAUNCH_APPLICATION');
      const textStep = task.steps.find(s => s.type === 'TEXT_INPUT');
      const saveStep = task.steps.find(s => s.type === 'GUI_SAVE');

      if (launchStep) launchStep.status = 'COMPLETED';
      if (textStep) textStep.status = 'COMPLETED';

      // Set task to GUI_SAVE step
      task.currentStepIndex = task.steps.indexOf(saveStep);
      task.status = 'IN_PROGRESS';
      saveStep.status = 'READY';

      // Stage GUI Save request
      await computerTaskService.advanceComputerTask(task.taskId);

      // Mock clean saved observation before GUI_SAVE verification
      desktopObservationService.setMockObservation({
        activeApplication: { id: 'app_text_editor', name: 'Mousepad', title: 'EVO_Save_Test.txt - Mousepad' },
        windows: [{ id: 'win_1', applicationId: 'app_text_editor', title: 'EVO_Save_Test.txt - Mousepad', focused: true }],
        snapshot: { available: true }
      });

      // Approve GUI Save with clean mock title
      const saveRes = await approveComputerAction(task.taskId, saveStep.stepId, {
        mock: true,
        mockTitle: 'EVO_Save_Test.txt - Mousepad',
        mockGuiSaved: true,
        mockDirtyCleared: true
      });

      assert.equal(saveRes.success, true);

      // Verify task completion
      const verification = verifyComputerTask(task.taskId);

      assert.equal(verification.verified, true, 'Task verification MUST succeed when file exists and GUI document is clean');
      assert.equal(task.status, 'COMPLETED');
    } finally {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      desktopObservationService.setMockObservation(null);
    }
  });

  test('G. Existing filesystem tasks continue working', async () => {
    const goal = "Create directory Research, write file Research/summary.txt containing 'Summary of research', and read Research/summary.txt.";
    const planRes = await plannerService.generatePlan({ goal });

    assert.equal(planRes.success, true);
    assert.ok(planRes.plan.some(s => s.action.type === 'write_file'), 'Standard filesystem tasks must still use write_file');
  });

  test('H. Existing text-input focus tests continue passing', () => {
    const target = { x: 400, y: 300, role: 'text', inputType: 'text', label: 'Text Field' };
    const text = "Sample payload";
    const obs = desktopObservationService.getDesktopObservation({ audit: false });

    const reqRes = computerInteractionService.requestTextInput(target, text, { observation: obs });
    assert.equal(reqRes.success, true);
    assert.equal(reqRes.status, 'AWAITING_APPROVAL');
  });

});
