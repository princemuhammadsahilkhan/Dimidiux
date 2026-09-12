import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import HomeScreen from './components/HomeScreen';
import ObjectiveScreen from './components/ObjectiveScreen';
import LearningScreen from './components/LearningScreen';
import EnvironmentScreen from './components/EnvironmentScreen';
import SettingsScreen from './components/SettingsScreen';
import { evoApi } from './services/evoApi';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [currentObjective, setCurrentObjective] = useState(null);

  const executePlanning = async (obj) => {
    if (!obj || !obj.id) return;
    const updated = await evoApi.generatePlan(obj.id, obj.goal);
    if (updated) setCurrentObjective(updated);
  };

  useEffect(() => {
    let isMounted = true;
    const initApp = async () => {
      const active = await evoApi.getActiveObjective();
      if (isMounted && active) {
        setCurrentObjective(active);
        if (active.status === 'PENDING') {
          executePlanning(active);
        }
      }
    };
    initApp();

    const unsubscribe = evoApi.onObjectiveUpdated((updatedObj) => {
      if (isMounted && updatedObj) {
        setCurrentObjective((prev) => {
          if (!prev || prev.id === updatedObj.id) {
            return updatedObj;
          }
          return prev;
        });
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleSelectObjective = async (obj) => {
    if (!obj || !obj.id) return;
    setCurrentObjective(obj);
    setActiveTab('objective');
    if (obj.id !== 'demo') {
      await evoApi.setActiveObjectiveId(obj.id);
      if ((obj.status === 'PENDING' || !obj.plan || obj.plan.length === 0) && obj.status !== 'PLANNED') {
        executePlanning(obj);
      }
    }
  };

  const handleRetryPlanning = (obj) => {
    if (obj && obj.id) {
      executePlanning(obj);
    }
  };

  const handleStartRunner = async (obj) => {
    if (!obj || !obj.id) return;
    await evoApi.startRunner(obj.id);
    const active = await evoApi.getActiveObjective();
    if (active) setCurrentObjective(active);
  };

  const handlePauseRunner = async (obj) => {
    if (!obj || !obj.id) return;
    const updated = await evoApi.pauseRunner(obj.id);
    if (updated) setCurrentObjective(updated);
  };

  const handleConfirmAndContinue = async (obj) => {
    if (!obj || !obj.id || !Array.isArray(obj.plan)) return;
    const pendingStep = obj.plan.find((s) => s.status === 'PENDING');
    if (pendingStep) {
      const updated = await evoApi.confirmAndContinue(obj.id, pendingStep.id);
      if (updated) setCurrentObjective(updated);
    }
  };

  const handleRetryExecution = async (obj) => {
    if (!obj || !obj.id) return;
    const updated = await evoApi.retryExecution(obj.id);
    if (updated) setCurrentObjective(updated);
  };

  const handleTabChange = async (tabId) => {
    if (tabId === 'objective') {
      const active = await evoApi.getActiveObjective();
      if (active) {
        setCurrentObjective(active);
      }
    }
    setActiveTab(tabId);
  };

  return (
    <div className="bg-surface font-body-md text-body-md text-on-surface antialiased min-h-screen selection:bg-primary-fixed selection:text-on-primary-fixed">
      <Header activeTab={activeTab} setActiveTab={handleTabChange} />
      <main className="w-full pt-14 px-window-padding min-h-screen">
        {activeTab === 'home' && (
          <HomeScreen onSelectObjective={handleSelectObjective} />
        )}
        {activeTab === 'objective' && (
          <ObjectiveScreen
            objective={currentObjective}
            onStartRunner={handleStartRunner}
            onPauseRunner={handlePauseRunner}
            onConfirmAndContinue={handleConfirmAndContinue}
            onRetryPlanning={handleRetryPlanning}
            onRetryExecution={handleRetryExecution}
          />
        )}
        {activeTab === 'learning' && <LearningScreen />}
        {activeTab === 'environment' && <EnvironmentScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
