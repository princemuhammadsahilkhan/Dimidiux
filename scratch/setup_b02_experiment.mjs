/**
 * Step 11 — Experiment 2 Setup Only (B02 Benchmark)
 * Creates the controlled benchmark definition and clean isolated workspace fixture for Task B02.
 * ZERO runs are executed.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_b02_experiment_storage.json';
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

// 1. Create clean isolated workspace fixture directory for B02
const fixtureRelativePath = 'workspace/fixtures/b02_fixture';
const fixtureAbsPath = path.resolve(process.cwd(), fixtureRelativePath);
if (!fs.existsSync(fixtureAbsPath)) {
  fs.mkdirSync(fixtureAbsPath, { recursive: true });
}
fs.writeFileSync(
  path.join(fixtureAbsPath, 'README.md'),
  '# Benchmark B02 Isolated Fixture\nClean initial workspace environment for Experiment B02.',
  'utf-8'
);

// 2. Define Experiment B02 benchmark
const b02Definition = {
  id: 'exp_b02_controlled_benchmark',
  name: 'B02: Multi-File Organization Benchmark',
  description: 'Second V1 experimental validation task for creating directory structure and multiple files with specific contents.',
  taskDefinition: {
    taskId: 'B02',
    goal: "Create a folder named ProjectFiles. Inside it, create three files: notes.txt containing 'Project Notes', summary.txt containing 'Project Summary', and readme.txt containing 'Project README'. Then verify that all three files exist and contain the exact requested contents.",
    expectedOutcome: {
      folderExists: 'ProjectFiles',
      filesExist: [
        'ProjectFiles/notes.txt',
        'ProjectFiles/summary.txt',
        'ProjectFiles/readme.txt'
      ],
      fileContents: {
        'ProjectFiles/notes.txt': 'Project Notes',
        'ProjectFiles/summary.txt': 'Project Summary',
        'ProjectFiles/readme.txt': 'Project README'
      },
      independentlyVerified: true
    },
    taskType: 'MULTI_FILE_ORGANIZATION',
    workspaceFixture: fixtureRelativePath,
    parameters: {
      folderName: 'ProjectFiles',
      files: [
        { name: 'notes.txt', content: 'Project Notes' },
        { name: 'summary.txt', content: 'Project Summary' },
        { name: 'readme.txt', content: 'Project README' }
      ]
    }
  },
  baselineGroup: { enabled: true, group: EXPERIMENT_GROUPS.BASELINE },
  reuseGroup: { enabled: true, group: EXPERIMENT_GROUPS.REUSED, capabilityId: null, capabilityVersion: 1 },
  evolvedGroup: { enabled: true, group: EXPERIMENT_GROUPS.EVOLVED, capabilityId: null, capabilityVersion: 2 },
  requiredRuns: 10
};

// 3. Create experiment definition in store
const createdExp = experimentService.createExperiment(b02Definition);
const readyExp = experimentService.updateExperiment(createdExp.id, { status: EXPERIMENT_STATUS.READY });

// 4. Verify ZERO runs have been executed
const existingRuns = getRunsByExperiment(readyExp.id);

console.log('====================================================');
console.log('B02 EXPERIMENT SETUP CONFIRMATION');
console.log('====================================================');
console.log('Experiment ID:', readyExp.id);
console.log('Task ID:', readyExp.taskDefinition.taskId);
console.log('Experiment Name:', readyExp.name);
console.log('Goal Statement:', readyExp.taskDefinition.goal);
console.log('Expected Outcome:', JSON.stringify(readyExp.taskDefinition.expectedOutcome, null, 2));
console.log('Fixture Location:', readyExp.taskDefinition.workspaceFixture);
console.log('Status:', readyExp.status);
console.log('Supported Groups:', Object.keys(EXPERIMENT_GROUPS).join(', '));
console.log('Completed Runs Count:', readyExp.completedRuns);
console.log('Executed Runs Recorded:', existingRuns.length);
console.log('Zero Runs Executed Confirmation:', existingRuns.length === 0 ? 'CONFIRMED (ZERO RUNS EXECUTED)' : 'FAILED');
console.log('====================================================');
