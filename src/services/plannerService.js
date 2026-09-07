import { searchMemory } from './memoryService.js';

export const RECOGNIZED_ACTIONS = [
  'list_directory',
  'read_file',
  'create_directory',
  'write_file',
  'copy_file',
  'move_file',
  'rename_file',
  'search_files',
  'get_time',
  'get_system_info',
  'run_constrained_command'
];

/**
 * Schema Validation for Plan and Explicit Action Objects
 */
export function validatePlanSchema(planData) {
  if (!planData || typeof planData !== 'object') {
    return { valid: false, error: 'Plan data must be an object.' };
  }

  if (!Array.isArray(planData.plan) || planData.plan.length === 0) {
    return { valid: false, error: 'Plan must contain a non-empty "plan" array.' };
  }

  const steps = planData.plan;
  const seenIds = new Set();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== 'object') {
      return { valid: false, error: `Step at index ${i} is not an object.` };
    }

    if (!step.id || typeof step.id !== 'string') {
      return { valid: false, error: `Step at index ${i} has invalid or missing "id".` };
    }

    if (seenIds.has(step.id)) {
      return { valid: false, error: `Duplicate step ID detected: "${step.id}".` };
    }
    seenIds.add(step.id);

    if (!step.title || typeof step.title !== 'string' || !step.title.trim()) {
      return { valid: false, error: `Step at index ${i} has invalid or missing "title".` };
    }

    if (typeof step.description !== 'string') {
      return { valid: false, error: `Step at index ${i} has invalid "description".` };
    }

    // Explicit Action Object Validation
    if (!step.action || typeof step.action !== 'object') {
      return { valid: false, error: `Step "${step.id}" is missing required "action" object.` };
    }

    if (!step.action.type || typeof step.action.type !== 'string') {
      return { valid: false, error: `Step "${step.id}" action has invalid or missing "type".` };
    }

    if (!RECOGNIZED_ACTIONS.includes(step.action.type)) {
      return { valid: false, error: `Step "${step.id}" action type "${step.action.type}" is unrecognized or blocked.` };
    }

    const t = step.action.type;
    if (t === 'list_directory' || t === 'read_file' || t === 'create_directory') {
      if (step.action.path === undefined || typeof step.action.path !== 'string') {
        return { valid: false, error: `Step "${step.id}" action path must be a string.` };
      }
    } else if (t === 'write_file') {
      if (step.action.path === undefined || typeof step.action.path !== 'string') {
        return { valid: false, error: `Step "${step.id}" action path must be a string.` };
      }
      if (step.action.content === undefined || typeof step.action.content !== 'string') {
        return { valid: false, error: `Step "${step.id}" action content must be a string.` };
      }
    } else if (t === 'copy_file' || t === 'move_file') {
      if (!step.action.source || typeof step.action.source !== 'string') {
        return { valid: false, error: `Step "${step.id}" action source must be a string.` };
      }
      if (!step.action.destination || typeof step.action.destination !== 'string') {
        return { valid: false, error: `Step "${step.id}" action destination must be a string.` };
      }
    }

    if (step.status !== 'PENDING' && step.status !== 'IN_PROGRESS' && step.status !== 'COMPLETED' && step.status !== 'FAILED') {
      return { valid: false, error: `Step "${step.id}" has invalid status "${step.status}".` };
    }

    if (typeof step.order !== 'number' || step.order !== i + 1) {
      return { valid: false, error: `Step "${step.id}" order must be ${i + 1}, got ${step.order}.` };
    }
  }

  return { valid: true };
}

/**
 * Dynamic Local Planner Provider
 * Parses the specific user objective and generates tailored executable plan steps.
 */
export class LocalDeterministicPlannerProvider {
  async plan({ goal, context }) {
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      throw new Error('Goal string is required for planning.');
    }

    const g = goal.trim();
    const gLower = g.toLowerCase();
    let stepsData = [];

    // Check relevant memory for preferences
    let targetSubfolder = 'Research/Papers';
    const memories = (context && Array.isArray(context.relevantMemory)) ? context.relevantMemory : [];
    const pathPrefMem = memories.find((m) =>
      (m.type === 'USER_PREFERENCE' || m.type === 'CORRECTION') &&
      m.content && (m.content.toLowerCase().includes('articles') || m.content.toLowerCase().includes('papers'))
    );
    if (pathPrefMem && pathPrefMem.content.toLowerCase().includes('articles')) {
      targetSubfolder = 'Research/Articles';
    }

    // Explicit Research Organization Workflow
    if (gLower.includes('research') && (gLower.includes('organize') || gLower.includes('paper'))) {
      stepsData = [
        {
          title: 'Inspect root workspace',
          description: 'List contents of approved workspace root.',
          action: { type: 'list_directory', path: '.' }
        },
        {
          title: `Create ${targetSubfolder.split('/')[1] || 'Papers'} directory`,
          description: `Create subfolder for research documents.`,
          action: { type: 'create_directory', path: targetSubfolder }
        },
        {
          title: 'Write research summary',
          description: 'Create summary document.',
          action: { type: 'write_file', path: 'Research/summary.txt', content: 'Summary of research papers.' }
        },
        {
          title: 'Copy paper to target folder',
          description: `Copy paper1.txt to ${targetSubfolder}/paper1.txt.`,
          action: { type: 'copy_file', source: 'Research/paper1.txt', destination: `${targetSubfolder}/paper1.txt` }
        }
      ];
    } else {
      // Dynamic Extraction from User's Objective:
      let folderName = null;
      const folderMatch = g.match(/(?:create|make|build)\s+(?:a\s+)?(?:folder|directory)\s+(?:called|named)?\s*["`']?([a-zA-Z0-9_\-\.]+)/i) ||
                          g.match(/folder\s+(?:called|named)\s*["`']?([a-zA-Z0-9_\-\.]+)/i) ||
                          g.match(/(?:create|make)\s+([a-zA-Z0-9_\-]+)\s+and/i);
      if (folderMatch) {
        folderName = folderMatch[1].replace(/["`']/g, '').trim();
      }

      let fileName = null;
      let fileContent = 'Default content';
      const fileMatch = g.match(/(?:create|write|make)\s+(?:a\s+)?file\s+(?:called|named)?\s*["`']?([a-zA-Z0-9_\-\.\/]+)/i) ||
                        g.match(/file\s+(?:called|named)\s*["`']?([a-zA-Z0-9_\-\.\/]+)/i) ||
                        g.match(/(?:and|\,)\s*([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+)/i);
      if (fileMatch) {
        fileName = fileMatch[1].replace(/["`']/g, '').trim();
      }

      const contentMatch = g.match(/containing\s+["`']([^"`']+)["`']/i) ||
                           g.match(/with\s+content\s+["`']([^"`']+)["`']/i) ||
                           g.match(/content\s+["`']([^"`']+)["`']/i);
      if (contentMatch) {
        fileContent = contentMatch[1];
      }

      let fullFilePath = fileName || (folderName ? `${folderName}/hello.txt` : 'output.txt');
      if (folderName && fileName && !fileName.includes('/')) {
        fullFilePath = `${folderName}/${fileName}`;
      }

      if (folderName) {
        stepsData.push({
          title: `Create ${folderName} directory`,
          description: `Create directory ${folderName}`,
          action: { type: 'create_directory', path: folderName }
        });
      }

      if (fileName || folderName) {
        stepsData.push({
          title: `Create file ${fullFilePath}`,
          description: `Write file ${fullFilePath} containing "${fileContent}"`,
          action: { type: 'write_file', path: fullFilePath, content: fileContent }
        });
      }

      if (gLower.includes('verify') || gLower.includes('check') || fileName) {
        stepsData.push({
          title: `Verify ${fullFilePath} exists`,
          description: `Read and verify ${fullFilePath}`,
          action: { type: 'read_file', path: fullFilePath }
        });
      }

      if (stepsData.length === 0) {
        stepsData = [
          {
            title: 'Inspect workspace root',
            description: 'Explore directory structure.',
            action: { type: 'list_directory', path: '.' }
          },
          {
            title: 'Read workspace documentation',
            description: 'Read README file.',
            action: { type: 'read_file', path: 'README.md' }
          }
        ];
      }
    }

    const plan = stepsData.map((s, idx) => ({
      id: `step_${idx + 1}`,
      title: s.title,
      description: s.description,
      action: s.action,
      status: 'PENDING',
      order: idx + 1
    }));

    return { plan };
  }
}

/**
 * PlannerService - Provider-Agnostic Facade
 */
export class PlannerService {
  constructor(provider = new LocalDeterministicPlannerProvider()) {
    this.provider = provider;
  }

  setProvider(newProvider) {
    this.provider = newProvider;
  }

  async generatePlan({ goal, context }) {
    try {
      let relevantMemory = (context && Array.isArray(context.relevantMemory)) ? context.relevantMemory : null;
      if (!relevantMemory) {
        try {
          relevantMemory = searchMemory(goal, context ? context.project : '', 10);
        } catch (e) {
          relevantMemory = [];
        }
      }

      const fullContext = {
        ...context,
        relevantMemory
      };

      const rawOutput = await this.provider.plan({ goal, context: fullContext });
      const validation = validatePlanSchema(rawOutput);

      if (!validation.valid) {
        return {
          success: false,
          error: `Malformed plan output: ${validation.error}`,
          context: fullContext
        };
      }

      return {
        success: true,
        plan: rawOutput.plan,
        context: fullContext
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Planner execution failed.'
      };
    }
  }
}

export const plannerService = new PlannerService();
export default plannerService;
