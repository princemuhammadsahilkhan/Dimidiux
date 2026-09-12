/**
 * Dedicated Persistent Store for EVO Self-Code Improvement Proposals (Stage 5A)
 */

const SELF_CODE_STORAGE_KEY = 'evo_self_code_proposals';

export const SELF_CODE_PROPOSAL_STATUS = {
  PROPOSED: 'PROPOSED',
  TESTING: 'TESTING',
  VALIDATED: 'VALIDATED',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  REJECTED: 'REJECTED',
  APPLIED: 'APPLIED'
};

/**
 * Validates self-code improvement proposal schema
 */
export function validateSelfCodeProposalSchema(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    return { valid: false, error: 'Self-code proposal must be an object.' };
  }

  const reason = proposal.reason || proposal.description;
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return { valid: false, error: 'Self-code proposal must include a non-empty reason/description.' };
  }

  const targetFiles = proposal.targetFiles || (Array.isArray(proposal.proposedChanges) ? proposal.proposedChanges.map(c => c.filePath) : []);
  if (!Array.isArray(targetFiles) || targetFiles.length === 0) {
    return { valid: false, error: 'Self-code proposal must specify at least one targetFile.' };
  }

  if (proposal.status && !Object.values(SELF_CODE_PROPOSAL_STATUS).includes(proposal.status)) {
    return { valid: false, error: `Invalid self-code proposal status "${proposal.status}".` };
  }

  return { valid: true };
}

/**
 * Retrieves all stored self-code proposals
 */
export function getSelfCodeProposals() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SELF_CODE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load self-code proposals:', e);
    return [];
  }
}

/**
 * Persists all self-code proposals
 */
export function saveSelfCodeProposals(proposals) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SELF_CODE_STORAGE_KEY, JSON.stringify(proposals, null, 2));
  } catch (e) {
    console.error('Failed to save self-code proposals:', e);
  }
}

/**
 * Retrieves a single proposal by ID
 */
export function getSelfCodeProposalById(id) {
  const proposals = getSelfCodeProposals();
  return proposals.find((p) => p.id === id || p.proposalId === id) || null;
}

/**
 * Creates and stores a new self-code improvement proposal
 */
export function createSelfCodeProposal(data) {
  const validation = validateSelfCodeProposalSchema(data);
  if (!validation.valid) {
    return { success: false, error: validation.error, proposal: null };
  }

  const proposals = getSelfCodeProposals();
  const id = `scp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const targetFiles = data.targetFiles || (Array.isArray(data.proposedChanges) ? data.proposedChanges.map(c => c.filePath) : []);
  const proposedChanges = Array.isArray(data.proposedChanges) ? data.proposedChanges : [];

  const proposal = {
    id,
    proposalId: id,
    baseCommit: data.baseCommit || data.baseVersion || 'HEAD',
    baseVersion: data.baseVersion || data.baseCommit || 'v1.1.0-self-healing',
    problemStatement: data.problemStatement || '',
    evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds : [],
    affectedComponent: data.affectedComponent || '',
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.85,
    targetFiles,
    proposedChanges,
    reason: (data.reason || data.description || '').trim(),
    expectedImprovement: data.expectedImprovement || 'Performance or correctness improvement',
    status: SELF_CODE_PROPOSAL_STATUS.PROPOSED,
    createdAt: now,
    updatedAt: now,
    testResult: null,
    comparisonResult: null
  };

  proposals.unshift(proposal);
  saveSelfCodeProposals(proposals);

  return {
    success: true,
    proposal,
    id
  };
}

/**
 * Updates an existing self-code improvement proposal
 */
export function updateSelfCodeProposal(id, updates) {
  const proposals = getSelfCodeProposals();
  let updatedProposal = null;
  const now = new Date().toISOString();

  const updatedProposals = proposals.map((p) => {
    if (p.id === id || p.proposalId === id) {
      updatedProposal = {
        ...p,
        ...updates,
        updatedAt: now
      };
      return updatedProposal;
    }
    return p;
  });

  if (!updatedProposal) {
    return null;
  }

  saveSelfCodeProposals(updatedProposals);
  return updatedProposal;
}

export function rejectSelfCodeProposal(proposalId, reason = 'Operator rejected proposal') {
  return updateSelfCodeProposal(proposalId, {
    status: SELF_CODE_PROPOSAL_STATUS.REJECTED,
    rejectionReason: reason
  });
}
