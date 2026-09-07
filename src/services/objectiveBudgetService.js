/**
 * Step 10: Objective Resource Budget Service
 * Centralized per-objective budget enforcement (execution time, action count, retries).
 */

import { getObjectives, updateObjectiveStatus, saveObjectives } from './objectiveStore.js';

const BUDGETS_KEY = 'evo_objective_budgets';

export const DEFAULT_BUDGET = {
  maxExecutionDurationMs: 60000, // 60 seconds
  maxActionCount: 20,            // 20 steps
  maxRetryCount: 3               // 3 retries
};

export function getBudgets() {
  try {
    const data = localStorage.getItem(BUDGETS_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Failed to load objective budgets:', e);
    return {};
  }
}

export function saveBudgets(budgets) {
  try {
    localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
    return true;
  } catch (e) {
    console.error('Failed to save objective budgets:', e);
    return false;
  }
}

export class ObjectiveBudgetService {
  setBudget(objectiveId, budgetConfig = {}) {
    return this.setObjectiveBudget(objectiveId, budgetConfig);
  }

  getBudget(objectiveId) {
    return this.getObjectiveBudget(objectiveId);
  }

  /**
   * Sets or updates budget limits for an objective
   */
  setObjectiveBudget(objectiveId, budgetConfig = {}) {
    const budgets = getBudgets();
    const current = budgets[objectiveId] || { ...DEFAULT_BUDGET };

    const updated = {
      ...current,
      ...budgetConfig,
      objectiveId,
      updatedAt: new Date().toISOString()
    };

    budgets[objectiveId] = updated;
    saveBudgets(budgets);

    // Also attach budget to objective store record
    const objectives = getObjectives();
    const obj = objectives.find((o) => o.id === objectiveId);
    if (obj) {
      obj.budget = updated;
      saveObjectives(objectives);
    }

    return updated;
  }

  /**
   * Retrieves budget configuration for an objective
   */
  getObjectiveBudget(objectiveId) {
    const budgets = getBudgets();
    return budgets[objectiveId] || { ...DEFAULT_BUDGET, objectiveId };
  }

  /**
   * Checks if an objective has violated any budget constraints
   */
  checkObjectiveBudget(objectiveId, currentMetrics = {}) {
    const budget = this.getObjectiveBudget(objectiveId);
    const {
      durationMs = 0,
      actionCount = 0,
      retryCount = 0
    } = currentMetrics;

    if (typeof budget.maxExecutionDurationMs === 'number' && durationMs > budget.maxExecutionDurationMs) {
      const reason = `Execution duration (${durationMs}ms) exceeded maximum limit (${budget.maxExecutionDurationMs}ms).`;
      return { exceeded: true, reason, metric: 'duration' };
    }

    if (typeof budget.maxActionCount === 'number' && actionCount > budget.maxActionCount) {
      const reason = `Action count (${actionCount}) exceeded maximum limit (${budget.maxActionCount}).`;
      return { exceeded: true, reason, metric: 'actionCount' };
    }

    if (typeof budget.maxRetryCount === 'number' && retryCount > budget.maxRetryCount) {
      const reason = `Retry count (${retryCount}) exceeded maximum limit (${budget.maxRetryCount}).`;
      return { exceeded: true, reason, metric: 'retryCount' };
    }

    return { exceeded: false, reason: null };
  }

  /**
   * Enforces budget compliance, mutating objective status to FAILED if violated
   */
  enforceObjectiveBudget(objectiveId, currentMetrics = {}) {
    const check = this.checkObjectiveBudget(objectiveId, currentMetrics);
    if (check.exceeded) {
      updateObjectiveStatus(objectiveId, 'FAILED', `Budget Exceeded: ${check.reason}`);
      return { enforced: true, failed: true, reason: check.reason };
    }
    return { enforced: true, failed: false, reason: null };
  }
}

export const objectiveBudgetService = new ObjectiveBudgetService();
export default objectiveBudgetService;
