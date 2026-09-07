const MEMORY_STORAGE_KEY = 'evo_memories';

export const MEMORY_TYPES = {
  USER_PREFERENCE: 'USER_PREFERENCE',
  PROJECT_CONTEXT: 'PROJECT_CONTEXT',
  WORKFLOW: 'WORKFLOW',
  EXPERIENCE: 'EXPERIENCE',
  CORRECTION: 'CORRECTION'
};

export const MEMORY_SOURCES = {
  EXPLICIT_USER: 'EXPLICIT_USER',
  OBSERVED_BEHAVIOR: 'OBSERVED_BEHAVIOR',
  INFERRED_PREFERENCE: 'INFERRED_PREFERENCE',
  OBJECTIVE_RESULT: 'OBJECTIVE_RESULT',
  ASSUMPTION: 'ASSUMPTION'
};

export const MEMORY_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED'
};

/**
 * Validates a memory item schema
 */
export function validateMemorySchema(item) {
  if (!item || typeof item !== 'object') {
    return { valid: false, error: 'Memory item must be an object.' };
  }
  if (!item.id || typeof item.id !== 'string') {
    return { valid: false, error: 'Memory item missing valid string id.' };
  }
  if (!Object.values(MEMORY_TYPES).includes(item.type)) {
    return { valid: false, error: `Invalid memory type "${item.type}".` };
  }
  if (typeof item.content !== 'string' || !item.content.trim()) {
    return { valid: false, error: 'Memory content must be a non-empty string.' };
  }
  if (!Object.values(MEMORY_SOURCES).includes(item.source)) {
    return { valid: false, error: `Invalid memory source "${item.source}".` };
  }
  if (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1) {
    return { valid: false, error: `Confidence must be a number between 0 and 1 (got ${item.confidence}).` };
  }
  if (typeof item.evidenceCount !== 'number' || item.evidenceCount < 1) {
    return { valid: false, error: 'evidenceCount must be a positive integer >= 1.' };
  }
  if (!Object.values(MEMORY_STATUS).includes(item.status)) {
    return { valid: false, error: `Invalid status "${item.status}".` };
  }
  return { valid: true };
}

/**
 * Retrieve all persisted memory items
 */
export function getMemories() {
  try {
    const data = localStorage.getItem(MEMORY_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load memories from localStorage:', e);
    return [];
  }
}

/**
 * Save memory items list to storage
 */
export function saveMemories(memories) {
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memories));
  } catch (e) {
    console.error('Failed to save memories to localStorage:', e);
  }
}

/**
 * Normalizes content string for comparison
 */
function normalizeContent(str) {
  return str ? str.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim() : '';
}

/**
 * Find duplicate active memory item
 */
export function findDuplicateMemory(type, content) {
  const memories = getMemories();
  const normTarget = normalizeContent(content);
  return memories.find((m) => {
    if (m.status !== MEMORY_STATUS.ACTIVE) return false;
    if (m.type !== type) return false;
    const normItem = normalizeContent(m.content);
    return normItem === normTarget || normItem.includes(normTarget) || normTarget.includes(normItem);
  }) || null;
}

/**
 * Create a new memory item or reinforce existing duplicate
 */
export function createMemory(data) {
  const now = new Date().toISOString();
  const type = data.type || MEMORY_TYPES.EXPERIENCE;
  const source = data.source || MEMORY_SOURCES.OBSERVED_BEHAVIOR;
  
  let initialConfidence = data.confidence;
  if (initialConfidence === undefined) {
    if (source === MEMORY_SOURCES.EXPLICIT_USER) initialConfidence = 0.95;
    else if (source === MEMORY_SOURCES.OBJECTIVE_RESULT) initialConfidence = 0.8;
    else initialConfidence = 0.4;
  }
  initialConfidence = Math.max(0, Math.min(1.0, initialConfidence));

  // Check for duplicate active memory item
  const duplicate = findDuplicateMemory(type, data.content);
  if (duplicate) {
    return reinforceMemory(duplicate.id, {
      confidenceDelta: 0.05,
      content: data.content,
      context: data.context || duplicate.context
    });
  }

  const newItem = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    content: data.content.trim(),
    context: data.context ? data.context.trim() : '',
    source,
    confidence: initialConfidence,
    evidenceCount: data.evidenceCount || 1,
    lastEvidenceAt: now,
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
    status: MEMORY_STATUS.ACTIVE
  };

  const validation = validateMemorySchema(newItem);
  if (!validation.valid) {
    console.error('Refusing to save invalid memory schema:', validation.error);
    return null;
  }

  const memories = getMemories();
  const updated = [newItem, ...memories];
  saveMemories(updated);
  return newItem;
}

/**
 * Reinforce an existing memory with new evidence
 */
export function reinforceMemory(id, options = {}) {
  const memories = getMemories();
  const now = new Date().toISOString();
  let target = null;

  const updated = memories.map((m) => {
    if (m.id === id) {
      const delta = options.confidenceDelta !== undefined ? options.confidenceDelta : 0.05;
      const newConfidence = Math.max(0, Math.min(1.0, m.confidence + delta));
      target = {
        ...m,
        confidence: Number(newConfidence.toFixed(3)),
        evidenceCount: m.evidenceCount + 1,
        lastEvidenceAt: now,
        updatedAt: now,
        content: options.content ? options.content.trim() : m.content,
        context: options.context ? options.context.trim() : m.context
      };
      return target;
    }
    return m;
  });

  if (target) {
    saveMemories(updated);
  }
  return target;
}

/**
 * Update confidence explicitly
 */
export function updateConfidence(id, newConfidence) {
  const memories = getMemories();
  const now = new Date().toISOString();
  const clamped = Math.max(0, Math.min(1.0, newConfidence));
  let target = null;

  const updated = memories.map((m) => {
    if (m.id === id) {
      target = {
        ...m,
        confidence: Number(clamped.toFixed(3)),
        updatedAt: now
      };
      return target;
    }
    return m;
  });

  if (target) {
    saveMemories(updated);
  }
  return target;
}

/**
 * Archive a memory item
 */
export function archiveMemory(id) {
  const memories = getMemories();
  const now = new Date().toISOString();
  let target = null;

  const updated = memories.map((m) => {
    if (m.id === id) {
      target = { ...m, status: MEMORY_STATUS.ARCHIVED, updatedAt: now };
      return target;
    }
    return m;
  });

  if (target) {
    saveMemories(updated);
  }
  return target;
}

/**
 * Restore an archived memory item
 */
export function restoreMemory(id) {
  const memories = getMemories();
  const now = new Date().toISOString();
  let target = null;

  const updated = memories.map((m) => {
    if (m.id === id) {
      target = { ...m, status: MEMORY_STATUS.ACTIVE, updatedAt: now };
      return target;
    }
    return m;
  });

  if (target) {
    saveMemories(updated);
  }
  return target;
}

/**
 * Increment usage count when a memory item is retrieved and passed to planner
 */
export function incrementUsageCount(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const memories = getMemories();
  const updated = memories.map((m) => {
    if (ids.includes(m.id)) {
      return { ...m, usageCount: m.usageCount + 1 };
    }
    return m;
  });
  saveMemories(updated);
}
