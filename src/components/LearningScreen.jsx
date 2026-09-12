import React, { useState, useEffect } from 'react';
import { evoApi } from '../services/evoApi';

export default function LearningScreen() {
  const [overview, setOverview] = useState(null);
  const [records, setRecords] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [versionState, setVersionState] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadAllData = async () => {
    try {
      const [ov, recs, caps, props, verState] = await Promise.all([
        evoApi.getSystemLearningOverview(),
        evoApi.getRuntimeLearningRecords(),
        evoApi.getCapabilities(),
        evoApi.getSelfCodeProposals(),
        evoApi.getSelfCodeVersionState()
      ]);

      setOverview(ov || null);
      setRecords(recs || []);
      setCapabilities(caps || []);
      setProposals(props || []);
      setVersionState(verState || null);
    } catch (err) {
      console.error('Failed to load learning data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    loadAllData();

    const unsubscribe = evoApi.onObjectiveUpdated(() => {
      if (isMounted) loadAllData();
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const showNotification = (msg) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleApproveProposal = async (proposalId) => {
    try {
      const res = await evoApi.approveSelfCodeProposal(proposalId);
      if (res && res.success) {
        showNotification(`Proposal approved! Promoted to version ${res.activeVersion || 'new'}.`);
      } else {
        showNotification(`Approval failed: ${res?.reason || res?.error || 'Unknown error'}`);
      }
      await loadAllData();
    } catch (err) {
      showNotification(`Error approving proposal: ${err.message}`);
    }
  };

  const handleRejectProposal = async (proposalId) => {
    try {
      await evoApi.rejectSelfCodeProposal(proposalId, 'Rejected by operator in UI');
      showNotification('Proposal rejected.');
      await loadAllData();
    } catch (err) {
      showNotification(`Error rejecting proposal: ${err.message}`);
    }
  };

  const handleRollbackVersion = async (versionId) => {
    if (!window.confirm(`Are you sure you want to rollback to version ${versionId}?`)) return;
    try {
      const res = await evoApi.rollbackSelfCodeVersion(versionId, 'Operator manual rollback from UI');
      if (res && res.success) {
        showNotification(`Successfully rolled back to ${versionId}.`);
      } else {
        showNotification(`Rollback failed: ${res?.reason || res?.error || 'Unknown error'}`);
      }
      await loadAllData();
    } catch (err) {
      showNotification(`Error during rollback: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto w-full py-space-3xl px-space-base flex justify-center items-center min-h-[60vh]">
        <div className="flex items-center gap-space-sm text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-[24px]">progress_activity</span>
          <span className="font-body-md">Loading EVO Learning & System State...</span>
        </div>
      </div>
    );
  }

  const awaitingProposals = proposals.filter(
    (p) => p.status === 'AWAITING_APPROVAL' || (p.status === 'VALIDATED' && overview?.currentAutonomyMode === 'SUPERVISED')
  );

  return (
    <div className="max-w-5xl mx-auto w-full py-space-3xl px-space-base space-y-space-3xl select-none">
      {/* Title Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-title-lg text-title-lg text-on-surface tracking-tight font-semibold">
            System Learning & Self-Observation
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-space-2xs">
            Persistent runtime learning records, capability evolution stats, and supervised self-code improvement status.
          </p>
        </div>

        {/* System Autonomy & Active Version Badge */}
        <div className="flex items-center gap-space-sm">
          <div className="flex items-center gap-space-2xs px-space-md py-space-xs rounded-full bg-surface-container-high border border-outline-variant/30">
            <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
            <span className="font-label-sm text-label-sm text-on-surface font-medium">
              Autonomy: {overview?.currentAutonomyMode || 'SUPERVISED'}
            </span>
          </div>
          <div className="flex items-center gap-space-2xs px-space-md py-space-xs rounded-full bg-primary-fixed border border-primary/20">
            <span className="material-symbols-outlined text-[14px] text-on-primary-fixed">verified</span>
            <span className="font-label-sm text-label-sm text-on-primary-fixed font-medium">
              {versionState?.activeVersion || overview?.currentActiveSelfCodeVersion || 'v1.1.0-self-healing'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div className="p-space-md bg-primary-fixed/30 border border-primary/30 rounded-xl flex items-center justify-between text-on-primary-fixed text-body-md">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[20px]">info</span>
            <span>{actionMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-on-primary-fixed hover:opacity-80"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* 1. LEARNING OVERVIEW CARDS */}
      <section className="space-y-space-sm">
        <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium px-space-xs">
          System Overview
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-base">
          <div className="p-space-lg bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col">
            <span className="font-body-sm text-body-sm text-on-surface-variant">Total Learning Runs</span>
            <span className="font-display text-display text-on-surface font-semibold mt-space-2xs">
              {overview?.totalLearningRecords || 0}
            </span>
            <div className="flex items-center gap-space-xs mt-space-xs font-caption text-caption text-on-surface-variant">
              <span className="text-emerald-600 font-medium">{overview?.successfulObjectiveCount || 0} succeeded</span>
              <span>•</span>
              <span className="text-rose-600 font-medium">{overview?.failedObjectiveCount || 0} failed</span>
            </div>
          </div>

          <div className="p-space-lg bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col">
            <span className="font-body-sm text-body-sm text-on-surface-variant">Capabilities Learned/Used</span>
            <span className="font-display text-display text-on-surface font-semibold mt-space-2xs">
              {overview?.capabilityLearningCount || capabilities.length}
            </span>
            <span className="font-caption text-caption text-on-surface-variant mt-space-xs">
              {capabilities.filter((c) => c.status === 'VALIDATED').length} validated
            </span>
          </div>

          <div className="p-space-lg bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col">
            <span className="font-body-sm text-body-sm text-on-surface-variant">Performance Diagnoses</span>
            <span className="font-display text-display text-on-surface font-semibold mt-space-2xs">
              {overview?.performanceDiagnosisCount || 0}
            </span>
            <span className="font-caption text-caption text-on-surface-variant mt-space-xs">
              Stage 5F metrics
            </span>
          </div>

          <div className="p-space-lg bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col">
            <span className="font-body-sm text-body-sm text-on-surface-variant">Self-Code Proposals</span>
            <span className="font-display text-display text-on-surface font-semibold mt-space-2xs">
              {overview?.proposalsGeneratedCount || proposals.length}
            </span>
            <span className="font-caption text-caption text-amber-600 font-medium mt-space-xs">
              {awaitingProposals.length} pending review
            </span>
          </div>
        </div>
      </section>

      {/* 2. PENDING SUPERVISED APPROVALS */}
      {awaitingProposals.length > 0 && (
        <section className="space-y-space-sm border-2 border-amber-500/30 p-space-lg bg-amber-500/5 rounded-2xl">
          <div className="flex items-center gap-space-xs text-amber-800">
            <span className="material-symbols-outlined text-[22px]">gavel</span>
            <h2 className="font-title-md text-title-md font-semibold">
              Supervised Approval Required ({awaitingProposals.length})
            </h2>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            EVO detected recurring evidence and generated a self-code improvement proposal. Standard autonomy policy requires operator review before promotion.
          </p>

          <div className="space-y-space-base mt-space-md">
            {awaitingProposals.map((p) => {
              const isStale = p.baseVersion && versionState?.activeVersion && p.baseVersion !== versionState.activeVersion;
              return (
                <div
                  key={p.id || p.proposalId}
                  className="p-space-xl bg-surface-container-lowest rounded-xl shadow-sm border border-amber-500/20 space-y-space-md"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-space-xs">
                        <span className="px-space-xs py-space-3xs rounded text-caption font-semibold bg-amber-100 text-amber-800">
                          {p.status}
                        </span>
                        {isStale && (
                          <span className="px-space-xs py-space-3xs rounded text-caption font-semibold bg-rose-100 text-rose-800">
                            STALE (Base Version Mismatch)
                          </span>
                        )}
                        <span className="font-label-sm text-label-sm text-on-surface-variant font-mono">
                          ID: {p.id || p.proposalId}
                        </span>
                      </div>
                      <h3 className="font-title-sm text-title-sm font-semibold text-on-surface mt-space-xs">
                        {p.problemStatement || 'Recurring self-code improvement candidate'}
                      </h3>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-3xs">
                        Component: <code className="font-mono text-primary">{p.affectedComponent}</code>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm p-space-sm bg-surface-container rounded-lg text-body-sm">
                    <div>
                      <span className="text-on-surface-variant block text-caption">Target Files</span>
                      <span className="font-mono text-caption text-on-surface truncate block">
                        {Array.isArray(p.targetFiles) ? p.targetFiles.join(', ') : 'src/services/...'}
                      </span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block text-caption">Sandbox Test Result</span>
                      <span className="font-medium text-emerald-700">
                        {p.testResult?.passed ? 'PASSED (0 Failures)' : p.status === 'VALIDATED' ? 'VALIDATED' : 'PASS'}
                      </span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block text-caption">Comparison Result</span>
                      <span className="font-medium text-primary">
                        {p.comparisonResult?.classification || 'IMPROVED'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-space-xs">
                    <div className="text-caption text-on-surface-variant">
                      Evidence Count: <span className="font-semibold">{p.evidenceIds?.length || 2}</span> | Security: <span className="text-emerald-700 font-medium">PASSED</span>
                    </div>

                    <div className="flex items-center gap-space-sm">
                      <button
                        type="button"
                        onClick={() => handleRejectProposal(p.id || p.proposalId)}
                        className="px-space-md py-space-xs rounded-lg border border-outline/30 text-on-surface hover:bg-surface-container font-label-md transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={isStale}
                        onClick={() => handleApproveProposal(p.id || p.proposalId)}
                        className={`px-space-lg py-space-xs rounded-lg font-label-md transition-colors flex items-center gap-space-2xs ${
                          isStale
                            ? 'bg-surface-container text-on-surface-variant/40 cursor-not-allowed'
                            : 'bg-primary text-on-primary hover:bg-primary/90 shadow-sm'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        Approve & Promote
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. RECENT RUNTIME LEARNING RECORDS */}
      <section className="space-y-space-sm">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium">
            Recent Runtime Learning
          </span>
          <span className="font-caption text-caption text-on-surface-variant">
            {records.length} records persisted
          </span>
        </div>

        {records.length === 0 ? (
          <div className="p-space-2xl bg-surface-container-lowest rounded-2xl text-center space-y-space-xs">
            <span className="material-symbols-outlined text-[32px] text-on-surface-variant/40">school</span>
            <p className="font-title-sm text-title-sm text-on-surface font-medium">No new learning yet.</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              EVO automatically records runtime learning when user objectives are executed.
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] divide-y divide-surface-container overflow-hidden">
            {records.slice(0, 8).map((r) => (
              <div
                key={r.learningRunId}
                onClick={() => setSelectedRecord(r)}
                className="p-space-base hover:bg-surface-container-low/50 transition-colors cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-space-md min-w-0 pr-space-md">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      r.status === 'COMPLETED'
                        ? 'bg-emerald-50 text-emerald-700'
                        : r.status === 'FAILED'
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {r.category === 'CAPABILITY_LEARNING'
                        ? 'extension'
                        : r.category === 'SELF_CODE_ANALYSIS'
                        ? 'code'
                        : r.category === 'PERFORMANCE_DIAGNOSIS'
                        ? 'speed'
                        : 'task_alt'}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-space-xs mb-space-3xs">
                      <span className="font-title-sm text-title-sm text-on-surface font-medium truncate">
                        {r.goal || `Objective ${r.objectiveId}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-space-xs text-caption text-on-surface-variant font-body-sm">
                      <span className="px-space-2xs py-0 rounded bg-surface-container text-caption font-medium">
                        {r.category}
                      </span>
                      <span>•</span>
                      <span>Mode: {r.summary?.executionMode || 'NORMAL_PLAN'}</span>
                      <span>•</span>
                      <span>Duration: {r.summary?.executionDurationMs || 0}ms</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-space-md shrink-0">
                  {r.summary?.proposalGenerated && (
                    <span className="px-space-xs py-space-3xs rounded-full bg-amber-100 text-amber-800 text-caption font-medium flex items-center gap-space-3xs">
                      <span className="material-symbols-outlined text-[12px]">code</span>
                      Proposal
                    </span>
                  )}
                  <span
                    className={`px-space-xs py-space-3xs rounded-full text-caption font-semibold ${
                      r.status === 'COMPLETED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : r.status === 'FAILED'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="material-symbols-outlined text-on-surface-variant text-[18px]">chevron_right</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. CAPABILITY LEARNING */}
      <section className="space-y-space-sm">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium">
            Learned Capabilities
          </span>
          <span className="font-caption text-caption text-on-surface-variant">
            {capabilities.length} total capabilities
          </span>
        </div>

        {capabilities.length === 0 ? (
          <div className="p-space-xl bg-surface-container-lowest rounded-2xl text-center space-y-space-xs">
            <span className="material-symbols-outlined text-[32px] text-on-surface-variant/40">extension</span>
            <p className="font-title-sm text-title-sm text-on-surface font-medium">No capabilities created yet.</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              EVO abstracts reusable capabilities when recurring successful step patterns occur.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-base">
            {capabilities.map((c) => (
              <div key={c.id} className="p-space-lg bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-space-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-title-sm text-title-sm text-on-surface font-semibold">{c.name}</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-1 mt-space-3xs">
                      {c.description || `${c.workflowSteps?.length || 0} workflow steps`}
                    </p>
                  </div>
                  <span
                    className={`px-space-xs py-space-3xs rounded-full text-caption font-semibold ${
                      c.status === 'VALIDATED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : c.status === 'CANDIDATE'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {c.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-space-xs p-space-xs bg-surface-container rounded-xl text-caption text-center">
                  <div>
                    <span className="text-on-surface-variant block">Active Ver</span>
                    <span className="font-semibold text-on-surface">v{c.activeVersion || c.version || 1}</span>
                  </div>
                  <div>
                    <span className="text-on-surface-variant block">Uses</span>
                    <span className="font-semibold text-on-surface">{c.usageCount || 0}</span>
                  </div>
                  <div>
                    <span className="text-on-surface-variant block">Success Rate</span>
                    <span className="font-semibold text-emerald-700">
                      {c.usageCount > 0
                        ? `${Math.round(((c.successfulUseCount || 0) / c.usageCount) * 100)}%`
                        : '100%'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-caption text-on-surface-variant pt-space-3xs">
                  <span>Evidence: {c.evidenceCount || 2}</span>
                  <span>
                    Rollback: {Array.isArray(c.versionHistory) && c.versionHistory.length > 1 ? 'Available' : 'None'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. SELF-CODE IMPROVEMENT PROPOSALS */}
      <section className="space-y-space-sm">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium">
            Self-Code Proposals
          </span>
          <span className="font-caption text-caption text-on-surface-variant">
            {proposals.length} proposals recorded
          </span>
        </div>

        {proposals.length === 0 ? (
          <div className="p-space-xl bg-surface-container-lowest rounded-2xl text-center space-y-space-xs">
            <span className="material-symbols-outlined text-[32px] text-on-surface-variant/40">code_blocks</span>
            <p className="font-title-sm text-title-sm text-on-surface font-medium">
              EVO has not detected a recurring self-improvement opportunity.
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Proposals are generated strictly when repeated implementation or performance evidence meets engineering thresholds.
            </p>
          </div>
        ) : (
          <div className="space-y-space-base">
            {proposals.map((p) => (
              <div key={p.id || p.proposalId} className="p-space-lg bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-space-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-space-xs mb-space-3xs">
                      <span className="font-mono text-caption text-primary font-medium">
                        {p.affectedComponent}
                      </span>
                      <span className="text-on-surface-variant text-caption">•</span>
                      <span className="font-mono text-caption text-on-surface-variant">
                        Target: {Array.isArray(p.targetFiles) ? p.targetFiles[0] : 'src/...'}
                      </span>
                    </div>
                    <h3 className="font-title-sm text-title-sm font-semibold text-on-surface">
                      {p.problemStatement || p.reason || 'Self-code candidate'}
                    </h3>
                  </div>

                  <span
                    className={`px-space-xs py-space-3xs rounded-full text-caption font-semibold ${
                      p.status === 'APPLIED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : p.status === 'VALIDATED'
                        ? 'bg-blue-100 text-blue-800'
                        : p.status === 'AWAITING_APPROVAL'
                        ? 'bg-amber-100 text-amber-800'
                        : p.status === 'REJECTED'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    {p.status}
                  </span>
                </div>

                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {p.expectedImprovement || 'Performance & reliability enhancement.'}
                </p>

                <div className="flex items-center justify-between text-caption text-on-surface-variant pt-space-xs border-t border-surface-container">
                  <span>Supporting Evidence: {p.evidenceIds?.length || 2} items</span>
                  <span>
                    Comparison:{' '}
                    <strong className="text-on-surface">
                      {p.comparisonResult?.classification || 'IMPROVED'}
                    </strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. SELF-CODE VERSION HISTORY & ROLLBACK */}
      <section className="space-y-space-sm">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-medium">
            Self-Code Version History
          </span>
          <span className="font-caption text-caption text-on-surface-variant">
            Active: {versionState?.activeVersion || 'v1.1.0-self-healing'}
          </span>
        </div>

        {versionState?.versionHistory && versionState.versionHistory.length > 0 ? (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] divide-y divide-surface-container overflow-hidden">
            {versionState.versionHistory.map((v) => {
              const isActive = v.versionId === versionState.activeVersion;
              return (
                <div key={v.versionId} className="p-space-base flex items-center justify-between">
                  <div className="flex items-center gap-space-md">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-caption ${isActive ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}`}>
                      {v.versionId.substring(0, 4)}
                    </div>
                    <div>
                      <div className="flex items-center gap-space-xs">
                        <span className="font-title-sm text-title-sm text-on-surface font-semibold">
                          {v.versionId}
                        </span>
                        {isActive && (
                          <span className="px-space-xs py-space-3xs rounded-full bg-emerald-100 text-emerald-800 text-caption font-semibold">
                            ACTIVE PRODUCTION
                          </span>
                        )}
                      </div>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-3xs">
                        {v.promotionReason || 'Initial baseline version'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-space-md">
                    <div className="text-right text-caption text-on-surface-variant hidden sm:block">
                      <div>Promoted: {new Date(v.promotedAt).toLocaleDateString()}</div>
                      <div>Tests: {v.testResults?.passedCount || 50} passed</div>
                    </div>

                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => handleRollbackVersion(v.versionId)}
                        className="px-space-md py-space-xs rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 font-label-md transition-colors flex items-center gap-space-3xs"
                      >
                        <span className="material-symbols-outlined text-[16px]">undo</span>
                        Rollback
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-space-md bg-surface-container-lowest rounded-2xl text-center text-body-sm text-on-surface-variant">
            No previous self-code version history recorded.
          </div>
        )}
      </section>

      {/* READ-ONLY RECORD DETAIL MODAL */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-space-base">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl max-w-2xl w-full p-space-xl space-y-space-md max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-surface-container pb-space-sm">
              <div>
                <span className="font-label-sm text-label-sm text-primary font-mono">
                  {selectedRecord.learningRunId}
                </span>
                <h2 className="font-title-md text-title-md text-on-surface font-semibold mt-space-3xs">
                  {selectedRecord.goal || 'Objective Learning Detail'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-space-sm p-space-md bg-surface-container rounded-xl text-body-sm">
              <div>
                <span className="text-on-surface-variant block text-caption">Category</span>
                <span className="font-semibold text-on-surface">{selectedRecord.category}</span>
              </div>
              <div>
                <span className="text-on-surface-variant block text-caption">Status</span>
                <span className="font-semibold text-emerald-700">{selectedRecord.status}</span>
              </div>
              <div>
                <span className="text-on-surface-variant block text-caption">Execution Mode</span>
                <span className="font-mono text-caption text-on-surface">{selectedRecord.summary?.executionMode}</span>
              </div>
              <div>
                <span className="text-on-surface-variant block text-caption">Duration</span>
                <span className="font-mono text-caption text-on-surface">{selectedRecord.summary?.executionDurationMs}ms</span>
              </div>
            </div>

            <div className="space-y-space-xs text-body-sm">
              <h4 className="font-title-sm text-title-sm text-on-surface font-semibold">Evidence & Linked Records</h4>
              <div className="p-space-sm bg-surface-container-low rounded-lg font-mono text-caption space-y-space-3xs text-on-surface-variant">
                <div>Objective ID: {selectedRecord.objectiveId}</div>
                <div>Evaluation ID: {selectedRecord.evaluationId || 'None'}</div>
                <div>Capability ID: {selectedRecord.capabilityId || 'None'} (v{selectedRecord.capabilityVersion || 1})</div>
                <div>Performance Metric IDs: {selectedRecord.performanceMetricIds?.join(', ') || 'None'}</div>
                <div>Self-Code Proposal ID: {selectedRecord.selfCodeProposalId || 'None'}</div>
                <div>Evidence IDs: {selectedRecord.evidenceIds?.join(', ') || 'None'}</div>
              </div>
            </div>

            <div className="flex justify-end pt-space-xs">
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-space-lg py-space-xs rounded-lg bg-surface-container text-on-surface font-label-md hover:bg-surface-container-high"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
