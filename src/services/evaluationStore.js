import { EXECUTION_CATEGORIES, EVALUATION_RESULTS } from '../config/evaluationConfig.js';

const STORAGE_KEY = 'evo_evaluations';

export function getEvaluations() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load evaluations from localStorage:', e);
    return [];
  }
}

export function saveEvaluations(evaluations) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(evaluations));
  } catch (e) {
    console.error('Failed to save evaluations to localStorage:', e);
  }
}

export function validateEvaluationSchema(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Evaluation record must be a non-null object.' };
  }

  if (typeof data.id !== 'string' || !data.id.trim()) {
    return { valid: false, error: 'Evaluation record must have a valid string "id".' };
  }

  if (typeof data.objectiveId !== 'string' || !data.objectiveId.trim()) {
    return { valid: false, error: 'Evaluation record must have a valid string "objectiveId".' };
  }

  if (typeof data.goal !== 'string') {
    return { valid: false, error: 'Evaluation record must have a string "goal".' };
  }

  if (typeof data.success !== 'boolean') {
    return { valid: false, error: 'Evaluation record must have boolean "success".' };
  }

  if (!Object.values(EXECUTION_CATEGORIES).includes(data.executionCategory)) {
    return { valid: false, error: `Invalid executionCategory "${data.executionCategory}".` };
  }

  if (!Object.values(EVALUATION_RESULTS).includes(data.evaluationResult)) {
    return { valid: false, error: `Invalid evaluationResult "${data.evaluationResult}".` };
  }

  if (typeof data.stepCount !== 'number' || data.stepCount < 0) {
    return { valid: false, error: 'stepCount must be a non-negative number.' };
  }

  if (typeof data.executionDurationMs !== 'number' || data.executionDurationMs < 0) {
    return { valid: false, error: 'executionDurationMs must be a non-negative number.' };
  }

  return { valid: true };
}

export function recordEvaluation(data) {
  const now = new Date().toISOString();
  const newRecord = {
    id: data.id || `eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    objectiveId: data.objectiveId,
    capabilityId: data.capabilityId || null,
    capabilityVersion: typeof data.capabilityVersion === 'number' ? data.capabilityVersion : null,
    executionMode: data.executionMode || 'NORMAL_PLAN',
    executionCategory: data.executionCategory || EXECUTION_CATEGORIES.BASELINE,
    goal: data.goal || '',
    startedAt: data.startedAt || now,
    completedAt: data.completedAt || now,
    success: Boolean(data.success),
    failureReason: data.failureReason || null,
    stepCount: typeof data.stepCount === 'number' ? data.stepCount : 0,
    completedStepCount: typeof data.completedStepCount === 'number' ? data.completedStepCount : 0,
    failedStepCount: typeof data.failedStepCount === 'number' ? data.failedStepCount : 0,
    executionDurationMs: typeof data.executionDurationMs === 'number' ? data.executionDurationMs : 0,
    reusedCapability: Boolean(data.reusedCapability),
    matchedConfidence: typeof data.matchedConfidence === 'number' ? data.matchedConfidence : null,
    evaluationResult: data.evaluationResult || EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE,
    createdAt: now
  };

  const validation = validateEvaluationSchema(newRecord);
  if (!validation.valid) {
    console.error('Refusing to persist invalid evaluation record:', validation.error);
    return null;
  }

  const current = getEvaluations();
  // Duplicate check: Prevent duplicate evaluation for same objectiveId
  const existing = current.find((e) => e.objectiveId === newRecord.objectiveId);
  if (existing) {
    return existing;
  }

  const updated = [newRecord, ...current];
  saveEvaluations(updated);
  return newRecord;
}

export function getEvaluationsByObjective(objectiveId) {
  if (!objectiveId) return null;
  const current = getEvaluations();
  return current.find((e) => e.objectiveId === objectiveId) || null;
}

export function getEvaluationsByCapability(capabilityId, version = null) {
  if (!capabilityId) return [];
  const current = getEvaluations();
  return current.filter((e) => {
    if (e.capabilityId !== capabilityId) return false;
    if (version !== null && version !== undefined) {
      return e.capabilityVersion === version;
    }
    return true;
  });
}
