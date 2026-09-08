/**
 * Step 11 — B01 REUSED Run 3 Only
 * Executes exactly ONE additional controlled run for Task B01 under the REUSED group using pinned capability cap_1788786148525_9mc4p v1.
 * Preserves all previous experiment runs (5 BASELINE + 2 REUSED).
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_b01_experiment_storage.json';
let memoryStore = {};
if (fs.existsSync(storeFile)) {
  try {
    memoryStore = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
  } catch (e) {
    memoryStore = {};
  }
}

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

import { experimentService } from '../src/services/experimentService.js';
import { EXPERIMENT_GROUPS } from '../src/config/experimentConfig.js';
import { getRunsByExperiment } from '../src/services/experimentStore.js';
import { getObjectives } from '../src/services/objectiveStore.js';

async function executeReusedRun3() {
  const experimentId = 'exp_b01_controlled_benchmark';
  const targetCapabilityId = 'cap_1788786148525_9mc4p';
  const targetCapabilityVersion = 1;
  
  // 1. Confirm experiment exists
  const exp = experimentService.getExperiment(experimentId);
  if (!exp) {
    throw new Error(`Experiment ${experimentId} not found.`);
  }

  // 2. Record initial run count before REUSED Run 3
  const runsBefore = getRunsByExperiment(experimentId);
  const reusedRunsBefore = runsBefore.filter((r) => r.group === EXPERIMENT_GROUPS.REUSED);
  console.log(`Total runs before execution: ${runsBefore.length} (Reused runs before: ${reusedRunsBefore.length})`);

  // Clean target test folder for fresh run verification
  const workspaceRoot = '/home/kali/Desktop/Evo/workspace';
  const targetFolder = path.join(workspaceRoot, 'ExperimentTest');
  if (fs.existsSync(targetFolder)) {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  }

  // 3. Execute ONE additional run for REUSED group pinned to capability v1
  const runRecord = await experimentService.runControlledRun(experimentId, EXPERIMENT_GROUPS.REUSED, {
    capabilityId: targetCapabilityId,
    capabilityVersion: targetCapabilityVersion
  });

  // 4. Verify post-run counts
  const runsAfter = getRunsByExperiment(experimentId);
  const reusedRunsAfter = runsAfter.filter((r) => r.group === EXPERIMENT_GROUPS.REUSED);
  const newlyExecutedRuns = runsAfter.length - runsBefore.length;

  // 5. Retrieve final objective state
  const objectives = getObjectives();
  const finalObj = objectives.find((o) => o.id === runRecord.objectiveId);

  // 6. Perform independent physical disk verification
  const runFixtureFolder = path.join(process.cwd(), runRecord.fixtureDirectory);
  let runFixtureFile = path.join(runFixtureFolder, 'hello.txt');
  if (!fs.existsSync(runFixtureFile)) {
    runFixtureFile = path.join(runFixtureFolder, 'ExperimentTest/hello.txt');
  }

  const folderExists = fs.existsSync(runFixtureFolder);
  const fileExists = fs.existsSync(runFixtureFile);
  let fileContents = null;
  if (fileExists) {
    fileContents = fs.readFileSync(runFixtureFile, 'utf-8').trim();
  }

  const physicalVerification = {
    folderExists,
    fileExists,
    fileContents,
    matchedExpectedContent: fileContents === 'Hello EVO',
    overallVerified: folderExists && fileExists && fileContents === 'Hello EVO'
  };

  console.log('\n====================================================');
  console.log('B01 REUSED RUN 3 EXECUTION REPORT');
  console.log('====================================================');
  console.log('Run ID:', runRecord.id);
  console.log('Objective ID:', runRecord.objectiveId);
  console.log('Capability ID/Version:', `${runRecord.capabilityId} v${runRecord.capabilityVersion}`);
  console.log('Success/Failure:', runRecord.success ? 'SUCCESS' : 'FAILURE');
  console.log('Final Status:', finalObj ? finalObj.status : 'UNKNOWN');
  console.log('Step Count:', runRecord.stepCount);
  console.log('Completed Step Count:', runRecord.completedStepCount);
  console.log('Failed Step Count:', runRecord.failedStepCount);
  console.log('Execution Duration (ms):', runRecord.executionDurationMs);
  console.log('Physical Verification:', JSON.stringify(physicalVerification));
  console.log('Fixture Path:', runRecord.fixtureDirectory);
  console.log('Single New Run Executed Confirmation:', newlyExecutedRuns === 1 ? 'CONFIRMED (EXACTLY 1 NEW RUN EXECUTED)' : 'FAILED');
  console.log('Total Completed B01 REUSED Runs:', reusedRunsAfter.length);
  console.log('Total Experiment Runs:', runsAfter.length);
  console.log('====================================================\n');
}

executeReusedRun3().catch((err) => {
  console.error('Execution Error:', err);
  process.exit(1);
});
