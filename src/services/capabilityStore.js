const CAPABILITY_STORAGE_KEY = 'evo_capabilities';

export const CAPABILITY_STATUS = {
  CANDIDATE: 'CANDIDATE',
  VALIDATED: 'VALIDATED',
  REJECTED: 'REJECTED'
};

/**
 * Validates a capability candidate schema
 */
export function validateCapabilitySchema(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, error: 'Capability candidate must be an object.' };
  }
  if (!candidate.id || typeof candidate.id !== 'string') {
    return { valid: false, error: 'Capability candidate missing valid string id.' };
  }
  if (!candidate.name || typeof candidate.name !== 'string' || !candidate.name.trim()) {
    return { valid: false, error: 'Capability name must be a non-empty string.' };
  }
  if (typeof candidate.description !== 'string') {
    return { valid: false, error: 'Capability description must be a string.' };
  }
  if (!Array.isArray(candidate.sourceExperienceIds)) {
    return { valid: false, error: 'sourceExperienceIds must be an array.' };
  }
  if (!Array.isArray(candidate.workflowSteps) || candidate.workflowSteps.length === 0) {
    return { valid: false, error: 'workflowSteps must be a non-empty array.' };
  }
  if (!Object.values(CAPABILITY_STATUS).includes(candidate.status)) {
    return { valid: false, error: `Invalid capability status "${candidate.status}".` };
  }
  if (typeof candidate.evidenceCount !== 'number' || candidate.evidenceCount < 2) {
    return { valid: false, error: `evidenceCount must be a number >= 2 (got ${candidate.evidenceCount}).` };
  }
  return { valid: true };
}

/**
 * Retrieve all persisted capabilities
 */
export function getCapabilities() {
  try {
    const data = localStorage.getItem(CAPABILITY_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load capabilities from localStorage:', e);
    return [];
  }
}

/**
 * Save capabilities list to storage
 */
export function saveCapabilities(capabilities) {
  try {
    localStorage.setItem(CAPABILITY_STORAGE_KEY, JSON.stringify(capabilities));
  } catch (e) {
    console.error('Failed to save capabilities to localStorage:', e);
  }
}

/**
 * Normalizes workflow steps sequence to string key for duplicate detection
 */
export function computeWorkflowFingerprint(workflowSteps) {
  if (!Array.isArray(workflowSteps)) return '';
  return workflowSteps
    .map((s) => {
      const type = s.action ? s.action.type : (s.type || '');
      const path = s.action ? (s.action.path || s.action.destination || '') : (s.path || '');
      return `${type}:${path}`;
    })
    .join('->');
}

/**
 * Find existing capability candidate representing the same workflow
 */
export function findDuplicateCandidate(workflowSteps) {
  const capabilities = getCapabilities();
  const targetFp = computeWorkflowFingerprint(workflowSteps);
  if (!targetFp) return null;

  return capabilities.find((c) => {
    const capFp = computeWorkflowFingerprint(c.workflowSteps);
    return capFp === targetFp;
  }) || null;
}

/**
 * Create a new capability candidate or reinforce existing duplicate
 */
export function createCapabilityCandidate(data) {
  const now = new Date().toISOString();

  // Check for duplicate candidate
  const duplicate = findDuplicateCandidate(data.workflowSteps);
  if (duplicate) {
    const capabilities = getCapabilities();
    let updatedTarget = null;
    const updatedCaps = capabilities.map((c) => {
      if (c.id === duplicate.id) {
        const combinedExperienceIds = Array.from(
          new Set([...(c.sourceExperienceIds || []), ...(data.sourceExperienceIds || [])])
        );
        updatedTarget = {
          ...c,
          evidenceCount: c.evidenceCount + (data.evidenceCount || 1),
          sourceExperienceIds: combinedExperienceIds,
          updatedAt: now
        };
        return updatedTarget;
      }
      return c;
    });
    saveCapabilities(updatedCaps);
    return updatedTarget;
  }

  const newCandidate = {
    id: `cap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: data.name.trim(),
    description: (data.description || '').trim(),
    sourceExperienceIds: Array.isArray(data.sourceExperienceIds) ? data.sourceExperienceIds : [],
    workflowSteps: data.workflowSteps,
    status: CAPABILITY_STATUS.CANDIDATE, // MUST initially be CANDIDATE
    evidenceCount: data.evidenceCount || 2,
    version: 1,
    activeVersion: 1,
    versionHistory: [],
    rollbackHistory: [],
    usageCount: 0,
    successfulUseCount: 0,
    failedUseCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now
  };

  const validation = validateCapabilitySchema(newCandidate);
  if (!validation.valid) {
    console.error('Refusing to save invalid capability candidate schema:', validation.error);
    return null;
  }

  const capabilities = getCapabilities();
  const updated = [newCandidate, ...capabilities];
  saveCapabilities(updated);
  return newCandidate;
}

/**
 * Processed Evolution Objective Tracking (Rule 3 - Idempotency & Persistence)
 */
const PROCESSED_EVOLUTION_STORAGE_KEY = 'evo_processed_objectives';

export function getProcessedEvolutionObjectiveIds() {
  try {
    const data = localStorage.getItem(PROCESSED_EVOLUTION_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

export function isObjectiveProcessedForEvolution(objectiveId) {
  if (!objectiveId) return false;
  const processed = getProcessedEvolutionObjectiveIds();
  return processed.includes(objectiveId);
}

export function markObjectiveProcessedForEvolution(objectiveId) {
  if (!objectiveId) return;
  const processed = getProcessedEvolutionObjectiveIds();
  if (!processed.includes(objectiveId)) {
    processed.push(objectiveId);
    try {
      localStorage.setItem(PROCESSED_EVOLUTION_STORAGE_KEY, JSON.stringify(processed));
    } catch (e) {
      console.error('Failed to save processed evolution objective IDs:', e);
    }
  }
}

/**
 * Records version-specific usage statistics for a capability (Rule 6)
 */
export function recordCapabilityUsage(id, success, version) {
  const capabilities = getCapabilities();
  const now = new Date().toISOString();
  let updatedTarget = null;

  const updatedCaps = capabilities.map((c) => {
    if (c.id === id) {
      const targetVer = version || c.activeVersion || c.version || 1;
      const versionStats = c.versionStats || {};
      const currentVerStat = versionStats[targetVer] || {
        version: targetVer,
        usageCount: 0,
        successfulUseCount: 0,
        failedUseCount: 0,
        lastUsedAt: null
      };

      const updatedVerStat = {
        ...currentVerStat,
        usageCount: (currentVerStat.usageCount || 0) + 1,
        successfulUseCount: (currentVerStat.successfulUseCount || 0) + (success ? 1 : 0),
        failedUseCount: (currentVerStat.failedUseCount || 0) + (success ? 0 : 1),
        lastUsedAt: now
      };

      updatedTarget = {
        ...c,
        usageCount: (c.usageCount || 0) + 1,
        successfulUseCount: (c.successfulUseCount || 0) + (success ? 1 : 0),
        failedUseCount: (c.failedUseCount || 0) + (success ? 0 : 1),
        lastUsedAt: now,
        versionStats: {
          ...versionStats,
          [targetVer]: updatedVerStat
        },
        updatedAt: now
      };
      return updatedTarget;
    }
    return c;
  });

  if (updatedTarget) {
    saveCapabilities(updatedCaps);
  }
  return updatedTarget;
}

/**
 * Updates a capability candidate with validation results
 */
export function updateCapabilityValidation(id, validationData) {
  const capabilities = getCapabilities();
  const now = new Date().toISOString();
  let updatedTarget = null;

  const updatedCaps = capabilities.map((c) => {
    if (c.id === id) {
      const isSuccess = Boolean(validationData.success);
      const newStatus = isSuccess ? CAPABILITY_STATUS.VALIDATED : CAPABILITY_STATUS.REJECTED;
      updatedTarget = {
        ...c,
        status: newStatus,
        validationStatus: newStatus,
        validationResult: isSuccess,
        validationErrors: Array.isArray(validationData.errors) ? validationData.errors : [],
        validatedAt: now,
        validationVersion: '1.0',
        updatedAt: now
      };
      return updatedTarget;
    }
    return c;
  });

  if (updatedTarget) {
    saveCapabilities(updatedCaps);
  }
  return updatedTarget;
}

// ----------------------------------------------------
// Improvement Proposals Storage (Step 9 - Milestone 4)
// ----------------------------------------------------

const PROPOSAL_STORAGE_KEY = 'evo_capability_proposals';

export const PROPOSAL_STATUS = {
  PROPOSED: 'PROPOSED',
  VALIDATED: 'VALIDATED',
  REJECTED: 'REJECTED',
  APPLIED: 'APPLIED'
};

export function getImprovementProposals(capabilityId) {
  try {
    const data = localStorage.getItem(PROPOSAL_STORAGE_KEY);
    const list = data ? JSON.parse(data) : [];
    if (capabilityId) {
      return list.filter((p) => p.capabilityId === capabilityId);
    }
    return list;
  } catch (e) {
    console.error('Failed to load improvement proposals from localStorage:', e);
    return [];
  }
}

export function saveImprovementProposals(proposals) {
  try {
    localStorage.setItem(PROPOSAL_STORAGE_KEY, JSON.stringify(proposals));
  } catch (e) {
    console.error('Failed to save improvement proposals to localStorage:', e);
  }
}

export function createImprovementProposal(data) {
  const now = new Date().toISOString();

  const newProposal = {
    id: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    capabilityId: data.capabilityId,
    baseVersion: data.baseVersion || 1,
    proposedVersion: (data.baseVersion || 1) + 1,
    reason: (data.reason || '').trim(),
    evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds : [],
    changes: data.changes || {},
    workflowSteps: data.workflowSteps,
    status: PROPOSAL_STATUS.PROPOSED,
    validationStatus: 'NOT_TESTED',
    validationResult: null,
    validationErrors: [],
    createdAt: now,
    updatedAt: now,
    validatedAt: null
  };

  const current = getImprovementProposals();
  const updated = [newProposal, ...current];
  saveImprovementProposals(updated);
  return newProposal;
}

export function updateImprovementProposal(id, updates) {
  const proposals = getImprovementProposals();
  const now = new Date().toISOString();
  let updatedTarget = null;

  const updatedList = proposals.map((p) => {
    if (p.id === id) {
      updatedTarget = {
        ...p,
        ...updates,
        updatedAt: now
      };
      return updatedTarget;
    }
    return p;
  });

  if (updatedTarget) {
    saveImprovementProposals(updatedList);
  }
  return updatedTarget;
}
