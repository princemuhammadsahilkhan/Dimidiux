/**
 * Step 9 — Milestone 7: Controlled Experimentation & Benchmarking Service
 * Orchestrates isolated experiment runs, raw result collection, metrics calculation, and group comparisons.
 */

import {
  EXPERIMENT_CONFIG,
  EXPERIMENT_STATUS,
  EXPERIMENT_GROUPS,
  EXPERIMENT_RESULTS
} from '../config/experimentConfig.js';
import {
  getExperiments,
  saveExperiment,
  getExperimentById,
  getExperimentRuns,
  recordExperimentRun,
  getRunsByExperiment,
  getRunsByGroup
} from './experimentStore.js';
import { createObjective, getObjectives, saveObjectives } from './objectiveStore.js';
import { runObjective } from './objectiveRunner.js';
import { evolutionService } from './evolutionService.js';
import { evaluationService } from './evaluationService.js';
import fs from 'fs';
import path from 'path';

export class ExperimentService {
  /**
   * Generates a deterministic task fingerprint
   */
  generateTaskFingerprint(taskDefinition) {
    if (!taskDefinition || typeof taskDefinition !== 'object') return 'fp_unknown';
    const goal = taskDefinition.goal || '';
    const taskType = taskDefinition.taskType || '';
    const fixture = taskDefinition.workspaceFixture || '';
    const paramsStr = JSON.stringify(taskDefinition.parameters || {});
    const raw = `${goal}:${taskType}:${fixture}:${paramsStr}`;

    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return `fp_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Generates a deterministic configuration hash
   */
  generateConfigurationHash(config) {
    if (!config || typeof config !== 'object') return 'cfg_unknown';
    const raw = JSON.stringify(config);
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return `cfg_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Creates a new experiment definition (starts in DRAFT status)
   */
  createExperiment(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Experiment data must be an object.');
    }
    const id = data.id || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const taskDefinition = data.taskDefinition || {
      goal: data.goal || data.name || 'Experiment Task',
      expectedOutcome: data.expectedOutcome || 'Completed',
      taskType: data.taskType || 'FILE_OPERATIONS',
      workspaceFixture: data.workspaceFixture || 'default_fixture',
      parameters: data.parameters || {}
    };

    const config = data.configuration || {
      seed: data.seed || 42,
      fixtureVersion: data.fixtureVersion || EXPERIMENT_CONFIG.DEFAULT_FIXTURE_VERSION,
      minRunsPerGroup: EXPERIMENT_CONFIG.MIN_RUNS_PER_GROUP
    };

    const taskFingerprint = this.generateTaskFingerprint(taskDefinition);
    const configurationHash = this.generateConfigurationHash(config);

    const experiment = {
      id,
      name: data.name || 'Untitled Experiment',
      description: data.description || '',
      taskDefinition,
      taskFingerprint,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: EXPERIMENT_STATUS.DRAFT,
      configuration: {
        ...config,
        configurationHash
      },
      requiredRuns: data.requiredRuns || EXPERIMENT_CONFIG.MIN_RUNS_PER_GROUP * 2,
      completedRuns: 0,
      baselineGroup: data.baselineGroup || { enabled: true },
      reuseGroup: data.reuseGroup || { enabled: true, capabilityId: data.capabilityId || null, capabilityVersion: 1 },
      evolvedGroup: data.evolvedGroup || { enabled: true, capabilityId: data.capabilityId || null, capabilityVersion: 2 },
      results: [],
      summary: null
    };

    return saveExperiment(experiment);
  }

  /**
   * Gets an experiment by ID
   */
  getExperiment(id) {
    return getExperimentById(id);
  }

  /**
   * Lists all experiments
   */
  listExperiments() {
    return getExperiments();
  }

  /**
   * Updates an experiment enforcing valid state machine transitions
   */
  updateExperiment(id, updates) {
    const exp = getExperimentById(id);
    if (!exp) {
      throw new Error(`Experiment ${id} not found.`);
    }

    if (updates.status && updates.status !== exp.status) {
      const validTransitions = {
        [EXPERIMENT_STATUS.DRAFT]: [EXPERIMENT_STATUS.READY, EXPERIMENT_STATUS.CANCELLED],
        [EXPERIMENT_STATUS.READY]: [EXPERIMENT_STATUS.RUNNING, EXPERIMENT_STATUS.CANCELLED],
        [EXPERIMENT_STATUS.RUNNING]: [EXPERIMENT_STATUS.COMPLETED, EXPERIMENT_STATUS.FAILED, EXPERIMENT_STATUS.CANCELLED],
        [EXPERIMENT_STATUS.COMPLETED]: [], // Terminal state
        [EXPERIMENT_STATUS.FAILED]: [],    // Terminal state
        [EXPERIMENT_STATUS.CANCELLED]: []  // Terminal state
      };

      const allowed = validTransitions[exp.status] || [];
      if (!allowed.includes(updates.status)) {
        throw new Error(`Invalid experiment state transition from ${exp.status} to ${updates.status}.`);
      }
    }

    const updated = {
      ...exp,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    return saveExperiment(updated);
  }

  /**
   * Transitions experiment to RUNNING
   */
  startExperiment(id) {
    const exp = getExperimentById(id);
    if (!exp) throw new Error(`Experiment ${id} not found.`);
    if (exp.status === EXPERIMENT_STATUS.DRAFT) {
      this.updateExperiment(id, { status: EXPERIMENT_STATUS.READY });
    }
    return this.updateExperiment(id, { status: EXPERIMENT_STATUS.RUNNING });
  }

  /**
   * Cancels an experiment
   */
  cancelExperiment(id) {
    return this.updateExperiment(id, { status: EXPERIMENT_STATUS.CANCELLED });
  }

  /**
   * Marks experiment as COMPLETED
   */
  completeExperiment(id) {
    const summary = this.getExperimentSummary(id);
    return this.updateExperiment(id, {
      status: EXPERIMENT_STATUS.COMPLETED,
      summary
    });
  }

  /**
   * Executes a single controlled, isolated experiment run
   */
  async runControlledRun(experimentId, group, runOptions = {}) {
    const exp = getExperimentById(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found.`);

    if (exp.status === EXPERIMENT_STATUS.DRAFT || exp.status === EXPERIMENT_STATUS.READY) {
      this.startExperiment(experimentId);
    }

    const runId = runOptions.runId || `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const workspaceSubdir = `workspace/experiments/${experimentId}/${runId}`;

    // Ensure isolated workspace directory exists
    const absWorkspaceSubdir = path.resolve(process.cwd(), workspaceSubdir);
    if (!fs.existsSync(absWorkspaceSubdir)) {
      fs.mkdirSync(absWorkspaceSubdir, { recursive: true });
    }

    // Determine group configuration
    let disableReuse = false;
    let explicitCapabilityId = null;
    let explicitCapabilityVersion = null;

    if (group === EXPERIMENT_GROUPS.BASELINE) {
      disableReuse = true; // Rule 3: BASELINE must explicitly disable capability reuse
    } else if (group === EXPERIMENT_GROUPS.REUSED) {
      explicitCapabilityId = runOptions.capabilityId || exp.reuseGroup?.capabilityId;
      explicitCapabilityVersion = runOptions.capabilityVersion || exp.reuseGroup?.capabilityVersion || 1;
    } else if (group === EXPERIMENT_GROUPS.EVOLVED) {
      explicitCapabilityId = runOptions.capabilityId || exp.evolvedGroup?.capabilityId;
      explicitCapabilityVersion = runOptions.capabilityVersion || exp.evolvedGroup?.capabilityVersion || 2;
    } else {
      throw new Error(`Invalid experiment group: ${group}`);
    }

    // Create target objective
    const goalText = runOptions.goal || exp.taskDefinition.goal;
    const obj = createObjective(goalText);

    // Prepare plan with experiment execution mode (isExperiment: true -> NO EVOLUTION SIDE EFFECTS)
    const prepRes = await evolutionService.createOrPrepareObjectivePlan(obj.id, goalText, {
      isExperiment: true,
      disableReuse,
      explicitCapabilityId,
      explicitCapabilityVersion,
      adaptedParams: {
        folder: `experiments/${experimentId}/${runId}`,
        targetDir: `experiments/${experimentId}/${runId}`
      }
    });

    if (!prepRes.success) {
      throw new Error(`Failed to prepare plan for experiment run: ${prepRes.error}`);
    }

    // Execute objective using existing ObjectiveRunner
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();

    const runResultObj = await runObjective(obj.id);
    const endMs = Date.now();
    const completedAt = new Date(endMs).toISOString();
    const executionDurationMs = Math.max(0, endMs - startMs);

    const finalObj = getObjectives().find((o) => o.id === obj.id) || runResultObj || obj;
    const isSuccess = finalObj.status === 'COMPLETED';

    const plan = Array.isArray(finalObj.plan) ? finalObj.plan : [];
    const stepCount = plan.length;
    const completedStepCount = plan.filter((s) => s.status === 'COMPLETED').length;
    const failedStepCount = plan.filter((s) => s.status === 'FAILED').length;
    const failedStepObj = plan.find((s) => s.status === 'FAILED');

    // Extract exact capability metadata captured at START
    const evoMeta = finalObj.evolution || {};
    const capId = evoMeta.capabilityId || explicitCapabilityId || null;
    const capVer = evoMeta.capabilityVersion || explicitCapabilityVersion || null;
    const execMode = evoMeta.executionMode || 'NORMAL_PLAN';

    const runRecord = {
      id: runId,
      experimentId,
      runNumber: (exp.completedRuns || 0) + 1,
      group,
      objectiveId: finalObj.id,
      capabilityId: capId,
      capabilityVersion: capVer,
      executionMode: execMode,
      startedAt,
      completedAt,
      success: isSuccess,
      failureReason: isSuccess ? null : (finalObj.currentStep || 'Execution failed'),
      failedStep: failedStepObj ? (failedStepObj.description || failedStepObj.action || failedStepObj.id) : null,
      stepCount,
      completedStepCount,
      failedStepCount,
      executionDurationMs,
      fixtureDirectory: workspaceSubdir,
      taskFingerprint: exp.taskFingerprint,
      configurationHash: exp.configuration?.configurationHash || 'cfg_default',
      fixtureVersion: exp.configuration?.fixtureVersion || EXPERIMENT_CONFIG.DEFAULT_FIXTURE_VERSION,
      createdAt: new Date().toISOString()
    };

    const savedRun = recordExperimentRun(runRecord);

    // Update experiment completedRuns count
    const updatedRunsCount = (exp.completedRuns || 0) + 1;
    this.updateExperiment(experimentId, {
      completedRuns: updatedRunsCount
    });

    return savedRun;
  }

  /**
   * Compares performance between two specific groups in an experiment
   */
  compareExperimentGroups(experimentId, group1, group2) {
    const runsGroup1 = getRunsByGroup(experimentId, group1);
    const runsGroup2 = getRunsByGroup(experimentId, group2);

    const metrics1 = evaluationService.calculateMetrics(runsGroup1);
    const metrics2 = evaluationService.calculateMetrics(runsGroup2);

    const isSufficient =
      runsGroup1.length >= EXPERIMENT_CONFIG.MIN_RUNS_PER_GROUP &&
      runsGroup2.length >= EXPERIMENT_CONFIG.MIN_RUNS_PER_GROUP;

    if (!isSufficient) {
      return {
        experimentId,
        group1,
        group2,
        evidenceSufficiency: false,
        classification: EXPERIMENT_RESULTS.INSUFFICIENT_EVIDENCE,
        message: 'Insufficient evidence: minimum 2 runs per group required.',
        metrics1,
        metrics2,
        successDelta: 0,
        durationDelta: 0,
        stepCountDelta: 0
      };
    }

    const successDelta = Number((metrics2.successRate - metrics1.successRate).toFixed(4));
    const durationDelta = metrics2.averageExecutionDurationMs - metrics1.averageExecutionDurationMs;
    const stepCountDelta = Number((metrics2.averageStepCount - metrics1.averageStepCount).toFixed(2));

    // Classification based on M6 deterministic rules
    let classification = EXPERIMENT_RESULTS.STABLE;
    if (successDelta <= -0.05 || (metrics2.averageExecutionDurationMs > metrics1.averageExecutionDurationMs * 1.30)) {
      classification = EXPERIMENT_RESULTS.REGRESSED;
    } else if (successDelta >= 0.05 || (metrics2.successRate >= metrics1.successRate && metrics2.averageStepCount < metrics1.averageStepCount)) {
      classification = EXPERIMENT_RESULTS.IMPROVED;
    }

    return {
      experimentId,
      group1,
      group2,
      evidenceSufficiency: true,
      classification,
      successDelta,
      durationDelta,
      stepCountDelta,
      metrics1,
      metrics2
    };
  }

  /**
   * Generates a comprehensive summary for an experiment
   */
  getExperimentSummary(experimentId) {
    const exp = getExperimentById(experimentId);
    if (!exp) return null;

    const runs = getRunsByExperiment(experimentId);
    const baselineRuns = runs.filter((r) => r.group === EXPERIMENT_GROUPS.BASELINE);
    const reusedRuns = runs.filter((r) => r.group === EXPERIMENT_GROUPS.REUSED);
    const evolvedRuns = runs.filter((r) => r.group === EXPERIMENT_GROUPS.EVOLVED);

    const baselineMetrics = evaluationService.calculateMetrics(baselineRuns);
    const reusedMetrics = evaluationService.calculateMetrics(reusedRuns);
    const evolvedMetrics = evaluationService.calculateMetrics(evolvedRuns);

    const baselineVsReused = this.compareExperimentGroups(experimentId, EXPERIMENT_GROUPS.BASELINE, EXPERIMENT_GROUPS.REUSED);
    const baselineVsEvolved = this.compareExperimentGroups(experimentId, EXPERIMENT_GROUPS.BASELINE, EXPERIMENT_GROUPS.EVOLVED);
    const reusedVsEvolved = this.compareExperimentGroups(experimentId, EXPERIMENT_GROUPS.REUSED, EXPERIMENT_GROUPS.EVOLVED);

    // Failure analysis aggregation
    const failedRuns = runs.filter((r) => !r.success);
    const failureCauses = {};
    failedRuns.forEach((r) => {
      const cause = r.failureReason || 'Unknown error';
      failureCauses[cause] = (failureCauses[cause] || 0) + 1;
    });

    let improvementsDetected = 0;
    let regressionsDetected = 0;

    [baselineVsReused, baselineVsEvolved, reusedVsEvolved].forEach((comp) => {
      if (comp.classification === EXPERIMENT_RESULTS.IMPROVED) improvementsDetected++;
      if (comp.classification === EXPERIMENT_RESULTS.REGRESSED) regressionsDetected++;
    });

    return {
      experimentId: exp.id,
      name: exp.name,
      status: exp.status,
      totalRuns: runs.length,
      baselineRunsCount: baselineRuns.length,
      reusedRunsCount: reusedRuns.length,
      evolvedRunsCount: evolvedRuns.length,
      baselineMetrics,
      reusedMetrics,
      evolvedMetrics,
      comparisons: {
        baselineVsReused,
        baselineVsEvolved,
        reusedVsEvolved
      },
      failureAnalysis: {
        totalFailedRuns: failedRuns.length,
        failureCauses
      },
      improvementsDetected,
      regressionsDetected
    };
  }

  /**
   * Compares two specific capability versions across all recorded experiment runs
   */
  compareCapabilityVersions(capabilityId, versionA, versionB) {
    const allRuns = getExperimentRuns();
    const runsA = allRuns.filter((r) => r.capabilityId === capabilityId && r.capabilityVersion === Number(versionA));
    const runsB = allRuns.filter((r) => r.capabilityId === capabilityId && r.capabilityVersion === Number(versionB));

    const metricsA = evaluationService.calculateMetrics(runsA);
    const metricsB = evaluationService.calculateMetrics(runsB);

    const isSufficient = runsA.length >= EXPERIMENT_CONFIG.MIN_RUNS_PER_GROUP && runsB.length >= EXPERIMENT_CONFIG.MIN_RUNS_PER_GROUP;

    if (!isSufficient) {
      return {
        capabilityId,
        versionA,
        versionB,
        evidenceSufficiency: false,
        classification: EXPERIMENT_RESULTS.INSUFFICIENT_EVIDENCE,
        message: 'Insufficient evidence to compare capability versions.',
        metricsA,
        metricsB
      };
    }

    const successDelta = Number((metricsB.successRate - metricsA.successRate).toFixed(4));
    const durationDelta = metricsB.averageExecutionDurationMs - metricsA.averageExecutionDurationMs;
    const stepCountDelta = Number((metricsB.averageStepCount - metricsA.averageStepCount).toFixed(2));

    let classification = EXPERIMENT_RESULTS.STABLE;
    if (successDelta <= -0.05 || (metricsB.averageExecutionDurationMs > metricsA.averageExecutionDurationMs * 1.30)) {
      classification = EXPERIMENT_RESULTS.REGRESSED;
    } else if (successDelta >= 0.05 || (metricsB.successRate >= metricsA.successRate && metricsB.averageStepCount < metricsA.averageStepCount)) {
      classification = EXPERIMENT_RESULTS.IMPROVED;
    }

    return {
      capabilityId,
      versionA,
      versionB,
      evidenceSufficiency: true,
      classification,
      successDelta,
      durationDelta,
      stepCountDelta,
      metricsA,
      metricsB
    };
  }
}

export const experimentService = new ExperimentService();
export default experimentService;
