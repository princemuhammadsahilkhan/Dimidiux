/**
 * Step 11 — B01 Final Baseline vs Reused Analysis
 * Reads storage and executes deterministic evaluation comparing 5 BASELINE runs vs 5 REUSED runs.
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
import { evaluationService } from '../src/services/evaluationService.js';

async function analyzeB01() {
  const experimentId = 'exp_b01_controlled_benchmark';
  const allRuns = getRunsByExperiment(experimentId);
  const baselineRuns = allRuns.filter((r) => r.group === EXPERIMENT_GROUPS.BASELINE);
  const reusedRuns = allRuns.filter((r) => r.group === EXPERIMENT_GROUPS.REUSED);

  console.log(`Total experiment runs retrieved: ${allRuns.length}`);
  console.log(`BASELINE runs count: ${baselineRuns.length}`);
  console.log(`REUSED runs count: ${reusedRuns.length}`);

  const baselineMetrics = evaluationService.calculateMetrics(baselineRuns);
  const reusedMetrics = evaluationService.calculateMetrics(reusedRuns);

  const comp = experimentService.compareExperimentGroups(
    experimentId,
    EXPERIMENT_GROUPS.BASELINE,
    EXPERIMENT_GROUPS.REUSED
  );

  console.log('\n--- RAW RUNS BREAKDOWN ---');
  console.log('BASELINE RUNS:');
  baselineRuns.forEach((r, idx) => {
    console.log(`  Run ${idx+1}: ID=${r.id}, Success=${r.success}, Duration=${r.executionDurationMs}ms, Steps=${r.stepCount} (Completed: ${r.completedStepCount}, Failed: ${r.failedStepCount})`);
  });

  console.log('REUSED RUNS:');
  reusedRuns.forEach((r, idx) => {
    console.log(`  Run ${idx+1}: ID=${r.id}, CapId=${r.capabilityId} v${r.capabilityVersion}, Success=${r.success}, Duration=${r.executionDurationMs}ms, Steps=${r.stepCount} (Completed: ${r.completedStepCount}, Failed: ${r.failedStepCount})`);
  });

  console.log('\n====================================================');
  console.log('B01 BASELINE VS REUSED COMPARISON REPORT');
  console.log('====================================================');
  console.log('1. BASELINE GROUP METRICS (5 Runs):');
  console.log('   - Success Rate:', (baselineMetrics.successRate * 100).toFixed(2) + '%', `(${baselineMetrics.successRate})`);
  console.log('   - Failure Rate:', (baselineMetrics.failureRate * 100).toFixed(2) + '%', `(${baselineMetrics.failureRate})`);
  console.log('   - Average Execution Duration:', baselineMetrics.averageExecutionDurationMs, 'ms');
  console.log('   - Average Step Count:', baselineMetrics.averageStepCount);
  console.log('   - Average Completed Steps:', baselineMetrics.averageCompletedSteps);
  console.log('   - Average Failed Steps:', baselineMetrics.averageFailedSteps);

  console.log('\n2. REUSED V1 GROUP METRICS (5 Runs):');
  console.log('   - Success Rate:', (reusedMetrics.successRate * 100).toFixed(2) + '%', `(${reusedMetrics.successRate})`);
  console.log('   - Failure Rate:', (reusedMetrics.failureRate * 100).toFixed(2) + '%', `(${reusedMetrics.failureRate})`);
  console.log('   - Average Execution Duration:', reusedMetrics.averageExecutionDurationMs, 'ms');
  console.log('   - Average Step Count:', reusedMetrics.averageStepCount);
  console.log('   - Average Completed Steps:', reusedMetrics.averageCompletedSteps);
  console.log('   - Average Failed Steps:', reusedMetrics.averageFailedSteps);

  console.log('\n3. COMPARISON DELTAS (REUSED vs BASELINE):');
  console.log('   - Success-Rate Delta:', comp.successDelta >= 0 ? `+${comp.successDelta}` : comp.successDelta);
  console.log('   - Duration Delta:', comp.durationDelta >= 0 ? `+${comp.durationDelta} ms` : `${comp.durationDelta} ms`);
  console.log('   - Step-Count Delta:', comp.stepCountDelta >= 0 ? `+${comp.stepCountDelta}` : comp.stepCountDelta);

  console.log('\n4. DETERMINISTIC M6/M7 CLASSIFICATION:');
  console.log('   - Evidence Sufficiency:', comp.evidenceSufficiency ? 'SUFFICIENT (5 runs per group >= min threshold of 2)' : 'INSUFFICIENT');
  console.log('   - Final Classification:', comp.classification);
  console.log('====================================================\n');
}

analyzeB01().catch((err) => {
  console.error('Analysis Error:', err);
  process.exit(1);
});
