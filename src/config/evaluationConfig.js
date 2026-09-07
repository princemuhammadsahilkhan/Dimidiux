/**
 * Centralized Evaluation Thresholds & Deterministic Rules Configuration (Milestone 6)
 */
export const EVALUATION_CONFIG = {
  // Minimum evaluations required per version/capability to classify beyond INSUFFICIENT_EVIDENCE
  MIN_EVIDENCE_THRESHOLD: 2,

  // Minimum success rate delta required to classify as IMPROVED (e.g. +5%)
  MIN_SUCCESS_RATE_IMPROVEMENT: 0.05,

  // Maximum acceptable duration multiplier before flagging potential REGRESSED execution time (e.g. +30%)
  MAX_ACCEPTABLE_DURATION_MULTIPLIER: 1.30,

  // Maximum acceptable failure rate delta before flagging REGRESSED (+5%)
  MAX_ACCEPTABLE_FAILURE_RATE_DELTA: 0.05
};

export const EXECUTION_CATEGORIES = {
  BASELINE: 'BASELINE',
  REUSED: 'REUSED',
  IMPROVED_VERSION: 'IMPROVED_VERSION'
};

export const EVALUATION_RESULTS = {
  IMPROVED: 'IMPROVED',
  STABLE: 'STABLE',
  REGRESSED: 'REGRESSED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE'
};
