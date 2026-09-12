import {
  getObjectives as localGetObjectives,
  getActiveObjective as localGetActiveObjective,
  createObjective as localCreateObjective,
  setActiveObjectiveId as localSetActiveObjectiveId,
  updateObjectiveStatus as localUpdateObjectiveStatus,
  setObjectivePlan as localSetObjectivePlan,
  setObjectivePlanningFailed as localSetObjectivePlanningFailed,
  saveObjectives as localSaveObjectives,
  subscribeObjectiveUpdates as localSubscribeObjectiveUpdates
} from './objectiveStore.js';
import { plannerService as localPlannerService } from './plannerService.js';
import {
  runObjective as localRunObjective,
  requestPause as localRequestPause,
  grantStepOverwriteConfirmation as localGrantStepOverwriteConfirmation
} from './objectiveRunner.js';
import {
  getMemories as localGetMemories,
  archiveMemory as localArchiveMemory,
  restoreMemory as localRestoreMemory
} from './memoryStore.js';
import {
  searchMemory as localSearchMemory,
  recordCorrection as localRecordCorrection
} from './memoryService.js';
import {
  getCapabilities as localGetCapabilities,
  getImprovementProposals as localGetImprovementProposals
} from './capabilityStore.js';
import {
  evaluateCapabilityCandidates as localEvaluateCapabilityCandidates,
  validateCapability as localValidateCapability,
  validateAllCapabilityCandidates as localValidateAllCapabilityCandidates,
  matchCapabilities as localMatchCapabilities,
  reuseCapability as localReuseCapability,
  proposeCapabilityImprovement as localProposeCapabilityImprovement,
  validateImprovement as localValidateImprovement,
  applyCapabilityImprovement as localApplyCapabilityImprovement,
  rollbackCapability as localRollbackCapability,
  getCapabilityVersions as localGetCapabilityVersions
} from './capabilityService.js';
import { evolutionService as localEvolutionService } from './evolutionService.js';
import { evaluationService as localEvaluationService } from './evaluationService.js';
import { experimentService as localExperimentService } from './experimentService.js';
import { backgroundSchedulerService as localBackgroundSchedulerService } from './backgroundSchedulerService.js';
import { objectiveBudgetService as localObjectiveBudgetService } from './objectiveBudgetService.js';
import { actionEventStore as localActionEventStore } from './actionEventStore.js';
import { objectiveSummaryService as localObjectiveSummaryService } from './objectiveSummaryService.js';
import { systemTool as localSystemTool } from './systemTool.js';
import { skillFactoryService as localSkillFactoryService } from './skillFactoryService.js';

const isElectron = typeof window !== 'undefined' && Boolean(window.evoAPI);

export const evoApi = {
  isElectron,

  async getObjectives() {
    if (isElectron) {
      return await window.evoAPI.getObjectives();
    }
    return localGetObjectives();
  },

  async getActiveObjective() {
    if (isElectron) {
      return await window.evoAPI.getActiveObjective();
    }
    return localGetActiveObjective();
  },

  async createObjective(goalText) {
    if (isElectron) {
      return await window.evoAPI.createObjective(goalText);
    }
    return localCreateObjective(goalText);
  },

  async setActiveObjectiveId(id) {
    if (isElectron) {
      return await window.evoAPI.setActiveObjectiveId(id);
    }
    localSetActiveObjectiveId(id);
    return localGetActiveObjective();
  },

  async generatePlan(objectiveId, goalText) {
    if (isElectron) {
      return await window.evoAPI.generatePlan(objectiveId);
    }
    localUpdateObjectiveStatus(objectiveId, 'PLANNING', 'Generating plan...');
    const result = await localEvolutionService.createOrPrepareObjectivePlan(objectiveId, goalText);
    if (result.success) {
      return localGetActiveObjective();
    } else {
      return localSetObjectivePlanningFailed(objectiveId, result.error);
    }
  },

  async startRunner(objectiveId, onStepCallback) {
    if (isElectron) {
      return await window.evoAPI.startRunner(objectiveId);
    }
    return await localRunObjective(objectiveId, {
      onStepCallback: () => {
        if (onStepCallback) onStepCallback(localGetActiveObjective());
      }
    });
  },

  async pauseRunner(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.pauseRunner(objectiveId);
    }
    localRequestPause(objectiveId);
    return localUpdateObjectiveStatus(objectiveId, 'PAUSED', 'Execution pause requested...');
  },

  async confirmAndContinue(objectiveId, stepId) {
    if (isElectron) {
      return await window.evoAPI.confirmAndContinue({ objectiveId, stepId });
    }
    localGrantStepOverwriteConfirmation(objectiveId, stepId);
    return await this.startRunner(objectiveId);
  },

  async retryPlanning(objectiveId, goalText) {
    if (isElectron) {
      return await window.evoAPI.retryPlanning(objectiveId);
    }
    return await this.generatePlan(objectiveId, goalText);
  },

  async retryExecution(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.retryExecution(objectiveId);
    }
    const objectives = localGetObjectives();
    const found = objectives.find((o) => o.id === objectiveId);
    if (found && Array.isArray(found.plan)) {
      found.plan.forEach((s) => {
        if (s.status === 'FAILED') s.status = 'PENDING';
      });
      found.status = 'PLANNED';
      found.currentStep = 'Plan ready. Retrying execution...';
      localSaveObjectives(objectives);
      await this.startRunner(objectiveId);
      return localGetActiveObjective();
    }
    return null;
  },

  async quitApp() {
    if (isElectron) {
      return await window.evoAPI.quitApp();
    }
  },

  // Memory Facade (Step 8)
  async getMemories() {
    if (isElectron) {
      return await window.evoAPI.getMemories();
    }
    return localGetMemories();
  },

  async searchMemory(query, context, maxResults) {
    if (isElectron) {
      return await window.evoAPI.searchMemory({ query, context, maxResults });
    }
    return localSearchMemory(query, context, maxResults);
  },

  async recordCorrection(correctionText, context) {
    if (isElectron) {
      return await window.evoAPI.recordCorrection({ correctionText, context });
    }
    return localRecordCorrection(correctionText, context);
  },

  async archiveMemory(id) {
    if (isElectron) {
      return await window.evoAPI.archiveMemory(id);
    }
    return localArchiveMemory(id);
  },

  async restoreMemory(id) {
    if (isElectron) {
      return await window.evoAPI.restoreMemory(id);
    }
    return localRestoreMemory(id);
  },

  // Capability Facade (Step 9 - Milestones 1 & 2)
  async getCapabilities() {
    if (isElectron) {
      return await window.evoAPI.getCapabilities();
    }
    return localGetCapabilities();
  },

  async evaluateCapabilityCandidates() {
    if (isElectron) {
      return await window.evoAPI.evaluateCapabilityCandidates();
    }
    return localEvaluateCapabilityCandidates();
  },

  async validateCapability(candidateId) {
    if (isElectron) {
      return await window.evoAPI.validateCapability(candidateId);
    }
    return localValidateCapability(candidateId);
  },

  async validateAllCapabilities() {
    if (isElectron) {
      return await window.evoAPI.validateAllCapabilities();
    }
    return localValidateAllCapabilityCandidates();
  },

  async matchCapabilities(goalText) {
    if (isElectron) {
      return await window.evoAPI.matchCapabilities(goalText);
    }
    return localMatchCapabilities(goalText);
  },

  async reuseCapability(capabilityId, objectiveId, overrideParams) {
    if (isElectron) {
      return await window.evoAPI.reuseCapability({ capabilityId, objectiveId, overrideParams });
    }
    return await localReuseCapability(capabilityId, objectiveId, overrideParams);
  },

  // Capability Improvement & Versioning Facade (Step 9 - Milestone 4)
  async getCapabilityVersions(capabilityId) {
    if (isElectron) {
      return await window.evoAPI.getCapabilityVersions(capabilityId);
    }
    return localGetCapabilityVersions(capabilityId);
  },

  async getImprovementProposals(capabilityId) {
    if (isElectron) {
      return await window.evoAPI.getImprovementProposals(capabilityId);
    }
    return localGetImprovementProposals(capabilityId);
  },

  async proposeCapabilityImprovement(capabilityId, newWorkflowSteps, reason, evidenceIds) {
    if (isElectron) {
      return await window.evoAPI.proposeCapabilityImprovement({ capabilityId, newWorkflowSteps, reason, evidenceIds });
    }
    return localProposeCapabilityImprovement(capabilityId, newWorkflowSteps, reason, evidenceIds);
  },

  async validateImprovement(proposalId) {
    if (isElectron) {
      return await window.evoAPI.validateImprovement(proposalId);
    }
    return localValidateImprovement(proposalId);
  },

  async applyCapabilityImprovement(proposalId) {
    if (isElectron) {
      return await window.evoAPI.applyCapabilityImprovement(proposalId);
    }
    return localApplyCapabilityImprovement(proposalId);
  },

  async rollbackCapability(capabilityId, targetVersion) {
    if (isElectron) {
      return await window.evoAPI.rollbackCapability({ capabilityId, targetVersion });
    }
    return localRollbackCapability(capabilityId, targetVersion);
  },

  async getEvolutionOverview() {
    if (isElectron) {
      return await window.evoAPI.getEvolutionOverview();
    }
    return localEvolutionService.getEvolutionOverview();
  },

  // Evaluation & Reliability Framework Facade (Step 9 - Milestone 6)
  async getEvaluationSummary() {
    if (isElectron) {
      return await window.evoAPI.getEvaluationSummary();
    }
    return localEvaluationService.getEvaluationSummary();
  },

  async evaluateObjective(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.evaluateObjective(objectiveId);
    }
    return localEvaluationService.evaluateObjective(objectiveId);
  },

  async evaluateCapability(capabilityId) {
    if (isElectron) {
      return await window.evoAPI.evaluateCapability(capabilityId);
    }
    return localEvaluationService.evaluateCapability(capabilityId);
  },

  async evaluateCapabilityVersion(capabilityId, version) {
    if (isElectron) {
      return await window.evoAPI.evaluateCapabilityVersion({ capabilityId, version });
    }
    return localEvaluationService.evaluateCapabilityVersion(capabilityId, version);
  },

  // Controlled Experimentation & Benchmarking Facade (Step 9 - Milestone 7)
  async createExperiment(data) {
    if (isElectron) {
      return await window.evoAPI.createExperiment(data);
    }
    return localExperimentService.createExperiment(data);
  },

  async getExperiment(id) {
    if (isElectron) {
      return await window.evoAPI.getExperiment(id);
    }
    return localExperimentService.getExperiment(id);
  },

  async listExperiments() {
    if (isElectron) {
      return await window.evoAPI.listExperiments();
    }
    return localExperimentService.listExperiments();
  },

  async startExperiment(id) {
    if (isElectron) {
      return await window.evoAPI.startExperiment(id);
    }
    return localExperimentService.startExperiment(id);
  },

  async cancelExperiment(id) {
    if (isElectron) {
      return await window.evoAPI.cancelExperiment(id);
    }
    return localExperimentService.cancelExperiment(id);
  },

  async getExperimentSummary(id) {
    if (isElectron) {
      return await window.evoAPI.getExperimentSummary(id);
    }
    return localExperimentService.getExperimentSummary(id);
  },

  async compareExperimentGroups(experimentId, group1, group2) {
    if (isElectron) {
      return await window.evoAPI.compareExperimentGroups({ experimentId, group1, group2 });
    }
    return localExperimentService.compareExperimentGroups(experimentId, group1, group2);
  },

  async compareCapabilityVersions(capabilityId, versionA, versionB) {
    if (isElectron) {
      return await window.evoAPI.compareCapabilityVersions({ capabilityId, versionA, versionB });
    }
    return localExperimentService.compareCapabilityVersions(capabilityId, versionA, versionB);
  },

  // Step 10 - V1 Requirements Gap Closure Facade
  async scheduleObjective(objectiveId, cronOrTime, isBackgroundEligible) {
    if (isElectron) {
      return await window.evoAPI.scheduleObjective({ objectiveId, cronOrTime, isBackgroundEligible });
    }
    return localBackgroundSchedulerService.scheduleObjective(objectiveId, cronOrTime, isBackgroundEligible);
  },

  async grantBackgroundAuthorization(objectiveId, durationMs) {
    if (isElectron) {
      return await window.evoAPI.grantBackgroundAuthorization({ objectiveId, durationMs });
    }
    return localBackgroundSchedulerService.grantAuthorization(objectiveId, durationMs);
  },

  async processScheduledTasks() {
    if (isElectron) {
      return await window.evoAPI.processScheduledTasks();
    }
    return await localBackgroundSchedulerService.processScheduledTasks();
  },

  async getScheduledTasks() {
    if (isElectron) {
      return await window.evoAPI.getScheduledTasks();
    }
    return localBackgroundSchedulerService.getScheduledTasks();
  },

  async setObjectiveBudget(objectiveId, budget) {
    if (isElectron) {
      return await window.evoAPI.setObjectiveBudget({ objectiveId, budget });
    }
    return localObjectiveBudgetService.setBudget(objectiveId, budget);
  },

  async getObjectiveBudget(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.getObjectiveBudget(objectiveId);
    }
    return localObjectiveBudgetService.getBudget(objectiveId);
  },

  async getActionEvents(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.getActionEvents(objectiveId);
    }
    return localActionEventStore.getEventsByObjective(objectiveId);
  },

  async reconstructObjectiveTimeline(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.reconstructObjectiveTimeline(objectiveId);
    }
    return localActionEventStore.reconstructObjectiveTimeline(objectiveId);
  },

  async generateObjectiveSummary(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.generateObjectiveSummary(objectiveId);
    }
    return localObjectiveSummaryService.generateSummary(objectiveId);
  },

  async runConstrainedCommand(command, args, objectiveId) {
    if (isElectron) {
      return await window.evoAPI.runConstrainedCommand({ command, args, objectiveId });
    }
    return await localSystemTool.runConstrainedCommand(command, args, objectiveId);
  },

  async getTime() {
    if (isElectron) {
      return await window.evoAPI.getTime();
    }
    return localSystemTool.getTime();
  },

  async getSystemInfo() {
    if (isElectron) {
      return await window.evoAPI.getSystemInfo();
    }
    return localSystemTool.getSystemInfo();
  },

  async promoteCandidateSkill(candidateId) {
    if (isElectron) {
      return await window.evoAPI.promoteCandidateSkill(candidateId);
    }
    return localSkillFactoryService.promoteCandidateSkill(candidateId);
  },

  // Stage 6A Runtime Learning & Self-Observation Loop Facade
  async getRuntimeLearningRecords(filter) {
    if (isElectron) {
      return await window.evoAPI.getRuntimeLearningRecords(filter);
    }
    return localEvolutionService.getRuntimeLearningRecords(filter);
  },

  async getRuntimeLearningRecordByObjective(objectiveId) {
    if (isElectron) {
      return await window.evoAPI.getRuntimeLearningRecordByObjective(objectiveId);
    }
    return localEvolutionService.getRuntimeLearningRecordByObjective(objectiveId);
  },

  async getSystemLearningOverview() {
    if (isElectron) {
      return await window.evoAPI.getSystemLearningOverview();
    }
    return localEvolutionService.getSystemLearningOverview();
  },

  // Supervised Self-Code Improvement & Versioning Facade (Stage 6B)
  async getSelfCodeProposals() {
    if (isElectron) {
      return await window.evoAPI.getSelfCodeProposals();
    }
    return localEvolutionService.getSelfCodeProposals();
  },

  async approveSelfCodeProposal(proposalId, options) {
    if (isElectron) {
      return await window.evoAPI.approveSelfCodeProposal({ proposalId, options });
    }
    return localEvolutionService.approveSelfCodeProposal(proposalId, options);
  },

  async rejectSelfCodeProposal(proposalId, reason) {
    if (isElectron) {
      return await window.evoAPI.rejectSelfCodeProposal({ proposalId, reason });
    }
    return localEvolutionService.rejectSelfCodeProposal(proposalId, reason);
  },

  async getSelfCodeVersionState() {
    if (isElectron) {
      return await window.evoAPI.getSelfCodeVersionState();
    }
    return localEvolutionService.getSelfCodeVersionState();
  },

  async rollbackSelfCodeVersion(versionId, reason) {
    if (isElectron) {
      return await window.evoAPI.rollbackSelfCodeVersion({ versionId, reason });
    }
    return localEvolutionService.rollbackSelfCodeVersion(versionId, reason);
  },

  // Stage 7A Controlled Desktop Observation Facades
  async getDesktopObservation(options) {
    if (isElectron) {
      return await window.evoAPI.getDesktopObservation(options);
    }
    return localEvolutionService.getDesktopObservation(options);
  },

  async getActiveApplication() {
    if (isElectron) {
      return await window.evoAPI.getActiveApplication();
    }
    return localEvolutionService.getActiveApplication();
  },

  async getOpenWindows() {
    if (isElectron) {
      return await window.evoAPI.getOpenWindows();
    }
    return localEvolutionService.getOpenWindows();
  },

  async getDesktopSnapshot() {
    if (isElectron) {
      return await window.evoAPI.getDesktopSnapshot();
    }
    return localEvolutionService.getDesktopSnapshot();
  },

  async getApplicationState(appId) {
    if (isElectron) {
      return await window.evoAPI.getApplicationState(appId);
    }
    return localEvolutionService.getApplicationState(appId);
  },

  // Stage 7B Controlled Single-Click Computer Interaction Facades
  async getPendingClickRequests() {
    if (isElectron) {
      return await window.evoAPI.getPendingClickRequests();
    }
    return localEvolutionService.getPendingClickRequests();
  },

  async requestMouseClick(target, options) {
    if (isElectron) {
      return await window.evoAPI.requestMouseClick(target, options);
    }
    return localEvolutionService.requestMouseClick(target, options);
  },

  async approveMouseClick(interactionId, options) {
    if (isElectron) {
      return await window.evoAPI.approveMouseClick(interactionId, options);
    }
    return localEvolutionService.approveMouseClick(interactionId, options);
  },

  async cancelMouseClick(interactionId, reason) {
    if (isElectron) {
      return await window.evoAPI.cancelMouseClick(interactionId, reason);
    }
    return localEvolutionService.cancelMouseClick(interactionId, reason);
  },

  // Stage 7C Visual Target Understanding Facades
  async identifyClickableTarget(observation, objective, options) {
    if (isElectron) {
      return await window.evoAPI.identifyClickableTarget(observation, objective, options);
    }
    return localEvolutionService.identifyClickableTarget(observation, objective, options);
  },

  async validateTargetProposal(proposal, observation) {
    if (isElectron) {
      return await window.evoAPI.validateTargetProposal(proposal, observation);
    }
    return localEvolutionService.validateTargetProposal(proposal, observation);
  },

  async createClickProposalFromTarget(visualProposal, options) {
    if (isElectron) {
      return await window.evoAPI.createClickProposalFromTarget(visualProposal, options);
    }
    return localEvolutionService.createClickProposalFromTarget(visualProposal, options);
  },

  async getVisualTargetProposals() {
    if (isElectron) {
      return await window.evoAPI.getVisualTargetProposals();
    }
    return localEvolutionService.getVisualTargetProposals();
  },

  // Stage 7D Controlled Application Launch Facades
  async listAllowedApplications() {
    if (isElectron) {
      return await window.evoAPI.listAllowedApplications();
    }
    return localEvolutionService.listAllowedApplications();
  },

  async requestApplicationLaunch(applicationId, options) {
    if (isElectron) {
      return await window.evoAPI.requestApplicationLaunch(applicationId, options);
    }
    return localEvolutionService.requestApplicationLaunch(applicationId, options);
  },

  async approveApplicationLaunch(requestId, options) {
    if (isElectron) {
      return await window.evoAPI.approveApplicationLaunch(requestId, options);
    }
    return localEvolutionService.approveApplicationLaunch(requestId, options);
  },

  async cancelApplicationLaunch(requestId, reason) {
    if (isElectron) {
      return await window.evoAPI.cancelApplicationLaunch(requestId, reason);
    }
    return localEvolutionService.cancelApplicationLaunch(requestId, reason);
  },

  async verifyApplicationLaunch(applicationId, observation) {
    if (isElectron) {
      return await window.evoAPI.verifyApplicationLaunch(applicationId, observation);
    }
    return localEvolutionService.verifyApplicationLaunch(applicationId, observation);
  },

  async getPendingLaunchRequests() {
    if (isElectron) {
      return await window.evoAPI.getPendingLaunchRequests();
    }
    return localEvolutionService.getPendingLaunchRequests();
  },

  // Stage 7E Controlled Supervised Text Input Facades
  async requestTextInput(target, text, options) {
    if (isElectron) {
      return await window.evoAPI.requestTextInput(target, text, options);
    }
    return localEvolutionService.requestTextInput(target, text, options);
  },

  async approveTextInput(requestId, options) {
    if (isElectron) {
      return await window.evoAPI.approveTextInput(requestId, options);
    }
    return localEvolutionService.approveTextInput(requestId, options);
  },

  async cancelTextInput(requestId, reason) {
    if (isElectron) {
      return await window.evoAPI.cancelTextInput(requestId, reason);
    }
    return localEvolutionService.cancelTextInput(requestId, reason);
  },

  async getPendingTextInputRequests() {
    if (isElectron) {
      return await window.evoAPI.getPendingTextInputRequests();
    }
    return localEvolutionService.getPendingTextInputRequests();
  },

  // Stage 7F Controlled Multi-Step Computer Task Facades
  async createComputerTask(objective, options) {
    if (isElectron) {
      return await window.evoAPI.createComputerTask(objective, options);
    }
    return localEvolutionService.createComputerTask(objective, options);
  },

  async planComputerTask(objective) {
    return localEvolutionService.planComputerTask(objective);
  },

  async getComputerTask(taskId) {
    if (isElectron) {
      return await window.evoAPI.getComputerTask(taskId);
    }
    return localEvolutionService.getComputerTask(taskId);
  },

  async getPendingComputerActions(taskId) {
    if (isElectron) {
      return await window.evoAPI.getPendingComputerActions(taskId);
    }
    return localEvolutionService.getPendingComputerActions(taskId);
  },

  async approveComputerAction(taskId, actionId, options) {
    if (isElectron) {
      return await window.evoAPI.approveComputerAction(taskId, actionId, options);
    }
    return localEvolutionService.approveComputerAction(taskId, actionId, options);
  },

  async cancelComputerTask(taskId, reason) {
    if (isElectron) {
      return await window.evoAPI.cancelComputerTask(taskId, reason);
    }
    return localEvolutionService.cancelComputerTask(taskId, reason);
  },

  async pauseComputerTask(taskId, reason) {
    return localEvolutionService.pauseComputerTask(taskId, reason);
  },

  async resumeComputerTask(taskId) {
    if (isElectron) {
      return await window.evoAPI.resumeComputerTask(taskId);
    }
    return localEvolutionService.resumeComputerTask(taskId);
  },

  async verifyComputerTask(taskId) {
    if (isElectron) {
      return await window.evoAPI.verifyComputerTask(taskId);
    }
    return localEvolutionService.verifyComputerTask(taskId);
  },

  // Stage 8A Scoped Computer Autonomy Facades
  async requestAutonomyScope(taskId, details) {
    if (isElectron) {
      return await window.evoAPI.requestAutonomyScope(taskId, details);
    }
    return localEvolutionService.requestAutonomyScope(taskId, details);
  },

  async approveAutonomyScope(scopeId, options) {
    if (isElectron) {
      return await window.evoAPI.approveAutonomyScope(scopeId, options);
    }
    return localEvolutionService.approveAutonomyScope(scopeId, options);
  },

  async revokeAutonomyScope(scopeId, reason) {
    if (isElectron) {
      return await window.evoAPI.revokeAutonomyScope(scopeId, reason);
    }
    return localEvolutionService.revokeAutonomyScope(scopeId, reason);
  },

  async getAutonomyScope(identifier) {
    if (isElectron) {
      return await window.evoAPI.getAutonomyScope(identifier);
    }
    return localEvolutionService.getAutonomyScope(identifier);
  },

  async getAutonomyScopeHistory() {
    if (isElectron) {
      return await window.evoAPI.getAutonomyScopeHistory();
    }
    return localEvolutionService.getAutonomyScopeHistory();
  },

  async planAutonomyScope(taskOrObjective) {
    if (isElectron) {
      return await window.evoAPI.planAutonomyScope(taskOrObjective);
    }
    return localEvolutionService.planAutonomyScope(taskOrObjective);
  },

  async validatePlannedScope(scope, taskOrObjective) {
    if (isElectron) {
      return await window.evoAPI.validatePlannedScope(scope, taskOrObjective);
    }
    return localEvolutionService.validatePlannedScope(scope, taskOrObjective);
  },

  // Stage 8D Recovery Facades
  async recoverComputerTask(taskId) {
    if (isElectron) {
      return await window.evoAPI.recoverComputerTask(taskId);
    }
    return localEvolutionService.recoverComputerTask(taskId);
  },

  async getRecoveryHistory(taskId) {
    if (isElectron) {
      return await window.evoAPI.getRecoveryHistory(taskId);
    }
    return localEvolutionService.getRecoveryHistory(taskId);
  },

  onObjectiveUpdated(callback) {
    if (isElectron) {
      return window.evoAPI.onObjectiveUpdated(callback);
    }
    return localSubscribeObjectiveUpdates(callback);
  }
};
