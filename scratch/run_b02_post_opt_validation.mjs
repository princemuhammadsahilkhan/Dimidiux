/**
 * Step 11 — B02 Post-Optimization Product Validation Run
 * Measures execution performance and telemetry for REUSED_CAPABILITY mode using current optimized code.
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
import { reuseOptimizationTracker } from '../src/services/capabilityService.js';

async function executePostOptValidationRun() {
  const experimentId = 'exp_b02_controlled_benchmark';
  const targetCapabilityId = 'cap_1788863616697_5im5s';
  const targetCapabilityVersion = 1;

  // 1. Confirm experiment exists
  const exp = experimentService.getExperiment(experimentId);
  if (!exp) {
    throw new Error(`Experiment ${experimentId} not found.`);
  }

  // 2. Record initial run count
  const runsBefore = getRunsByExperiment(experimentId);
  console.log(`Total runs before execution: ${runsBefore.length}`);

  // 3. Reset telemetry tracker before execution
  reuseOptimizationTracker.reset();

  // Clean target test folder in root workspace for fresh run verification
  const workspaceRoot = path.resolve(process.cwd(), 'workspace');
  const targetFolder = path.join(workspaceRoot, 'ProjectFiles');
  if (fs.existsSync(targetFolder)) {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  }

  // 4. Execute ONE post-optimization validation run for REUSED group
  const runRecord = await experimentService.runControlledRun(experimentId, EXPERIMENT_GROUPS.REUSED, {
    capabilityId: targetCapabilityId,
    capabilityVersion: targetCapabilityVersion
  });

  // 5. Capture telemetry counts
  const telemetry = {
    schemaValidationCalls: reuseOptimizationTracker.schemaValidationCount,
    simulationCalls: reuseOptimizationTracker.simulationCount,
    securityValidationCalls: reuseOptimizationTracker.securityCheckCount
  };

  // 6. Verify post-run counts
  const runsAfter = getRunsByExperiment(experimentId);
  const newlyExecutedRuns = runsAfter.length - runsBefore.length;

  // 7. Retrieve final objective state
  const objectives = getObjectives();
  const finalObj = objectives.find((o) => o.id === runRecord.objectiveId);

  // 8. Perform independent physical disk verification
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
  console.log('B02 POST-OPTIMIZATION PRODUCT VALIDATION REPORT');
  console.log('====================================================');
  console.log('Run ID:', runRecord.id);
  console.log('Objective ID:', runRecord.objectiveId);
  console.log('Status:', finalObj ? finalObj.status : 'UNKNOWN');
  console.log('Success/Failure:', runRecord.success ? 'SUCCESS' : 'FAILURE');
  console.log('Step Count:', runRecord.stepCount);
  console.log('Completed Step Count:', runRecord.completedStepCount);
  console.log('Failed Step Count:', runRecord.failedStepCount);
  console.log('Execution Duration (ms):', runRecord.executionDurationMs);
  console.log('Exact Capability ID/Version Used:', `${runRecord.capabilityId} v${runRecord.capabilityVersion}`);
  console.log('Execution Mode:', runRecord.executionMode || 'REUSED_CAPABILITY');
  console.log('Verification Results:', JSON.stringify(physicalVerification, null, 2));
  console.log('Fixture Path:', runRecord.fixtureDirectory);
  console.log('Optimization Telemetry:');
  console.log('  - Schema Validation Calls:', telemetry.schemaValidationCalls);
  console.log('  - Simulation Calls:', telemetry.simulationCalls);
  console.log('  - Security Validation Calls:', telemetry.securityValidationCalls);
  console.log('Confirmation Exactly ONE New Run Executed:', newlyExecutedRuns === 1 ? 'CONFIRMED (EXACTLY 1 NEW RUN EXECUTED)' : 'FAILED');
  console.log('Total Recorded B02 Runs:', runsAfter.length);
  console.log('====================================================\n');
}

executePostOptValidationRun().catch((err) => {
  console.error('Execution Error:', err);
  process.exit(1);
});
