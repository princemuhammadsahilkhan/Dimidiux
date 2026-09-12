/**
 * Step 10: Action Event Store & Audit Timeline
 * Manages persistent storage of ActionEvent records for tool auditability, timeline reconstruction, and input redaction.
 */

const ACTION_EVENTS_KEY = 'evo_action_events';

/**
 * Redacts sensitive values in input objects (password, secret, token, key, credentials)
 */
export function redactSensitiveInputs(inputs) {
  if (!inputs || typeof inputs !== 'object') return {};
  const sensitiveKeys = ['password', 'secret', 'token', 'key', 'credential', 'auth', 'private'];
  const redacted = {};

  for (const [k, v] of Object.entries(inputs)) {
    const isSensitive = sensitiveKeys.some((s) => k.toLowerCase().includes(s));
    if (isSensitive) {
      redacted[k] = '[REDACTED]';
    } else if (typeof v === 'string' && sensitiveKeys.some((s) => v.toLowerCase().includes(s))) {
      redacted[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      redacted[k] = redactSensitiveInputs(v);
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

/**
 * Generates a deterministic hash string for input parameters
 */
export function generateInputHash(inputs) {
  if (!inputs) return 'hash_none';
  const raw = JSON.stringify(inputs);
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `hash_${Math.abs(hash).toString(36)}`;
}

/**
 * Retrieves all action events from localStorage
 */
export function getActionEvents() {
  try {
    const data = localStorage.getItem(ACTION_EVENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load action events from localStorage:', e);
    return [];
  }
}

/**
 * Persists all action events to localStorage
 */
export function saveActionEvents(events) {
  try {
    if (!Array.isArray(events)) return false;
    localStorage.setItem(ACTION_EVENTS_KEY, JSON.stringify(events));
    return true;
  } catch (e) {
    console.error('Failed to save action events to localStorage:', e);
    return false;
  }
}

/**
 * Records a new ActionEvent for audit logging
 */
export function recordActionEvent(eventData) {
  if (!eventData || typeof eventData !== 'object') {
    throw new Error('ActionEvent data must be an object.');
  }

  const rawInputs = eventData.inputs || {};
  const redactedInputs = redactSensitiveInputs(rawInputs);
  const inputHash = generateInputHash(rawInputs);

  const record = {
    ...eventData,
    id: eventData.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    objectiveId: eventData.objectiveId || 'unknown_obj',
    stepId: eventData.stepId || null,
    tool: eventData.tool || 'unknown_tool',
    inputHash,
    redactedInputs,
    startedAt: eventData.startedAt || new Date().toISOString(),
    completedAt: eventData.completedAt || new Date().toISOString(),
    durationMs: typeof eventData.durationMs === 'number' ? eventData.durationMs : 0,
    outcome: eventData.outcome || (eventData.success ? 'SUCCESS' : 'FAILED'),
    verificationResult: eventData.verificationResult || null,
    errorMessage: eventData.errorMessage || eventData.error || null,
    reversibilityMetadata: eventData.reversibilityMetadata || null,
    capabilityId: eventData.capabilityId || null,
    capabilityVersion: eventData.capabilityVersion || null,
    autonomyMode: eventData.autonomyMode || 'NORMAL',
    humanIntervention: Boolean(eventData.humanIntervention),
    createdAt: new Date().toISOString()
  };

  const events = getActionEvents();
  events.push(record);
  saveActionEvents(events);
  return record;
}

/**
 * Returns all action events for a specific objective
 */
export function getEventsByObjective(objectiveId) {
  if (!objectiveId) return [];
  const events = getActionEvents();
  return events.filter((e) => e.objectiveId === objectiveId);
}

/**
 * Reconstructs complete objective execution history and audit log
 */
export function reconstructObjectiveTimeline(objectiveId) {
  const events = getEventsByObjective(objectiveId);
  events.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  return {
    success: true,
    objectiveId,
    totalEventsCount: events.length,
    successfulEventsCount: events.filter((e) => e.outcome === 'SUCCESS').length,
    failedEventsCount: events.filter((e) => e.outcome === 'FAILED').length,
    humanInterventionsCount: events.filter((e) => e.humanIntervention).length,
    summary: {
      totalEvents: events.length,
      successfulEvents: events.filter((e) => e.outcome === 'SUCCESS').length,
      failedEvents: events.filter((e) => e.outcome === 'FAILED').length
    },
    timeline: events
  };
}

/**
 * Stage 5F: Passive Read-Only Detection of Redundant Operations across Action Events
 */
export function detectRedundantOperations(eventsList = null, options = {}) {
  const events = Array.isArray(eventsList) ? eventsList : getActionEvents();
  const minSessions = options.minSessions || 3;
  const minRatio = options.minRedundancyRatio || 0.30;

  if (!events || events.length === 0) {
    return { detected: false, reason: 'No action events available.', metric: null };
  }

  // Filter out capability workflow executions (Rule 3: Capability redundancy is CAPABILITY_WORKFLOW)
  const coreEvents = events.filter((e) => !e.capabilityId && !e.reusedCapability);
  const capEvents = events.filter((e) => Boolean(e.capabilityId || e.reusedCapability));

  // Check if redundancy belongs to capability workflows
  const capHashCounts = {};
  capEvents.forEach((e) => {
    if (e.inputHash && e.inputHash !== 'hash_none') {
      const key = `${e.tool}:${e.inputHash}`;
      capHashCounts[key] = (capHashCounts[key] || 0) + 1;
    }
  });

  const hasCapRedundancy = Object.values(capHashCounts).some((count) => count >= 2);

  if (coreEvents.length === 0) {
    if (hasCapRedundancy) {
      return {
        detected: false,
        category: 'CAPABILITY_WORKFLOW',
        reason: 'Redundant operations detected inside capability workflow (CAPABILITY_WORKFLOW). No core self-code proposal generated.',
        metric: null
      };
    }
    return { detected: false, reason: 'No core EVO action events available.', metric: null };
  }

  // Group core events by objective
  const objMap = {};
  coreEvents.forEach((e) => {
    const objId = e.objectiveId || 'unknown';
    if (!objMap[objId]) objMap[objId] = [];
    objMap[objId].push(e);
  });

  const objIds = Object.keys(objMap);
  if (objIds.length < minSessions) {
    return {
      detected: false,
      reason: `Insufficient distinct objectives/sessions for redundant operations (got ${objIds.length}, required >= ${minSessions}).`,
      metric: null
    };
  }

  // Check for repeated identical tool operations (same tool + same inputHash) across objectives
  const hashObjMap = {};
  const sampleEvtIds = new Set();
  let totalOps = 0;
  let redundantOps = 0;

  coreEvents.forEach((e) => {
    if (e.inputHash && e.inputHash !== 'hash_none') {
      totalOps++;
      const key = `${e.tool}:${e.inputHash}`;
      if (!hashObjMap[key]) hashObjMap[key] = new Set();
      hashObjMap[key].add(e.objectiveId);
      sampleEvtIds.add(e.id);
    }
  });

  // Find hash keys that recur across >= minSessions distinct objectives
  const recurringKeys = Object.keys(hashObjMap).filter((k) => hashObjMap[k].size >= minSessions);

  if (recurringKeys.length === 0) {
    return {
      detected: false,
      reason: `No recurring identical tool operations found across >= ${minSessions} distinct objectives.`,
      metric: null
    };
  }

  // Count total redundant ops for recurring keys
  coreEvents.forEach((e) => {
    const key = `${e.tool}:${e.inputHash}`;
    if (recurringKeys.includes(key)) {
      redundantOps++;
    }
  });

  const redundancyRatio = totalOps > 0 ? Number((redundantOps / totalOps).toFixed(4)) : 0;

  if (redundancyRatio < minRatio) {
    return {
      detected: false,
      reason: `Redundancy ratio ${redundancyRatio} below threshold ${minRatio}.`,
      metric: null
    };
  }

  const metric = {
    id: `metric_redundant_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    metricType: 'REDUNDANT_OPERATIONS',
    affectedComponent: 'plannerService',
    targetFiles: ['src/services/plannerService.js'],
    sampleSize: objIds.length,
    baselineValue: 0,
    observedValue: redundancyRatio,
    multiplier: Number((1 + redundancyRatio).toFixed(2)),
    evidenceIds: Array.from(sampleEvtIds),
    normalization: { totalOperations: totalOps, redundantOperations: redundantOps, redundancyRatio },
    timestamp: new Date().toISOString()
  };

  return {
    detected: true,
    metric
  };
}

export const actionEventStore = {
  redactSensitiveInputs,
  generateInputHash,
  getActionEvents,
  saveActionEvents,
  recordActionEvent,
  getEventsByObjective,
  reconstructObjectiveTimeline,
  detectRedundantOperations
};

