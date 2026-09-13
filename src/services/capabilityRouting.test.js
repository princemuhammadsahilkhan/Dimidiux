if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

import assert from 'assert';
import { extractGoalParameters, matchCapabilities } from './capabilityService.js';
import { planComputerTask } from './computerTaskService.js';
import { getCapabilities, saveCapabilities, CAPABILITY_STATUS } from './capabilityStore.js';

console.log('=== RUNNING EVO CAPABILITY ROUTING REGRESSION SUITE ===');

// Setup mock state for capability store testing
const initialCapabilities = getCapabilities();

try {
  // Test H: "file manager" never produces params.file = "manager"
  console.log('\n--- Test H: extractGoalParameters("file manager") ---');
  const paramsH1 = extractGoalParameters('Open the file manager.');
  console.log('Parameters for "Open the file manager.":', paramsH1);
  assert.strictEqual(paramsH1.file, null, 'file manager MUST NOT set file = "manager"');

  const paramsH2 = extractGoalParameters('launch file manager');
  assert.strictEqual(paramsH2.file, null, 'launch file manager MUST NOT set file = "manager"');

  const paramsH3 = extractGoalParameters('Open file manager, then open browser');
  assert.strictEqual(paramsH3.file, null, 'Open file manager MUST NOT set file = "manager"');

  const paramsH4 = extractGoalParameters('create file notes.txt in folder docs');
  assert.strictEqual(paramsH4.file, 'notes.txt', 'actual file notes.txt MUST be parsed');
  assert.strictEqual(paramsH4.folder, 'docs', 'actual folder docs MUST be parsed');
  console.log('✓ Test H passed: extractGoalParameters does not produce false-positive file="manager".');

  // Seed test capabilities
  const mockCapabilities = [
    {
      id: 'cap_fs_pure',
      name: 'Read and verify manager',
      description: 'Read file manager and verify content',
      status: CAPABILITY_STATUS.VALIDATED,
      evidenceCount: 3,
      sourceExperienceIds: ['exp1'],
      version: 1,
      workflowSteps: [
        { action: { type: 'read_file', path: 'manager' } },
        { action: { type: 'write_file', path: 'output.txt', content: 'verified' } },
        { action: { type: 'create_directory', path: 'logs' } }
      ]
    },
    {
      id: 'cap_comp_single',
      name: 'Launch Firefox browser',
      description: 'Launch Firefox application and verify process',
      status: CAPABILITY_STATUS.VALIDATED,
      evidenceCount: 3,
      sourceExperienceIds: ['exp2'],
      version: 1,
      workflowSteps: [
        { action: { type: 'LAUNCH_APPLICATION', target: 'firefox' } },
        { action: { type: 'VERIFY', target: 'firefox' } }
      ]
    },
    {
      id: 'cap_comp_triple',
      name: 'Launch multi application workflow',
      description: 'Launch Firefox, then VS Code, then File Manager',
      status: CAPABILITY_STATUS.VALIDATED,
      evidenceCount: 3,
      sourceExperienceIds: ['exp3'],
      version: 1,
      workflowSteps: [
        { action: { type: 'LAUNCH_APPLICATION', target: 'firefox' } },
        { action: { type: 'LAUNCH_APPLICATION', target: 'code' } },
        { action: { type: 'LAUNCH_APPLICATION', target: 'thunar' } }
      ]
    },
    {
      id: 'cap_mixed',
      name: 'Launch application and save output file',
      description: 'Launch text editor and write file to directory',
      status: CAPABILITY_STATUS.VALIDATED,
      evidenceCount: 3,
      sourceExperienceIds: ['exp4'],
      version: 1,
      workflowSteps: [
        { action: { type: 'LAUNCH_APPLICATION', target: 'app_text_editor' } },
        { action: { type: 'write_file', path: 'doc.txt', content: 'hello' } }
      ]
    }
  ];

  saveCapabilities(mockCapabilities);

  // Test A: Filesystem capability does NOT match "Open Firefox."
  console.log('\n--- Test A: Filesystem capability vs "Open Firefox." ---');
  const matchA = matchCapabilities('Open Firefox.');
  console.log('Match result for "Open Firefox.":', matchA);
  assert.notStrictEqual(matchA.capabilityId, 'cap_fs_pure', 'Pure filesystem capability MUST NOT match "Open Firefox."');
  console.log('✓ Test A passed.');

  // Test B: Filesystem capability does NOT match "Open the file manager."
  console.log('\n--- Test B: Filesystem capability vs "Open the file manager." ---');
  const matchB = matchCapabilities('Open the file manager.');
  console.log('Match result for "Open the file manager.":', matchB);
  assert.notStrictEqual(matchB.capabilityId, 'cap_fs_pure', 'Pure filesystem capability MUST NOT match "Open the file manager."');
  console.log('✓ Test B passed.');

  // Test C: Filesystem capability does NOT match "Open Firefox, then open VS Code, then open the file manager."
  console.log('\n--- Test C: Filesystem capability vs Multi-app objective ---');
  const matchC = matchCapabilities('Open Firefox, then open VS Code, then open the file manager.');
  console.log('Match result for multi-app prompt:', matchC);
  assert.notStrictEqual(matchC.capabilityId, 'cap_fs_pure', 'Pure filesystem capability MUST NOT match multi-app objective.');
  console.log('✓ Test C passed.');

  // Test D: One-launch capability does NOT match three-application launch objective.
  console.log('\n--- Test D: One-launch capability vs Three-app launch objective ---');
  assert.notStrictEqual(matchC.capabilityId, 'cap_comp_single', 'Single launch capability MUST NOT match three-application objective.');
  console.log('✓ Test D passed.');

  // Test E: Compatible computer capability DOES match equivalent computer objective.
  console.log('\n--- Test E: Compatible computer capability match ---');
  const matchE = matchCapabilities('Launch Firefox application and verify');
  console.log('Match result for equivalent computer goal:', matchE);
  assert.strictEqual(matchE.matched, true, 'Compatible computer capability MUST match equivalent computer goal.');
  assert.strictEqual(matchE.capabilityId, 'cap_comp_single');
  console.log('✓ Test E passed.');

  // Test F: Compatible filesystem capability DOES match equivalent filesystem objective.
  console.log('\n--- Test F: Compatible filesystem capability match ---');
  const matchF = matchCapabilities('create directory logs and write file output.txt');
  console.log('Match result for equivalent filesystem goal:', matchF);
  assert.strictEqual(matchF.matched, true, 'Compatible filesystem capability MUST match equivalent filesystem goal.');
  assert.strictEqual(matchF.capabilityId, 'cap_fs_pure');
  console.log('✓ Test F passed.');

  // Test G: Mixed capability only matches compatible mixed objectives.
  console.log('\n--- Test G: Mixed capability matching ---');
  const matchG_pure_comp = matchCapabilities('Open Firefox application');
  assert.notStrictEqual(matchG_pure_comp.capabilityId, 'cap_mixed', 'Mixed capability MUST NOT match purely computer application launch without file write step.');

  const matchG_mixed = matchCapabilities('Launch text editor and write file doc.txt in folder docs');
  console.log('Match result for mixed goal:', matchG_mixed);
  assert.strictEqual(matchG_mixed.matched, true, 'Mixed capability MUST match compatible mixed goal.');
  assert.strictEqual(matchG_mixed.capabilityId, 'cap_mixed');
  console.log('✓ Test G passed.');

  // Test I: Multi-application objective preserves ordered steps: Firefox -> VS Code -> File Manager
  console.log('\n--- Test I: Multi-application ordered planning ---');
  const multiAppGoal = 'Open Firefox, then open Visual Studio Code, and finally open the file manager.';
  const task = planComputerTask(multiAppGoal);
  const steps = task.steps;
  console.log('Generated plan steps:');
  steps.forEach(s => console.log(` - ${s.type} -> ${s.targetReference?.appName} (${s.targetReference?.applicationId})`));

  const launchSteps = steps.filter(s => s.type === 'LAUNCH_APPLICATION');
  assert.strictEqual(launchSteps.length, 3, 'Multi-app prompt MUST generate exactly 3 LAUNCH_APPLICATION steps');
  assert.ok(launchSteps[0].targetReference.applicationId.includes('firefox'), 'Step 1 MUST be Firefox');
  assert.strictEqual(launchSteps[1].targetReference.applicationId, 'code', 'Step 2 MUST be Visual Studio Code');
  assert.strictEqual(launchSteps[2].targetReference.applicationId, 'thunar', 'Step 3 MUST be File Manager');
  console.log('✓ Test I passed: Exact requested order (Firefox -> VS Code -> File Manager) preserved.');

  console.log('\n=== ALL CAPABILITY ROUTING REGRESSION TESTS PASSED (PASS) ===');
} finally {
  // Restore original state
  saveCapabilities(initialCapabilities);
}
