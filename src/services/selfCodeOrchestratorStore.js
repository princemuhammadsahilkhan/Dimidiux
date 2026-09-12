/**
 * Stage 5D: Persistent Store & Policy Configuration for EVO Self-Improvement Orchestrator
 */

const AUTONOMY_POLICY_STORAGE_KEY = 'evo_self_improvement_policy';
const RUNS_STORAGE_KEY = 'evo_self_improvement_runs';

export const AUTONOMY_MODES = {
  SUPERVISED: 'SUPERVISED',
  AUTONOMOUS: 'AUTONOMOUS'
};

export const DEFAULT_AUTONOMY_POLICY = {
  mode: AUTONOMY_MODES.SUPERVISED,
  cooldownMs: 300000, // 5 minutes post-promotion cooldown
  maxAutonomousPromotionsPerWindow: 2, // Max 2 autonomous promotions
  rateLimitWindowMs: 86400000, // Per 24-hour window
  maxFailedProposalsBeforeSupervised: 3, // Requires supervised review after 3 failures
  changeBudget: {
    maxFilesChanged: 3,
    maxLinesChanged: 500
  }
};

/**
 * Retrieves persistent autonomy policy
 */
export function getAutonomyPolicy() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_AUTONOMY_POLICY };
  try {
    const raw = localStorage.getItem(AUTONOMY_POLICY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTONOMY_POLICY };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_AUTONOMY_POLICY,
      ...parsed,
      changeBudget: {
        ...DEFAULT_AUTONOMY_POLICY.changeBudget,
        ...(parsed.changeBudget || {})
      }
    };
  } catch (e) {
    console.error('Failed to load autonomy policy:', e);
    return { ...DEFAULT_AUTONOMY_POLICY };
  }
}

/**
 * Saves full autonomy policy
 */
export function saveAutonomyPolicy(policy) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(AUTONOMY_POLICY_STORAGE_KEY, JSON.stringify(policy, null, 2));
  } catch (e) {
    console.error('Failed to save autonomy policy:', e);
  }
}

/**
 * Updates autonomy policy partially
 */
export function updateAutonomyPolicy(updates = {}) {
  const current = getAutonomyPolicy();
  const updated = {
    ...current,
    ...updates,
    changeBudget: {
      ...current.changeBudget,
      ...(updates.changeBudget || {})
    }
  };
  saveAutonomyPolicy(updated);
  return updated;
}

/**
 * Resets autonomy policy to strict default (SUPERVISED)
 */
export function resetAutonomyPolicyToDefault() {
  saveAutonomyPolicy({ ...DEFAULT_AUTONOMY_POLICY });
  return { ...DEFAULT_AUTONOMY_POLICY };
}

/**
 * Retrieves all persistent self-improvement run records
 */
export function getSelfImprovementRuns() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RUNS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load self-improvement runs:', e);
    return [];
  }
}

/**
 * Persists all self-improvement run records
 */
export function saveSelfImprovementRuns(runs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs, null, 2));
  } catch (e) {
    console.error('Failed to save self-improvement runs:', e);
  }
}

/**
 * Retrieves a single run record by ID
 */
export function getSelfImprovementRunById(id) {
  const runs = getSelfImprovementRuns();
  return runs.find((r) => r.id === id || r.runId === id) || null;
}

const PROMOTION_LOCK_STORAGE_KEY = 'evo_self_improvement_lock';

/**
 * Checks if a self-code promotion is currently locked in-memory/persisted
 */
export function isPromotionLocked() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(PROMOTION_LOCK_STORAGE_KEY);
    if (!raw) return false;
    const lock = JSON.parse(raw);
    if (Date.now() - (lock.acquiredAt || 0) > 60000) {
      localStorage.removeItem(PROMOTION_LOCK_STORAGE_KEY);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Acquires the promotion lock for concurrent execution protection
 */
export function acquirePromotionLock(ownerId = 'orchestrator') {
  if (isPromotionLocked()) {
    return { acquired: false, reason: 'Promotion lock active: another self-improvement promotion is currently in progress.' };
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PROMOTION_LOCK_STORAGE_KEY, JSON.stringify({
        ownerId,
        acquiredAt: Date.now()
      }));
    } catch (e) {}
  }
  return { acquired: true };
}

/**
 * Releases the promotion lock
 */
export function releasePromotionLock(ownerId = 'orchestrator') {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(PROMOTION_LOCK_STORAGE_KEY);
    } catch (e) {}
  }
  return { released: true };
}

/**
 * Creates and stores a new structured self-improvement run record (Req 14)
 */
export function createSelfImprovementRun(data = {}) {
  const runs = getSelfImprovementRuns();
  const id = data.runId || data.id || `sir_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const runRecord = {
    id,
    runId: id,
    evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds : [],
    proposalId: data.proposalId || null,
    baseVersion: data.baseVersion || 'v1.1.0-self-healing',
    candidateFingerprint: data.candidateFingerprint || null,
    sandboxResult: data.sandboxResult || null,
    comparisonResult: data.comparisonResult || null,
    promotionResult: data.promotionResult || null,
    healthResult: data.healthResult || null,
    rollbackResult: data.rollbackResult || null,
    timestamps: {
      startedAt: data.startedAt || now,
      completedAt: data.completedAt || null
    },
    autonomyMode: data.autonomyMode || getAutonomyPolicy().mode,
    status: data.status || 'STARTED',
    approvalReason: data.approvalReason || null,
    stopReason: data.stopReason || null,
    logs: Array.isArray(data.logs) ? data.logs : [],
    auditEvents: Array.isArray(data.auditEvents) ? data.auditEvents : []
  };

  runs.unshift(runRecord);
  saveSelfImprovementRuns(runs);

  return runRecord;
}

/**
 * Updates an existing self-improvement run record
 */
export function updateSelfImprovementRun(id, updates = {}) {
  const runs = getSelfImprovementRuns();
  let updatedRun = null;
  const now = new Date().toISOString();

  const updatedRuns = runs.map((r) => {
    if (r.id === id || r.runId === id) {
      updatedRun = {
        ...r,
        ...updates,
        timestamps: {
          ...r.timestamps,
          ...(updates.timestamps || {}),
          updatedAt: now
        }
      };
      return updatedRun;
    }
    return r;
  });

  if (!updatedRun) return null;

  saveSelfImprovementRuns(updatedRuns);
  return updatedRun;
}

/**
 * Helper to count recent autonomous promotions for rate limiting
 */
export function getRecentPromotionsCount(windowMs = 86400000) {
  const runs = getSelfImprovementRuns();
  const now = Date.now();
  return runs.filter((r) => {
    if (r.status !== 'PROMOTED' || r.autonomyMode !== AUTONOMY_MODES.AUTONOMOUS) return false;
    const completedAt = r.timestamps && r.timestamps.completedAt ? new Date(r.timestamps.completedAt).getTime() : 0;
    return now - completedAt <= windowMs;
  }).length;
}

/**
 * Helper to get timestamp of last promotion for cooldown checking
 */
export function getLastPromotionTimestamp() {
  const runs = getSelfImprovementRuns();
  const promotedRuns = runs.filter((r) => r.status === 'PROMOTED' && r.timestamps && r.timestamps.completedAt);
  if (promotedRuns.length === 0) return 0;
  return new Date(promotedRuns[0].timestamps.completedAt).getTime();
}

/**
 * Helper to count consecutive failed proposals for safety thresholding
 */
export function getRecentFailedProposalsCount() {
  const runs = getSelfImprovementRuns();
  let count = 0;
  for (const r of runs) {
    if (r.status === 'REJECTED' || r.status === 'FAILED') {
      count++;
    } else if (r.status === 'PROMOTED') {
      break;
    }
  }
  return count;
}
