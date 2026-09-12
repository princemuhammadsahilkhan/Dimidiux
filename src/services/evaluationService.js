import {
  EVALUATION_CONFIG,
  EXECUTION_CATEGORIES,
  EVALUATION_RESULTS
} from '../config/evaluationConfig.js';
import {
  getEvaluations,
  recordEvaluation,
  getEvaluationsByObjective,
  getEvaluationsByCapability
} from './evaluationStore.js';
import { getCapabilities } from './capabilityStore.js';
import { getObjectives } from './objectiveStore.js';

export class EvaluationService {
  /**
   * Helper: Calculates deterministic summary metrics for an array of evaluation records
   */
  calculateMetrics(evaluations) {
    const total = evaluations.length;
    if (total === 0) {
      return {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        failureRate: 0,
        averageExecutionDurationMs: 0,
        averageStepCount: 0,
        averageCompletedSteps: 0,
        averageFailedSteps: 0
      };
    }

    const successCount = evaluations.filter((e) => e.success).length;
    const failureCount = total - successCount;
    const totalDuration = evaluations.reduce((sum, e) => sum + (e.executionDurationMs || 0), 0);
    const totalSteps = evaluations.reduce((sum, e) => sum + (e.stepCount || 0), 0);
    const totalCompleted = evaluations.reduce((sum, e) => sum + (e.completedStepCount || 0), 0);
    const totalFailed = evaluations.reduce((sum, e) => sum + (e.failedStepCount || 0), 0);

    return {
      usageCount: total,
      successCount,
      failureCount,
      successRate: Number((successCount / total).toFixed(4)),
      failureRate: Number((failureCount / total).toFixed(4)),
      averageExecutionDurationMs: Math.round(totalDuration / total),
      averageStepCount: Number((totalSteps / total).toFixed(2)),
      averageCompletedSteps: Number((totalCompleted / total).toFixed(2)),
      averageFailedSteps: Number((totalFailed / total).toFixed(2))
    };
  }

  /**
   * Classifies an evaluation result deterministically based on historical evidence
   */
  classifyEvaluationResult(capabilityId, capabilityVersion, executionCategory, isSuccess, durationMs, stepCount) {
    if (!capabilityId || executionCategory === EXECUTION_CATEGORIES.BASELINE) {
      return EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE;
    }

    const currentVersionEvals = getEvaluationsByCapability(capabilityId, capabilityVersion);
    const totalCurrentCount = currentVersionEvals.length + 1; // including current

    // Evidence Threshold Rule: Must have at least MIN_EVIDENCE_THRESHOLD evaluations
    if (totalCurrentCount < EVALUATION_CONFIG.MIN_EVIDENCE_THRESHOLD) {
      return EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE;
    }

    // Determine baseline / previous comparison group
    let compEvals = [];
    if (capabilityVersion > 1) {
      // Compare against prior version (e.g. v1)
      compEvals = getEvaluationsByCapability(capabilityId, capabilityVersion - 1);
    } else {
      // Compare against baseline / general evaluations for same capability
      compEvals = getEvaluationsByCapability(capabilityId, 1);
    }

    if (compEvals.length === 0) {
      return EVALUATION_RESULTS.STABLE;
    }

    const currentMetrics = this.calculateMetrics([...currentVersionEvals, { success: isSuccess, executionDurationMs: durationMs, stepCount }]);
    const compMetrics = this.calculateMetrics(compEvals);

    // Regression Detection Checks
    const successRateDrop = compMetrics.successRate - currentMetrics.successRate;
    const durationMultiplier = compMetrics.averageExecutionDurationMs > 0
      ? currentMetrics.averageExecutionDurationMs / compMetrics.averageExecutionDurationMs
      : 1.0;

    if (
      successRateDrop > EVALUATION_CONFIG.MAX_ACCEPTABLE_FAILURE_RATE_DELTA ||
      durationMultiplier > EVALUATION_CONFIG.MAX_ACCEPTABLE_DURATION_MULTIPLIER ||
      (currentMetrics.failureCount > compMetrics.failureCount && currentMetrics.successRate < compMetrics.successRate)
    ) {
      return EVALUATION_RESULTS.REGRESSED;
    }

    // Improvement Detection Checks
    const successRateGain = currentMetrics.successRate - compMetrics.successRate;
    if (
      successRateGain >= EVALUATION_CONFIG.MIN_SUCCESS_RATE_IMPROVEMENT ||
      (currentMetrics.successRate >= compMetrics.successRate && currentMetrics.averageStepCount < compMetrics.averageStepCount)
    ) {
      return EVALUATION_RESULTS.IMPROVED;
    }

    return EVALUATION_RESULTS.STABLE;
  }

  /**
   * Records evaluation for a completed or failed objective
   */
  recordObjectiveEvaluation(objective) {
    if (!objective || !objective.id) return null;

    // Idempotency check: Return existing evaluation record if already evaluated
    const existing = getEvaluationsByObjective(objective.id);
    if (existing) return existing;

    const isSuccess = objective.status === 'COMPLETED';
    const plan = Array.isArray(objective.plan) ? objective.plan : [];
    const stepCount = plan.length;
    const completedStepCount = plan.filter((s) => s.status === 'COMPLETED').length;
    const failedStepCount = plan.filter((s) => s.status === 'FAILED').length;

    // Calculate execution duration
    const startedAt = objective.createdAt || new Date().toISOString();
    const completedAt = objective.updatedAt || new Date().toISOString();
    const startMs = new Date(startedAt).getTime();
    const endMs = new Date(completedAt).getTime();
    const executionDurationMs = Math.max(0, endMs - startMs);

    // Extract evolution metadata captured at EXECUTION START
    const evoMeta = objective.evolution || {};
    const capabilityId = evoMeta.capabilityId || null;
    const capabilityVersion = typeof evoMeta.capabilityVersion === 'number' ? evoMeta.capabilityVersion : null;
    const executionMode = evoMeta.executionMode || 'NORMAL_PLAN';
    const reusedCapability = Boolean(evoMeta.reusedCapability);
    const matchedConfidence = typeof evoMeta.matchedConfidence === 'number' ? evoMeta.matchedConfidence : null;

    // Determine executionCategory
    let executionCategory = EXECUTION_CATEGORIES.BASELINE;
    if (reusedCapability && capabilityId) {
      if (capabilityVersion && capabilityVersion > 1) {
        executionCategory = EXECUTION_CATEGORIES.IMPROVED_VERSION;
      } else {
        executionCategory = EXECUTION_CATEGORIES.REUSED;
      }
    }

    // Determine evaluationResult
    const evaluationResult = this.classifyEvaluationResult(
      capabilityId,
      capabilityVersion,
      executionCategory,
      isSuccess,
      executionDurationMs,
      stepCount
    );

    const record = {
      objectiveId: objective.id,
      capabilityId,
      capabilityVersion,
      executionMode,
      executionCategory,
      goal: objective.goal || '',
      startedAt,
      completedAt,
      success: isSuccess,
      failureReason: isSuccess ? null : (objective.currentStep || 'Objective failed'),
      stepCount,
      completedStepCount,
      failedStepCount,
      executionDurationMs,
      reusedCapability,
      matchedConfidence,
      evaluationResult
    };

    return recordEvaluation(record);
  }

  /**
   * Evaluates performance for a specific capability version
   */
  evaluateCapabilityVersion(capabilityId, version) {
    const evals = getEvaluationsByCapability(capabilityId, version);
    const metrics = this.calculateMetrics(evals);

    return {
      capabilityId,
      version,
      usageCount: metrics.usageCount,
      versionSuccessRate: metrics.successRate,
      versionFailureRate: metrics.failureRate,
      averageExecutionDurationMs: metrics.averageExecutionDurationMs,
      averageStepCount: metrics.averageStepCount,
      averageCompletedSteps: metrics.averageCompletedSteps,
      averageFailedSteps: metrics.averageFailedSteps,
      evidenceSufficiency: metrics.usageCount >= EVALUATION_CONFIG.MIN_EVIDENCE_THRESHOLD
    };
  }

  /**
   * Evaluates overall capability performance across all versions
   */
  evaluateCapability(capabilityId) {
    const capabilities = getCapabilities();
    const cap = capabilities.find((c) => c.id === capabilityId);

    if (!cap) {
      return { success: false, error: 'Capability not found.' };
    }

    const allEvals = getEvaluationsByCapability(capabilityId);
    const activeVer = cap.activeVersion || cap.version || 1;

    // Build version summaries
    const versionHistory = cap.versionHistory || [];
    const versionsToEval = Array.from(new Set([1, activeVer, ...versionHistory.map((h) => h.version)]));
    const versionSummaries = {};

    for (const v of versionsToEval) {
      versionSummaries[v] = this.evaluateCapabilityVersion(capabilityId, v);
    }

    const activeVerSummary = versionSummaries[activeVer] || this.evaluateCapabilityVersion(capabilityId, activeVer);
    const totalEvaluations = allEvals.length;
    const isSufficient = totalEvaluations >= EVALUATION_CONFIG.MIN_EVIDENCE_THRESHOLD;

    let overallResult = EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE;
    if (isSufficient) {
      if (activeVer > 1 && versionSummaries[1]) {
        const v1Rate = versionSummaries[1].versionSuccessRate;
        const vCurrRate = activeVerSummary.versionSuccessRate;
        if (vCurrRate < v1Rate - EVALUATION_CONFIG.MAX_ACCEPTABLE_FAILURE_RATE_DELTA) {
          overallResult = EVALUATION_RESULTS.REGRESSED;
        } else if (vCurrRate >= v1Rate + EVALUATION_CONFIG.MIN_SUCCESS_RATE_IMPROVEMENT) {
          overallResult = EVALUATION_RESULTS.IMPROVED;
        } else {
          overallResult = EVALUATION_RESULTS.STABLE;
        }
      } else {
        overallResult = EVALUATION_RESULTS.STABLE;
      }
    }

    return {
      success: true,
      capabilityId: cap.id,
      name: cap.name,
      status: cap.status,
      activeVersion: activeVer,
      totalEvaluations,
      evidenceSufficiency: isSufficient,
      overallEvaluationResult: overallResult,
      activeVersionSummary: activeVerSummary,
      versionSummaries
    };
  }

  /**
   * Evaluates an objective using its persisted evaluation record
   */
  evaluateObjective(objectiveId) {
    const evalRecord = getEvaluationsByObjective(objectiveId);
    if (!evalRecord) {
      const objectives = getObjectives();
      const obj = objectives.find((o) => o.id === objectiveId);
      if (!obj) return null;
      return {
        objectiveId,
        goal: obj.goal,
        status: obj.status,
        evaluationRecord: null,
        message: 'No evaluation record found for this objective.'
      };
    }

    return {
      objectiveId: evalRecord.objectiveId,
      goal: evalRecord.goal,
      executionMode: evalRecord.executionMode,
      executionCategory: evalRecord.executionCategory,
      capabilityId: evalRecord.capabilityId,
      capabilityVersion: evalRecord.capabilityVersion,
      success: evalRecord.success,
      executionDurationMs: evalRecord.executionDurationMs,
      stepCount: evalRecord.stepCount,
      completedStepCount: evalRecord.completedStepCount,
      failedStepCount: evalRecord.failedStepCount,
      evaluationResult: evalRecord.evaluationResult
    };
  }

  /**
   * Generates system-wide evaluation summary statistics
   */
  getEvaluationSummary() {
    const evaluations = getEvaluations();
    const metrics = this.calculateMetrics(evaluations);

    const baselineExecutions = evaluations.filter((e) => e.executionCategory === EXECUTION_CATEGORIES.BASELINE).length;
    const reusedExecutions = evaluations.filter((e) => e.executionCategory === EXECUTION_CATEGORIES.REUSED).length;
    const improvedExecutions = evaluations.filter((e) => e.executionCategory === EXECUTION_CATEGORIES.IMPROVED_VERSION).length;

    const capabilityIdsEvaluated = Array.from(new Set(evaluations.filter((e) => e.capabilityId).map((e) => e.capabilityId)));
    const versionPairsEvaluated = Array.from(new Set(evaluations.filter((e) => e.capabilityId && e.capabilityVersion).map((e) => `${e.capabilityId}_v${e.capabilityVersion}`)));

    const improvementsDetected = evaluations.filter((e) => e.evaluationResult === EVALUATION_RESULTS.IMPROVED).length;
    const regressionsDetected = evaluations.filter((e) => e.evaluationResult === EVALUATION_RESULTS.REGRESSED).length;
    const insufficientEvidenceCount = evaluations.filter((e) => e.evaluationResult === EVALUATION_RESULTS.INSUFFICIENT_EVIDENCE).length;

    return {
      totalEvaluations: metrics.usageCount,
      successfulEvaluations: metrics.successCount,
      failedEvaluations: metrics.failureCount,
      overallSuccessRate: metrics.successRate,
      baselineExecutions,
      reusedExecutions,
      improvedExecutions,
      capabilityCountEvaluated: capabilityIdsEvaluated.length,
      versionCountEvaluated: versionPairsEvaluated.length,
      improvementsDetected,
      regressionsDetected,
      insufficientEvidenceCount
    };
  }

  /**
   * Stage 5F: Passive Read-Only Detection of Duration Regressions
   */
  detectDurationRegressions(evaluationsList = null, options = {}) {
    const evals = Array.isArray(evaluationsList) ? evaluationsList : getEvaluations();
    const minSessions = options.minSessions || 3;
    const minMultiplier = options.minMultiplier || 2.5;
    const maxCv = options.maxCv || 0.40;

    if (!evals || evals.length === 0) {
      return { detected: false, reason: 'No evaluations available.', metric: null };
    }

    // Filter out environmental failures (ENOENT, EACCES, network error)
    const validEvals = evals.filter((e) => {
      if (!e || e.success === false) {
        const reason = String(e ? e.failureReason || '' : '').toLowerCase();
        if (reason.includes('enoent') || reason.includes('eacces') || reason.includes('permission denied') || reason.includes('network error')) {
          return false;
        }
      }
      return true;
    });

    // Group evaluations by objective ID to ensure multi-session evidence
    const objMap = {};
    validEvals.forEach((e) => {
      const objId = e.objectiveId || 'unknown';
      if (!objMap[objId]) objMap[objId] = [];
      objMap[objId].push(e);
    });

    const objIds = Object.keys(objMap);
    if (objIds.length < minSessions) {
      return {
        detected: false,
        reason: `Insufficient distinct objectives/sessions for duration regression (got ${objIds.length}, required >= ${minSessions}).`,
        metric: null
      };
    }

    // Calculate duration statistics across valid evaluations
    const durations = validEvals.map((e) => e.executionDurationMs || 0).filter((d) => d > 0);
    if (durations.length < minSessions) {
      return { detected: false, reason: 'Insufficient duration data across sessions.', metric: null };
    }

    // Split into historical baseline (first half) and recent observed (second half)
    const mid = Math.floor(durations.length / 2);
    const sliceIdx = mid > 0 ? mid : 1;
    const baselineDurations = durations.slice(0, sliceIdx);
    const observedDurations = durations.slice(sliceIdx);

    const baseMean = baselineDurations.reduce((a, b) => a + b, 0) / baselineDurations.length;
    const obsMean = observedDurations.reduce((a, b) => a + b, 0) / observedDurations.length;

    if (baseMean <= 0 || obsMean <= 0) {
      return { detected: false, reason: 'Invalid non-positive duration baseline.', metric: null };
    }

    const multiplier = obsMean / baseMean;
    if (multiplier < minMultiplier) {
      return {
        detected: false,
        reason: `Duration multiplier ${multiplier.toFixed(2)}x is below required threshold ${minMultiplier}x.`,
        metric: null
      };
    }

    // Stability Rule: Calculate Coefficient of Variation (stdDev / mean) for observed set
    const obsVariance = observedDurations.reduce((sum, d) => sum + Math.pow(d - obsMean, 2), 0) / observedDurations.length;
    const obsStdDev = Math.sqrt(obsVariance);
    const cv = obsMean > 0 ? obsStdDev / obsMean : 0;

    if (cv > maxCv) {
      return {
        detected: false,
        reason: `Unstable high variance (coefficient of variation ${cv.toFixed(2)} exceeds max ${maxCv}). Sample rejected.`,
        metric: null
      };
    }

    const sampleEvalIds = validEvals.map((e) => e.id || e.objectiveId);

    const metric = {
      id: `metric_duration_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      metricType: 'DURATION_REGRESSION',
      affectedComponent: 'executionEngine',
      targetFiles: ['src/services/executionEngine.js'],
      sampleSize: objIds.length,
      baselineValue: Math.round(baseMean),
      observedValue: Math.round(obsMean),
      multiplier: Number(multiplier.toFixed(2)),
      evidenceIds: sampleEvalIds,
      normalization: { fileCount: options.fileCount || 1, cv: Number(cv.toFixed(4)) },
      timestamp: new Date().toISOString()
    };

    return {
      detected: true,
      metric
    };
  }

  /**
   * Stage 5F: Passive Read-Only Detection of Planning Overhead / Step Bloat
   */
  detectPlanningOverhead(evaluationsList = null, options = {}) {
    const evals = Array.isArray(evaluationsList) ? evaluationsList : getEvaluations();
    const minSessions = options.minSessions || 3;
    const minMultiplier = options.minMultiplier || 2.5;

    if (!evals || evals.length === 0) {
      return { detected: false, reason: 'No evaluations available.', metric: null };
    }

    // Exclude capability reuse executions (must be dynamic planning) and environmental failures
    const coreEvals = evals.filter((e) => {
      if (e.reusedCapability || e.capabilityId) return false;
      if (e.success === false) {
        const reason = String(e.failureReason || '').toLowerCase();
        if (reason.includes('enoent') || reason.includes('eacces') || reason.includes('permission denied')) {
          return false;
        }
      }
      return true;
    });

    const objMap = {};
    coreEvals.forEach((e) => {
      const objId = e.objectiveId || 'unknown';
      if (!objMap[objId]) objMap[objId] = [];
      objMap[objId].push(e);
    });

    const objIds = Object.keys(objMap);
    if (objIds.length < minSessions) {
      return {
        detected: false,
        reason: `Insufficient distinct objectives/sessions for planning overhead (got ${objIds.length}, required >= ${minSessions}).`,
        metric: null
      };
    }

    const stepCounts = coreEvals.map((e) => e.stepCount || 0).filter((s) => s > 0);
    if (stepCounts.length < minSessions) {
      return { detected: false, reason: 'Insufficient step count data across sessions.', metric: null };
    }

    const mid = Math.floor(stepCounts.length / 2);
    const baseMean = stepCounts.slice(0, mid > 0 ? mid : 1).reduce((a, b) => a + b, 0) / (mid > 0 ? mid : 1);
    const obsMean = stepCounts.slice(mid > 0 ? mid : 1).reduce((a, b) => a + b, 0) / (stepCounts.length - (mid > 0 ? mid : 1));

    if (baseMean <= 0) {
      return { detected: false, reason: 'Invalid non-positive step count baseline.', metric: null };
    }

    const multiplier = obsMean / baseMean;
    if (multiplier < minMultiplier) {
      return {
        detected: false,
        reason: `Step bloat multiplier ${multiplier.toFixed(2)}x below threshold ${minMultiplier}x.`,
        metric: null
      };
    }

    const metric = {
      id: `metric_planning_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      metricType: 'PLANNING_OVERHEAD',
      affectedComponent: 'plannerService',
      targetFiles: ['src/services/plannerService.js'],
      sampleSize: objIds.length,
      baselineValue: Math.round(baseMean),
      observedValue: Math.round(obsMean),
      multiplier: Number(multiplier.toFixed(2)),
      evidenceIds: coreEvals.map((e) => e.id || e.objectiveId),
      normalization: { averageSteps: Number(obsMean.toFixed(2)) },
      timestamp: new Date().toISOString()
    };

    return {
      detected: true,
      metric
    };
  }
}

export const evaluationService = new EvaluationService();

