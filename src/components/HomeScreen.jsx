import React, { useState, useEffect } from 'react';
import { evoApi } from '../services/evoApi';

export default function HomeScreen({ onSelectObjective }) {
  const [promptText, setPromptText] = useState('');
  const [isMicActive, setIsMicActive] = useState(false);
  const [realObjectives, setRealObjectives] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const loadObjectives = async () => {
      const objs = await evoApi.getObjectives();
      if (isMounted) setRealObjectives(objs || []);
    };
    loadObjectives();

    const unsubscribe = evoApi.onObjectiveUpdated(() => {
      loadObjectives();
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const toggleMic = () => {
    setIsMicActive(!isMicActive);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!promptText.trim()) return;

    const newObj = await evoApi.createObjective(promptText);
    if (newObj) {
      setPromptText('');
      onSelectObjective(newObj);
    }
  };

  const handleCardClick = async (objOrTitle) => {
    if (typeof objOrTitle === 'object' && objOrTitle.id) {
      await evoApi.setActiveObjectiveId(objOrTitle.id);
      onSelectObjective(objOrTitle);
    } else {
      // Demo card clicked
      onSelectObjective({
        id: 'demo',
        goal: objOrTitle,
        status: 'Working',
        progress: objOrTitle === 'Research project' ? 41 : 72,
        currentStep: 'Analyzing papers',
        plan: ['Collect papers', 'Organize papers', 'Analyze papers', 'Create summary'],
        completedSteps: ['Collect papers', 'Organize papers']
      });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] max-w-3xl mx-auto px-space-base select-none">
      {/* Title */}
      <div className="w-full flex flex-col items-center text-center mb-space-3xl">
        <h1 className="font-display text-display text-on-surface tracking-tight font-medium">
          What would you like me to work on?
        </h1>
      </div>

      {/* Prompt Input Form */}
      <form onSubmit={handleSubmit} className="w-full relative mb-space-4xl">
        <div className="relative flex items-center w-full bg-surface-container-lowest rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_6px_24px_rgba(0,0,0,0.06)] transition-all duration-200">
          <input
            id="evo-prompt-input"
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Tell EVO what you want done..."
            className="w-full h-16 pl-space-xl pr-14 bg-transparent font-body-lg text-body-lg text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none"
          />
          <div className="absolute right-space-md flex items-center justify-center">
            <button
              id="evo-mic-btn"
              type="button"
              aria-label="Voice command"
              onClick={toggleMic}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors duration-150 active:scale-95 ${
                isMicActive
                  ? 'text-primary bg-primary-fixed'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={{
                  fontVariationSettings: isMicActive ? "'FILL' 1" : "'FILL' 0",
                }}
              >
                mic
              </span>
            </button>
          </div>
        </div>
      </form>

      {/* Working Now Section */}
      <div className="w-full flex flex-col">
        <div className="mb-space-md px-space-xs">
          <span className="font-label-md text-label-md text-on-surface-variant font-medium tracking-tight">
            Working now
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-base w-full">
          {realObjectives.length > 0 ? (
            realObjectives.map((obj) => (
              <div
                key={obj.id}
                onClick={() => handleCardClick(obj)}
                className="flex flex-col justify-between p-space-xl bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-start justify-between mb-space-3xl">
                  <div className="flex flex-col min-w-0 pr-space-md">
                    <span className="font-title-sm text-title-sm text-on-surface font-semibold truncate mb-space-2xs">
                      {obj.goal}
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant truncate">
                      {obj.currentStep || (obj.status === 'PENDING' ? 'Waiting to begin' : 'Working')}
                    </span>
                  </div>
                  <div className="flex items-center justify-center px-space-sm py-space-2xs rounded-full bg-surface-container">
                    <span className="font-caption text-caption text-on-surface font-medium">
                      {obj.progress}%
                    </span>
                  </div>
                </div>
                <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-container rounded-full transition-all duration-500"
                    style={{ width: `${obj.progress}%` }}
                  ></div>
                </div>
              </div>
            ))
          ) : (
            // Stitch Demo cards when zero real user objectives exist
            <>
              <div
                onClick={() => handleCardClick('Research project')}
                className="flex flex-col justify-between p-space-xl bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-start justify-between mb-space-3xl">
                  <div className="flex flex-col min-w-0 pr-space-md">
                    <span className="font-title-sm text-title-sm text-on-surface font-semibold truncate mb-space-2xs">
                      Research project
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant truncate">
                      Analyzing papers
                    </span>
                  </div>
                  <div className="flex items-center justify-center px-space-sm py-space-2xs rounded-full bg-surface-container">
                    <span className="font-caption text-caption text-on-surface font-medium">
                      41%
                    </span>
                  </div>
                </div>
                <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-container rounded-full transition-all duration-500"
                    style={{ width: '41%' }}
                  ></div>
                </div>
              </div>

              <div
                onClick={() => handleCardClick('Website redesign')}
                className="flex flex-col justify-between p-space-xl bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-start justify-between mb-space-3xl">
                  <div className="flex flex-col min-w-0 pr-space-md">
                    <span className="font-title-sm text-title-sm text-on-surface font-semibold truncate mb-space-2xs">
                      Website redesign
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant truncate">
                      Testing layout
                    </span>
                  </div>
                  <div className="flex items-center justify-center px-space-sm py-space-2xs rounded-full bg-surface-container">
                    <span className="font-caption text-caption text-on-surface font-medium">
                      72%
                    </span>
                  </div>
                </div>
                <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-container rounded-full transition-all duration-500"
                    style={{ width: '72%' }}
                  ></div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
