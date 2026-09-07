/**
 * Step 10: Human-Readable Completion Summary & Performance Observability Service
 * Generates factual completion summaries and aggregates real performance metrics for objectives.
 */

import { getObjectives } from './objectiveStore.js';
import { getEventsByObjective, reconstructObjectiveTimeline } from './actionEventStore.js';

export class ObjectiveSummaryService {
  /**
   * Generates a factual human-readable summary for an objective
   */
  generateObjectiveSummary(objectiveId) {
    const objectives = getObjectives();
    const obj = objectives.find((o) => o.id === objectiveId);
    if (!obj) {
      return { success: false, error: `Objective ${objectiveId} not found.` };
    }

    const timelineData = reconstructObjectiveTimeline(objectiveId);
    const events = timelineData.timeline;
    const plan = Array.isArray(obj.plan) ? obj.plan : [];

    const actionsTaken = events.map((e) => `${e.tool} (${e.outcome})`);
    const fileChanges = [];
    events.forEach((e) => {
      if (['write_file', 'create_directory', 'copy_file', 'move_file', 'rename_file'].includes(e.tool) && e.outcome === 'SUCCESS') {
        const pathInfo = e.redactedInputs?.path || e.redactedInputs?.destination || e.redactedInputs?.source || '';
        if (pathInfo) fileChanges.push({ tool: e.tool, path: pathInfo });
      }
    });

    const verifications = events.filter((e) => e.verificationResult).map((e) => ({
      tool: e.tool,
      verificationResult: e.verificationResult
    }));

    const blockedOrFailed = [];
    if (obj.status === 'FAILED') {
      blockedOrFailed.push(obj.currentStep || 'Objective execution failed');
    }
    events.filter((e) => e.outcome === 'FAILED').forEach((e) => {
      blockedOrFailed.push(`Step ${e.stepId || 'unknown'}: ${e.errorMessage || 'Action failed'}`);
    });

    const evoMeta = obj.evolution || {};
    const capabilityUsed = evoMeta.capabilityId
      ? { capabilityId: evoMeta.capabilityId, capabilityVersion: evoMeta.capabilityVersion || 1, executionMode: evoMeta.executionMode }
      : null;

    const startMs = obj.createdAt ? new Date(obj.createdAt).getTime() : 0;
    const endMs = obj.updatedAt ? new Date(obj.updatedAt).getTime() : startMs;
    const durationMs = Math.max(0, endMs - startMs);

    const summaryText = `[EVO Summary] Objective "${obj.goal}" finished with status ${obj.status}. Executed ${events.length} action(s), mutated ${fileChanges.length} resource(s) in ${durationMs}ms.`;

    return {
      success: true,
      objectiveId: obj.id,
      goal: obj.goal,
      status: obj.status,
      summaryText,
      actionsTaken,
      fileChanges,
      verifications,
      blockedOrFailed,
      capabilityUsed,
      markdownSummary: `# HUMAN-READABLE EXECUTION SUMMARY\nGoal: ${obj.goal}\nStatus: ${obj.status}\n${summaryText}`,
      metrics: {
        executionDurationMs: durationMs,
        totalActions: events.length,
        totalRetries: obj.retryCount || 0,
        planLength: plan.length,
        completedSteps: plan.filter((s) => s.status === 'COMPLETED').length,
        failedSteps: plan.filter((s) => s.status === 'FAILED').length
      },
      performance: {
        executionDurationMs: durationMs,
        actionCount: events.length,
        retryCount: obj.retryCount || 0,
        planLength: plan.length,
        completedSteps: plan.filter((s) => s.status === 'COMPLETED').length,
        failedSteps: plan.filter((s) => s.status === 'FAILED').length
      }
    };
  }

  generateSummary(objectiveId) {
    return this.generateObjectiveSummary(objectiveId);
  }
}

export const objectiveSummaryService = new ObjectiveSummaryService();
export default objectiveSummaryService;
