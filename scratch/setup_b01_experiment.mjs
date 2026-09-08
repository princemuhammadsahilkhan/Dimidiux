/**
 * Step 11 — Experiment 1 Setup Only (B01 Benchmark)
 * Creates the controlled benchmark definition and clean isolated workspace fixture for Task B01.
 * ZERO runs are executed.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_b01_experiment_storage.json';
if (fs.existsSync(storeFile)) {
  fs.unlinkSync(storeFile);
}
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

import { experimentService } from '../src/services/experimentService.js';
import { EXPERIMENT_STATUS, EXPERIMENT_GROUPS } from '../src/config/experimentConfig.js';
import { getRunsByExperiment } from '../src/services/experimentStore.js';

// 1. Create clean isolated workspace fixture directory
const fixtureRelativePath = 'workspace/fixtures/b01_fixture';
const fixtureAbsPath = path.resolve(process.cwd(), fixtureRelativePath);
if (!fs.existsSync(fixtureAbsPath)) {
  fs.mkdirSync(fixtureAbsPath, { recursive: true });
}
fs.writeFileSync(
  path.join(fixtureAbsPath, 'README.md'),
  '# Benchmark B01 Isolated Fixture\nClean initial workspace environment for Experiment B01.',
  'utf-8'
);

// 2. Define Experiment B01 benchmark
const b01Definition = {
  id: 'exp_b01_controlled_benchmark',
  name: 'B01: Controlled File & Folder Operations Benchmark',
  description: 'First V1 experimental validation task for folder creation, file writing, and verification.',
  taskDefinition: {
    taskId: 'B01',
    goal: "Create a folder named ExperimentTest, create a file named hello.txt inside it containing 'Hello EVO', and verify that the file exists.",
    expectedOutcome: {
      folderExists: 'ExperimentTest',
      fileExists: 'ExperimentTest/hello.txt',
      fileContents: 'Hello EVO',
      independentlyVerified: true
    },
    taskType: 'FILE_AND_FOLDER_OPERATIONS',
    workspaceFixture: fixtureRelativePath,
    parameters: {
      folderName: 'ExperimentTest',
      fileName: 'hello.txt',
      fileContent: 'Hello EVO'
    }
  },
  baselineGroup: { enabled: true, group: EXPERIMENT_GROUPS.BASELINE },
  reuseGroup: { enabled: true, group: EXPERIMENT_GROUPS.REUSED, capabilityId: null, capabilityVersion: 1 },
  evolvedGroup: { enabled: true, group: EXPERIMENT_GROUPS.EVOLVED, capabilityId: null, capabilityVersion: 2 },
  requiredRuns: 6
};

// 3. Create experiment definition in store
const createdExp = experimentService.createExperiment(b01Definition);
const readyExp = experimentService.updateExperiment(createdExp.id, { status: EXPERIMENT_STATUS.READY });

// 4. Verify ZERO runs have been executed
const existingRuns = getRunsByExperiment(readyExp.id);

console.log('====================================================');
console.log('B01 EXPERIMENT SETUP CONFIRMATION');
console.log('====================================================');
console.log('Experiment ID:', readyExp.id);
console.log('Task ID:', readyExp.taskDefinition.taskId);
console.log('Experiment Name:', readyExp.name);
console.log('Status:', readyExp.status);
console.log('Fixture Location:', readyExp.taskDefinition.workspaceFixture);
console.log('Absolute Fixture Path:', fixtureAbsPath);
console.log('Supported Groups:', Object.keys(EXPERIMENT_GROUPS).join(', '));
console.log('Completed Runs Count:', readyExp.completedRuns);
console.log('Executed Runs Recorded:', existingRuns.length);
console.log('Expected Outcome:', JSON.stringify(readyExp.taskDefinition.expectedOutcome));
console.log('====================================================');
