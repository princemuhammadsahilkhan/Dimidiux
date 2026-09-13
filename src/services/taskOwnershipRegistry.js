/**
 * TASK OWNERSHIP REGISTRY SERVICE
 * 
 * Tracks process and window ownership per task to distinguish EVO-owned resources
 * from pre-existing user applications.
 */

export class TaskOwnershipRegistry {
  constructor() {
    this.records = [];
  }

  /**
   * Registers an application launch record for a task.
   */
  registerLaunch(record = {}) {
    if (!record || typeof record !== 'object') {
      throw new Error('Launch record must be an object.');
    }

    const {
      taskId = null,
      objectiveId = null,
      applicationId = null,
      executable = null,
      pid = null,
      windowId = null,
      startupWMClass = null,
      launchedAt = new Date().toISOString(),
      isPreExisting = false
    } = record;

    if (!taskId && !objectiveId) {
      throw new Error('Launch record requires taskId or objectiveId.');
    }
    if (!applicationId) {
      throw new Error('Launch record requires applicationId.');
    }

    const tId = String(taskId || objectiveId);
    const oId = String(objectiveId || taskId);

    const entry = {
      id: `own_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      taskId: tId,
      objectiveId: oId,
      applicationId: String(applicationId),
      executable: executable ? String(executable) : null,
      pid: pid !== null && pid !== undefined ? String(pid) : null,
      windowId: windowId !== null && windowId !== undefined ? String(windowId) : null,
      startupWMClass: startupWMClass ? String(startupWMClass) : null,
      launchedAt: String(launchedAt),
      isPreExisting: Boolean(isPreExisting)
    };

    this.records.push(entry);
    return entry;
  }

  /**
   * Returns all resource records registered in the system.
   */
  getAllRecords() {
    return [...this.records];
  }

  /**
   * Retrieves owned resource records matching query parameters.
   */
  getOwnedResource(query = {}) {
    if (typeof query === 'string') {
      return this.records.find(r => r.id === query || r.windowId === query || r.pid === query || r.applicationId === query) || null;
    }
    if (!query || typeof query !== 'object') return null;

    return this.records.find(r => {
      if (query.taskId && r.taskId !== query.taskId) return false;
      if (query.objectiveId && r.objectiveId !== query.objectiveId) return false;
      if (query.applicationId && r.applicationId !== query.applicationId) return false;
      if (query.windowId && r.windowId !== query.windowId) return false;
      if (query.pid && r.pid !== query.pid) return false;
      return true;
    }) || null;
  }

  /**
   * Retrieves all resource records registered for a specific taskId.
   */
  getTaskOwnedResources(taskId) {
    if (!taskId) return [];
    return this.records.filter(r => r.taskId === taskId || r.objectiveId === taskId);
  }

  /**
   * Checks if a resource (by windowId, pid, or object) is task-owned by the specified taskId.
   * Returns true ONLY IF the resource is recorded for that task AND isPreExisting === false.
   */
  isOwnedByTask(taskId, resource) {
    if (!taskId || !resource) return false;

    let targetWinId = null;
    let targetPid = null;
    let targetAppId = null;

    if (typeof resource === 'string') {
      targetWinId = resource;
      targetPid = resource;
      targetAppId = resource;
    } else if (typeof resource === 'object') {
      targetWinId = resource.windowId || resource.id || null;
      targetPid = resource.pid || null;
      targetAppId = resource.applicationId || null;
    }

    const matches = this.records.filter(r => (r.taskId === taskId || r.objectiveId === taskId));

    for (const record of matches) {
      if (record.isPreExisting) continue;

      if (targetWinId && record.windowId && String(record.windowId) === String(targetWinId)) return true;
      if (targetPid && record.pid && String(record.pid) === String(targetPid)) return true;
      if (targetAppId && record.applicationId && String(record.applicationId) === String(targetAppId)) return true;
    }

    return false;
  }

  /**
   * Explicitly marks a resource as pre-existing for a task.
   */
  markPreExisting(record = {}) {
    return this.registerLaunch({
      ...record,
      isPreExisting: true
    });
  }

  /**
   * Releases ownership data for a given taskId.
   */
  releaseTaskOwnership(taskId) {
    if (!taskId) return 0;
    const initialCount = this.records.length;
    this.records = this.records.filter(r => r.taskId !== taskId && r.objectiveId !== taskId);
    return initialCount - this.records.length;
  }

  /**
   * Clears task ownership records for a specific taskId or all records.
   */
  clearTaskOwnership(taskId = null) {
    if (taskId) {
      return this.releaseTaskOwnership(taskId);
    }
    const count = this.records.length;
    this.records = [];
    return count;
  }
}

export const taskOwnershipRegistry = new TaskOwnershipRegistry();
