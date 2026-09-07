import fs from 'fs';
import path from 'path';

// Memory Storage Polyfill
const storeFile = '/tmp/evo_test_step9_m6_storage.json';
if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);

let memoryStore = {};
globalThis.localStorage = {
  getItem: (key) => (key in memoryStore ? memoryStore[key] : null),
  setItem: (key, val) => {
    memoryStore[key] = String(val);
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  removeItem: (key) => {
    delete memoryStore[key];
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  clear: () => {
    memoryStore = {};
    if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);
  }
};

import {
  EVALUATION_CONFIG,
  EXECUTION_CATEGORIES,
  EVALUATION_RESULTS
} from '../src/config/evaluationConfig.js';
import {
  getEvaluations,
  saveEvaluations,
  recordEvaluation,
  getEvaluationsByObjective,
  getEvaluationsByCapability,
  validateEvaluationSchema
} from '../src/services/evaluationStore.js';
import { evaluationService } from '../src/services/evaluationService.js';
import {
  saveCapabilities,
  getCapabilities,
  createCapabilityCandidate
} from '../src/services/capabilityStore.js';
import {
  validateCapability,
  matchCapabilities,
  reuseCapability
} from '../src/services/capabilityService.js';
import { createObjective, getObjectives, saveObjectives } from '../src/services/objectiveStore.js';
import { evolutionService } from '../src/services/evolutionService.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ TEST FAILED (${totalTests}): ${message}`);
    throw new Error(`Test ${totalTests}: ${message}`);
  } else {
    passedTests++;
    console.log(`✓ Test ${totalTests}: ${message}`);
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('STARTING STEP 9 — MILESTONE 6 TEST SUITE');
  console.log('==================================================\n');

  localStorage.clear();

  // 1. Evaluation Schema Validation
  console.log('--- Scenario 1: Evaluation Schema Validation ---');
  const validRecord = {
    id: 'eval_1',
    objectiveId: 'obj_1',
    capabilityId: 'cap_1',
    capabilityVersion: 1,
    executionMode: 'NORMAL_PLAN',
    executionCategory: EXECUTION_CATEGORIES.BASELINE,
    goal: 'Test goal',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    success: true,
    failureReason: null,
    stepCount: 2,
    completedStepCount: 2,
    failedStepCount: 0,
    executionDurationMs: 150,
    reusedCapability: false,
    matchedConfidence: null,
    evaluationResult: EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE,
    createdAt: new Date().toISOString()
  };
  const schemaValResult = validateEvaluationSchema(validRecord);
  assert(schemaValResult.valid === true, 'Valid evaluation record passes schema validation.');

  const invalidRecord = { ...validRecord, success: 'not-a-boolean' };
  const invalidValResult = validateEvaluationSchema(invalidRecord);
  assert(invalidValResult.valid === false, 'Invalid record fails schema validation (non-boolean success).');

  // 2. Persistence & Save/Load
  console.log('\n--- Scenario 2: Persistence & Save/Load ---');
  recordEvaluation(validRecord);
  const evalsAfterSave = getEvaluations();
  assert(evalsAfterSave.length === 1, 'Evaluation record persisted successfully.');
  assert(evalsAfterSave[0].id === 'eval_1', 'Persisted record preserves ID.');

  // 3. Successful Evaluation Recording
  console.log('\n--- Scenario 3: Successful Evaluation Recording ---');
  const successObj = {
    id: 'obj_succ_1',
    goal: 'Create report file',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 500).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [
      { id: 's1', status: 'COMPLETED' },
      { id: 's2', status: 'COMPLETED' }
    ],
    evolution: {
      executionMode: 'NORMAL_PLAN',
      capabilityId: null,
      capabilityVersion: null,
      reusedCapability: false,
      matchedConfidence: null
    }
  };
  const succEval = evaluationService.recordObjectiveEvaluation(successObj);
  assert(succEval !== null, 'Objective evaluation recorded.');
  assert(succEval.success === true, 'Recorded evaluation success is true.');
  assert(succEval.failureReason === null, 'Failure reason is null for successful objective.');

  // 4. Failed Evaluation Recording
  console.log('\n--- Scenario 4: Failed Evaluation Recording ---');
  const failObj = {
    id: 'obj_fail_1',
    goal: 'Write corrupted file',
    status: 'FAILED',
    currentStep: 'Write permission denied',
    createdAt: new Date(Date.now() - 300).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [
      { id: 's1', status: 'COMPLETED' },
      { id: 's2', status: 'FAILED' }
    ],
    evolution: {
      executionMode: 'NORMAL_PLAN',
      capabilityId: null,
      capabilityVersion: null,
      reusedCapability: false
    }
  };
  const failEval = evaluationService.recordObjectiveEvaluation(failObj);
  assert(failEval.success === false, 'Recorded evaluation success is false for failed objective.');
  assert(failEval.failureReason === 'Write permission denied', 'Failure reason captured correctly.');

  // 5. BASELINE Classification
  console.log('\n--- Scenario 5: BASELINE Classification ---');
  assert(succEval.executionCategory === EXECUTION_CATEGORIES.BASELINE, 'Non-reused execution classified as BASELINE.');

  // 6. REUSED Classification
  console.log('\n--- Scenario 6: REUSED Classification ---');
  const reusedObj = {
    id: 'obj_reused_1',
    goal: 'Directory summary',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 400).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: {
      executionMode: 'REUSED_CAPABILITY',
      capabilityId: 'cap_dir_list',
      capabilityVersion: 1,
      reusedCapability: true,
      matchedConfidence: 0.95
    }
  };
  const reusedEval = evaluationService.recordObjectiveEvaluation(reusedObj);
  assert(reusedEval.executionCategory === EXECUTION_CATEGORIES.REUSED, 'Reused v1 capability execution classified as REUSED.');

  // 7. IMPROVED_VERSION Classification
  console.log('\n--- Scenario 7: IMPROVED_VERSION Classification ---');
  const v2Obj = {
    id: 'obj_v2_1',
    goal: 'Directory summary v2',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 200).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: {
      executionMode: 'REUSED_CAPABILITY',
      capabilityId: 'cap_dir_list',
      capabilityVersion: 2,
      reusedCapability: true,
      matchedConfidence: 0.98
    }
  };
  const v2Eval = evaluationService.recordObjectiveEvaluation(v2Obj);
  assert(v2Eval.executionCategory === EXECUTION_CATEGORIES.IMPROVED_VERSION, 'Reused v2 capability execution classified as IMPROVED_VERSION.');

  // 8. Version-Specific Metrics & 9. Version-Specific Failure Attribution
  console.log('\n--- Scenarios 8 & 9: Version-Specific Metrics & Failure Attribution ---');
  // Record a failed v2 evaluation
  const v2FailObj = {
    id: 'obj_v2_fail',
    goal: 'Directory summary v2 retry',
    status: 'FAILED',
    currentStep: 'Timeout',
    createdAt: new Date(Date.now() - 600).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'FAILED' }],
    evolution: {
      executionMode: 'REUSED_CAPABILITY',
      capabilityId: 'cap_dir_list',
      capabilityVersion: 2,
      reusedCapability: true
    }
  };
  evaluationService.recordObjectiveEvaluation(v2FailObj);

  const v1Metrics = evaluationService.evaluateCapabilityVersion('cap_dir_list', 1);
  const v2Metrics = evaluationService.evaluateCapabilityVersion('cap_dir_list', 2);

  assert(v1Metrics.usageCount === 1, 'v1 has 1 recorded usage.');
  assert(v1Metrics.versionSuccessRate === 1.0, 'v1 success rate is 100%.');
  assert(v2Metrics.usageCount === 2, 'v2 has 2 recorded usages.');
  assert(v2Metrics.versionSuccessRate === 0.5, 'v2 success rate is 50%.');
  assert(v2Metrics.versionFailureRate === 0.5, 'v2 failure rate is 50%.');

  // 10. v1/v2 Isolation
  console.log('\n--- Scenario 10: v1/v2 Isolation ---');
  const v1Evals = getEvaluationsByCapability('cap_dir_list', 1);
  const v2Evals = getEvaluationsByCapability('cap_dir_list', 2);
  assert(v1Evals.every((e) => e.capabilityVersion === 1), 'v1 evals contain only capabilityVersion 1.');
  assert(v2Evals.every((e) => e.capabilityVersion === 2), 'v2 evals contain only capabilityVersion 2.');

  // 11. ActiveVersion Race Protection
  console.log('\n--- Scenario 11: ActiveVersion Race Protection ---');
  // Setup capability store with activeVersion = 2
  saveCapabilities([
    {
      id: 'cap_race_test',
      name: 'Race Test Cap',
      status: 'VALIDATED',
      version: 2,
      activeVersion: 2,
      versionHistory: [{ version: 1 }, { version: 2 }]
    }
  ]);

  // Objective started when activeVersion was 1 (captured in evolution at start)
  const raceObj = {
    id: 'obj_race_1',
    goal: 'Race condition test objective',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 500).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: {
      executionMode: 'REUSED_CAPABILITY',
      capabilityId: 'cap_race_test',
      capabilityVersion: 1, // Captured at start!
      reusedCapability: true
    }
  };

  // Now activeVersion in cap store is 2, but when objective finishes:
  const raceEval = evaluationService.recordObjectiveEvaluation(raceObj);
  assert(raceEval.capabilityVersion === 1, 'Evaluation remains attributed to v1 captured at start, despite activeVersion being v2.');

  // 12. Insufficient Evidence with One Observation
  console.log('\n--- Scenario 12: Insufficient Evidence with One Observation ---');
  const singleEvalCap = {
    id: 'obj_single_obs',
    goal: 'Single observation test',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 100).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: {
      executionMode: 'REUSED_CAPABILITY',
      capabilityId: 'cap_single_obs',
      capabilityVersion: 1,
      reusedCapability: true
    }
  };
  const singleEvalResult = evaluationService.recordObjectiveEvaluation(singleEvalCap);
  assert(singleEvalResult.evaluationResult === EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE, 'Single observation produces INSUFFICIENT_EVIDENCE.');

  // 13. Sufficient Evidence with at least Two Observations
  console.log('\n--- Scenario 13: Sufficient Evidence with >= 2 Observations ---');
  const secondEvalCap = {
    id: 'obj_second_obs',
    goal: 'Second observation test',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 100).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: {
      executionMode: 'REUSED_CAPABILITY',
      capabilityId: 'cap_single_obs',
      capabilityVersion: 1,
      reusedCapability: true
    }
  };
  const secondEvalResult = evaluationService.recordObjectiveEvaluation(secondEvalCap);
  assert(secondEvalResult.evaluationResult !== EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE, '>= 2 observations produces classified result (STABLE).');

  // 14. Deterministic Improvement Detection
  console.log('\n--- Scenario 14: Deterministic Improvement Detection ---');
  // Baseline group (v1): 2 runs, 1 success (50% success rate)
  const v1ImproveCap = 'cap_improve_test';
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_imp_v1_1',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }, { id: 's2', status: 'COMPLETED' }],
    evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: v1ImproveCap, capabilityVersion: 1, reusedCapability: true }
  });
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_imp_v1_2',
    status: 'FAILED',
    currentStep: 'Failed step 2',
    createdAt: new Date(Date.now() - 900).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }, { id: 's2', status: 'FAILED' }],
    evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: v1ImproveCap, capabilityVersion: 1, reusedCapability: true }
  });

  // v2 group: 2 runs, 2 successes (100% success rate, +50% gain >= 5% min gain)
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_imp_v2_1',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 800).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: v1ImproveCap, capabilityVersion: 2, reusedCapability: true }
  });
  const v2SecondEval = evaluationService.recordObjectiveEvaluation({
    id: 'obj_imp_v2_2',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 700).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: v1ImproveCap, capabilityVersion: 2, reusedCapability: true }
  });

  assert(v2SecondEval.evaluationResult === EVALUATION_RESULTS.IMPROVED, 'v2 with higher success rate classified as IMPROVED.');

  // 15. Deterministic Regression Detection
  console.log('\n--- Scenario 15: Deterministic Regression Detection ---');
  const regCap = 'cap_reg_test';
  // v1: 2 runs, 2 successes (100%)
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_reg_v1_1', status: 'COMPLETED', createdAt: new Date(Date.now() - 1000).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: regCap, capabilityVersion: 1, reusedCapability: true }
  });
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_reg_v1_2', status: 'COMPLETED', createdAt: new Date(Date.now() - 900).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: regCap, capabilityVersion: 1, reusedCapability: true }
  });

  // v2: 2 runs, 2 failures (0% success, drop > 5%)
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_reg_v2_1', status: 'FAILED', currentStep: 'Err', createdAt: new Date(Date.now() - 800).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'FAILED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: regCap, capabilityVersion: 2, reusedCapability: true }
  });
  const v2RegEval = evaluationService.recordObjectiveEvaluation({
    id: 'obj_reg_v2_2', status: 'FAILED', currentStep: 'Err', createdAt: new Date(Date.now() - 700).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'FAILED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: regCap, capabilityVersion: 2, reusedCapability: true }
  });

  assert(v2RegEval.evaluationResult === EVALUATION_RESULTS.REGRESSED, 'v2 with degraded performance classified as REGRESSED.');

  // 16. Stable Classification
  console.log('\n--- Scenario 16: Stable Classification ---');
  const stableCap = 'cap_stable_test';
  // v1: 2 runs, 2 successes
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_stb_v1_1', status: 'COMPLETED', createdAt: new Date(Date.now() - 1000).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: stableCap, capabilityVersion: 1, reusedCapability: true }
  });
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_stb_v1_2', status: 'COMPLETED', createdAt: new Date(Date.now() - 900).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: stableCap, capabilityVersion: 1, reusedCapability: true }
  });

  // v2: 2 runs, 2 successes (identical stats)
  evaluationService.recordObjectiveEvaluation({
    id: 'obj_stb_v2_1', status: 'COMPLETED', createdAt: new Date(Date.now() - 800).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: stableCap, capabilityVersion: 2, reusedCapability: true }
  });
  const v2StbEval = evaluationService.recordObjectiveEvaluation({
    id: 'obj_stb_v2_2', status: 'COMPLETED', createdAt: new Date(Date.now() - 700).toISOString(), updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }], evolution: { executionMode: 'REUSED_CAPABILITY', capabilityId: stableCap, capabilityVersion: 2, reusedCapability: true }
  });

  assert(v2StbEval.evaluationResult === EVALUATION_RESULTS.STABLE, 'v2 with equal performance classified as STABLE.');

  // 17. Duplicate Prevention / Idempotency
  console.log('\n--- Scenario 17: Duplicate Prevention / Idempotency ---');
  const dupObj = {
    id: 'obj_idempotency_test',
    goal: 'Idempotency test objective',
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - 100).toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [{ id: 's1', status: 'COMPLETED' }],
    evolution: { executionMode: 'NORMAL_PLAN', capabilityId: null, capabilityVersion: null, reusedCapability: false }
  };
  const firstCallEval = evaluationService.recordObjectiveEvaluation(dupObj);
  const totalCountBefore = getEvaluations().length;

  const secondCallEval = evaluationService.recordObjectiveEvaluation(dupObj);
  const totalCountAfter = getEvaluations().length;

  assert(firstCallEval.id === secondCallEval.id, 'Repeated evaluation call returns identical record.');
  assert(totalCountBefore === totalCountAfter, 'No duplicate evaluation record added on repeated invocation.');

  // 18. Restart Persistence
  console.log('\n--- Scenario 18: Restart Persistence ---');
  const countBeforeRestart = getEvaluations().length;
  // Simulate app restart by re-reading localStorage directly
  const rawFromStorage = JSON.parse(localStorage.getItem('evo_evaluations') || '[]');
  assert(rawFromStorage.length === countBeforeRestart, 'All evaluation records persist in localStorage across restart.');

  // 19. Capability Summary & 20. Version Summary
  console.log('\n--- Scenarios 19 & 20: Capability & Version Summary ---');
  saveCapabilities([
    {
      id: v1ImproveCap,
      name: 'Improvement Test Capability',
      status: 'VALIDATED',
      version: 2,
      activeVersion: 2,
      versionHistory: [{ version: 1 }, { version: 2 }]
    }
  ]);
  const capSummary = evaluationService.evaluateCapability(v1ImproveCap);
  assert(capSummary.success === true, 'evaluateCapability succeeded.');
  assert(capSummary.capabilityId === v1ImproveCap, 'Capability ID matches.');
  assert(capSummary.overallEvaluationResult === EVALUATION_RESULTS.IMPROVED, 'Overall result shows IMPROVED.');
  assert(capSummary.versionSummaries[1].versionSuccessRate === 0.5, 'v1 version summary success rate is 0.5.');
  assert(capSummary.versionSummaries[2].versionSuccessRate === 1.0, 'v2 version summary success rate is 1.0.');

  // 21. Objective Evaluation
  console.log('\n--- Scenario 21: Objective Evaluation ---');
  const objEvalResult = evaluationService.evaluateObjective('obj_imp_v2_2');
  assert(objEvalResult !== null, 'Objective evaluation returned result.');
  assert(objEvalResult.capabilityId === v1ImproveCap, 'Objective eval contains correct capability ID.');
  assert(objEvalResult.capabilityVersion === 2, 'Objective eval contains correct capability version.');
  assert(objEvalResult.evaluationResult === EVALUATION_RESULTS.IMPROVED, 'Objective eval contains evaluation result.');

  // 22. System Summary
  console.log('\n--- Scenario 22: System Summary ---');
  const sysSummary = evaluationService.getEvaluationSummary();
  assert(sysSummary.totalEvaluations > 0, 'System summary totalEvaluations > 0.');
  assert(sysSummary.successfulEvaluations > 0, 'System summary successfulEvaluations > 0.');
  assert(typeof sysSummary.overallSuccessRate === 'number', 'System summary overallSuccessRate is number.');
  assert(sysSummary.improvementsDetected > 0, 'System summary improvementsDetected > 0.');
  assert(sysSummary.regressionsDetected > 0, 'System summary regressionsDetected > 0.');
  assert(sysSummary.insufficientEvidenceCount > 0, 'System summary insufficientEvidenceCount > 0.');

  // 23. Read-Only Security Boundary
  console.log('\n--- Scenario 23: Read-Only Security Boundary ---');
  const serviceMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(evaluationService));
  const mutatingWords = ['execute', 'activate', 'rollback', 'modify', 'write', 'delete', 'update', 'apply'];
  const suspiciousMethods = serviceMethods.filter((m) =>
    mutatingWords.some((w) => m.toLowerCase().includes(w))
  );
  assert(suspiciousMethods.length === 0, 'evaluationService exposes NO capability/security mutating methods.');

  // 24. IPC Input Validation Test (using evaluationService inputs)
  console.log('\n--- Scenario 44: Input Validation Checks ---');
  const nullObjEval = evaluationService.evaluateObjective('non_existent_objective_id');
  assert(nullObjEval === null, 'Non-existent objective returns null gracefully.');

  const nonExistentCapEval = evaluationService.evaluateCapability('non_existent_cap_id');
  assert(nonExistentCapEval.success === false, 'Non-existent capability returns success: false error.');

  // 25 & 26. Evolution Lifecycle Integration Regression Check
  console.log('\n--- Scenarios 25 & 26: Evolution Lifecycle Integration ---');
  const candidate = createCapabilityCandidate({
    name: 'M6 Integration Test Candidate',
    description: 'Test candidate description',
    workflowSteps: [{ action: 'read_file', path: '/tmp/test_m6.txt' }]
  });
  validateCapability(candidate.id);

  const newObj = createObjective('Test M6 lifecycle integration');
  const evoPrep = await evolutionService.createOrPrepareObjectivePlan(newObj.id, 'Test M6 lifecycle integration');
  assert(evoPrep.success === true, 'evolutionService prepared plan.');

  // Run objective
  newObj.plan = [{ id: 's1', description: 'Read file', action: 'read_file', parameters: { path: '/tmp/test_m6.txt' }, status: 'COMPLETED' }];
  newObj.status = 'COMPLETED';
  saveObjectives([newObj]);

  const autoEval = evolutionService.handleObjectiveCompletion(newObj.id);
  assert(autoEval !== null, 'evolutionService automatically recorded objective evaluation upon completion.');

  console.log('\n==================================================');
  console.log(`ALL ${totalTests} STEP 9 — MILESTONE 6 ASSERTIONS PASSED SUCCESSFULLY!`);
  console.log('==================================================');
}

runTests().catch((err) => {
  console.error('\n❌ STEP 9 — MILESTONE 6 TEST SUITE FAILED:');
  console.error(err);
  process.exit(1);
});
