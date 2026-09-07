import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.join(projectRoot, 'workspace');

// Storage polyfill for testing
const testStoreFile = path.join(projectRoot, 'scratch', 'test_correctness_store.json');
if (fs.existsSync(testStoreFile)) fs.unlinkSync(testStoreFile);

let memoryStore = {};
function persistStore() {
  fs.writeFileSync(testStoreFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
}

globalThis.localStorage = {
  getItem: (k) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k, v) => { memoryStore[k] = String(v); persistStore(); },
  removeItem: (k) => { delete memoryStore[k]; persistStore(); },
  clear: () => { memoryStore = {}; persistStore(); }
};

import {
  getObjectives,
  saveObjectives,
  createObjective,
  setObjectivePlan,
  setActiveObjectiveId,
  getActiveObjective
} from '../src/services/objectiveStore.js';
import { plannerService } from '../src/services/plannerService.js';
import { runObjective } from '../src/services/objectiveRunner.js';

console.log('====================================================');
console.log('      EVO PLAN CORRECTNESS & ISOLATION REGRESSION   ');
console.log('====================================================\n');

async function runCorrectnessTest() {
  localStorage.clear();
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }
  const initBugDir = path.join(workspaceRoot, 'TestProject');
  if (fs.existsSync(initBugDir)) {
    fs.rmSync(initBugDir, { recursive: true, force: true });
  }

  // ----------------------------------------------------
  // TEST 1: Objective A vs Objective B Plan Generation
  // ----------------------------------------------------
  console.log('[Test 1] Generating plans for Objective A and Objective B...');
  const objA = createObjective('Create TestProject and hello.txt.');
  const objB = createObjective('Organize research papers.');

  const planARes = await plannerService.generatePlan({ goal: objA.goal });
  assert.strictEqual(planARes.success, true, 'Objective A plan generated');
  setObjectivePlan(objA.id, planARes.plan);

  const planBRes = await plannerService.generatePlan({ goal: objB.goal });
  assert.strictEqual(planBRes.success, true, 'Objective B plan generated');
  setObjectivePlan(objB.id, planBRes.plan);

  const objAPersisted = getObjectives().find((o) => o.id === objA.id);
  const objBPersisted = getObjectives().find((o) => o.id === objB.id);

  // Verify Objective A plan does NOT contain Research/Papers
  const hasResearchInA = objAPersisted.plan.some(
    (s) => (s.action.path && s.action.path.includes('Research')) || s.title.includes('Research')
  );
  assert.strictEqual(hasResearchInA, false, 'Objective A must NOT contain Research/Papers steps!');
  assert.ok(objAPersisted.plan.some((s) => s.action.path && s.action.path.includes('TestProject')), 'Objective A contains TestProject action');

  // Verify Objective B plan contains Research/Papers
  const hasResearchInB = objBPersisted.plan.some(
    (s) => (s.action.path && s.action.path.includes('Research')) || s.title.includes('Research')
  );
  assert.strictEqual(hasResearchInB, true, 'Objective B contains Research steps');
  console.log('  ✓ Objective A and Objective B generated distinct, correct plans.');

  // ----------------------------------------------------
  // TEST 2: Execution Isolation & Active Switching
  // ----------------------------------------------------
  console.log('\n[Test 2] Active Objective Switching & Execution Isolation...');
  setActiveObjectiveId(objB.id); // Switch active objective to B
  assert.strictEqual(getActiveObjective().id, objB.id, 'Active objective is B');

  // Execute Objective A while active is B
  const runARes = await runObjective(objA.id, { root: workspaceRoot });
  assert.strictEqual(runARes.status, 'COMPLETED', 'Objective A execution completed');

  // Verify Objective A executed ONLY Objective A's steps
  const objAFinal = getObjectives().find((o) => o.id === objA.id);
  const objBFinal = getObjectives().find((o) => o.id === objB.id);

  assert.strictEqual(objAFinal.status, 'COMPLETED', 'Objective A completed');
  assert.strictEqual(objBFinal.status, 'PLANNED', 'Objective B steps were NOT executed during Objective A run!');
  console.log('  ✓ Execution isolation verified (Executing A did not execute B steps).');

  // ----------------------------------------------------
  // TEST 3: Persistence Reload Isolation
  // ----------------------------------------------------
  console.log('\n[Test 3] Persistence Reload Isolation...');
  const storeContent = JSON.parse(fs.readFileSync(testStoreFile, 'utf-8'));
  const reloadedObjectives = JSON.parse(storeContent.evo_objectives);
  const reloadedA = reloadedObjectives.find((o) => o.id === objA.id);
  const reloadedB = reloadedObjectives.find((o) => o.id === objB.id);

  assert.strictEqual(reloadedA.plan.length, objAPersisted.plan.length, 'Objective A plan preserved after reload');
  assert.strictEqual(reloadedB.plan.length, objBPersisted.plan.length, 'Objective B plan preserved after reload');
  console.log('  ✓ Plans remain correctly associated across store reload.');

  // ----------------------------------------------------
  // TEST 4: Exact Bug Objective End-to-End Execution
  // ----------------------------------------------------
  console.log('\n[Test 4] Testing Exact Bug Objective End-to-End...');
  const bugDir = path.join(workspaceRoot, 'TestProject');
  if (fs.existsSync(bugDir)) {
    fs.rmSync(bugDir, { recursive: true, force: true });
  }

  const exactGoal = 'Create a folder called TestProject and create a file called hello.txt inside it containing "Hello EVO". Then verify that the file exists.';
  const exactObj = createObjective(exactGoal);
  const exactPlanRes = await plannerService.generatePlan({ goal: exactObj.goal });
  assert.strictEqual(exactPlanRes.success, true, 'Exact objective plan generated');
  setObjectivePlan(exactObj.id, exactPlanRes.plan);

  const exactPersisted = getObjectives().find((o) => o.id === exactObj.id);
  assert.ok(exactPersisted.plan.some((s) => s.action.path === 'TestProject'), 'Step 1 creates folder TestProject');
  assert.ok(exactPersisted.plan.some((s) => s.action.path === 'TestProject/hello.txt' && s.action.content === 'Hello EVO'), 'Step 2 writes TestProject/hello.txt containing "Hello EVO"');
  assert.ok(exactPersisted.plan.some((s) => s.action.type === 'read_file' && s.action.path === 'TestProject/hello.txt'), 'Step 3 reads/verifies TestProject/hello.txt');

  // Execute
  const runExactRes = await runObjective(exactObj.id, { root: workspaceRoot });
  assert.strictEqual(runExactRes.status, 'COMPLETED', 'Exact objective status COMPLETED');

  // Verify actual filesystem state on disk
  const targetFolderExists = fs.existsSync(path.join(workspaceRoot, 'TestProject'));
  const targetFileExists = fs.existsSync(path.join(workspaceRoot, 'TestProject', 'hello.txt'));
  assert.strictEqual(targetFolderExists, true, 'workspace/TestProject directory MUST exist');
  assert.strictEqual(targetFileExists, true, 'workspace/TestProject/hello.txt file MUST exist');

  const actualContent = fs.readFileSync(path.join(workspaceRoot, 'TestProject', 'hello.txt'), 'utf-8');
  assert.strictEqual(actualContent, 'Hello EVO', 'workspace/TestProject/hello.txt content MUST be "Hello EVO"');

  console.log('  ✓ Exact bug objective executed cleanly.');
  console.log('  ✓ Disk state verified: workspace/TestProject/hello.txt contains "Hello EVO".');

  console.log('\n====================================================');
  console.log('   PLAN CORRECTNESS & ISOLATION BUG TEST PASSED!    ');
  console.log('====================================================\n');
}

runCorrectnessTest().catch((err) => {
  console.error('Plan Correctness Test Failed:', err);
  process.exit(1);
});
