/**
 * Step 9 — Milestone 7: Controlled Experimentation & Benchmarking Configuration
 * Centralizes experiment statuses, groups, minimum evidence thresholds, and results.
 */

export const EXPERIMENT_CONFIG = {
  MIN_RUNS_PER_GROUP: 2,
  DEFAULT_FIXTURE_VERSION: '1.0.0'
};

export const EXPERIMENT_STATUS = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

export const EXPERIMENT_GROUPS = {
  BASELINE: 'BASELINE',
  REUSED: 'REUSED',
  EVOLVED: 'EVOLVED'
};

export const EXPERIMENT_RESULTS = {
  IMPROVED: 'IMPROVED',
  STABLE: 'STABLE',
  REGRESSED: 'REGRESSED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE'
};
