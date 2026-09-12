import {
  getMemories,
  createMemory,
  reinforceMemory,
  archiveMemory,
  updateConfidence,
  incrementUsageCount,
  MEMORY_TYPES,
  MEMORY_SOURCES,
  MEMORY_STATUS
} from './memoryStore.js';
import { computeWorkflowFingerprint } from './capabilityStore.js';

// Centralized Sensitive Data Filter (Requirement 8)
const SENSITIVE_PATTERNS = [
  /password\s*(is|[:=])\s*\S+/i,
  /api[_-]?key\s*(is|[:=])\s*\S+/i,
  /secret[_-]?key\s*(is|[:=])\s*\S+/i,
  /auth[_-]?token\s*(is|[:=])\s*\S+/i,
  /bearer\s+[a-zA-Z0-9._-]+/i,
  /private[_-]?key/i,
  /-----BEGIN (RSA|EC|DSA|OPENSSH|PRIVATE) KEY-----/i,
  /postgres:\/\/\S+/i,
  /mongodb(\+srv)?:\/\/\S+/i,
  /mysql:\/\/\S+/i,
  /access[_-]?token/i,
  /credentials/i
];

export function isSensitiveMemoryCandidate(candidateText) {
  if (!candidateText || typeof candidateText !== 'string') return true;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(candidateText)) {
      return true;
    }
  }
  return false;
}

/**
 * Tokenize string into lowercase alphanumeric keywords
 */
function tokenize(str) {
  if (!str || typeof str !== 'string') return [];
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
}

/**
 * Deterministic Memory Search & Ranking (Requirement 6 & 7)
 */
export function searchMemory(query, contextStr = '', maxResults = 5) {
  const memories = getMemories().filter((m) => m.status === MEMORY_STATUS.ACTIVE);
  const queryTokens = tokenize(query);
  const contextTokens = tokenize(contextStr);
  const allTargetTokens = Array.from(new Set([...queryTokens, ...contextTokens]));

  if (allTargetTokens.length === 0) {
    return [];
  }

  const now = Date.now();

  const scored = memories.map((mem) => {
    const memTokens = tokenize(`${mem.content} ${mem.context || ''}`);
    if (memTokens.length === 0) return { mem, score: 0 };

    let tokenMatches = 0;
    allTargetTokens.forEach((t) => {
      if (memTokens.includes(t)) tokenMatches++;
    });

    if (tokenMatches === 0) return { mem, score: 0 };

    const relevance = tokenMatches / allTargetTokens.length;
    const confidenceWeight = mem.confidence;
    const evidenceWeight = Math.min(1.0, mem.evidenceCount / 5);

    const ageInDays = (now - new Date(mem.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyWeight = Math.max(0.1, 1.0 - (ageInDays / 30));

    const usageWeight = Math.min(1.0, (mem.usageCount || 0) / 10);

    let typeBoost = 1.0;
    if (mem.type === MEMORY_TYPES.CORRECTION) typeBoost = 1.5;
    else if (mem.type === MEMORY_TYPES.USER_PREFERENCE) typeBoost = 1.3;
    else if (mem.type === MEMORY_TYPES.WORKFLOW) typeBoost = 1.2;

    const finalScore =
      (relevance * 0.45 +
      confidenceWeight * 0.25 +
      evidenceWeight * 0.15 +
      recencyWeight * 0.10 +
      usageWeight * 0.05) * typeBoost;

    return { mem, score: finalScore };
  });

  // Filter items with score > 0 and sort descending by score
  const filtered = scored.filter((s) => s.score > 0.15);
  filtered.sort((a, b) => b.score - a.score);

  const topItems = filtered.slice(0, maxResults).map((s) => s.mem);

  if (topItems.length > 0) {
    incrementUsageCount(topItems.map((m) => m.id));
  }

  return topItems;
}

/**
 * Explicit User Correction Handler (Requirements 5 & 10)
 */
export function recordCorrection(correctionText, contextStr = '') {
  if (isSensitiveMemoryCandidate(correctionText)) {
    console.warn('Rejected memory candidate: Contains sensitive data.');
    return null;
  }

  const memories = getMemories();
  const correctionTokens = tokenize(correctionText);

  // Contradiction Handling: lower confidence/archive older memories contradicted by explicit correction
  memories.forEach((m) => {
    if (m.status === MEMORY_STATUS.ACTIVE && (m.type === MEMORY_TYPES.USER_PREFERENCE || m.type === MEMORY_TYPES.CORRECTION)) {
      const mTokens = tokenize(m.content);
      const overlap = correctionTokens.filter((t) => mTokens.includes(t));
      if (overlap.length >= 2 && m.source !== MEMORY_SOURCES.EXPLICIT_USER) {
        archiveMemory(m.id);
      } else if (overlap.length >= 2) {
        updateConfidence(m.id, Math.max(0.1, m.confidence - 0.4));
      }
    }
  });

  return createMemory({
    type: MEMORY_TYPES.CORRECTION,
    content: correctionText.trim(),
    context: contextStr ? contextStr.trim() : '',
    source: MEMORY_SOURCES.EXPLICIT_USER,
    confidence: 0.95
  });
}

/**
 * Extract structured Experience record post-objective execution (Requirement 1 & 9)
 */
export function extractExperienceFromObjective(objective) {
  if (!objective || !objective.id || !objective.goal) return null;

  const plan = Array.isArray(objective.plan) ? objective.plan : [];
  const completedCount = plan.filter((s) => s.status === 'COMPLETED').length;
  const failedCount = plan.filter((s) => s.status === 'FAILED').length;
  const outcome = objective.status === 'COMPLETED' ? 'SUCCESS' : 'FAILED';

  const majorActions = plan
    .filter((s) => s.action && s.action.type)
    .map((s) => s.action.type);
  const uniqueActions = Array.from(new Set(majorActions));

  const content = `Objective "${objective.goal}" finished with outcome ${outcome}. Completed ${completedCount}/${plan.length} steps. Actions used: [${uniqueActions.join(', ')}].`;

  if (isSensitiveMemoryCandidate(content)) {
    return null;
  }

  const workflowFingerprint = computeWorkflowFingerprint(plan);

  const expMem = createMemory({
    type: MEMORY_TYPES.EXPERIENCE,
    content,
    context: objective.goal,
    workflowFingerprint: workflowFingerprint || null,
    source: MEMORY_SOURCES.OBJECTIVE_RESULT,
    confidence: 0.85
  });

  // Conservative Workflow Promotion (Requirement 1 & 14)
  // Single successful execution alone does NOT create a WORKFLOW.
  // Workflow creation requires evidence of repeated consistent procedure (evidenceCount >= 2).
  if (outcome === 'SUCCESS' && plan.length >= 2) {
    const workflowSummary = `Workflow for "${objective.goal}": ` + plan.map((s) => s.title).join(' -> ');
    const existingWorkflow = getMemories().find(
      (m) => m.status === MEMORY_STATUS.ACTIVE && m.type === MEMORY_TYPES.WORKFLOW && m.content === workflowSummary
    );

    if (existingWorkflow) {
      reinforceMemory(existingWorkflow.id, { confidenceDelta: 0.1 });
    } else {
      const existingExp = getMemories().find(
        (m) => m.type === MEMORY_TYPES.EXPERIENCE && ((workflowFingerprint && m.workflowFingerprint === workflowFingerprint) || m.context === objective.goal)
      );
      if (existingExp && existingExp.evidenceCount >= 2) {
        createMemory({
          type: MEMORY_TYPES.WORKFLOW,
          content: workflowSummary,
          context: objective.goal,
          source: MEMORY_SOURCES.OBSERVED_BEHAVIOR,
          confidence: 0.6,
          evidenceCount: existingExp.evidenceCount
        });
      }
    }
  }

  return expMem;
}

export const memoryService = {
  isSensitiveMemoryCandidate,
  search: searchMemory,
  recordCorrection,
  extractExperienceFromObjective
};
