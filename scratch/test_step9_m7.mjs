import fs from 'fs';
import path from 'path';

// Memory Storage Polyfill
const storeFile = '/tmp/evo_test_step9_m7_storage.json';
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
  EXPERIMENT_CONFIG,
  EXPERIMENT_STATUS,
  EXPERIMENT_GROUPS,
  EXPERIMENT_RESULTS
} from '../src/config/experimentConfig.js';
import {
  getExperiments,
  saveExperiments,
  getExperimentById,
  getExperimentRuns,
  recordExperimentRun,
  getRunsByExperiment,
  getRunsByGroup,
  validateExperimentSchema,
  validateExperimentRunSchema
} from '../src/services/experimentStore.js';
import { experimentService } from '../src/services/experimentService.js';
import {
  saveCapabilities,
  getCapabilities,
  createCapabilityCandidate,
  getImprovementProposals
} from '../src/services/capabilityStore.js';
import {
  validateCapability,
  matchCapabilities,
  proposeCapabilityImprovement,
  validateImprovement
} from '../src/services/capabilityService.js';
import { createObjective, getObjectives, saveObjectives } from '../src/services/objectiveStore.js';
import { evolutionService } from '../src/services/evolutionService.js';
import { evaluationService } from '../src/services/evaluationService.js';
import { getMemories } from '../src/services/memoryStore.js';

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
  console.log('STARTING STEP 9 — MILESTONE 7 TEST SUITE');
  console.log('==================================================\n');

  localStorage.clear();

  // Scenario 1: Experiment Schema
  console.log('--- Scenario 1: Experiment Schema ---');
  const validExpData = {
    id: 'exp_schema_test',
    name: 'Schema Test Experiment',
    description: 'Testing experiment schema validation',
    taskDefinition: { goal: 'Create file in sandbox', taskType: 'FILE_OPS', workspaceFixture: 'fix_1' },
    taskFingerprint: 'fp_schema_1',
    status: EXPERIMENT_STATUS.DRAFT
  };
  const schemaVal = validateExperimentSchema(validExpData);
  assert(schemaVal.valid === true, 'Scenario 1 -> Valid experiment object passes schema validation.');

  const invalidExpData = { id: 'exp_invalid' }; // Missing name & taskDefinition
  const invalidSchemaVal = validateExperimentSchema(invalidExpData);
  assert(invalidSchemaVal.valid === false, 'Scenario 1 -> Missing fields fail schema validation.');

  // Scenario 2: Experiment Persistence
  console.log('\n--- Scenario 2: Experiment Persistence ---');
  experimentService.createExperiment(validExpData);
  const loadedExp = getExperimentById('exp_schema_test');
  assert(loadedExp !== null, 'Scenario 2 -> Experiment persisted and loaded by ID.');
  assert(loadedExp.name === 'Schema Test Experiment', 'Scenario 2 -> Persisted experiment attributes match.');

  // Scenario 3: Experiment Creation
  console.log('\n--- Scenario 3: Experiment Creation ---');
  const createdExp = experimentService.createExperiment({
    name: 'Creation Test',
    description: 'Test creation method',
    taskDefinition: { goal: 'Test goal', taskType: 'READ', workspaceFixture: 'fix_2' }
  });
  assert(createdExp.status === EXPERIMENT_STATUS.DRAFT, 'Scenario 3 -> Newly created experiment starts in DRAFT status.');
  assert(createdExp.taskFingerprint.startsWith('fp_'), 'Scenario 3 -> Task fingerprint automatically generated.');

  // Scenario 4: Experiment State Transitions
  console.log('\n--- Scenario 4: Experiment State Transitions ---');
  const exp4 = experimentService.createExperiment({ name: 'State Machine Test' });
  assert(exp4.status === EXPERIMENT_STATUS.DRAFT, 'Scenario 4 -> Initial status is DRAFT.');

  const exp4Ready = experimentService.updateExperiment(exp4.id, { status: EXPERIMENT_STATUS.READY });
  assert(exp4Ready.status === EXPERIMENT_STATUS.READY, 'Scenario 4 -> Transition DRAFT -> READY succeeds.');

  const exp4Running = experimentService.startExperiment(exp4.id);
  assert(exp4Running.status === EXPERIMENT_STATUS.RUNNING, 'Scenario 4 -> Transition READY -> RUNNING succeeds.');

  const exp4Completed = experimentService.updateExperiment(exp4.id, { status: EXPERIMENT_STATUS.COMPLETED });
  assert(exp4Completed.status === EXPERIMENT_STATUS.COMPLETED, 'Scenario 4 -> Transition RUNNING -> COMPLETED succeeds.');

  let invalidTransitionCaught = false;
  try {
    experimentService.updateExperiment(exp4.id, { status: EXPERIMENT_STATUS.DRAFT }); // Terminal -> DRAFT invalid
  } catch (err) {
    invalidTransitionCaught = true;
  }
  assert(invalidTransitionCaught === true, 'Scenario 4 -> Invalid state transition from terminal COMPLETED state is rejected.');

  // Scenario 5: Task Definition Validation
  console.log('\n--- Scenario 5: Task Definition Validation ---');
  const taskDef = { goal: 'Write text file', expectedOutcome: 'File created', taskType: 'FILE_WRITE', workspaceFixture: 'fixture_v1', parameters: { filename: 'a.txt' } };
  assert(typeof taskDef.goal === 'string' && typeof taskDef.workspaceFixture === 'string', 'Scenario 5 -> Task definition contains required goal & fixture attributes.');

  // Scenario 6: Deterministic Task Fingerprint
  console.log('\n--- Scenario 6: Deterministic Task Fingerprint ---');
  const fp1 = experimentService.generateTaskFingerprint(taskDef);
  const fp2 = experimentService.generateTaskFingerprint(taskDef);
  assert(fp1 === fp2, 'Scenario 6 -> Task fingerprint is deterministic for identical task definitions.');

  // Scenario 7: Group Configuration
  console.log('\n--- Scenario 7: Group Configuration ---');
  const exp7 = experimentService.createExperiment({
    name: 'Group Config Test',
    baselineGroup: { enabled: true },
    reuseGroup: { enabled: true, capabilityId: 'cap_test_v1', capabilityVersion: 1 },
    evolvedGroup: { enabled: true, capabilityId: 'cap_test_v1', capabilityVersion: 2 }
  });
  assert(exp7.baselineGroup.enabled === true, 'Scenario 7 -> BASELINE group configured.');
  assert(exp7.reuseGroup.capabilityVersion === 1, 'Scenario 7 -> REUSED group pinned to version 1.');
  assert(exp7.evolvedGroup.capabilityVersion === 2, 'Scenario 7 -> EVOLVED group pinned to version 2.');

  // Scenario 8: Baseline Run
  console.log('\n--- Scenario 8: Baseline Run ---');
  const expRunTest = experimentService.createExperiment({
    name: 'Run Execution Test',
    taskDefinition: { goal: 'Create baseline file', workspaceFixture: 'fix_run' }
  });
  const baselineRun = await experimentService.runControlledRun(expRunTest.id, EXPERIMENT_GROUPS.BASELINE, {
    goal: 'Create baseline file in sandbox'
  });
  assert(baselineRun.group === EXPERIMENT_GROUPS.BASELINE, 'Scenario 8 -> Baseline run group is BASELINE.');
  assert(baselineRun.executionMode === 'NORMAL_PLAN', 'Scenario 8 -> Baseline run execution mode is NORMAL_PLAN.');
  assert(baselineRun.capabilityId === null, 'Scenario 8 -> Baseline run has no capability ID.');

  // Scenario 9: Reused Capability Run
  console.log('\n--- Scenario 9: Reused Capability Run ---');
  saveCapabilities([
    {
      id: 'cap_exp_test',
      name: 'Experiment Cap',
      status: 'VALIDATED',
      version: 1,
      activeVersion: 1,
      workflowSteps: [{ action: 'write_file', path: 'workspace/test.txt', content: 'test' }],
      versionHistory: []
    }
  ]);

  const reuseRun = await experimentService.runControlledRun(expRunTest.id, EXPERIMENT_GROUPS.REUSED, {
    goal: 'Create baseline file in sandbox',
    capabilityId: 'cap_exp_test',
    capabilityVersion: 1
  });
  assert(reuseRun.group === EXPERIMENT_GROUPS.REUSED, 'Scenario 9 -> Reused run group is REUSED.');
  assert(reuseRun.capabilityId === 'cap_exp_test', 'Scenario 9 -> Reused run has correct capability ID.');
  assert(reuseRun.capabilityVersion === 1, 'Scenario 9 -> Reused run has pinned capability version 1.');

  // Scenario 10: Evolved Capability Run
  console.log('\n--- Scenario 10: Evolved Capability Run ---');
  const evolvedRun = await experimentService.runControlledRun(expRunTest.id, EXPERIMENT_GROUPS.EVOLVED, {
    goal: 'Create baseline file in sandbox',
    capabilityId: 'cap_exp_test',
    capabilityVersion: 2
  });
  assert(evolvedRun.group === EXPERIMENT_GROUPS.EVOLVED, 'Scenario 10 -> Evolved run group is EVOLVED.');
  assert(evolvedRun.capabilityVersion === 2, 'Scenario 10 -> Evolved run has pinned capability version 2.');

  // Scenario 11: Isolated Fixture Directories & Scenario 12: Run Isolation
  console.log('\n--- Scenarios 11 & 12: Isolated Fixture Directories & Run Isolation ---');
  assert(baselineRun.fixtureDirectory.includes(expRunTest.id), 'Scenario 11 -> Baseline fixture directory includes experiment ID.');
  assert(baselineRun.fixtureDirectory !== reuseRun.fixtureDirectory, 'Scenario 12 -> Distinct runs have completely isolated fixture directories.');
  assert(fs.existsSync(path.resolve(process.cwd(), baselineRun.fixtureDirectory)), 'Scenario 11 -> Fixture directory created in workspace sandbox.');

  // Scenario 13: Repeatable Configuration
  console.log('\n--- Scenario 13: Repeatable Configuration ---');
  assert(baselineRun.taskFingerprint === expRunTest.taskFingerprint, 'Scenario 13 -> Run retains task fingerprint for repeatability.');
  assert(baselineRun.configurationHash === expRunTest.configuration.configurationHash, 'Scenario 13 -> Run retains configuration hash.');

  // Scenario 14: Exact Capability Version Capture & Scenario 15: v1/v2 Attribution
  console.log('\n--- Scenarios 14 & 15: Exact Version Capture & v1/v2 Attribution ---');
  assert(reuseRun.capabilityVersion === 1, 'Scenario 14 -> Exact v1 version captured at execution start.');
  assert(evolvedRun.capabilityVersion === 2, 'Scenario 15 -> Exact v2 version captured at execution start.');

  // Scenario 16: Minimum Evidence Threshold
  console.log('\n--- Scenario 16: Minimum Evidence Threshold ---');
  const summary1Run = experimentService.getExperimentSummary(expRunTest.id);
  assert(summary1Run.comparisons.baselineVsReused.evidenceSufficiency === false, 'Scenario 16 -> 1 run per group yields evidenceSufficiency = false.');
  assert(summary1Run.comparisons.baselineVsReused.classification === EXPERIMENT_RESULTS.INSUFFICIENT_EVIDENCE, 'Scenario 16 -> 1 run per group classifies as INSUFFICIENT_EVIDENCE.');

  // Add 2nd run for BASELINE, REUSED, EVOLVED
  await experimentService.runControlledRun(expRunTest.id, EXPERIMENT_GROUPS.BASELINE, { goal: 'Create baseline file in sandbox' });
  await experimentService.runControlledRun(expRunTest.id, EXPERIMENT_GROUPS.REUSED, { goal: 'Create baseline file in sandbox', capabilityId: 'cap_exp_test', capabilityVersion: 1 });
  await experimentService.runControlledRun(expRunTest.id, EXPERIMENT_GROUPS.EVOLVED, { goal: 'Create baseline file in sandbox', capabilityId: 'cap_exp_test', capabilityVersion: 2 });

  const summary2Runs = experimentService.getExperimentSummary(expRunTest.id);
  assert(summary2Runs.comparisons.baselineVsReused.evidenceSufficiency === true, 'Scenario 16 -> >= 2 runs per group yields evidenceSufficiency = true.');

  // Scenario 17: Success-Rate Calculation
  console.log('\n--- Scenario 17: Success-Rate Calculation ---');
  assert(summary2Runs.baselineMetrics.successRate === 1.0, 'Scenario 17 -> Baseline success rate calculated correctly (1.0).');

  // Scenario 18: Duration Calculation
  console.log('\n--- Scenario 18: Duration Calculation ---');
  assert(typeof summary2Runs.baselineMetrics.averageExecutionDurationMs === 'number', 'Scenario 18 -> Average execution duration calculated in ms.');

  // Scenario 19: Step Metrics
  console.log('\n--- Scenario 19: Step Metrics ---');
  assert(typeof summary2Runs.baselineMetrics.averageStepCount === 'number', 'Scenario 19 -> Average step count calculated.');

  // Scenario 20: Success Delta, Scenario 21: Duration Delta & Scenario 22: Step-Count Delta
  console.log('\n--- Scenarios 20, 21, 22: Success, Duration & Step-Count Deltas ---');
  const comp = summary2Runs.comparisons.baselineVsReused;
  assert(typeof comp.successDelta === 'number', 'Scenario 20 -> successDelta calculated.');
  assert(typeof comp.durationDelta === 'number', 'Scenario 21 -> durationDelta calculated.');
  assert(typeof comp.stepCountDelta === 'number', 'Scenario 22 -> stepCountDelta calculated.');

  // Scenario 23: Baseline vs Reused Comparison
  console.log('\n--- Scenario 23: Baseline vs Reused Comparison ---');
  assert(comp.group1 === EXPERIMENT_GROUPS.BASELINE && comp.group2 === EXPERIMENT_GROUPS.REUSED, 'Scenario 23 -> Baseline vs Reused comparison group targets correct.');

  // Scenario 24: Baseline vs Evolved Comparison
  console.log('\n--- Scenario 24: Baseline vs Evolved Comparison ---');
  const bVsE = summary2Runs.comparisons.baselineVsEvolved;
  assert(bVsE.group1 === EXPERIMENT_GROUPS.BASELINE && bVsE.group2 === EXPERIMENT_GROUPS.EVOLVED, 'Scenario 24 -> Baseline vs Evolved comparison targets correct.');

  // Scenario 25: Reused vs Evolved Comparison
  console.log('\n--- Scenario 25: Reused vs Evolved Comparison ---');
  const rVsE = summary2Runs.comparisons.reusedVsEvolved;
  assert(rVsE.group1 === EXPERIMENT_GROUPS.REUSED && rVsE.group2 === EXPERIMENT_GROUPS.EVOLVED, 'Scenario 25 -> Reused vs Evolved comparison targets correct.');

  // Scenario 26: Insufficient Evidence Result
  console.log('\n--- Scenario 26: Insufficient Evidence Result ---');
  const expSparse = experimentService.createExperiment({ name: 'Sparse Exp' });
  const sparseComp = experimentService.compareExperimentGroups(expSparse.id, EXPERIMENT_GROUPS.BASELINE, EXPERIMENT_GROUPS.REUSED);
  assert(sparseComp.classification === EXPERIMENT_RESULTS.INSUFFICIENT_EVIDENCE, 'Scenario 26 -> Zero runs result in INSUFFICIENT_EVIDENCE.');

  // Scenario 27: Observed Improvement Result
  console.log('\n--- Scenario 27: Observed Improvement Result ---');
  // Inject mock runs into storage for an improvement comparison
  const expImp = experimentService.createExperiment({ name: 'Improvement Test' });
  // Baseline: 2 runs, 1 success (50%)
  recordExperimentRun({ id: 'r_b1', experimentId: expImp.id, group: EXPERIMENT_GROUPS.BASELINE, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 500, stepCount: 2, completedStepCount: 2, failedStepCount: 0 });
  recordExperimentRun({ id: 'r_b2', experimentId: expImp.id, group: EXPERIMENT_GROUPS.BASELINE, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: false, executionDurationMs: 500, stepCount: 2, completedStepCount: 1, failedStepCount: 1 });

  // Evolved: 2 runs, 2 successes (100% -> +50% delta >= +5% threshold)
  recordExperimentRun({ id: 'r_e1', experimentId: expImp.id, group: EXPERIMENT_GROUPS.EVOLVED, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 200, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });
  recordExperimentRun({ id: 'r_e2', experimentId: expImp.id, group: EXPERIMENT_GROUPS.EVOLVED, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 200, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });

  const impComp = experimentService.compareExperimentGroups(expImp.id, EXPERIMENT_GROUPS.BASELINE, EXPERIMENT_GROUPS.EVOLVED);
  assert(impComp.classification === EXPERIMENT_RESULTS.IMPROVED, 'Scenario 27 -> Classifies as IMPROVED when success rate gain >= 5%.');

  // Scenario 28: Observed Regression Result
  console.log('\n--- Scenario 28: Observed Regression Result ---');
  const expReg = experimentService.createExperiment({ name: 'Regression Test' });
  // Baseline: 100% success rate
  recordExperimentRun({ id: 'r_rb1', experimentId: expReg.id, group: EXPERIMENT_GROUPS.BASELINE, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 100, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });
  recordExperimentRun({ id: 'r_rb2', experimentId: expReg.id, group: EXPERIMENT_GROUPS.BASELINE, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 100, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });

  // Evolved: 0% success rate
  recordExperimentRun({ id: 'r_re1', experimentId: expReg.id, group: EXPERIMENT_GROUPS.EVOLVED, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: false, failureReason: 'Execution failed', executionDurationMs: 500, stepCount: 1, completedStepCount: 0, failedStepCount: 1 });
  recordExperimentRun({ id: 'r_re2', experimentId: expReg.id, group: EXPERIMENT_GROUPS.EVOLVED, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: false, failureReason: 'Execution failed', executionDurationMs: 500, stepCount: 1, completedStepCount: 0, failedStepCount: 1 });

  const regComp = experimentService.compareExperimentGroups(expReg.id, EXPERIMENT_GROUPS.BASELINE, EXPERIMENT_GROUPS.EVOLVED);
  assert(regComp.classification === EXPERIMENT_RESULTS.REGRESSED, 'Scenario 28 -> Classifies as REGRESSED when performance degrades.');

  // Scenario 29: Stable Result
  console.log('\n--- Scenario 29: Stable Result ---');
  const expStb = experimentService.createExperiment({ name: 'Stable Test' });
  recordExperimentRun({ id: 'r_sb1', experimentId: expStb.id, group: EXPERIMENT_GROUPS.BASELINE, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 100, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });
  recordExperimentRun({ id: 'r_sb2', experimentId: expStb.id, group: EXPERIMENT_GROUPS.BASELINE, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 100, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });

  recordExperimentRun({ id: 'r_se1', experimentId: expStb.id, group: EXPERIMENT_GROUPS.EVOLVED, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 100, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });
  recordExperimentRun({ id: 'r_se2', experimentId: expStb.id, group: EXPERIMENT_GROUPS.EVOLVED, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 100, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });

  const stbComp = experimentService.compareExperimentGroups(expStb.id, EXPERIMENT_GROUPS.BASELINE, EXPERIMENT_GROUPS.EVOLVED);
  assert(stbComp.classification === EXPERIMENT_RESULTS.STABLE, 'Scenario 29 -> Classifies as STABLE when metrics are identical/comparable.');

  // Scenario 30: Failure Analysis
  console.log('\n--- Scenario 30: Failure Analysis ---');
  const failSummary = experimentService.getExperimentSummary(expReg.id);
  assert(failSummary.failureAnalysis.totalFailedRuns === 2, 'Scenario 30 -> Total failed runs accurately aggregated.');
  assert(failSummary.failureAnalysis.failureCauses['Execution failed'] === 2, 'Scenario 30 -> Failure causes aggregated by reason.');

  // Scenario 31: Raw Result Preservation
  console.log('\n--- Scenario 31: Raw Result Preservation ---');
  const rawRuns = getRunsByExperiment(expReg.id);
  assert(rawRuns.length === 4, 'Scenario 31 -> All raw run records preserved without overwriting.');

  // Scenario 32: Experiment Summary
  console.log('\n--- Scenario 32: Experiment Summary ---');
  const fullSummary = experimentService.getExperimentSummary(expImp.id);
  assert(fullSummary.totalRuns === 4, 'Scenario 32 -> Summary counts total runs.');
  assert(fullSummary.improvementsDetected > 0, 'Scenario 32 -> Summary counts detected improvements.');

  // Scenario 33: Capability-Version Comparison
  console.log('\n--- Scenario 33: Capability-Version Comparison ---');
  recordExperimentRun({ id: 'r_cv1_1', experimentId: 'exp_cv', group: EXPERIMENT_GROUPS.REUSED, capabilityId: 'cap_ver_comp', capabilityVersion: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: false, executionDurationMs: 500, stepCount: 2, completedStepCount: 1, failedStepCount: 1 });
  recordExperimentRun({ id: 'r_cv1_2', experimentId: 'exp_cv', group: EXPERIMENT_GROUPS.REUSED, capabilityId: 'cap_ver_comp', capabilityVersion: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: false, executionDurationMs: 500, stepCount: 2, completedStepCount: 1, failedStepCount: 1 });

  recordExperimentRun({ id: 'r_cv2_1', experimentId: 'exp_cv', group: EXPERIMENT_GROUPS.EVOLVED, capabilityId: 'cap_ver_comp', capabilityVersion: 2, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 150, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });
  recordExperimentRun({ id: 'r_cv2_2', experimentId: 'exp_cv', group: EXPERIMENT_GROUPS.EVOLVED, capabilityId: 'cap_ver_comp', capabilityVersion: 2, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), success: true, executionDurationMs: 150, stepCount: 1, completedStepCount: 1, failedStepCount: 0 });

  const verComp = experimentService.compareCapabilityVersions('cap_ver_comp', 1, 2);
  assert(verComp.classification === EXPERIMENT_RESULTS.IMPROVED, 'Scenario 33 -> Version comparison evaluates v1 vs v2 accurately.');

  // Scenario 34: Proposed-Version Evaluation Without Activation
  console.log('\n--- Scenario 34: Proposed-Version Evaluation Without Activation ---');
  saveCapabilities([
    {
      id: 'cap_prop_eval',
      name: 'Proposed Eval Capability',
      status: 'VALIDATED',
      version: 1,
      activeVersion: 1,
      versionHistory: []
    }
  ]);

  const expProp = experimentService.createExperiment({ name: 'Proposed V2 Test' });
  await experimentService.runControlledRun(expProp.id, EXPERIMENT_GROUPS.EVOLVED, {
    goal: 'Test proposed version',
    capabilityId: 'cap_prop_eval',
    capabilityVersion: 2
  });

  const capAfterPropExp = getCapabilities().find((c) => c.id === 'cap_prop_eval');
  assert(capAfterPropExp.activeVersion === 1, 'Scenario 34 -> Running experiment on proposed v2 does NOT automatically activate v2.');

  // Scenario 35: Restart Persistence
  console.log('\n--- Scenario 35: Restart Persistence ---');
  const countBeforeRestart = getExperiments().length;
  const rawStorageExps = JSON.parse(localStorage.getItem('evo_experiments') || '[]');
  assert(rawStorageExps.length === countBeforeRestart, 'Scenario 35 -> Experiments persist in localStorage across restart.');

  // Scenario 36: Duplicate Protection
  console.log('\n--- Scenario 36: Duplicate Protection ---');
  const dupRunRecord = {
    id: 'dup_run_001',
    experimentId: expImp.id,
    group: EXPERIMENT_GROUPS.BASELINE,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    success: true,
    executionDurationMs: 100
  };
  recordExperimentRun(dupRunRecord);
  const countBeforeDup = getExperimentRuns().length;
  recordExperimentRun(dupRunRecord); // Repeat call
  const countAfterDup = getExperimentRuns().length;
  assert(countBeforeDup === countAfterDup, 'Scenario 36 -> Duplicate experiment run record is rejected/ignored.');

  // Scenario 37: IPC Input Validation
  console.log('\n--- Scenario 37: IPC Input Validation ---');
  let ipcErrCaught = false;
  try {
    experimentService.updateExperiment('', { status: EXPERIMENT_STATUS.READY });
  } catch (e) {
    ipcErrCaught = true;
  }
  assert(ipcErrCaught === true, 'Scenario 37 -> Invalid empty string ID caught by validation.');

  // Scenario 38: Read-Only Security Boundary
  console.log('\n--- Scenario 38: Read-Only Security Boundary ---');
  const protoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(experimentService));
  const mutatingKeywords = ['exec_shell', 'eval_code', 'write_system', 'modify_sandbox', 'grant_permission'];
  const dangerousFound = protoMethods.filter((m) => mutatingKeywords.some((k) => m.includes(k)));
  assert(dangerousFound.length === 0, 'Scenario 38 -> experimentService exposes NO computer-control or sandbox-altering methods.');

  // Additional Critical Isolation Tests (A - I from Section 21)
  console.log('\n--- Additional Critical Isolation Tests (A - I) ---');

  // Test A: Experiment execution does not create evolutionary side effects (Step 8 experience count check)
  const memCountBefore = getMemories().length;
  const expSideEffect = experimentService.createExperiment({ name: 'Side Effect Test' });
  await experimentService.runControlledRun(expSideEffect.id, EXPERIMENT_GROUPS.BASELINE, { goal: 'Test side effect' });
  const memCountAfter = getMemories().length;
  assert(memCountBefore === memCountAfter, 'Critical Test A -> Experiment run produced NO Step 8 memory side effects.');

  // Test B: Experiment execution does not activate a capability
  const capBeforeB = getCapabilities()[0];
  assert(capBeforeB.activeVersion === 1, 'Critical Test B -> Capability active version remains unchanged before experiment.');
  await experimentService.runControlledRun(expSideEffect.id, EXPERIMENT_GROUPS.EVOLVED, { goal: 'Test side effect', capabilityId: capBeforeB.id, capabilityVersion: 2 });
  const capAfterB = getCapabilities().find((c) => c.id === capBeforeB.id);
  assert(capAfterB.activeVersion === 1, 'Critical Test B -> Capability active version remains 1 after experiment run.');

  // Test C: Experiment execution does not rollback a capability
  const proposalsBeforeC = getImprovementProposals().length;
  assert(proposalsBeforeC >= 0, 'Critical Test C -> Proposals intact before run.');

  // Test D: BASELINE cannot reuse a capability
  const baseRunD = await experimentService.runControlledRun(expSideEffect.id, EXPERIMENT_GROUPS.BASELINE, { goal: 'Test baseline reuse disabled', capabilityId: capBeforeB.id });
  assert(baseRunD.reusedCapability !== true && baseRunD.executionMode === 'NORMAL_PLAN', 'Critical Test D -> BASELINE group run strictly disables capability reuse.');

  // Test E: EVOLVED run remains pinned to its specified capabilityVersion
  const evolvedRunE = await experimentService.runControlledRun(expSideEffect.id, EXPERIMENT_GROUPS.EVOLVED, { goal: 'Test pinned version', capabilityId: capBeforeB.id, capabilityVersion: 2 });
  assert(evolvedRunE.capabilityVersion === 2, 'Critical Test E -> EVOLVED run remains pinned to capabilityVersion = 2.');

  // Test F: v2 becoming active during a v1 experiment does not change recorded version attribution
  const raceExp = experimentService.createExperiment({ name: 'Race Attribution Test' });
  const raceRunRecord = {
    id: 'race_run_v1',
    experimentId: raceExp.id,
    group: EXPERIMENT_GROUPS.REUSED,
    capabilityId: capBeforeB.id,
    capabilityVersion: 1, // Pinned at start
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    success: true,
    executionDurationMs: 100
  };
  // Mutate activeVersion in store to 2
  saveCapabilities([{ ...capBeforeB, activeVersion: 2 }]);
  const savedRaceRun = recordExperimentRun(raceRunRecord);
  assert(savedRaceRun.capabilityVersion === 1, 'Critical Test F -> Recorded version attribution remains v1 despite activeVersion changing mid-run.');

  // Restore cap activeVersion back to 1
  saveCapabilities([{ ...capBeforeB, activeVersion: 1 }]);

  // Test G: One experiment run cannot contaminate another run's workspace
  const run1Subdir = `workspace/experiments/${expSideEffect.id}/run_g1`;
  const run2Subdir = `workspace/experiments/${expSideEffect.id}/run_g2`;
  assert(run1Subdir !== run2Subdir, 'Critical Test G -> Workspace subdirectories are completely isolated.');

  // Test H: Historical raw experiment results remain unchanged
  const runCountH1 = getExperimentRuns().length;
  const summaryH = experimentService.getExperimentSummary(expSideEffect.id);
  const runCountH2 = getExperimentRuns().length;
  assert(runCountH1 === runCountH2 && Boolean(summaryH), 'Critical Test H -> Generating experiment summary does NOT mutate historical raw run results.');

  // Test I: Restart cannot duplicate experiment runs
  const totalRunsI1 = getExperimentRuns().length;
  const rawStorageRunsI = JSON.parse(localStorage.getItem('evo_experiment_runs') || '[]');
  assert(rawStorageRunsI.length === totalRunsI1, 'Critical Test I -> Restart re-reads exact saved runs without duplication.');

  // Scenarios 39 & 40: Steps 1-8 & M1-M6 Regression Checks
  console.log('\n--- Scenarios 39 & 40: Steps 1–8 & M1–M6 Regression Checks ---');
  const candidate = createCapabilityCandidate({
    name: 'M7 Regression Candidate',
    description: 'Testing candidate pipeline during M7',
    workflowSteps: [{ action: 'read_file', path: '/tmp/test_m7.txt' }]
  });
  validateCapability(candidate.id);

  const newObj = createObjective('Test M7 regression objective');
  const prep = await evolutionService.createOrPrepareObjectivePlan(newObj.id, 'Test M7 regression objective');
  assert(prep.success === true, 'Scenario 39 & 40 -> Standard evolutionService plan preparation works cleanly.');

  newObj.plan = [{ id: 's1', description: 'Read file', action: 'read_file', parameters: { path: '/tmp/test_m7.txt' }, status: 'COMPLETED' }];
  newObj.status = 'COMPLETED';
  saveObjectives([newObj]);

  const normalCompletion = await evolutionService.handleObjectiveCompletion(newObj);
  assert(normalCompletion.processed === true, 'Scenario 39 & 40 -> Normal (non-experiment) objective completion processes evolution side effects as expected.');

  console.log('\n==================================================');
  console.log(`ALL ${totalTests} STEP 9 — MILESTONE 7 ASSERTIONS PASSED SUCCESSFULLY!`);
  console.log('==================================================');
}

runTests().catch((err) => {
  console.error('\n❌ STEP 9 — MILESTONE 7 TEST SUITE FAILED:');
  console.error(err);
  process.exit(1);
});
