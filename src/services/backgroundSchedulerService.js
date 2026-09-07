/**
 * Step 9 / Step 10: Background Work & Scheduler Service
 * Manages persistent background objective scheduling, authorization boundaries, restart recovery, and WAITING state transitions.
 */

import { getObjectives, saveObjectives, updateObjectiveStatus } from './objectiveStore.js';
import { runObjective } from './objectiveRunner.js';

const SCHEDULER_KEY = 'evo_scheduled_tasks';

export function getScheduledTasks() {
  try {
    const data = localStorage.getItem(SCHEDULER_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load scheduled tasks:', e);
    return [];
  }
}

export function saveScheduledTasks(tasks) {
  try {
    localStorage.setItem(SCHEDULER_KEY, JSON.stringify(tasks));
    return true;
  } catch (e) {
    console.error('Failed to save scheduled tasks:', e);
    return false;
  }
}

export class BackgroundSchedulerService {
  getScheduledTasks() {
    return getScheduledTasks();
  }

  /**
   * Schedules an objective for background execution
   */
  scheduleObjective(objectiveId, cronOrOptions = {}, isBackgroundEligible = false) {
    const objectives = getObjectives();
    const obj = objectives.find((o) => o.id === objectiveId);
    if (!obj) {
      throw new Error(`Objective ${objectiveId} not found.`);
    }

    let isBackgroundAuthorized = false;
    let maxExecutionDurationMs = 60000;
    let scheduledTime = new Date().toISOString();

    if (typeof cronOrOptions === 'object' && cronOrOptions !== null) {
      isBackgroundAuthorized = Boolean(cronOrOptions.isBackgroundAuthorized || cronOrOptions.isBackgroundEligible);
      maxExecutionDurationMs = cronOrOptions.maxExecutionDurationMs || 60000;
      scheduledTime = cronOrOptions.scheduledTime || scheduledTime;
    } else {
      isBackgroundAuthorized = Boolean(isBackgroundEligible);
      scheduledTime = String(cronOrOptions);
    }

    const tasks = getScheduledTasks();
    const existingIndex = tasks.findIndex((t) => t.objectiveId === objectiveId);

    const taskRecord = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      objectiveId,
      scheduledTime,
      isBackgroundAuthorized: Boolean(isBackgroundAuthorized),
      maxExecutionDurationMs,
      status: isBackgroundAuthorized ? 'SCHEDULED' : 'WAITING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      tasks[existingIndex] = taskRecord;
    } else {
      tasks.push(taskRecord);
    }

    saveScheduledTasks(tasks);

    // Silence boundary enforcement: If authorization is missing, set objective status to WAITING
    if (!isBackgroundAuthorized) {
      updateObjectiveStatus(objectiveId, 'WAITING', 'Waiting for explicit user authorization for background execution.');
    } else {
      updateObjectiveStatus(objectiveId, 'PLANNED', 'Authorized for background execution.');
    }

    return taskRecord;
  }

  /**
   * Explicitly grants user authorization for background execution
   */
  grantBackgroundAuthorization(objectiveId) {
    const tasks = getScheduledTasks();
    const task = tasks.find((t) => t.objectiveId === objectiveId);

    if (task) {
      task.isBackgroundAuthorized = true;
      task.status = 'SCHEDULED';
      task.updatedAt = new Date().toISOString();
      saveScheduledTasks(tasks);
    }

    updateObjectiveStatus(objectiveId, 'PLANNED', 'Explicit background authorization granted. Ready to run.');
    return task || { objectiveId, isBackgroundAuthorized: true };
  }

  grantAuthorization(objectiveId) {
    return this.grantBackgroundAuthorization(objectiveId);
  }

  /**
   * Executes scheduled background tasks that are authorized
   */
  async processScheduledTasks() {
    const tasks = getScheduledTasks();
    const pendingTasks = tasks.filter((t) => t.status === 'SCHEDULED' || t.status === 'RUNNING' || t.status === 'WAITING');

    const results = [];
    for (const task of pendingTasks) {
      const objectives = getObjectives();
      const obj = objectives.find((o) => o.id === task.objectiveId);

      if (!obj || obj.status === 'COMPLETED' || obj.status === 'CANCELLED') {
        task.status = obj ? obj.status : 'CANCELLED';
        task.updatedAt = new Date().toISOString();
        continue;
      }

      // Check if authorization was revoked or missing
      if (!task.isBackgroundAuthorized) {
        task.status = 'WAITING';
        updateObjectiveStatus(task.objectiveId, 'WAITING', 'Authorization unavailable.');
        results.push({ taskId: task.id, status: 'WAITING' });
        continue;
      }

      task.status = 'RUNNING';
      task.updatedAt = new Date().toISOString();
      saveScheduledTasks(tasks);

      try {
        const runRes = await runObjective(task.objectiveId);
        const finalObj = getObjectives().find((o) => o.id === task.objectiveId);
        task.status = finalObj ? finalObj.status : 'COMPLETED';
        task.updatedAt = new Date().toISOString();
        results.push({ taskId: task.id, status: task.status, result: runRes });
      } catch (err) {
        task.status = 'FAILED';
        task.updatedAt = new Date().toISOString();
        results.push({ taskId: task.id, status: 'FAILED', error: err.message });
      }
    }

    saveScheduledTasks(tasks);
    return {
      processedCount: results.length,
      results
    };
  }

  /**
   * Recovers scheduler state after application restart
   */
  performSchedulerStartupRecovery() {
    const tasks = getScheduledTasks();
    let modified = false;

    tasks.forEach((task) => {
      if (task.status === 'RUNNING') {
        // Interrupted running task recovers safely based on authorization
        if (task.isBackgroundAuthorized) {
          task.status = 'SCHEDULED';
        } else {
          task.status = 'WAITING';
        }
        task.updatedAt = new Date().toISOString();
        modified = true;
      }
    });

    if (modified) {
      saveScheduledTasks(tasks);
    }

    return tasks;
  }
}

export const backgroundSchedulerService = new BackgroundSchedulerService();
export default backgroundSchedulerService;
