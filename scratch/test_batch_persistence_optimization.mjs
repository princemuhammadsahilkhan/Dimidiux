/**
 * Focused Regression Test Suite for Atomic Persistence Batching (Optimization #2)
 *
 * Proves:
 * 1. Objective plan and evolution metadata are both persisted correctly in a single atomic update.
 * 2. Capability ID and exact version remain pinned.
 * 3. executionMode and reusedCapability metadata are correctly captured.
 * 4. Restart/load from storage recovers complete objective state without data loss.
 * 5. Write call count during REUSED_CAPABILITY objective preparation is reduced to 1 (atomic write).
 * 6. Existing objective persistence semantics and function contracts remain intact.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_batch_persistence_storage.json';
if (fs.existsSync(storeFile)) {
  fs.unlinkSync(storeFile);
}
let memoryStore = {};
let setItemCount = 0;

globalThis.localStorage = {
  getItem: (key) => (key in memoryStore ? memoryStore[key] : null),
  setItem: (key, val) => {
    if (key === 'evo_objectives') {
      setItemCount++;
    }
    memoryStore[key] = String(val);
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  removeItem: (key) => {
    delete memoryStore[key];
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  clear: () => {
    memoryStore = {};
    setItemCount = 0;
    if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);
  }
};

import {
  createCapabilityCandidate,
  getCapabilities
} from '../src/services/capabilityStore.js';
import {
  validateCapability
} from '../src/services/capabilityService.js';
import {
  createObjective,
  getObjectives,
  setObjectivePlan,
  setObjectivePlanAndEvolutionMetadata,
  updateObjectiveEvolutionMetadata
} from '../src/services/objectiveStore.js';
import { evolutionService, EXECUTION_MODES } from '../src/services/evolutionService.js';

async function runBatchPersistenceOptimizationTests() {
  console.log('====================================================');
  console.log('ATOMIC PERSISTENCE BATCHING REGRESSION TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`✗ [FAIL] ${message}`);
      failed++;
    }
  }

  // Setup: Create candidate and validate capability
  const candidate = createCapabilityCandidate({
    name: 'Create Folder Batch Notes Capability',
    description: 'Creates folder with notes file and verifies content.',
    sourceExperienceIds: ['exp_batch_1', 'exp_batch_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'BatchFolder' } },
      { action: { type: 'write_file', path: 'BatchFolder/notes.txt', content: 'Batch Notes' } },
      { action: { type: 'read_file', path: 'BatchFolder/notes.txt' } }
    ],
    evidenceCount: 2
  });

  const valRes = validateCapability(candidate.id);
  assert(valRes.success && valRes.capability.status === 'VALIDATED', 'Test capability validated successfully');

  // Test 1: Explicit Capability Pinning Objective Preparation with Atomic Batching
  setItemCount = 0;
  const obj1 = createObjective('Test Goal for Explicit Capability Pinning');
  const countBeforePrepare1 = setItemCount;

  const prepareRes1 = await evolutionService.createOrPrepareObjectivePlan(obj1.id, obj1.goal, {
    explicitCapabilityId: candidate.id,
    explicitCapabilityVersion: 1,
    isExperiment: true
  });

  const writesDuringPrepare1 = setItemCount - countBeforePrepare1;

  assert(prepareRes1.success, 'Objective preparation succeeded for explicit capability');
  assert(writesDuringPrepare1 === 1, `Objective plan and evolution metadata written in exactly ONE atomic write (writes: ${writesDuringPrepare1})`);

  const fetchedObj1 = getObjectives().find((o) => o.id === obj1.id);
  assert(fetchedObj1 !== undefined, 'Objective found in objectiveStore');
  assert(fetchedObj1.status === 'PLANNED', 'Objective status is PLANNED');
  assert(Array.isArray(fetchedObj1.plan) && fetchedObj1.plan.length === 3, 'Objective bound plan has 3 steps');
  assert(fetchedObj1.evolution.capabilityId === candidate.id, 'Capability ID pinned correctly');
  assert(fetchedObj1.evolution.capabilityVersion === 1, 'Capability version pinned correctly');
  assert(fetchedObj1.evolution.executionMode === EXECUTION_MODES.REUSED_CAPABILITY, 'executionMode is REUSED_CAPABILITY');
  assert(fetchedObj1.evolution.reusedCapability === true, 'reusedCapability flag is true');
  assert(fetchedObj1.evolution.isExperiment === true, 'isExperiment flag is true');

  // Test 2: Restart/Reload Simulation (Re-reading from disk/localStorage string)
  const rawStorageData = fs.readFileSync(storeFile, 'utf-8');
  const reloadedStore = JSON.parse(rawStorageData);
  const reloadedObjectives = JSON.parse(reloadedStore['evo_objectives']);
  const reloadedObj1 = reloadedObjectives.find((o) => o.id === obj1.id);

  assert(reloadedObj1 !== undefined, 'Reloaded objective exists in storage');
  assert(reloadedObj1.status === 'PLANNED', 'Reloaded objective status preserved');
  assert(reloadedObj1.plan.length === 3, 'Reloaded objective plan steps preserved without loss');
  assert(reloadedObj1.evolution.capabilityId === candidate.id, 'Reloaded capability ID pinned correctly');
  assert(reloadedObj1.evolution.capabilityVersion === 1, 'Reloaded capability version pinned correctly');

  // Test 3: Automatic Matching Path Objective Preparation with Atomic Batching
  setItemCount = 0;
  const obj2 = createObjective('Create a folder named BatchFolder with notes.txt containing Batch Notes');
  const countBeforePrepare2 = setItemCount;

  const prepareRes2 = await evolutionService.createOrPrepareObjectivePlan(obj2.id, obj2.goal);
  const writesDuringPrepare2 = setItemCount - countBeforePrepare2;

  assert(prepareRes2.success, 'Objective preparation succeeded for automatic capability match');
  assert(writesDuringPrepare2 === 1, `Matched objective plan and evolution metadata written in exactly ONE atomic write (writes: ${writesDuringPrepare2})`);

  const fetchedObj2 = getObjectives().find((o) => o.id === obj2.id);
  assert(fetchedObj2.evolution.capabilityId === candidate.id, 'Matched capability ID recorded correctly');
  assert(fetchedObj2.evolution.matchedConfidence >= 0.7, 'Match confidence recorded correctly');

  // Test 4: Existing API Contracts (setObjectivePlan & updateObjectiveEvolutionMetadata direct calls)
  const obj3 = createObjective('Direct API Test Goal');
  const plan3 = [
    { id: 's1', title: 'Step 1', description: 'Create directory step', action: { type: 'create_directory', path: 'D1' }, status: 'PENDING', order: 1 }
  ];
  setObjectivePlan(obj3.id, plan3);
  const fetchedObj3 = getObjectives().find((o) => o.id === obj3.id);
  assert(fetchedObj3.status === 'PLANNED' && fetchedObj3.plan.length === 1, 'setObjectivePlan backward compatibility preserved');

  setObjectivePlanAndEvolutionMetadata(obj3.id, plan3, { customField: 'testVal' });
  const fetchedObj3Updated = getObjectives().find((o) => o.id === obj3.id);
  assert(fetchedObj3Updated.evolution.customField === 'testVal', 'setObjectivePlanAndEvolutionMetadata atomic update preserved');

  updateObjectiveEvolutionMetadata(obj3.id, { extraMeta: 123 });
  const fetchedObj3Meta = getObjectives().find((o) => o.id === obj3.id);
  assert(fetchedObj3Meta.evolution.extraMeta === 123, 'updateObjectiveEvolutionMetadata backward compatibility preserved');

  console.log('\n----------------------------------------------------');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runBatchPersistenceOptimizationTests().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
