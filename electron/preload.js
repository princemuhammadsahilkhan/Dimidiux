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

  onObjectiveUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('objective-updated', listener);
    return () => {
      ipcRenderer.removeListener('objective-updated', listener);
    };
  }
});
