/**
 * Persistent Store for EVO Self-Code Versioning, Comparison, and Rollback State (Stage 5C)
 */

const SELF_CODE_VERSION_STORAGE_KEY = 'evo_self_code_version_state';
export const DEFAULT_SELF_CODE_VERSION = 'v1.1.0-self-healing';

export const SELF_CODE_COMPARISON_RESULTS = {
  IMPROVED: 'IMPROVED',
  STABLE: 'STABLE',
  REGRESSED: 'REGRESSED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE'
};

/**
 * Returns default initial self-code version state
 */
export function getDefaultVersionState() {
  const now = new Date().toISOString();
  return {
    activeVersion: DEFAULT_SELF_CODE_VERSION,
    versionHistory: [
      {
        versionId: DEFAULT_SELF_CODE_VERSION,
        baseVersion: 'v1.0.0',
        proposalId: null,
        changedFiles: [],
        promotedAt: now,
        promotionReason: 'Initial baseline production version',
        testResults: { passedCount: 50, failedCount: 0 },
        comparisonResults: { classification: SELF_CODE_COMPARISON_RESULTS.STABLE },
        status: 'ACTIVE'
      }
    ],
    rollbackHistory: []
  };
}

/**
 * Retrieves persistent self-code version state
 */
export function getSelfCodeVersionState() {
  if (typeof localStorage === 'undefined') return getDefaultVersionState();
  try {
    const raw = localStorage.getItem(SELF_CODE_VERSION_STORAGE_KEY);
    if (!raw) return getDefaultVersionState();
    const state = JSON.parse(raw);
    if (!state || !state.activeVersion) return getDefaultVersionState();
    return state;
  } catch (e) {
    console.error('Failed to load self-code version state:', e);
    return getDefaultVersionState();
  }
}

/**
 * Persists self-code version state
 */
export function saveSelfCodeVersionState(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SELF_CODE_VERSION_STORAGE_KEY, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save self-code version state:', e);
  }
}

/**
 * Returns currently active self-code version ID string
 */
export function getActiveSelfCodeVersion() {
  const state = getSelfCodeVersionState();
  return state.activeVersion || DEFAULT_SELF_CODE_VERSION;
}

/**
 * Records a new self-code promotion in persistent version state
 */
export function recordSelfCodePromotionRecord(versionData) {
  const state = getSelfCodeVersionState();
  const now = new Date().toISOString();

  const newVersionRecord = {
    versionId: versionData.versionId,
    baseVersion: versionData.baseVersion || state.activeVersion,
    proposalId: versionData.proposalId,
    changedFiles: Array.isArray(versionData.changedFiles) ? versionData.changedFiles : [],
    promotedAt: now,
    promotionReason: versionData.promotionReason || 'Controlled Stage 5C self-code promotion',
    testResults: versionData.testResults || null,
    comparisonResults: versionData.comparisonResults || null,
    fingerprint: versionData.fingerprint || null,
    sourceBackups: versionData.sourceBackups || null,
    status: 'ACTIVE'
  };

  // Set previous active records to INACTIVE
  const updatedHistory = (state.versionHistory || []).map((h) => ({
    ...h,
    status: 'INACTIVE'
  }));

  updatedHistory.unshift(newVersionRecord);

  const updatedState = {
    ...state,
    activeVersion: versionData.versionId,
    versionHistory: updatedHistory
  };

  saveSelfCodeVersionState(updatedState);
  return updatedState;
}

/**
 * Records a self-code rollback in persistent version state
 */
export function recordSelfCodeRollbackRecord(rollbackData) {
  const state = getSelfCodeVersionState();
  const now = new Date().toISOString();

  const rollbackRecord = {
    id: `sc_rb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    fromVersion: rollbackData.fromVersion || state.activeVersion,
    toVersion: rollbackData.toVersion,
    reason: (rollbackData.reason || 'Self-code rollback').trim(),
    timestamp: now
  };

  const updatedHistory = (state.versionHistory || []).map((h) => {
    if (h.versionId === rollbackData.toVersion) {
      return { ...h, status: 'ACTIVE' };
    } else if (h.versionId === rollbackData.fromVersion) {
      return { ...h, status: 'ROLLED_BACK' };
    }
    return h;
  });

  const updatedState = {
    ...state,
    activeVersion: rollbackData.toVersion,
    versionHistory: updatedHistory,
    rollbackHistory: [rollbackRecord, ...(state.rollbackHistory || [])]
  };

  saveSelfCodeVersionState(updatedState);
  return updatedState;
}
