import {
  getCapabilities,
  getProcessedEvolutionObjectiveIds,
  isObjectiveProcessedForEvolution,
  markObjectiveProcessedForEvolution,
  recordCapabilityUsage,
  getImprovementProposals,
  PROPOSAL_STATUS,
  recordFailureEvidence
} from './capabilityStore.js';
import {
  matchCapabilities,
  reuseCapability,
  evaluateCapabilityCandidates,
  validateAllCapabilityCandidates,
  proposeCapabilityImprovement,
  validateImprovement,
  applyCapabilityImprovement,
  promoteRepairCandidate,
  checkPromotionEligibility,
  rollbackCapability,
  evaluateCapabilityInvariants,
  extractGoalParameters,
  generateCapabilityRepairCandidate
} from './capabilityService.js';
import { extractExperienceFromObjective } from './memoryService.js';
import { getMemories } from './memoryStore.js';
import { getObjectives, updateObjectiveEvolutionMetadata, setObjectivePlan } from './objectiveStore.js';
import { plannerService } from './plannerService.js';
import { evaluationService } from './evaluationService.js';

export const EXECUTION_MODES = {
  NORMAL_PLAN: 'NORMAL_PLAN',
  REUSED_CAPABILITY: 'REUSED_CAPABILITY'
};

/**
 * EvolutionService — Orchestrator for Step 8 + Step 9 Lifecycle (Milestone 5)
 */
export class EvolutionService {
  /**
   * 1. Orchestrates Objective Creation / Planning:
   * Checks for a compatible VALIDATED capability match.
   * If MATCH (score >= 0.7): Adapts capability, records evolution metadata at START, binds plan to NEW objective.
   * If NO MATCH: Falls back to standard plannerService.generatePlan (Rule 2: Keep planning separate).
   * Supports options for Controlled Experiments (Milestone 7): { isExperiment, disableReuse, explicitCapabilityId, explicitCapabilityVersion, adaptedParams }
   */
  async createOrPrepareObjectivePlan(objectiveId, goalText, options = {}) {
    const objectives = getObjectives();
    const obj = objectives.find((o) => o.id === objectiveId);
    if (!obj) {
      return { success: false, error: 'Target objective not found.' };
    }

    const {
      isExperiment = false,
      disableReuse = false,
      explicitCapabilityId = null,
      explicitCapabilityVersion = null,
      adaptedParams = {}
    } = options;

    // Milestone 7 Rule: BASELINE group or explicitly disabled reuse
    if (disableReuse) {
      updateObjectiveEvolutionMetadata(objectiveId, {
        capabilityId: null,
        capabilityVersion: null,
        executionMode: EXECUTION_MODES.NORMAL_PLAN,
        reusedCapability: false,
        isExperiment
      });

      const planRes = await plannerService.generatePlan({ goal: goalText });
      if (planRes.success) {
        let planToUse = planRes.plan;
        const prefix = adaptedParams.folder || adaptedParams.targetDir;
        if (prefix) {
          planToUse = planToUse.map((step) => {
            const newAction = { ...step.action };
            if (newAction.path && !newAction.path.startsWith(prefix)) {
              newAction.path = `${prefix}/${newAction.path}`;
            }
            if (newAction.source && !newAction.source.startsWith(prefix)) {
              newAction.source = `${prefix}/${newAction.source}`;
            }
            if (newAction.destination && !newAction.destination.startsWith(prefix)) {
              newAction.destination = `${prefix}/${newAction.destination}`;
            }
            return { ...step, action: newAction };
          });
        }
        setObjectivePlan(objectiveId, planToUse);
        const updatedObj = getObjectives().find((o) => o.id === objectiveId);
        return {
          success: true,
          executionMode: EXECUTION_MODES.NORMAL_PLAN,
          objective: updatedObj,
          plan: planToUse
        };
      }
      return { success: false, error: planRes.error || 'Planning failed.' };
    }

    // Milestone 7 Rule: Explicit Capability & Version Pinning (REUSED / EVOLVED groups)
    if (explicitCapabilityId && explicitCapabilityVersion) {
      const evolutionMetadata = {
        capabilityId: explicitCapabilityId,
        capabilityVersion: explicitCapabilityVersion,
        executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
        reusedCapability: true,
        isExperiment
      };

      const reuseRes = await reuseCapability(explicitCapabilityId, objectiveId, adaptedParams, {
        execute: false,
        evolutionMetadata
      });
      if (reuseRes.success) {
        const updatedObj = getObjectives().find((o) => o.id === objectiveId);
        return {
          success: true,
          executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
          objective: updatedObj,
          plan: updatedObj ? updatedObj.plan : []
        };
      }
    }

    // Step A: Check for reusable validated capability match
    const matchRes = matchCapabilities(goalText);

    if (matchRes && matchRes.matched && matchRes.capabilityId) {
      const cap = getCapabilities().find((c) => c.id === matchRes.capabilityId);
      const capVersion = cap ? (cap.activeVersion || cap.version || 1) : 1;

      // RULE 4 & 5: Capture capabilityId, capabilityVersion, executionMode AT EXECUTION START
      const evolutionMetadata = {
        capabilityId: matchRes.capabilityId,
        capabilityVersion: capVersion,
        executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
        reusedCapability: true,
        matchedConfidence: matchRes.confidence,
        matchedReasons: matchRes.reasons,
        isExperiment
      };

      // Reuse capability (adapts params & binds plan with evolution metadata in single atomic write)
      const reuseRes = await reuseCapability(matchRes.capabilityId, objectiveId, matchRes.adaptedParams, {
        execute: false,
        evolutionMetadata
      });
      if (reuseRes.success) {
        const updatedObj = getObjectives().find((o) => o.id === objectiveId);
        return {
          success: true,
          executionMode: EXECUTION_MODES.REUSED_CAPABILITY,
          objective: updatedObj,
          capability: cap,
          plan: updatedObj ? updatedObj.plan : []
        };
      }
    }

    // Step B: Fallback to standard PlannerService provider (Rule 2)
    updateObjectiveEvolutionMetadata(objectiveId, {
      capabilityId: null,
      capabilityVersion: null,
      executionMode: EXECUTION_MODES.NORMAL_PLAN,
      reusedCapability: false,
      isExperiment
    });

    const planRes = await plannerService.generatePlan({ goal: goalText });
    if (planRes.success) {
      setObjectivePlan(objectiveId, planRes.plan);
      const updatedObj = getObjectives().find((o) => o.id === objectiveId);
      return {
        success: true,
        executionMode: EXECUTION_MODES.NORMAL_PLAN,
        objective: updatedObj,
        plan: planRes.plan
      };
    }

    return {
      success: false,
      error: planRes.error || 'Planning failed.'
    };
  }

  /**
   * 2. Orchestrates Objective Completion (IDEMPOTENT processing, Rule 3)
   * Processed ONCE per objective ID.
   */
  async handleObjectiveCompletion(objective) {
    if (!objective || !objective.id) return { processed: false, reason: 'Invalid objective object.' };

    // Idempotency check: Prevent duplicate processing or recursive loops
    if (isObjectiveProcessedForEvolution(objective.id)) {
      return { processed: false, reason: 'Objective already processed for evolution.' };
    }

    // Milestone 7 Critical Rule: Experiments MUST NOT contaminate EVO evolution state!
    const evoMeta = objective.evolution || {};
    if (evoMeta.isExperiment) {
      markObjectiveProcessedForEvolution(objective.id);
      return {
        processed: true,
        isExperiment: true,
        objectiveId: objective.id,
        reason: 'Experiment run completed without evolution side effects.'
      };
    }

    try {
      const isSuccess = objective.status === 'COMPLETED';

      // Step A: Extract Step 8 Experience
      let expResult = null;
      try {
        expResult = extractExperienceFromObjective(objective);
      } catch (e) {
        console.error('EvolutionService: Experience extraction failed:', e);
      }

      // Step B: Record Version-Specific Capability Usage (Rule 4 & 6)
      const evoMeta = objective.evolution || {};
      const reusedCapId = evoMeta.capabilityId;
      const capVersion = evoMeta.capabilityVersion;

      if (reusedCapId) {
        recordCapabilityUsage(reusedCapId, isSuccess, capVersion);

        // Stage 2 Self-Healing: Invariant Check, Failure Evidence Capture & Repair Candidate Generation
        try {
          const targetParams = extractGoalParameters(objective.goal);
          const invEval = await evaluateCapabilityInvariants(reusedCapId, {
            rootPath: objective.root || undefined,
            targetParams,
            version: capVersion
          });

          if (invEval && !invEval.success && Array.isArray(invEval.results)) {
            const failedInvariants = invEval.results.filter((r) => !r.passed);
            for (const failedInv of failedInvariants) {
              const precedingStep = Array.isArray(objective.completedSteps) && objective.completedSteps.length > 0
                ? objective.completedSteps[objective.completedSteps.length - 1]
                : (Array.isArray(objective.plan) && objective.plan.length > 0 ? objective.plan[0] : null);

              const evidence = recordFailureEvidence({
                capabilityId: reusedCapId,
                capabilityVersion: capVersion,
                objectiveId: objective.id,
                failedInvariantId: failedInv.id,
                failedInvariantType: failedInv.type,
                targetPath: failedInv.targetPath,
                expected: failedInv.expected,
                actual: failedInv.actual,
                precedingStep,
                targetParams,
                timestamp: new Date().toISOString()
              });

              // Generate localized NON-ACTIVE repair candidate
              generateCapabilityRepairCandidate(evidence.id);
            }
          }
        } catch (invErr) {
          console.error('EvolutionService: Failure evidence capture / repair generation failed:', invErr);
        }
      }

      // Step B2: Record Objective Evaluation (Milestone 6)
      try {
        evaluationService.recordObjectiveEvaluation(objective);
      } catch (e) {
        console.error('EvolutionService: Objective evaluation recording failed:', e);
      }

      // Step C: Evaluate & Candidate-Create from Experiences (Rule 1 & 8)
      try {
        evaluateCapabilityCandidates();
      } catch (e) {
        console.error('EvolutionService: Candidate evaluation failed:', e);
      }

      // Step D: In-Memory Validation of Candidate Capabilities (Rule 2 & 8)
      try {
        validateAllCapabilityCandidates();
      } catch (e) {
        console.error('EvolutionService: Candidate validation failed:', e);
      }

      // Step E: Failure & Improvement Triggering (Rule 6, 9, 10, 11)
      if (reusedCapId) {
        this.processCapabilityImprovementsAndRollbacks(reusedCapId, capVersion);
      }

      // Mark objective as processed (IDEMPOTENT persistence)
      markObjectiveProcessedForEvolution(objective.id);

      return {
        processed: true,
        objectiveId: objective.id,
        status: objective.status,
        experienceRecorded: Boolean(expResult)
      };
    } catch (err) {
      console.error('EvolutionService error during objective completion:', err);
      // Evolution failure MUST NOT corrupt objective or execution state (Rule 13)
      return { processed: false, error: err.message };
    }
  }

  /**
   * 3. Process Capability Improvements & Version-Aware Rollbacks (Rule 6, 9, 11)
   */
  processCapabilityImprovementsAndRollbacks(capabilityId, targetVersion) {
    const capabilities = getCapabilities();
    const cap = capabilities.find((c) => c.id === capabilityId);
    if (!cap) return;

    const ver = targetVersion || cap.activeVersion || cap.version || 1;
    const versionStats = (cap.versionStats && cap.versionStats[ver]) ? cap.versionStats[ver] : null;

    const failedCount = versionStats ? (versionStats.failedUseCount || 0) : (cap.failedUseCount || 0);

    // Rule 9: If version accumulated repeated failures (failedUseCount >= 2), propose & validate improvement
    if (failedCount >= 2) {
      const proposals = getImprovementProposals(capabilityId);
      let pending = proposals.find((p) => p.status === PROPOSAL_STATUS.PROPOSED);

      if (!pending) {
        const propRes = proposeCapabilityImprovement(capabilityId, {
          reason: `Automated improvement proposed due to repeated failures on version ${ver} (failedUseCount = ${failedCount})`,
          baseVersion: ver
        });
        if (propRes.proposed && propRes.proposal) {
          pending = propRes.proposal;
        }
      }

      // Validate proposal (sets validationStatus = VALIDATED, eligibilityStatus = ELIGIBLE)
      if (pending && pending.status === PROPOSAL_STATUS.PROPOSED) {
        validateImprovement(pending.id);
      }

      // Rule 9 CRITICAL: DO NOT automatically apply! Application remains controlled via applyValidatedImprovement.

      // Rule 11: If active version has previous version history and accumulated failures, check rollback eligibility
      if (cap.versionHistory && cap.versionHistory.length > 0 && ver === cap.activeVersion) {
        rollbackCapability(capabilityId, `Automated rollback due to version ${ver} failure threshold (failedUseCount = ${failedCount})`);
      }
    }
  }

  /**
   * 4. Controlled Improvement Application / Stage 4 Candidate Promotion
   * Must be called explicitly for controlled transition (PROPOSED -> VALIDATED -> CONTROLLED APPLY -> NEW VERSION)
   */
  checkPromotionEligibility(proposalIdOrObj, options = {}) {
    return checkPromotionEligibility(proposalIdOrObj, options);
  }

  promoteValidatedCandidate(proposalIdOrObj, options = {}) {
    return promoteRepairCandidate(proposalIdOrObj, options);
  }

  applyValidatedImprovement(proposalId, options = {}) {
    return promoteRepairCandidate(proposalId, options);
  }

  /**
   * 5. Returns High-Level Evolution System Overview
   */
  getEvolutionOverview() {
    const memories = getMemories();
    const capabilities = getCapabilities();
    const proposals = getImprovementProposals();
    const processedObjectiveIds = getProcessedEvolutionObjectiveIds();

    const candidates = capabilities.filter((c) => c.status === 'CANDIDATE');
    const validated = capabilities.filter((c) => c.status === 'VALIDATED');
    const rejected = capabilities.filter((c) => c.status === 'REJECTED');

    return {
      totalMemoriesCount: memories.length,
      capabilitiesCount: capabilities.length,
      candidatesCount: candidates.length,
      validatedCount: validated.length,
      rejectedCount: rejected.length,
      proposalsCount: proposals.length,
      processedObjectivesCount: processedObjectiveIds.length,
      capabilities,
      proposals
    };
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
