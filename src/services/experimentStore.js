/**
 * Step 9 — Milestone 7: Experiment & Benchmarking Store
 * Manages persistent storage for controlled experiments and isolated run results.
 */

import { EXPERIMENT_STATUS, EXPERIMENT_GROUPS } from '../config/experimentConfig.js';

const EXPERIMENTS_KEY = 'evo_experiments';
const EXPERIMENT_RUNS_KEY = 'evo_experiment_runs';

/**
 * Validates an experiment definition object
 */
export function validateExperimentSchema(exp) {
  if (!exp || typeof exp !== 'object') {
    return { valid: false, errors: ['Experiment must be an object.'] };
  }
  const errors = [];
  if (!exp.id || typeof exp.id !== 'string') errors.push('Missing or invalid id.');
  if (!exp.name || typeof exp.name !== 'string') errors.push('Missing or invalid name.');
  if (!exp.taskDefinition || typeof exp.taskDefinition !== 'object') errors.push('Missing or invalid taskDefinition.');
  if (!exp.taskFingerprint || typeof exp.taskFingerprint !== 'string') errors.push('Missing or invalid taskFingerprint.');
  if (!exp.status || !Object.values(EXPERIMENT_STATUS).includes(exp.status)) {
    errors.push(`Invalid status: ${exp.status}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates an experiment run record
 */
export function validateExperimentRunSchema(run) {
  if (!run || typeof run !== 'object') {
    return { valid: false, errors: ['Experiment run must be an object.'] };
  }
  const errors = [];
  if (!run.id || typeof run.id !== 'string') errors.push('Missing or invalid run id.');
  if (!run.experimentId || typeof run.experimentId !== 'string') errors.push('Missing or invalid experimentId.');
  if (!run.group || !Object.values(EXPERIMENT_GROUPS).includes(run.group)) {
    errors.push(`Invalid group: ${run.group}`);
  }
  if (!run.startedAt || typeof run.startedAt !== 'string') errors.push('Missing or invalid startedAt timestamp.');
  if (!run.completedAt || typeof run.completedAt !== 'string') errors.push('Missing or invalid completedAt timestamp.');
  if (typeof run.success !== 'boolean') errors.push('Missing or invalid boolean success.');
  if (typeof run.executionDurationMs !== 'number' || run.executionDurationMs < 0) {
    errors.push('Missing or invalid executionDurationMs.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Retrieves all experiments from localStorage
 */
export function getExperiments() {
  try {
    const data = localStorage.getItem(EXPERIMENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('Failed to load experiments from localStorage:', err);
    return [];
  }
}

/**
 * Persists all experiments to localStorage
 */
export function saveExperiments(experiments) {
  try {
    if (!Array.isArray(experiments)) return false;
    localStorage.setItem(EXPERIMENTS_KEY, JSON.stringify(experiments));
    return true;
  } catch (err) {
    console.error('Failed to save experiments to localStorage:', err);
    return false;
  }
}

/**
 * Gets a single experiment by ID
 */
export function getExperimentById(id) {
  if (!id) return null;
  const experiments = getExperiments();
  return experiments.find((e) => e.id === id) || null;
}

/**
 * Saves or updates a single experiment
 */
export function saveExperiment(experiment) {
  const schemaCheck = validateExperimentSchema(experiment);
  if (!schemaCheck.valid) {
    throw new Error(`Invalid experiment schema: ${schemaCheck.errors.join(', ')}`);
  }

  const experiments = getExperiments();
  const index = experiments.findIndex((e) => e.id === experiment.id);
  const updatedExp = {
    ...experiment,
    updatedAt: new Date().toISOString()
  };

  if (index >= 0) {
    experiments[index] = updatedExp;
  } else {
    experiments.push(updatedExp);
  }

  saveExperiments(experiments);
  return updatedExp;
}

/**
 * Retrieves all experiment runs from localStorage
 */
export function getExperimentRuns() {
  try {
    const data = localStorage.getItem(EXPERIMENT_RUNS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('Failed to load experiment runs from localStorage:', err);
    return [];
  }
}

/**
 * Persists all experiment runs to localStorage
 */
export function saveExperimentRuns(runs) {
  try {
    if (!Array.isArray(runs)) return false;
    localStorage.setItem(EXPERIMENT_RUNS_KEY, JSON.stringify(runs));
    return true;
  } catch (err) {
    console.error('Failed to save experiment runs to localStorage:', err);
    return false;
  }
}

/**
 * Records a single completed experiment run immutably
 */
export function recordExperimentRun(runData) {
  const schemaCheck = validateExperimentRunSchema(runData);
  if (!schemaCheck.valid) {
    throw new Error(`Invalid experiment run schema: ${schemaCheck.errors.join(', ')}`);
  }

  const runs = getExperimentRuns();
  // Immutable protection: Do not overwrite an existing completed run
  const existing = runs.find((r) => r.id === runData.id);
  if (existing) {
    return existing;
  }

  const record = {
    ...runData,
    createdAt: runData.createdAt || new Date().toISOString()
  };

  runs.push(record);
  saveExperimentRuns(runs);
  return record;
}

/**
 * Retrieves all runs for a specific experiment ID
 */
export function getRunsByExperiment(experimentId) {
  if (!experimentId) return [];
  const runs = getExperimentRuns();
  return runs.filter((r) => r.experimentId === experimentId);
}

/**
 * Retrieves all runs for a specific experiment ID and group
 */
export function getRunsByGroup(experimentId, group) {
  if (!experimentId || !group) return [];
  const runs = getRunsByExperiment(experimentId);
  return runs.filter((r) => r.group === group);
}
