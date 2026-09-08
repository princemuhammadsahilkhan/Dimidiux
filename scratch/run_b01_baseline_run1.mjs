/**
 * Step 11 — B01 Baseline Run 1 Only
 * Executes exactly ONE controlled run for Task B01 under the BASELINE group.
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

async function executeBaselineRun1() {
  const experimentId = 'exp_b01_controlled_benchmark';
  
  // 1. Confirm experiment exists
  const exp = experimentService.getExperiment(experimentId);
  if (!exp) {
    throw new Error(`Experiment ${experimentId} not found.`);
  }

  // 2. Record initial run count
  const runsBefore = getRunsByExperiment(experimentId);
  console.log(`Runs before execution: ${runsBefore.length}`);

  // 3. Execute ONE run for BASELINE group
  const runRecord = await experimentService.runControlledRun(experimentId, EXPERIMENT_GROUPS.BASELINE);

  // 4. Verify post-run count
  const runsAfter = getRunsByExperiment(experimentId);
  const newlyExecutedRuns = runsAfter.length - runsBefore.length;

  // 5. Retrieve final objective state
  const objectives = getObjectives();
  const finalObj = objectives.find((o) => o.id === runRecord.objectiveId);

  // 6. Perform independent physical disk verification
  const workspaceRoot = '/home/kali/Desktop/Evo/workspace';
  const targetFolder = path.join(workspaceRoot, 'ExperimentTest');
  const targetFile = path.join(targetFolder, 'hello.txt');

  const folderExists = fs.existsSync(targetFolder);
  const fileExists = fs.existsSync(targetFile);
  let fileContents = null;
  if (fileExists) {
    fileContents = fs.readFileSync(targetFile, 'utf-8').trim();
  }

  const physicalVerification = {
    folderExists,
    fileExists,
    fileContents,
    matchedExpectedContent: fileContents === 'Hello EVO',
    overallVerified: folderExists && fileExists && fileContents === 'Hello EVO'
  };

  console.log('\n====================================================');
  console.log('B01 BASELINE RUN 1 EXECUTION REPORT');
  console.log('====================================================');
  console.log('Experiment ID:', runRecord.experimentId);
  console.log('Run ID:', runRecord.id);
  console.log('Group:', runRecord.group);
  console.log('Objective ID:', runRecord.objectiveId);
  console.log('Success/Failure:', runRecord.success ? 'SUCCESS' : 'FAILURE');
  console.log('Final Objective Status:', finalObj ? finalObj.status : 'UNKNOWN');
  console.log('Capability ID:', runRecord.capabilityId);
  console.log('Capability Version:', runRecord.capabilityVersion);
  console.log('Step Count:', runRecord.stepCount);
  console.log('Completed Step Count:', runRecord.completedStepCount);
  console.log('Failed Step Count:', runRecord.failedStepCount);
  console.log('Execution Duration (ms):', runRecord.executionDurationMs);
  console.log('Physical Verification:', JSON.stringify(physicalVerification));
  console.log('Fixture Path:', runRecord.fixtureDirectory);
  console.log('Single Run Executed Confirmation:', newlyExecutedRuns === 1 ? 'CONFIRMED (EXACTLY 1 RUN EXECUTED)' : 'FAILED');
  console.log('====================================================\n');
}

executeBaselineRun1().catch((err) => {
  console.error('Execution Error:', err);
  process.exit(1);
});
