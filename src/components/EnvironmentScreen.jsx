import React, { useState, useEffect } from 'react';
import { evoApi } from '../services/evoApi';

export default function EnvironmentScreen() {
  const [observation, setObservation] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [targetProposals, setTargetProposals] = useState([]);
  const [allowedApps, setAllowedApps] = useState([]);
  const [pendingLaunchRequests, setPendingLaunchRequests] = useState([]);
  const [pendingTextInputRequests, setPendingTextInputRequests] = useState([]);
  const [selectedAppId, setSelectedAppId] = useState('app_text_editor');
  const [launchReason, setLaunchReason] = useState('Operator request to launch desktop text editor');
  const [launchResult, setLaunchResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clickResult, setClickResult] = useState(null);
  const [textInputResult, setTextInputResult] = useState(null);
  const [targetX, setTargetX] = useState('500');
  const [targetY, setTargetY] = useState('300');
  const [targetButton, setTargetButton] = useState('left');
  const [reasonText, setReasonText] = useState('Operator test click interaction');
  const [objectiveInput, setObjectiveInput] = useState('Click main action button');
  const [textPayload, setTextPayload] = useState('Sample non-sensitive text input');
  const [textTargetLabel, setTextTargetLabel] = useState('Search Query Field');
  const [textInputType, setTextInputType] = useState('text');

  // Stage 7F Multi-step Supervised Computer Task state
  const [taskObjective, setTaskObjective] = useState("Launch text editor and type 'EVO Stage 7F Supervised Task'");
  const [currentTask, setCurrentTask] = useState(null);
  const [pendingComputerActions, setPendingComputerActions] = useState([]);
  const [taskActionResult, setTaskActionResult] = useState(null);

  // Stage 8A/8C Scoped Computer Autonomy Policy state
  const [currentScope, setCurrentScope] = useState(null);
  const [scopeHistory, setScopeHistory] = useState([]);
  const [maxActionsInput, setMaxActionsInput] = useState('10');
  const [maxDurationMinutes, setMaxDurationMinutes] = useState('30');
  const [scopeProposal, setScopeProposal] = useState(null);
  const [isEditingScope, setIsEditingScope] = useState(false);
  const [editedMaxActions, setEditedMaxActions] = useState('5');
  const [editedMaxDuration, setEditedMaxDuration] = useState('2');

  // Stage 8D Intelligent Bounded Execution & Recovery state
  const [recoveryHistory, setRecoveryHistory] = useState([]);

  const fetchObservationAndRequests = async () => {
    setLoading(true);
    try {
      const obs = await evoApi.getDesktopObservation();
      setObservation(obs);
      const pending = await evoApi.getPendingClickRequests();
      setPendingRequests(pending || []);
      const proposals = await evoApi.getVisualTargetProposals();
      setTargetProposals(proposals || []);
      const apps = await evoApi.listAllowedApplications();
      setAllowedApps(apps || []);
      const pendingLaunches = await evoApi.getPendingLaunchRequests();
      setPendingLaunchRequests(pendingLaunches || []);
      const pendingTexts = await evoApi.getPendingTextInputRequests();
      setPendingTextInputRequests(pendingTexts || []);
      const pendingActions = await evoApi.getPendingComputerActions();
      setPendingComputerActions(pendingActions || []);
      if (currentTask?.taskId) {
        const updatedTask = await evoApi.getComputerTask(currentTask.taskId);
        if (updatedTask) setCurrentTask(updatedTask);
      }
      const scope = await evoApi.getAutonomyScope();
      setCurrentScope(scope || null);
      const history = await evoApi.getAutonomyScopeHistory();
      setScopeHistory(history || []);
      const recHist = await evoApi.getRecoveryHistory(currentTask?.taskId || null);
      setRecoveryHistory(recHist || []);
    } catch (err) {
      console.error('Failed to fetch desktop observation/requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchObservationAndRequests();
  }, []);

  const handleIdentifyTarget = async (e) => {
    e.preventDefault();
    if (!objectiveInput) return;
    try {
      const res = await evoApi.identifyClickableTarget(observation, objectiveInput);
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Target Identification Result: ${res.reason || res.status}`);
      }
    } catch (err) {
      console.error('Failed to identify clickable target:', err);
    }
  };

  const handleApproveVisualTarget = async (proposal) => {
    try {
      const res = await evoApi.createClickProposalFromTarget(proposal);
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Failed to convert target proposal to click request: ${res.error}`);
      }
    } catch (err) {
      console.error('Failed to convert target proposal to click request:', err);
    }
  };

  const handleStageClickRequest = async (e) => {
    e.preventDefault();
    const x = parseInt(targetX, 10);
    const y = parseInt(targetY, 10);
    if (isNaN(x) || isNaN(y)) return;

    try {
      const target = {
        x,
        y,
        button: targetButton,
        windowId: observation?.windows?.[0]?.id || null,
        confidence: 0.95,
        reason: reasonText
      };
      const res = await evoApi.requestMouseClick(target);
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Click Request Failed: ${res.error}`);
      }
    } catch (err) {
      console.error('Failed to stage click request:', err);
    }
  };

  const handleApproveClick = async (interactionId) => {
    try {
      const res = await evoApi.approveMouseClick(interactionId);
      setClickResult(res);
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to approve mouse click:', err);
    }
  };

  const handleCancelClick = async (interactionId) => {
    try {
      await evoApi.cancelMouseClick(interactionId, 'Operator cancelled via UI');
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to cancel mouse click:', err);
    }
  };

  const handleStageLaunchRequest = async (e) => {
    e.preventDefault();
    if (!selectedAppId) return;
    try {
      const res = await evoApi.requestApplicationLaunch(selectedAppId, { reason: launchReason });
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Application Launch Request Failed: ${res.error}`);
      }
    } catch (err) {
      console.error('Failed to request application launch:', err);
    }
  };

  const handleApproveLaunch = async (requestId) => {
    try {
      const res = await evoApi.approveApplicationLaunch(requestId);
      setLaunchResult(res);
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to approve application launch:', err);
    }
  };

  const handleCancelLaunch = async (requestId) => {
    try {
      await evoApi.cancelApplicationLaunch(requestId, 'Operator cancelled via UI');
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to cancel application launch:', err);
    }
  };

  const handleStageTextInputRequest = async (e) => {
    e.preventDefault();
    const x = parseInt(targetX, 10);
    const y = parseInt(targetY, 10);
    if (isNaN(x) || isNaN(y)) return;

    try {
      const target = {
        x,
        y,
        windowId: observation?.windows?.[0]?.id || null,
        role: textInputType,
        inputType: textInputType,
        label: textTargetLabel,
        confidence: 0.95,
        reason: 'Operator requested text entry'
      };
      const res = await evoApi.requestTextInput(target, textPayload);
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Text Input Request Failed: ${res.error}`);
      }
    } catch (err) {
      console.error('Failed to stage text input request:', err);
    }
  };

  const handleApproveTextInput = async (requestId) => {
    try {
      const res = await evoApi.approveTextInput(requestId);
      setTextInputResult(res);
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to approve text input:', err);
    }
  };

  const handleCancelTextInput = async (requestId) => {
    try {
      await evoApi.cancelTextInput(requestId, 'Operator cancelled via UI');
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to cancel text input:', err);
    }
  };

  // Stage 7F & 8C Task & Scope Handlers
  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!taskObjective) return;
    try {
      const task = await evoApi.createComputerTask(taskObjective, { autoAdvance: true });
      setCurrentTask(task);
      const scopePlanRes = await evoApi.planAutonomyScope(taskObjective);
      if (scopePlanRes.success && scopePlanRes.proposedScope) {
        setScopeProposal(scopePlanRes.proposedScope);
        setEditedMaxActions(String(scopePlanRes.proposedScope.maxActions || 5));
        setEditedMaxDuration(String(Math.round((scopePlanRes.proposedScope.maxDurationMs || 120000) / 60000)));
      }
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to create computer task:', err);
      alert(`Task Creation Error: ${err.message}`);
    }
  };

  const handleApproveRecommendedScope = async (proposal) => {
    if (!currentTask?.taskId) {
      alert('Please create or select a computer task first.');
      return;
    }
    try {
      const maxActions = parseInt(editedMaxActions, 10) || proposal.maxActions || 5;
      const maxDurationMs = (parseInt(editedMaxDuration, 10) || 2) * 60 * 1000;
      const reqRes = await evoApi.requestAutonomyScope(currentTask.taskId, {
        ...proposal,
        maxActions,
        maxDurationMs
      });
      if (reqRes.success && reqRes.scope) {
        const appRes = await evoApi.approveAutonomyScope(reqRes.scope.scopeId);
        if (appRes.success) {
          setScopeProposal(null);
          setIsEditingScope(false);
          fetchObservationAndRequests();
        } else {
          alert(`Approve Scope Failed: ${appRes.error}`);
        }
      } else {
        alert(`Request Scope Failed: ${reqRes.error}`);
      }
    } catch (err) {
      console.error('Failed to approve recommended scope:', err);
    }
  };

  const handleApproveAction = async (actionId) => {
    if (!currentTask) return;
    try {
      const res = await evoApi.approveComputerAction(currentTask.taskId, actionId);
      setTaskActionResult(res);
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to approve computer action:', err);
      alert(`Action Approval Error: ${err.message}`);
    }
  };

  const handlePauseTask = async () => {
    if (!currentTask) return;
    try {
      const updated = await evoApi.pauseComputerTask(currentTask.taskId, 'Operator paused task via UI');
      setCurrentTask(updated);
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to pause computer task:', err);
    }
  };

  const handleResumeTask = async () => {
    if (!currentTask) return;
    try {
      const updated = await evoApi.resumeComputerTask(currentTask.taskId);
      setCurrentTask(updated);
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to resume computer task:', err);
    }
  };

  const handleCancelTask = async () => {
    if (!currentTask) return;
    try {
      const updated = await evoApi.cancelComputerTask(currentTask.taskId, 'Operator cancelled task via UI');
      setCurrentTask(updated);
      fetchObservationAndRequests();
    } catch (err) {
      console.error('Failed to cancel computer task:', err);
    }
  };

  const handleRequestScope = async (e) => {
    e.preventDefault();
    if (!currentTask?.taskId) {
      alert('Please create or select a computer task first before requesting an autonomy scope.');
      return;
    }
    try {
      const maxActions = parseInt(maxActionsInput, 10) || 10;
      const maxDurationMs = (parseInt(maxDurationMinutes, 10) || 30) * 60 * 1000;
      const res = await evoApi.requestAutonomyScope(currentTask.taskId, {
        maxActions,
        maxDurationMs,
        allowedApplications: ['app_text_editor', 'app_terminal', 'app_browser']
      });
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Request Scope Failed: ${res.error}`);
      }
    } catch (err) {
      console.error('Failed to request autonomy scope:', err);
    }
  };

  const handleApproveScope = async (scopeId) => {
    try {
      const res = await evoApi.approveAutonomyScope(scopeId);
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Approve Scope Failed: ${res.error}`);
      }
    } catch (err) {
      console.error('Failed to approve autonomy scope:', err);
    }
  };

  const handleRevokeScope = async (scopeId) => {
    try {
      const res = await evoApi.revokeAutonomyScope(scopeId, 'Operator revoked scope via UI');
      if (res.success) {
        fetchObservationAndRequests();
      } else {
        alert(`Revoke Scope Failed: ${res.error}`);
      }
    } catch (err) {
      console.error('Failed to revoke autonomy scope:', err);
    }
  };

  const activeApp = observation?.activeApplication || {
    id: 'app_evo_desktop',
    name: 'EVO Desktop Platform',
    title: 'EVO Environment Workspace'
  };

  const openWindows = observation?.windows || [];
  const snapshot = observation?.snapshot || { available: false, pathOrReference: null };
  const timestamp = observation?.timestamp ? new Date(observation.timestamp).toLocaleString() : 'N/A';

  return (
    <div className="max-w-6xl mx-auto py-space-md space-y-space-md selection:bg-primary-fixed selection:text-on-primary-fixed">
      {/* Top Banner & Header */}
      <div className="bg-surface-container rounded-2xl p-space-md shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-space-sm">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">account_tree</span>
          </div>
          <div>
            <h1 className="font-title-lg text-title-lg text-on-surface font-semibold tracking-tight">
              Supervised Computer Task Orchestrator
            </h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Multi-step computer-use runner with sequential execution & one approval per physical action.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-space-sm">
          <span className="px-space-xs py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
            SUPERVISED COMPUTER TASK
          </span>
          <button
            type="button"
            onClick={fetchObservationAndRequests}
            disabled={loading}
            className="px-space-sm py-space-2xs bg-surface-container-lowest hover:bg-surface-container-low text-on-surface rounded-lg font-label-md text-label-md transition-all shadow-sm flex items-center gap-1 border border-outline-variant/30"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Safety Boundary & One Action Per Approval Banner */}
      <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-space-sm text-indigo-700 dark:text-indigo-300 flex items-start gap-space-xs">
        <span className="material-symbols-outlined text-[20px] text-indigo-500 shrink-0 mt-0.5">verified_user</span>
        <div className="text-body-sm text-xs">
          <span className="font-bold">ONE ACTION PER APPROVAL:</span> Physical computer actions execute strictly sequentially (one at a time). Every app launch, click, and text input requires explicit operator approval (`Approve Action`). One approval authorizes exactly ONE physical action and cannot authorize future steps. Stale target detection automatically captures fresh observations and re-identifies targets before input execution.
        </div>
      </div>

      {/* Stage 7F Multi-Step Supervised Computer Task Section */}
      <div className="bg-surface-container rounded-2xl p-space-md shadow-sm space-y-space-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">account_tree</span>
            <h2 className="font-title-md text-title-md font-semibold text-on-surface">
              Supervised Computer Task Runner
            </h2>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold font-mono border border-primary/20">
            ONE ACTION PER APPROVAL
          </span>
        </div>

        {/* Task Objective Form */}
        <form onSubmit={handleCreateTask} className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/20 space-y-space-xs text-xs">
          <div>
            <label className="text-on-surface-variant font-medium block mb-1">User Task Objective</label>
            <input
              type="text"
              value={taskObjective}
              onChange={(e) => setTaskObjective(e.target.value)}
              placeholder="e.g. Launch text editor and type 'EVO Stage 7F Supervised Task'"
              className="w-full px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface font-medium"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/90 transition-all text-xs flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">play_circle</span>
            Plan & Stage Computer Task
          </button>
        </form>

        {/* Active / Planned Task Overview */}
        {currentTask && (
          <div className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/20 space-y-space-xs text-xs">
            <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
              <div>
                <span className="text-on-surface-variant font-mono">Task ID: {currentTask.taskId}</span>
                <div className="font-semibold text-on-surface text-sm mt-0.5">{currentTask.objective}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono ${
                  currentTask.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                  currentTask.status === 'PAUSED' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' :
                  currentTask.status === 'IN_PROGRESS' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                  'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {currentTask.status}
                </span>

                {currentTask.recoveryStatus && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/30">
                    {currentTask.recoveryStatus}
                  </span>
                )}

                {currentTask.status === 'IN_PROGRESS' && (
                  <button
                    type="button"
                    onClick={handlePauseTask}
                    className="px-2 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 rounded font-semibold transition-all"
                  >
                    Pause
                  </button>
                )}

                {currentTask.status === 'PAUSED' && (
                  <button
                    type="button"
                    onClick={handleResumeTask}
                    className="px-2 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 rounded font-semibold transition-all"
                  >
                    Resume
                  </button>
                )}

                {(currentTask.status === 'IN_PROGRESS' || currentTask.status === 'PAUSED' || currentTask.status === 'PLANNED') && (
                  <button
                    type="button"
                    onClick={handleCancelTask}
                    className="px-2 py-1 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 rounded font-semibold transition-all"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Planned Steps Timeline */}
            <div className="space-y-1.5 pt-1">
              <div className="text-on-surface-variant font-medium text-[11px] uppercase tracking-wider">Task Step Timeline</div>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {currentTask.steps.map((step, idx) => (
                  <div key={step.stepId} className="p-2 rounded bg-surface-container/50 border border-outline-variant/10 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-on-surface-variant font-bold">#{idx + 1}</span>
                      <span className="font-mono text-primary font-bold px-1.5 py-0.5 bg-primary/10 rounded text-[10px]">
                        {step.type}
                      </span>
                      <span className="text-on-surface truncate max-w-md">{step.description}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      step.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                      step.status === 'AWAITING_APPROVAL' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 animate-pulse' :
                      step.status === 'EXECUTING' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                      step.status === 'STALE' ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' :
                      'bg-surface-container text-on-surface-variant'
                    }`}>
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stage 8A Bounded Computer Autonomy Scope Section */}
        <div className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/30 space-y-space-xs text-xs">
          <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">admin_panel_settings</span>
              <span className="font-semibold text-on-surface text-sm">Computer Autonomy Policy (Stage 8A)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border ${
                currentScope && currentScope.mode === 'BOUNDED' && currentScope.status === 'ACTIVE'
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30'
                  : 'bg-primary/10 text-primary border-primary/20'
              }`}>
                MODE: {currentScope && currentScope.mode === 'BOUNDED' && currentScope.status === 'ACTIVE' ? 'BOUNDED (AUTO-EXECUTE WITHIN SCOPE)' : 'FULLY_SUPERVISED'}
              </span>
            </div>
          </div>

          {/* Hard Safety Overrides Banner */}
          <div className="p-2 rounded bg-surface-container/40 border border-outline-variant/10 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="font-bold text-on-surface-variant uppercase tracking-wider">Hard Overrides:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Passwords & Secrets Blocked</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Shortcuts & Hotkeys Blocked</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Shell Execution Blocked</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Confidence &lt;0.70 Halts Task</span>
          </div>

          {/* Stage 8C Recommended Autonomy Scope Panel */}
          {scopeProposal && (
            <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/30 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-2 text-sm">
                  <span className="material-symbols-outlined text-indigo-600 text-[18px]">psychology</span>
                  EVO RECOMMENDS THIS AUTONOMY SCOPE
                </span>
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 text-xs font-mono font-bold">
                  Confidence: {Math.round((scopeProposal.confidence || 1.0) * 100)}%
                </span>
              </div>

              <div className="text-on-surface text-xs space-y-1">
                <div><strong>Objective:</strong> {taskObjective}</div>
                <div><strong>Explanation:</strong> {scopeProposal.explanation}</div>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div><strong>Applications:</strong> {scopeProposal.allowedApplications?.join(', ') || 'None'}</div>
                  <div><strong>Actions:</strong> {scopeProposal.allowedActions?.join(', ') || 'None'}</div>
                  <div><strong>Max Actions:</strong> {editedMaxActions}</div>
                  <div><strong>Time Limit:</strong> {editedMaxDuration} mins</div>
                </div>
              </div>

              <div className="p-2 rounded bg-surface-container/50 text-[11px] space-y-1">
                <span className="font-bold text-on-surface-variant uppercase tracking-wider block">Always Blocked:</span>
                <div className="flex flex-wrap gap-x-3 text-emerald-600 dark:text-emerald-400 font-medium">
                  <span>✓ Passwords & Credentials</span>
                  <span>✓ Keyboard Shortcuts</span>
                  <span>✓ Shell Commands</span>
                  <span>✓ Unknown Targets</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleApproveRecommendedScope(scopeProposal)}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Approve Scope
                </button>
                <button
                  type="button"
                  onClick={() => setScopeProposal(null)}
                  className="px-4 py-1.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold transition-all border border-rose-500/20"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingScope(!isEditingScope)}
                  className="px-4 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-semibold transition-all"
                >
                  {isEditingScope ? 'Close Edit' : 'Edit Scope'}
                </button>
              </div>

              {isEditingScope && (
                <div className="p-3 bg-surface-container-lowest rounded-lg border border-indigo-500/20 space-y-2 mt-2">
                  <div className="font-semibold text-xs text-on-surface">Edit Budget & Allowed Applications (Hard Safety Overrides Remain Locked)</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-on-surface-variant font-medium block mb-1">Max Actions Budget (&lt;= 50)</label>
                      <input
                        type="number"
                        value={editedMaxActions}
                        onChange={(e) => setEditedMaxActions(e.target.value)}
                        className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 text-on-surface font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-on-surface-variant font-medium block mb-1">Time Budget (Minutes)</label>
                      <input
                        type="number"
                        value={editedMaxDuration}
                        onChange={(e) => setEditedMaxDuration(e.target.value)}
                        className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 text-on-surface font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Active Scope Status & Budget Meter */}
          {currentScope ? (
            <div className="p-3 bg-surface-container/50 rounded-lg border border-outline-variant/20 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-on-surface text-xs">
                    Scope ID: <span className="font-mono text-primary">{currentScope.scopeId}</span> (Task: <span className="font-mono">{currentScope.taskId}</span>)
                  </div>
                  <div className="text-on-surface-variant text-[11px]">
                    Created: {new Date(currentScope.createdAt).toLocaleTimeString()} | Expires: {new Date(currentScope.expiresAt).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    currentScope.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                    currentScope.status === 'PENDING' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 animate-pulse' :
                    'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                  }`}>
                    {currentScope.status}
                  </span>
                  {currentScope.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => handleApproveScope(currentScope.scopeId)}
                      className="px-3 py-1 bg-emerald-600 text-white font-semibold rounded hover:bg-emerald-700 transition-all text-xs"
                    >
                      Approve Bounded Scope
                    </button>
                  )}
                  {(currentScope.status === 'ACTIVE' || currentScope.status === 'PENDING') && (
                    <button
                      type="button"
                      onClick={() => handleRevokeScope(currentScope.scopeId)}
                      className="px-3 py-1 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 font-semibold rounded transition-all text-xs"
                    >
                      Revoke Scope
                    </button>
                  )}
                </div>
              </div>

              {/* Action Budget Meter */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-on-surface-variant">Action Budget Usage</span>
                  <span className="font-mono font-bold text-on-surface">{currentScope.executedActionsCount} / {currentScope.maxActions} Actions</span>
                </div>
                <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (currentScope.executedActionsCount / (currentScope.maxActions || 1)) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Request Scope Form */
            <form onSubmit={handleRequestScope} className="space-y-2 pt-1">
              <div className="text-on-surface-variant font-medium text-[11px] uppercase tracking-wider">Request Bounded Autonomy Scope</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-on-surface-variant text-[11px] block mb-0.5">Max Actions Budget</label>
                  <input
                    type="number"
                    value={maxActionsInput}
                    onChange={(e) => setMaxActionsInput(e.target.value)}
                    min="1"
                    max="50"
                    className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 text-on-surface font-mono"
                  />
                </div>
                <div>
                  <label className="text-on-surface-variant text-[11px] block mb-0.5">Time Budget (Minutes)</label>
                  <input
                    type="number"
                    value={maxDurationMinutes}
                    onChange={(e) => setMaxDurationMinutes(e.target.value)}
                    min="1"
                    max="120"
                    className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 text-on-surface font-mono"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!currentTask}
                className="w-full py-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 font-semibold rounded-lg transition-all text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">verified</span>
                Request Bounded Scope for Current Task
              </button>
            </form>
          )}
        </div>

        {/* Pending Action Approval Section */}
        {pendingComputerActions.length > 0 && (
          <div className="p-space-sm bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-space-xs text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5 text-sm">
                <span className="material-symbols-outlined text-[18px]">gavel</span>
                Pending Supervised Computer Actions ({pendingComputerActions.length})
              </span>
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold rounded text-[10px] font-mono">
                ONE APPROVAL PER PHYSICAL ACTION
              </span>
            </div>

            <div className="space-y-2">
              {pendingComputerActions.map((action) => (
                <div key={action.stepId} className="p-3 bg-surface-container-lowest rounded-lg border border-amber-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-on-surface text-sm">Step: {action.stepId} ({action.type})</div>
                      <div className="text-on-surface-variant text-xs">{action.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApproveAction(action.stepId)}
                      className="px-4 py-1.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-all shadow-sm"
                    >
                      Approve & Execute One Action
                    </button>
                  </div>
                  {action.targetReference && (
                    <div className="p-2 bg-surface-container/60 rounded font-mono text-[11px] text-on-surface-variant">
                      Target: {JSON.stringify(action.targetReference)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Result Display */}
        {taskActionResult && (
          <div className="p-space-sm bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs space-y-1">
            <div className="font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              Action Execution Result
            </div>
            <div className="font-mono text-on-surface-variant">
              Status: {taskActionResult.status} | Details: {JSON.stringify(taskActionResult.details || taskActionResult.result || {})}
            </div>
          </div>
        )}
        {/* Recovery Audit Log Display */}
        {recoveryHistory.length > 0 && (
          <div className="p-space-sm bg-purple-500/10 border border-purple-500/20 rounded-xl text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 text-sm">
                <span className="material-symbols-outlined text-[18px]">build_circle</span>
                Bounded Recovery Audit Events ({recoveryHistory.length})
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-600 dark:text-purple-300 text-[10px] font-mono font-bold">
                AUDITED & BOUNDED
              </span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {recoveryHistory.map((rec) => (
                <div key={rec.id} className="p-2 rounded bg-surface-container-lowest border border-purple-500/10 flex items-center justify-between font-mono text-[11px]">
                  <div>
                    <span className="font-bold text-on-surface">{rec.recoveryLevel}</span>
                    <span className="text-on-surface-variant mx-1">|</span>
                    <span className="text-primary font-semibold">{rec.attemptedAction}</span>
                    <span className="text-on-surface-variant mx-1">|</span>
                    <span className="text-on-surface-variant">{rec.reason}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    rec.result === 'RECOVERED' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                    rec.result === 'SCOPE_EXPANSION_REQUIRED' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' :
                    'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                  }`}>
                    {rec.result}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>


      {/* Stage 7E Controlled Supervised Text Input Section */}
      <div className="bg-surface-container rounded-2xl p-space-md shadow-sm space-y-space-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">keyboard</span>
            <h2 className="font-title-md text-title-md font-semibold text-on-surface">
              Supervised Text Input
            </h2>
          </div>
          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-bold font-mono">
            NON-SENSITIVE TARGETS ONLY
          </span>
        </div>

        {/* Stage Text Input Request Form */}
        <form onSubmit={handleStageTextInputRequest} className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/20 space-y-space-xs text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
            <div>
              <label className="text-on-surface-variant font-medium block mb-1">Target Field Label</label>
              <input
                type="text"
                value={textTargetLabel}
                onChange={(e) => setTextTargetLabel(e.target.value)}
                placeholder="Field label (e.g. Search Query)"
                className="w-full px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface"
              />
            </div>

            <div>
              <label className="text-on-surface-variant font-medium block mb-1">Input Type</label>
              <select
                value={textInputType}
                onChange={(e) => setTextInputType(e.target.value)}
                className="w-full px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 font-mono text-on-surface"
              >
                <option value="text">text</option>
                <option value="search">search</option>
                <option value="textarea">textarea</option>
              </select>
            </div>

            <div>
              <label className="text-on-surface-variant font-medium block mb-1">Text Payload to Type</label>
              <input
                type="text"
                value={textPayload}
                onChange={(e) => setTextPayload(e.target.value)}
                placeholder="Enter non-sensitive text"
                className="w-full px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="text-xs text-on-surface-variant font-mono">
              Target Field: {textTargetLabel} ({textInputType}) | Text Length: {textPayload.length} chars
            </div>
            <button
              type="submit"
              className="px-4 py-1.5 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/90 transition-all text-xs flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">edit_note</span>
              Stage Text Input Request
            </button>
          </div>
        </form>

        {/* Pending Text Input Approvals */}
        {pendingTextInputRequests.length > 0 && (
          <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-space-sm space-y-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-title-sm text-title-sm font-bold text-teal-900 dark:text-teal-200 flex items-center gap-2">
                <span className="material-symbols-outlined text-teal-600 text-[18px]">pending_actions</span>
                Pending Supervised Text Input Approvals ({pendingTextInputRequests.length})
              </span>
              <span className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-800 dark:text-teal-200 text-xs font-mono font-bold">
                AWAITING_APPROVAL
              </span>
            </div>

            <div className="space-y-space-xs">
              {pendingTextInputRequests.map((req) => (
                <div key={req.requestId} className="bg-surface-container-lowest rounded-lg p-space-sm border border-teal-500/20 flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-body-md font-semibold text-on-surface">
                      <span>Field: {req.target.label}</span>
                      <span className="px-2 py-0.5 rounded bg-surface-container-low text-xs font-mono text-on-surface-variant">
                        Type: {req.target.inputType}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 text-xs font-mono font-bold">
                        NON-SENSITIVE
                      </span>
                    </div>
                    <div className="text-xs text-on-surface-variant font-mono">
                      Proposed Text: "{req.redactedPreview}" ({req.textLength} chars) | Request ID: {req.requestId}
                    </div>
                  </div>

                  <div className="flex items-center gap-space-xs">
                    <button
                      type="button"
                      onClick={() => handleApproveTextInput(req.requestId)}
                      className="px-space-sm py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">keyboard</span>
                      Approve & Type
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelTextInput(req.requestId)}
                      className="px-space-sm py-1.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold transition-all border border-rose-500/20"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Text Input Execution Result Banner */}
        {textInputResult && (
          <div className={`p-space-sm rounded-xl border ${textInputResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'} space-y-1`}>
            <div className="flex items-center justify-between">
              <span className="font-title-sm text-title-sm font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {textInputResult.success ? 'task_alt' : 'error'}
                </span>
                Text Input Result: {textInputResult.success ? 'EXECUTED' : 'FAILED'}
              </span>
              <button
                type="button"
                onClick={() => setTextInputResult(null)}
                className="text-xs font-semibold underline opacity-80 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
            <div className="text-xs font-mono space-y-0.5">
              <div>Request ID: {textInputResult.requestId} | Text Length: {textInputResult.textLength} chars</div>
              <div>Input Hash (SHA-256): {textInputResult.inputHash}</div>
              <div>Before Obs: {textInputResult.beforeObservationId} | After Obs: {textInputResult.afterObservationId}</div>
              <div>
                State: <span className="font-bold text-teal-600 dark:text-teal-400">{textInputResult.state}</span> | Details: {textInputResult.verification?.details}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stage 7D Controlled Application Launch Section */}
      <div className="bg-surface-container rounded-2xl p-space-md shadow-sm space-y-space-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">rocket_launch</span>
            <h2 className="font-title-md text-title-md font-semibold text-on-surface">
              Launch Application
            </h2>
          </div>
          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-bold font-mono">
            ALLOWLISTED ONLY
          </span>
        </div>

        {/* Stage Application Launch Request Form */}
        <form onSubmit={handleStageLaunchRequest} className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/20 space-y-space-xs text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
            <div>
              <label className="text-on-surface-variant font-medium block mb-1">Select Allowed Application</label>
              <select
                value={selectedAppId}
                onChange={(e) => setSelectedAppId(e.target.value)}
                className="w-full px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 font-mono text-on-surface"
              >
                {allowedApps.map((app) => (
                  <option key={app.applicationId} value={app.applicationId}>
                    {app.displayName} ({app.executable})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-on-surface-variant font-medium block mb-1">Objective Launch Reason</label>
              <input
                type="text"
                value={launchReason}
                onChange={(e) => setLaunchReason(e.target.value)}
                placeholder="Reason for launching application"
                className="w-full px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="text-xs text-on-surface-variant font-mono">
              Current Observation ID: {observation?.observationId || 'N/A'}
            </div>
            <button
              type="submit"
              className="px-4 py-1.5 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/90 transition-all text-xs flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">add_task</span>
              Stage Launch Request
            </button>
          </div>
        </form>

        {/* Pending Application Launch Approvals */}
        {pendingLaunchRequests.length > 0 && (
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-space-sm space-y-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-title-sm text-title-sm font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-600 text-[18px]">pending_actions</span>
                Pending Application Launch Approvals ({pendingLaunchRequests.length})
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 text-xs font-mono font-bold">
                AWAITING_APPROVAL
              </span>
            </div>

            <div className="space-y-space-xs">
              {pendingLaunchRequests.map((req) => (
                <div key={req.requestId} className="bg-surface-container-lowest rounded-lg p-space-sm border border-indigo-500/20 flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-body-md font-semibold text-on-surface">
                      <span>Application: {req.displayName}</span>
                      <span className="px-2 py-0.5 rounded bg-surface-container-low text-xs font-mono text-on-surface-variant">
                        {req.executable}
                      </span>
                    </div>
                    <div className="text-xs text-on-surface-variant font-mono">
                      Request ID: {req.requestId} | Before Obs: {req.beforeObservationId}
                    </div>
                  </div>

                  <div className="flex items-center gap-space-xs">
                    <button
                      type="button"
                      onClick={() => handleApproveLaunch(req.requestId)}
                      className="px-space-sm py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      Approve Launch
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelLaunch(req.requestId)}
                      className="px-space-sm py-1.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold transition-all border border-rose-500/20"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Application Launch Result Banner */}
        {launchResult && (
          <div className={`p-space-sm rounded-xl border ${launchResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'} space-y-1`}>
            <div className="flex items-center justify-between">
              <span className="font-title-sm text-title-sm font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {launchResult.success ? 'task_alt' : 'error'}
                </span>
                Application Launch Result: {launchResult.success ? 'SUCCESS' : 'FAILED'}
              </span>
              <button
                type="button"
                onClick={() => setLaunchResult(null)}
                className="text-xs font-semibold underline opacity-80 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
            <div className="text-xs font-mono space-y-0.5">
              <div>Request ID: {launchResult.requestId} | Application ID: {launchResult.applicationId}</div>
              <div>Before Obs: {launchResult.beforeObservationId} | After Obs: {launchResult.afterObservationId}</div>
              <div>
                Application State:{' '}
                <span className={`font-bold ${launchResult.verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {launchResult.state} (Verified: {launchResult.verified ? 'YES' : 'NO'})
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stage 7C Suggested UI Targets Section */}
      <div className="bg-surface-container rounded-2xl p-space-md shadow-sm space-y-space-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">center_focus_strong</span>
            <h2 className="font-title-md text-title-md font-semibold text-on-surface">
              Suggested Target
            </h2>
          </div>
          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-bold font-mono">
            TARGET IDENTIFICATION ONLY
          </span>
        </div>

        {/* Target Identification Search/Test Bar */}
        <form onSubmit={handleIdentifyTarget} className="flex gap-2 text-xs">
          <input
            type="text"
            value={objectiveInput}
            onChange={(e) => setObjectiveInput(e.target.value)}
            placeholder="Enter goal intent to identify UI target (e.g. Click submit button)"
            className="flex-1 px-3 py-1.5 bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-on-surface"
          />
          <button
            type="submit"
            className="px-4 py-1.5 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/90 transition-all"
          >
            Identify Target
          </button>
        </form>

        {/* Target Proposals Grid */}
        {targetProposals.length === 0 ? (
          <div className="p-space-md text-center bg-surface-container-lowest rounded-xl border border-outline-variant/20 text-xs text-on-surface-variant">
            No visual target proposals generated yet. Enter a goal intent above to identify clickable UI targets.
          </div>
        ) : (
          <div className="space-y-space-xs">
            {targetProposals.map((prop) => (
              <div key={prop.proposalId} className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-body-md text-on-surface">{prop.target.label}</span>
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-mono font-medium uppercase">
                      Role: {prop.target.role}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${prop.status === 'PROPOSED' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                      {prop.status} ({Math.round(prop.confidence * 100)}% Confidence)
                    </span>
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono">
                    Observed: {prop.observationId}
                  </div>
                </div>

                <div className="text-xs text-on-surface-variant flex items-center justify-between">
                  <div>
                    <span>Target Coordinates: ({prop.target.x}, {prop.target.y})</span> | Bounds: [{prop.target.bounds.width}×{prop.target.bounds.height}]
                  </div>
                  <div className="flex items-center gap-space-xs">
                    <button
                      type="button"
                      onClick={() => handleApproveVisualTarget(prop)}
                      className="px-space-sm py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">touch_app</span>
                      Approve Click
                    </button>
                  </div>
                </div>

                <div className="text-xs italic text-on-surface-variant/80 border-t border-outline-variant/10 pt-1">
                  Reasoning: "{prop.reasoning}"
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Supervised Single-Click Approvals */}
      {pendingRequests.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-space-md space-y-space-sm">
          <div className="flex items-center justify-between">
            <span className="font-title-md text-title-md font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-600 text-[20px]">touch_app</span>
              Pending Single-Click Approval ({pendingRequests.length})
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 text-xs font-mono font-bold">
              AWAITING_APPROVAL
            </span>
          </div>

          <div className="space-y-space-xs">
            {pendingRequests.map((req) => (
              <div key={req.interactionId} className="bg-surface-container-lowest rounded-xl p-space-sm border border-amber-500/20 flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-body-md font-semibold text-on-surface">
                    <span>Target: ({req.target.x}, {req.target.y})</span>
                    <span className="px-2 py-0.5 rounded bg-surface-container-low text-xs font-mono text-on-surface-variant uppercase">
                      {req.target.button} click
                    </span>
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono">
                    Window: {req.target.windowId || 'Desktop bounds'} | Observation: {req.beforeObservationId}
                  </div>
                  <div className="text-xs text-on-surface italic">
                    Reason: "{req.target.reason}"
                  </div>
                </div>

                <div className="flex items-center gap-space-xs">
                  <button
                    type="button"
                    onClick={() => handleApproveClick(req.interactionId)}
                    className="px-space-sm py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    Approve Click
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelClick(req.interactionId)}
                    className="px-space-sm py-1.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold transition-all border border-rose-500/20"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Result Banner */}
      {clickResult && (
        <div className={`p-space-md rounded-2xl border ${clickResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'} space-y-2`}>
          <div className="flex items-center justify-between">
            <span className="font-title-sm text-title-sm font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">
                {clickResult.success ? 'task_alt' : 'error'}
              </span>
              Click Execution Result: {clickResult.success ? 'SUCCESS' : 'FAILED / STALE'}
            </span>
            <button
              type="button"
              onClick={() => setClickResult(null)}
              className="text-xs font-semibold underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
          <div className="text-xs font-mono space-y-1">
            <div>Interaction ID: {clickResult.interactionId}</div>
            <div>Before Obs: {clickResult.beforeObservationId} | After Obs: {clickResult.afterObservationId}</div>
            <div>
              State Change Detected:{' '}
              <span className={`font-bold ${clickResult.stateChanged ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {clickResult.stateChanged ? 'YES (Desktop State Changed)' : 'NO (State Preserved)'}
              </span>
            </div>
            <div>Details: {clickResult.verification?.details}</div>
          </div>
        </div>
      )}

      {/* Grid: Active App & Observation Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
        {/* Active Application Card */}
        <div className="bg-surface-container rounded-2xl p-space-md shadow-sm space-y-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-title-sm text-title-sm font-semibold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[18px]">apps</span>
              Active Application
            </span>
            <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-mono font-medium">
              {activeApp.id}
            </span>
          </div>

          <div className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/20 space-y-space-xs">
            <div>
              <div className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">Application Name</div>
              <div className="text-body-md text-on-surface font-semibold">{activeApp.name}</div>
            </div>
            <div>
              <div className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">Window Title</div>
              <div className="text-body-sm text-on-surface truncate">{activeApp.title}</div>
            </div>
          </div>
        </div>

        {/* Stage Test Click Interaction Form */}
        <div className="bg-surface-container rounded-2xl p-space-md shadow-sm space-y-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-title-sm text-title-sm font-semibold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[18px]">mouse</span>
              Stage Supervised Click Request
            </span>
          </div>

          <form onSubmit={handleStageClickRequest} className="p-space-sm bg-surface-container-lowest rounded-xl border border-outline-variant/20 space-y-2 text-xs">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-on-surface-variant font-medium block">X Coord</label>
                <input
                  type="number"
                  value={targetX}
                  onChange={(e) => setTargetX(e.target.value)}
                  className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 font-mono text-on-surface"
                />
              </div>
              <div>
                <label className="text-on-surface-variant font-medium block">Y Coord</label>
                <input
                  type="number"
                  value={targetY}
                  onChange={(e) => setTargetY(e.target.value)}
                  className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 font-mono text-on-surface"
                />
              </div>
              <div>
                <label className="text-on-surface-variant font-medium block">Button</label>
                <select
                  value={targetButton}
                  onChange={(e) => setTargetButton(e.target.value)}
                  className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 font-mono text-on-surface"
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-on-surface-variant font-medium block">Reason</label>
              <input
                type="text"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                className="w-full px-2 py-1 bg-surface-container rounded border border-outline-variant/30 text-on-surface"
              />
            </div>

            <button
              type="submit"
              className="w-full py-1.5 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/90 transition-all text-xs"
            >
              Stage Click Request
            </button>
          </form>
        </div>
      </div>

      {/* Open Windows Card */}
      <div className="bg-surface-container rounded-2xl p-space-md shadow-sm space-y-space-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">window</span>
            <h2 className="font-title-md text-title-md font-semibold text-on-surface">
              Open Windows ({openWindows.length})
            </h2>
          </div>
        </div>

        {openWindows.length === 0 ? (
          <div className="p-space-lg text-center bg-surface-container-lowest rounded-xl border border-outline-variant/20">
            <span className="material-symbols-outlined text-[32px] text-on-surface-variant/40 mb-1">visibility_off</span>
            <p className="text-body-sm text-on-surface-variant">No open windows detected in observation state.</p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/20 bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
            {openWindows.map((win) => (
              <div key={win.id} className="p-space-sm flex items-center justify-between hover:bg-surface-container-low/50 transition-colors">
                <div className="space-y-0.5 max-w-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-body-md text-body-md text-on-surface font-medium truncate">
                      {win.title}
                    </span>
                    {win.focused && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary text-on-primary uppercase tracking-wider">
                        Focused
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono">
                    ID: {win.id} | App: {win.applicationId}
                  </div>
                </div>

                <div className="text-right font-mono text-xs text-on-surface-variant">
                  {win.bounds ? `${win.bounds.width}×${win.bounds.height} at (${win.bounds.x}, ${win.bounds.y})` : 'Bounds N/A'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
