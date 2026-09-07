import { validatePlanSchema } from './plannerService.js';

const STORAGE_KEY = 'evo_objectives';
const ACTIVE_ID_KEY = 'evo_active_objective_id';

export function getObjectives() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load objectives from localStorage:', e);
    return [];
  }
}

export function saveObjectives(objectives) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(objectives));
  } catch (e) {
    console.error('Failed to save objectives to localStorage:', e);
  }
}

export function createObjective(goalText) {
  const trimmed = goalText ? goalText.trim() : '';
  if (!trimmed) return null;

  const newObj = {
    id: `obj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    goal: trimmed,
    status: 'PENDING',
    progress: 0,
    createdAt: new Date().toISOString(),
    currentStep: null,
    plan: [],
    completedSteps: []
  };

  const current = getObjectives();
  const updated = [newObj, ...current];
  saveObjectives(updated);
  setActiveObjectiveId(newObj.id);
  return newObj;
}

export function updateObjectiveStatus(id, status, currentStep) {
  const objectives = getObjectives();
  const updated = objectives.map((obj) => {
    if (obj.id === id) {
      return {
        ...obj,
        status,
        currentStep: currentStep !== undefined ? currentStep : obj.currentStep
      };
    }
    return obj;
  });
  saveObjectives(updated);
  return updated.find((o) => o.id === id);
}

export function setObjectivePlan(id, planArray) {
  // Strict schema validation before persistence
  const validation = validatePlanSchema({ plan: planArray });
  if (!validation.valid) {
    console.error('Refusing to persist invalid plan:', validation.error);
    return null;
  }

  const objectives = getObjectives();
  const updated = objectives.map((obj) => {
    if (obj.id === id) {
      return {
        ...obj,
        status: 'PLANNED',
        plan: planArray,
        currentStep: 'Plan created. Ready to begin.'
      };
    }
    return obj;
  });
  saveObjectives(updated);
  return updated.find((o) => o.id === id);
}

export function setObjectivePlanningFailed(id, errorMsg) {
  const objectives = getObjectives();
  const updated = objectives.map((obj) => {
    if (obj.id === id) {
      return {
        ...obj,
        status: 'PLANNING_FAILED',
        currentStep: errorMsg || 'Planning failed.'
      };
    }
    return obj;
  });
  saveObjectives(updated);
  return updated.find((o) => o.id === id);
}

export function getActiveObjectiveId() {
  return localStorage.getItem(ACTIVE_ID_KEY) || null;
}

export function setActiveObjectiveId(id) {
  if (id) {
    localStorage.setItem(ACTIVE_ID_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_ID_KEY);
  }
}

export function updateObjectiveEvolutionMetadata(id, evolutionData) {
  const objectives = getObjectives();
  const updated = objectives.map((obj) => {
    if (obj.id === id) {
      return {
        ...obj,
        evolution: {
          ...(obj.evolution || {}),
          ...evolutionData
        }
      };
    }
    return obj;
  });
  saveObjectives(updated);
  return updated.find((o) => o.id === id);
}

export function getActiveObjective() {
  const objectives = getObjectives();
  const activeId = getActiveObjectiveId();
  if (activeId) {
    const found = objectives.find((o) => o.id === activeId);
    if (found) return found;
  }
  return objectives.length > 0 ? objectives[0] : null;
}
