import React from 'react';

export default function ObjectiveScreen({
  objective,
  onStartRunner,
  onPauseRunner,
  onConfirmAndContinue,
  onRetryPlanning,
  onRetryExecution
}) {
  const goalText = objective ? objective.goal : 'Research project';
  const status = objective ? objective.status : 'Working';

  // Mapping status display
  let statusLabel = 'Working';
  let dotClass = 'bg-primary-container animate-pulse';

  if (status === 'PLANNING') {
    statusLabel = 'Planning';
    dotClass = 'bg-primary-container animate-pulse';
  } else if (status === 'PLANNED') {
    statusLabel = 'Planned';
    dotClass = 'bg-primary-container';
  } else if (status === 'IN_PROGRESS') {
    statusLabel = 'In Progress';
    dotClass = 'bg-primary-container animate-pulse';
  } else if (status === 'PAUSED') {
    statusLabel = 'Paused';
    dotClass = 'bg-secondary';
  } else if (status === 'COMPLETED') {
    statusLabel = 'Completed';
    dotClass = 'bg-primary-container';
  } else if (status === 'FAILED') {
    statusLabel = 'Failed';
    dotClass = 'bg-error';
  } else if (status === 'PLANNING_FAILED') {
    statusLabel = 'Planning Failed';
    dotClass = 'bg-error';
  }

  const progressValue = objective ? objective.progress : 41;

  const rightNowText = objective
    ? objective.currentStep || (status === 'PLANNED' ? 'Plan created. Ready to begin.' : 'Waiting to begin')
    : 'EVO is analyzing papers.';

  const plan = objective && Array.isArray(objective.plan) ? objective.plan : null;
  const isOverwriteConfirmationNeeded = objective && objective.currentStep && objective.currentStep.includes('Overwrite confirmation required');

  return (
    <div className="flex flex-col w-full items-center justify-center py-space-4xl">
      <div className="w-full max-w-[420px] flex flex-col items-center text-center">
        {/* Title / Goal */}
        <h1 className="font-title-lg text-title-lg text-on-surface tracking-tight font-semibold mb-space-base">
          {goalText}
        </h1>

        {/* Status & Progress Container */}
        <div className="w-full bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md mb-space-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <span className={`w-2 h-2 rounded-full ${dotClass}`}></span>
              <span className="font-label-md text-label-md text-on-surface-variant">
                {statusLabel}
              </span>
            </div>
            <span className="font-mono-code text-mono-code text-on-surface font-medium">
              {progressValue}%
            </span>
          </div>

          {/* Minimal Progress Bar */}
          <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-container rounded-full transition-all duration-500"
              style={{ width: `${progressValue}%` }}
            ></div>
          </div>
        </div>

        {/* Task List Container */}
        <div className="w-full bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md mb-space-2xl text-left">
          {status === 'PLANNING' ? (
            <div className="flex items-center gap-space-md text-on-surface-variant">
              <span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
              <span className="font-body-md text-body-md italic text-on-surface-variant">
                Analyzing objective and generating structured plan...
              </span>
            </div>
          ) : status === 'PLANNING_FAILED' ? (
            <div className="flex flex-col gap-space-xs text-error">
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[18px]">error</span>
                <span className="font-body-md text-body-md font-medium">
                  Failed to generate plan
                </span>
              </div>
              {objective.currentStep && (
                <p className="font-body-sm text-body-sm text-on-surface-variant/70 pl-7">
                  {objective.currentStep}
                </p>
              )}
            </div>
          ) : plan && plan.length > 0 ? (
            plan.map((step) => {
              const isCompleted = step.status === 'COMPLETED';
              const isInProgress = step.status === 'IN_PROGRESS';
              const isFailed = step.status === 'FAILED';

              return (
                <div key={step.id || step.order} className="flex items-start gap-space-md text-on-surface-variant">
                  {isCompleted ? (
                    <span
                      className="material-symbols-outlined text-[18px] text-primary select-none mt-0.5"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      check
                    </span>
                  ) : isInProgress ? (
                    <span className="w-[18px] h-5 flex items-center justify-center">
                      <span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
                    </span>
                  ) : isFailed ? (
                    <span className="material-symbols-outlined text-[18px] text-error select-none mt-0.5">
                      close
                    </span>
                  ) : (
                    <span className="w-[18px] h-5 flex items-center justify-center">
                      <span className="w-2 h-2 rounded-full bg-surface-variant"></span>
                    </span>
                  )}
                  <div className="flex flex-col min-w-0">
                    <span
                      className={`font-body-md text-body-md ${
                        isCompleted
                          ? 'line-through text-on-surface-variant/70'
                          : isInProgress
                          ? 'font-title-sm text-title-sm font-medium text-on-surface'
                          : isFailed
                          ? 'font-medium text-error'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      {step.title}
                    </span>
                    {step.description && (
                      <span className="font-body-sm text-body-sm text-on-surface-variant/60">
                        {step.description}
                      </span>
                    )}
                    {step.resultMetadata && step.resultMetadata.summary && (
                      <span className="font-mono-code text-[11px] text-primary mt-1 bg-surface-container px-1.5 py-0.5 rounded w-fit">
                        {step.resultMetadata.summary}
                      </span>
                    )}
                    {step.failureInfo && step.failureInfo.error && (
                      <span className="font-body-sm text-body-sm text-error/80 mt-0.5">
                        Error: {step.failureInfo.error}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex items-center gap-space-md text-on-surface-variant py-space-xs">
              <span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
              <span className="font-body-md text-body-md italic text-on-surface-variant">
                Waiting for plan generation...
              </span>
            </div>
          )}
        </div>

        {/* Right now section */}
        <div className="flex flex-col items-center gap-space-2xs mb-space-3xl">
          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
            Right now
          </span>
          <p className="font-body-lg text-body-lg text-on-surface font-normal">
            {rightNowText}
          </p>
        </div>

        {/* Action Controls */}
        {status === 'PLANNING_FAILED' ? (
          <button
            type="button"
            onClick={() => onRetryPlanning && onRetryPlanning(objective)}
            className="px-space-xl py-space-sm bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg transition-colors shadow-sm inline-flex items-center justify-center gap-space-xs"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Retry Planning
          </button>
        ) : status === 'FAILED' ? (
          <button
            type="button"
            onClick={() => onRetryExecution && onRetryExecution(objective)}
            className="px-space-xl py-space-sm bg-error hover:bg-error/90 text-on-error font-label-md text-label-md rounded-lg transition-colors shadow-sm inline-flex items-center justify-center gap-space-xs"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Retry Execution
          </button>
        ) : isOverwriteConfirmationNeeded ? (
          <button
            type="button"
            onClick={() => onConfirmAndContinue && onConfirmAndContinue(objective)}
            className="px-space-xl py-space-sm bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg transition-colors shadow-sm inline-flex items-center justify-center gap-space-xs"
          >
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            Confirm Overwrite & Continue
          </button>
        ) : status === 'PLANNED' || status === 'PAUSED' ? (
          <button
            type="button"
            onClick={() => onStartRunner && onStartRunner(objective)}
            className="px-space-xl py-space-sm bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg transition-colors shadow-sm inline-flex items-center justify-center gap-space-xs"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            {status === 'PAUSED' ? 'Resume Execution' : 'Start Execution'}
          </button>
        ) : status === 'IN_PROGRESS' ? (
          <button
            type="button"
            onClick={() => onPauseRunner && onPauseRunner(objective)}
            className="px-space-xl py-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md rounded-lg transition-colors shadow-sm inline-flex items-center justify-center gap-space-xs"
          >
            <span className="material-symbols-outlined text-[18px]">pause</span>
            Pause
          </button>
        ) : status === 'COMPLETED' ? (
          <button
            type="button"
            disabled
            className="px-space-xl py-space-sm bg-surface-container-high text-on-surface-variant font-label-md text-label-md rounded-lg transition-colors shadow-sm inline-flex items-center justify-center cursor-default opacity-80"
          >
            Completed
          </button>
        ) : (
          <button
            id="pause-btn"
            type="button"
            className="px-space-xl py-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md rounded-lg transition-colors shadow-sm inline-flex items-center justify-center"
          >
            Pause
          </button>
        )}
      </div>
    </div>
  );
}
