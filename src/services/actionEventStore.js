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

export const actionEventStore = {
  redactSensitiveInputs,
  generateInputHash,
  getActionEvents,
  saveActionEvents,
  recordActionEvent,
  getEventsByObjective,
  reconstructObjectiveTimeline
};
