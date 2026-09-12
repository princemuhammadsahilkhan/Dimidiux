/**
 * Stage 6A: Persistent Store for EVO Real Runtime Learning Records
 * Tracks and links structured learning evidence produced during objective execution.
 */

const RUNTIME_LEARNING_KEY = 'evo_runtime_learning_records';

import { getActiveSelfCodeVersion } from './selfCodeVersionStore.js';
import { getAutonomyPolicy } from './selfCodeOrchestratorStore.js';

export const LEARNING_CATEGORIES = {
  USER_EXECUTION: 'USER_EXECUTION',
  CAPABILITY_LEARNING: 'CAPABILITY_LEARNING',
  PERFORMANCE_DIAGNOSIS: 'PERFORMANCE_DIAGNOSIS',
  SELF_CODE_ANALYSIS: 'SELF_CODE_ANALYSIS',
  DESKTOP_INTERACTION: 'DESKTOP_INTERACTION',
  APPLICATION_CONTROL: 'APPLICATION_CONTROL'
};

export const LEARNING_STATUS = {
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  PENDING_REVIEW: 'PENDING_REVIEW'
};

/**
 * Validates a Runtime Learning Record schema
 */
export function validateRuntimeLearningRecordSchema(record) {
  if (!record || typeof record !== 'object') {
    return { valid: false, error: 'Runtime learning record must be an object.' };
  }
  if (!record.learningRunId || typeof record.learningRunId !== 'string') {
    return { valid: false, error: 'Runtime learning record missing learningRunId.' };
  }
  if (!record.objectiveId || typeof record.objectiveId !== 'string') {
    return { valid: false, error: 'Runtime learning record missing objectiveId.' };
  }
  if (!record.category || !Object.values(LEARNING_CATEGORIES).includes(record.category)) {
    return { valid: false, error: `Invalid runtime learning record category "${record.category}".` };
  }
  if (!Array.isArray(record.evidenceIds)) {
    return { valid: false, error: 'evidenceIds must be an array.' };
  }
  if (record.status && !Object.values(LEARNING_STATUS).includes(record.status)) {
    return { valid: false, error: `Invalid runtime learning status "${record.status}".` };
  }
  return { valid: true };
}

/**
 * Retrieves all runtime learning records from localStorage
 */
export function getRuntimeLearningRecords(filterOptions = {}) {
  const opts = filterOptions && typeof filterOptions === 'object' ? filterOptions : {};
  try {
    const data = localStorage.getItem(RUNTIME_LEARNING_KEY);
    let list = data ? JSON.parse(data) : [];
    if (!Array.isArray(list)) list = [];

    if (opts.category) {
      list = list.filter((r) => r.category === opts.category);
    }
    if (opts.capabilityId) {
      list = list.filter((r) => r.capabilityId === opts.capabilityId);
    }
    if (opts.status) {
      list = list.filter((r) => r.status === opts.status);
    }

    return list;
  } catch (e) {
    console.error('Failed to load runtime learning records from localStorage:', e);
    return [];
  }
}

/**
 * Persists all runtime learning records to localStorage
 */
export function saveRuntimeLearningRecords(records) {
  try {
    if (!Array.isArray(records)) return false;
    localStorage.setItem(RUNTIME_LEARNING_KEY, JSON.stringify(records));
    return true;
  } catch (e) {
    console.error('Failed to save runtime learning records to localStorage:', e);
    return false;
  }
}

/**
 * Retrieves a runtime learning record by objective ID
 */
export function getRuntimeLearningRecordByObjective(objectiveId) {
  if (!objectiveId) return null;
  const records = getRuntimeLearningRecords();
  return records.find((r) => r.objectiveId === objectiveId) || null;
}

/**
 * Retrieves a runtime learning record by learningRunId
 */
export function getRuntimeLearningRecordById(id) {
  if (!id) return null;
  const records = getRuntimeLearningRecords();
  return records.find((r) => r.learningRunId === id) || null;
}

/**
 * Creates and persists a new Runtime Learning Record with objective-level idempotency
 */
export function createRuntimeLearningRecord(data = {}) {
  if (!data.objectiveId) {
    console.error('Cannot create runtime learning record without objectiveId.');
    return null;
  }

  // Idempotency check: Return existing record if already completed
  const existing = getRuntimeLearningRecordByObjective(data.objectiveId);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const learningRunId = data.learningRunId || `lrn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const record = {
    learningRunId,
    objectiveId: data.objectiveId,
    goal: data.goal || '',
    category: data.category || LEARNING_CATEGORIES.USER_EXECUTION,
    evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds : [],
    capabilityId: data.capabilityId || null,
    capabilityVersion: typeof data.capabilityVersion === 'number' ? data.capabilityVersion : null,
    evaluationId: data.evaluationId || null,
    performanceMetricIds: Array.isArray(data.performanceMetricIds) ? data.performanceMetricIds : [],
    selfCodeProposalId: data.selfCodeProposalId || null,
    timestamps: {
      startedAt: data.timestamps?.startedAt || now,
      completedAt: data.timestamps?.completedAt || now,
      learnedAt: now
    },
    status: data.status || LEARNING_STATUS.COMPLETED,
    summary: {
      ...(data.summary || {}),
      success: Boolean(data.summary?.success),
      executionMode: data.summary?.executionMode || 'NORMAL_PLAN',
      executionDurationMs: typeof data.summary?.executionDurationMs === 'number' ? data.summary.executionDurationMs : 0,
      stepCount: typeof data.summary?.stepCount === 'number' ? data.summary.stepCount : 0,
      experienceCreated: Boolean(data.summary?.experienceCreated),
      evaluationResult: data.summary?.evaluationResult || null,
      proposalGenerated: Boolean(data.summary?.proposalGenerated),
      approvalRequired: Boolean(data.summary?.approvalRequired)
    }
  };

  const validation = validateRuntimeLearningRecordSchema(record);
  if (!validation.valid) {
    console.error('Refusing to save invalid runtime learning record:', validation.error);
    return null;
  }

  const records = getRuntimeLearningRecords();
  records.push(record);
  saveRuntimeLearningRecords(records);
  return record;
}

/**
 * Returns deterministic system-wide learning overview
 */
export function getSystemLearningOverview() {
  const records = getRuntimeLearningRecords();
  const total = records.length;

  const successfulCount = records.filter((r) => r.summary?.success).length;
  const failedCount = total - successfulCount;

  const userExecutionCount = records.filter((r) => r.category === LEARNING_CATEGORIES.USER_EXECUTION).length;
  const capabilityLearningCount = records.filter((r) => r.category === LEARNING_CATEGORIES.CAPABILITY_LEARNING).length;
  const performanceDiagnosisCount = records.filter((r) => r.category === LEARNING_CATEGORIES.PERFORMANCE_DIAGNOSIS).length;
  const selfCodeAnalysisCount = records.filter((r) => r.category === LEARNING_CATEGORIES.SELF_CODE_ANALYSIS).length;

  const proposalsGeneratedCount = records.filter((r) => r.summary?.proposalGenerated).length;
  const pendingReviewsCount = records.filter((r) => r.summary?.approvalRequired).length;

  const activeVersion = getActiveSelfCodeVersion();
  const autonomyPolicy = getAutonomyPolicy();

  return {
    totalLearningRecords: total,
    successfulObjectiveCount: successfulCount,
    failedObjectiveCount: failedCount,
    userExecutionCount,
    capabilityLearningCount,
    performanceDiagnosisCount,
    selfCodeAnalysisCount,
    proposalsGeneratedCount,
    pendingReviewsCount,
    currentActiveSelfCodeVersion: activeVersion,
    currentAutonomyMode: autonomyPolicy ? autonomyPolicy.mode : 'SUPERVISED'
  };
}

export const runtimeLearningStore = {
  LEARNING_CATEGORIES,
  LEARNING_STATUS,
  validateRuntimeLearningRecordSchema,
  getRuntimeLearningRecords,
  saveRuntimeLearningRecords,
  getRuntimeLearningRecordByObjective,
  getRuntimeLearningRecordById,
  createRuntimeLearningRecord,
  getSystemLearningOverview
};
