const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evoAPI', {
  getObjectives: () => ipcRenderer.invoke('get-objectives'),
  getActiveObjective: () => ipcRenderer.invoke('get-active-objective'),
  createObjective: (goalText) => ipcRenderer.invoke('create-objective', goalText),
  setActiveObjectiveId: (id) => ipcRenderer.invoke('set-active-objective-id', id),
  generatePlan: (objectiveId) => ipcRenderer.invoke('generate-plan', objectiveId),
  startRunner: (objectiveId) => ipcRenderer.invoke('start-runner', objectiveId),
  pauseRunner: (objectiveId) => ipcRenderer.invoke('pause-runner', objectiveId),
  confirmAndContinue: (data) => ipcRenderer.invoke('confirm-and-continue', data),
  retryPlanning: (objectiveId) => ipcRenderer.invoke('retry-planning', objectiveId),
  retryExecution: (objectiveId) => ipcRenderer.invoke('retry-execution', objectiveId),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Memory IPC methods (Step 8)
  getMemories: () => ipcRenderer.invoke('get-memories'),
  searchMemory: (payload) => ipcRenderer.invoke('search-memory', payload),
  recordCorrection: (payload) => ipcRenderer.invoke('record-correction', payload),
  archiveMemory: (id) => ipcRenderer.invoke('archive-memory', id),
  restoreMemory: (id) => ipcRenderer.invoke('restore-memory', id),

  // Capability Registry IPC methods (Step 9 - Milestones 1, 2, 3 & 4)
  getCapabilities: () => ipcRenderer.invoke('get-capabilities'),
  evaluateCapabilityCandidates: () => ipcRenderer.invoke('evaluate-capability-candidates'),
  validateCapability: (candidateId) => ipcRenderer.invoke('validate-capability', candidateId),
  validateAllCapabilities: () => ipcRenderer.invoke('validate-all-capabilities'),
  matchCapabilities: (goalText) => ipcRenderer.invoke('match-capabilities', goalText),
  reuseCapability: (payload) => ipcRenderer.invoke('reuse-capability', payload),

  // Capability Improvement & Versioning IPC methods (Step 9 - Milestone 4 & 5)
  getCapabilityVersions: (capabilityId) => ipcRenderer.invoke('get-capability-versions', capabilityId),
  getImprovementProposals: (capabilityId) => ipcRenderer.invoke('get-improvement-proposals', capabilityId),
  proposeCapabilityImprovement: (payload) => ipcRenderer.invoke('propose-capability-improvement', payload),
  validateImprovement: (proposalId) => ipcRenderer.invoke('validate-improvement', proposalId),
  applyCapabilityImprovement: (proposalId) => ipcRenderer.invoke('apply-capability-improvement', proposalId),
  rollbackCapability: (payload) => ipcRenderer.invoke('rollback-capability', payload),
  getEvolutionOverview: () => ipcRenderer.invoke('get-evolution-overview'),

  // Evaluation & Reliability Framework IPC methods (Step 9 - Milestone 6)
  getEvaluationSummary: () => ipcRenderer.invoke('get-evaluation-summary'),
  evaluateObjective: (objectiveId) => ipcRenderer.invoke('evaluate-objective', objectiveId),
  evaluateCapability: (capabilityId) => ipcRenderer.invoke('evaluate-capability', capabilityId),
  evaluateCapabilityVersion: (payload) => ipcRenderer.invoke('evaluate-capability-version', payload),

  // Controlled Experimentation & Benchmarking IPC methods (Step 9 - Milestone 7)
  createExperiment: (data) => ipcRenderer.invoke('create-experiment', data),
  getExperiment: (id) => ipcRenderer.invoke('get-experiment', id),
  listExperiments: () => ipcRenderer.invoke('list-experiments'),
  startExperiment: (id) => ipcRenderer.invoke('start-experiment', id),
  cancelExperiment: (id) => ipcRenderer.invoke('cancel-experiment', id),
  getExperimentSummary: (id) => ipcRenderer.invoke('get-experiment-summary', id),
  compareExperimentGroups: (payload) => ipcRenderer.invoke('compare-experiment-groups', payload),
  compareCapabilityVersions: (payload) => ipcRenderer.invoke('compare-capability-versions', payload),

  // V1 Gap Closure IPC methods (Step 10)
  scheduleObjective: (payload) => ipcRenderer.invoke('schedule-objective', payload),
  grantBackgroundAuthorization: (objectiveId) => ipcRenderer.invoke('grant-background-authorization', objectiveId),
  processScheduledTasks: () => ipcRenderer.invoke('process-scheduled-tasks'),
  getScheduledTasks: () => ipcRenderer.invoke('get-scheduled-tasks'),
  setObjectiveBudget: (payload) => ipcRenderer.invoke('set-objective-budget', payload),
  getObjectiveBudget: (objectiveId) => ipcRenderer.invoke('get-objective-budget', objectiveId),
  getActionEvents: () => ipcRenderer.invoke('get-action-events'),
  getEventsByObjective: (objectiveId) => ipcRenderer.invoke('get-events-by-objective', objectiveId),
  reconstructObjectiveTimeline: (objectiveId) => ipcRenderer.invoke('reconstruct-objective-timeline', objectiveId),
  generateObjectiveSummary: (objectiveId) => ipcRenderer.invoke('generate-objective-summary', objectiveId),
  runConstrainedCommand: (payload) => ipcRenderer.invoke('run-constrained-command', payload),
  getTime: () => ipcRenderer.invoke('get-time'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  promoteCandidateSkill: (payload) => ipcRenderer.invoke('promote-candidate-skill', payload),

  // Stage 6A Runtime Learning IPC methods
  getRuntimeLearningRecords: (filter) => ipcRenderer.invoke('get-runtime-learning-records', filter),
  getRuntimeLearningRecordByObjective: (objectiveId) => ipcRenderer.invoke('get-runtime-learning-record-by-objective', objectiveId),
  getSystemLearningOverview: () => ipcRenderer.invoke('get-system-learning-overview'),

  // Stage 6B Supervised Self-Code Improvement & Versioning IPC methods
  getSelfCodeProposals: () => ipcRenderer.invoke('get-self-code-proposals'),
  approveSelfCodeProposal: (payload) => ipcRenderer.invoke('approve-self-code-proposal', payload),
  rejectSelfCodeProposal: (payload) => ipcRenderer.invoke('reject-self-code-proposal', payload),
  getSelfCodeVersionState: () => ipcRenderer.invoke('get-self-code-version-state'),
  rollbackSelfCodeVersion: (payload) => ipcRenderer.invoke('rollback-self-code-version', payload),

  // Stage 7A Controlled Desktop Observation IPC methods
  getDesktopObservation: (options) => ipcRenderer.invoke('get-desktop-observation', options),
  getActiveApplication: () => ipcRenderer.invoke('get-active-application'),
  getOpenWindows: () => ipcRenderer.invoke('get-open-windows'),
  getDesktopSnapshot: () => ipcRenderer.invoke('get-desktop-snapshot'),
  getApplicationState: (appId) => ipcRenderer.invoke('get-application-state', appId),

  // Stage 7B Controlled Single-Click Computer Interaction IPC methods
  getPendingClickRequests: () => ipcRenderer.invoke('get-pending-click-requests'),
  requestMouseClick: (target, options) => ipcRenderer.invoke('request-mouse-click', { target, options }),
  approveMouseClick: (interactionId, options) => ipcRenderer.invoke('approve-mouse-click', { interactionId, options }),
  cancelMouseClick: (interactionId, reason) => ipcRenderer.invoke('cancel-mouse-click', { interactionId, reason }),

  // Stage 7C Visual Target Understanding IPC methods
  identifyClickableTarget: (observation, objective, options) => ipcRenderer.invoke('identify-clickable-target', { observation, objective, options }),
  validateTargetProposal: (proposal, observation) => ipcRenderer.invoke('validate-target-proposal', { proposal, observation }),
  createClickProposalFromTarget: (visualProposal, options) => ipcRenderer.invoke('create-click-proposal-from-target', { visualProposal, options }),
  getVisualTargetProposals: () => ipcRenderer.invoke('get-visual-target-proposals'),

  // Stage 7D Controlled Application Launch IPC methods
  listAllowedApplications: () => ipcRenderer.invoke('list-allowed-applications'),
  requestApplicationLaunch: (applicationId, options) => ipcRenderer.invoke('request-application-launch', { applicationId, options }),
  approveApplicationLaunch: (requestId, options) => ipcRenderer.invoke('approve-application-launch', { requestId, options }),
  cancelApplicationLaunch: (requestId, reason) => ipcRenderer.invoke('cancel-application-launch', { requestId, reason }),
  verifyApplicationLaunch: (applicationId, observation) => ipcRenderer.invoke('verify-application-launch', { applicationId, observation }),
  getPendingLaunchRequests: () => ipcRenderer.invoke('get-pending-launch-requests'),

  // Stage 7E Controlled Supervised Text Input IPC methods
  requestTextInput: (target, text, options) => ipcRenderer.invoke('request-text-input', { target, text, options }),
  approveTextInput: (requestId, options) => ipcRenderer.invoke('approve-text-input', { requestId, options }),
  cancelTextInput: (requestId, reason) => ipcRenderer.invoke('cancel-text-input', { requestId, reason }),
  getPendingTextInputRequests: () => ipcRenderer.invoke('get-pending-text-input-requests'),

  // Stage 7F Controlled Multi-Step Computer Task IPC methods
  createComputerTask: (objective, options) => ipcRenderer.invoke('create-computer-task', { objective, options }),
  getComputerTask: (taskId) => ipcRenderer.invoke('get-computer-task', taskId),
  getPendingComputerActions: (taskId) => ipcRenderer.invoke('get-pending-computer-actions', taskId),
  approveComputerAction: (taskId, actionId, options) => ipcRenderer.invoke('approve-computer-action', { taskId, actionId, options }),
  cancelComputerTask: (taskId, reason) => ipcRenderer.invoke('cancel-computer-task', { taskId, reason }),
  resumeComputerTask: (taskId) => ipcRenderer.invoke('resume-computer-task', taskId),
  verifyComputerTask: (taskId) => ipcRenderer.invoke('verify-computer-task', taskId),

  // Stage 8A/8C Scoped Computer Autonomy IPC methods
  requestAutonomyScope: (taskId, details) => ipcRenderer.invoke('request-autonomy-scope', { taskId, details }),
  approveAutonomyScope: (scopeId, options) => ipcRenderer.invoke('approve-autonomy-scope', { scopeId, options }),
  revokeAutonomyScope: (scopeId, reason) => ipcRenderer.invoke('revoke-autonomy-scope', { scopeId, reason }),
  getAutonomyScope: (identifier) => ipcRenderer.invoke('get-autonomy-scope', identifier),
  getAutonomyScopeHistory: () => ipcRenderer.invoke('get-autonomy-scope-history'),
  planAutonomyScope: (taskOrObjective) => ipcRenderer.invoke('plan-autonomy-scope', taskOrObjective),
  validatePlannedScope: (scope, taskOrObjective) => ipcRenderer.invoke('validate-planned-scope', { scope, taskOrObjective }),

  // Stage 8D Intelligent Recovery IPC methods
  recoverComputerTask: (taskId) => ipcRenderer.invoke('recover-computer-task', taskId),
  getRecoveryHistory: (taskId) => ipcRenderer.invoke('get-recovery-history', taskId),

  onObjectiveUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('objective-updated', listener);
    return () => {
      ipcRenderer.removeListener('objective-updated', listener);
    };
  }
});
