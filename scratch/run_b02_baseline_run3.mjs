/**
 * Step 11 — B02 BASELINE Run 3 Only
 * Executes exactly ONE additional controlled run for Task B02 under the BASELINE group (capability reuse disabled).
 * Preserves B02 BASELINE Runs 1 & 2.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_b02_experiment_storage.json';
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

async function executeB02BaselineRun3() {
  const experimentId = 'exp_b02_controlled_benchmark';

  // 1. Confirm experiment exists
  const exp = experimentService.getExperiment(experimentId);
  if (!exp) {
    throw new Error(`Experiment ${experimentId} not found.`);
  }

  // 2. Record initial run count before Run 3
  const runsBefore = getRunsByExperiment(experimentId);
  const baselineRunsBefore = runsBefore.filter((r) => r.group === EXPERIMENT_GROUPS.BASELINE);
  console.log(`Total runs before execution: ${runsBefore.length} (Baseline runs before: ${baselineRunsBefore.length})`);

  // Clean target test folder in workspace root for fresh run verification
  const workspaceRoot = path.resolve(process.cwd(), 'workspace');
  const targetFolder = path.join(workspaceRoot, 'ProjectFiles');
  if (fs.existsSync(targetFolder)) {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  }

  // 3. Execute ONE additional run for BASELINE group (capability reuse explicitly disabled)
  const runRecord = await experimentService.runControlledRun(experimentId, EXPERIMENT_GROUPS.BASELINE);

  // 4. Verify post-run counts
  const runsAfter = getRunsByExperiment(experimentId);
  const baselineRunsAfter = runsAfter.filter((r) => r.group === EXPERIMENT_GROUPS.BASELINE);
  const newlyExecutedRuns = runsAfter.length - runsBefore.length;

  // 5. Retrieve final objective state
  const objectives = getObjectives();
  const finalObj = objectives.find((o) => o.id === runRecord.objectiveId);

  // 6. Perform independent physical disk verification
  const runFixtureFolder = path.resolve(process.cwd(), runRecord.fixtureDirectory);
  const projectFilesFolder = path.join(runFixtureFolder, 'ProjectFiles');

  const folderExists = fs.existsSync(projectFilesFolder);
  const notesFile = path.join(projectFilesFolder, 'notes.txt');
  const summaryFile = path.join(projectFilesFolder, 'summary.txt');
  const readmeFile = path.join(projectFilesFolder, 'readme.txt');

  const notesExists = fs.existsSync(notesFile);
  const summaryExists = fs.existsSync(summaryFile);
  const readmeExists = fs.existsSync(readmeFile);

  const notesContent = notesExists ? fs.readFileSync(notesFile, 'utf-8').trim() : null;
  const summaryContent = summaryExists ? fs.readFileSync(summaryFile, 'utf-8').trim() : null;
  const readmeContent = readmeExists ? fs.readFileSync(readmeFile, 'utf-8').trim() : null;

  const notesVerified = notesContent === 'Project Notes';
  const summaryVerified = summaryContent === 'Project Summary';
  const readmeVerified = readmeContent === 'Project README';

  const overallVerified = folderExists && notesExists && summaryExists && readmeExists && notesVerified && summaryVerified && readmeVerified;

  const physicalVerification = {
    folderExists,
    notesFile: { exists: notesExists, content: notesContent, verified: notesVerified },
    summaryFile: { exists: summaryExists, content: summaryContent, verified: summaryVerified },
    readmeFile: { exists: readmeExists, content: readmeContent, verified: readmeVerified },
    overallVerified
  };

  console.log('\n====================================================');
  console.log('B02 BASELINE RUN 3 EXECUTION REPORT');
  console.log('====================================================');
  console.log('Run ID:', runRecord.id);
  console.log('Objective ID:', runRecord.objectiveId);
  console.log('Success/Failure:', runRecord.success ? 'SUCCESS' : 'FAILURE');
  console.log('Final Status:', finalObj ? finalObj.status : 'UNKNOWN');
  console.log('Capability ID/Version:', runRecord.capabilityId ? `${runRecord.capabilityId} v${runRecord.capabilityVersion}` : 'NONE (Capability reuse disabled)');
  console.log('Step Count:', runRecord.stepCount);
  console.log('Completed Step Count:', runRecord.completedStepCount);
  console.log('Failed Step Count:', runRecord.failedStepCount);
  console.log('Execution Duration (ms):', runRecord.executionDurationMs);
  console.log('Verification Result:', JSON.stringify(physicalVerification, null, 2));
  console.log('Fixture Path:', runRecord.fixtureDirectory);
  console.log('Single New Run Executed Confirmation:', newlyExecutedRuns === 1 ? 'CONFIRMED (EXACTLY 1 NEW RUN EXECUTED)' : 'FAILED');
  console.log('Total B02 BASELINE Runs Recorded:', baselineRunsAfter.length);
  console.log('Total B02 Experiment Runs Recorded:', runsAfter.length);
  console.log('====================================================\n');
}

executeB02BaselineRun3().catch((err) => {
  console.error('Execution Error:', err);
  process.exit(1);
});
