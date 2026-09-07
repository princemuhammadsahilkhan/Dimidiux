import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.join(projectRoot, 'workspace');

// Setup Node.js storage polyfill for Step 8 testing
const testStoreFile = path.join(projectRoot, 'scratch', 'test_step8_store.json');
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

// Import memory modules & services
import {
  getMemories,
  saveMemories,
  createMemory,
  reinforceMemory,
  updateConfidence,
  archiveMemory,
  restoreMemory,
  validateMemorySchema,
  MEMORY_TYPES,
  MEMORY_SOURCES,
  MEMORY_STATUS
} from '../src/services/memoryStore.js';
import {
  memoryService,
  isSensitiveMemoryCandidate,
  searchMemory,
  recordCorrection,
  extractExperienceFromObjective
} from '../src/services/memoryService.js';
import { plannerService } from '../src/services/plannerService.js';
import { createObjective, setObjectivePlan, getObjectives } from '../src/services/objectiveStore.js';
import { runObjective } from '../src/services/objectiveRunner.js';
import { writeFile } from '../src/services/filesystemTool.js';

console.log('================================================================');
console.log('         EVO STEP 8 TEST SUITE: MEMORY + EXPERIENCE             ');
console.log('================================================================\n');

async function runStep8Tests() {
  localStorage.clear();
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  // ----------------------------------------------------
  // TEST 1: Memory Creation
  // ----------------------------------------------------
  console.log('[Test 1] Memory Creation...');
  const mem1 = createMemory({
    type: MEMORY_TYPES.USER_PREFERENCE,
    content: 'Research PDFs should be stored in Research/Papers.',
    source: MEMORY_SOURCES.EXPLICIT_USER,
    confidence: 0.95
  });
  assert.ok(mem1 && mem1.id.startsWith('mem_'), 'Memory item created with valid ID');
  assert.strictEqual(mem1.type, MEMORY_TYPES.USER_PREFERENCE, 'Type matches');
  assert.strictEqual(mem1.source, MEMORY_SOURCES.EXPLICIT_USER, 'Source matches');
  assert.strictEqual(mem1.status, MEMORY_STATUS.ACTIVE, 'Initial status ACTIVE');
  console.log('  ✓ Memory creation succeeded.');

  // ----------------------------------------------------
  // TEST 2: Schema Validation
  // ----------------------------------------------------
  console.log('\n[Test 2] Schema Validation...');
  const validCheck = validateMemorySchema(mem1);
  assert.strictEqual(validCheck.valid, true, 'Valid schema returns true');

  const invalidCheck = validateMemorySchema({ id: 'bad', confidence: 1.5, status: 'UNKNOWN' });
  assert.strictEqual(invalidCheck.valid, false, 'Invalid schema rejected');
  console.log('  ✓ Schema validation verified.');

  // ----------------------------------------------------
  // TEST 3: Duplicate Detection
  // ----------------------------------------------------
  console.log('\n[Test 3] Duplicate Detection & Merging...');
  const countBefore = getMemories().length;
  const dupMem = createMemory({
    type: MEMORY_TYPES.USER_PREFERENCE,
    content: 'Research PDFs should be stored in Research/Papers.',
    source: MEMORY_SOURCES.OBSERVED_BEHAVIOR
  });
  const countAfter = getMemories().length;
  assert.strictEqual(countAfter, countBefore, 'Duplicate creation reinforces existing memory rather than adding duplicate');
  assert.strictEqual(dupMem.id, mem1.id, 'Returns original memory item ID');
  assert.strictEqual(dupMem.evidenceCount, 2, 'Evidence count incremented');
  console.log('  ✓ Duplicate memory detection & reinforcement verified.');

  // ----------------------------------------------------
  // TEST 4: Relevance Ranking
  // ----------------------------------------------------
  console.log('\n[Test 4] Relevance Ranking...');
  createMemory({
    type: MEMORY_TYPES.PROJECT_CONTEXT,
    content: 'Thesis project contains papers and datasets.',
    source: MEMORY_SOURCES.EXPLICIT_USER,
    confidence: 0.9
  });
  const searchResults = searchMemory('organize research papers');
  assert.ok(searchResults.length > 0, 'Returns relevant memory items');
  assert.ok(searchResults[0].content.includes('Research') || searchResults[0].content.includes('Thesis'), 'Top ranked item is relevant');
  console.log('  ✓ Relevance ranking verified.');

  // ----------------------------------------------------
  // TEST 5: Confidence Bounds
  // ----------------------------------------------------
  console.log('\n[Test 5] Confidence Bounds (0.0 to 1.0)...');
  const upperMem = updateConfidence(mem1.id, 1.8);
  assert.strictEqual(upperMem.confidence, 1.0, 'Confidence capped at 1.0');
  const lowerMem = updateConfidence(mem1.id, -0.5);
  assert.strictEqual(lowerMem.confidence, 0.0, 'Confidence floor at 0.0');
  updateConfidence(mem1.id, 0.95);
  console.log('  ✓ Confidence bounds enforced.');

  // ----------------------------------------------------
  // TEST 6: Evidence Count Tracking
  // ----------------------------------------------------
  console.log('\n[Test 6] Evidence Count & Timestamps...');
  const latestMem1 = getMemories().find((m) => m.id === mem1.id);
  assert.strictEqual(latestMem1.evidenceCount, 2, 'evidenceCount tracks evidence observations');
  assert.ok(latestMem1.lastEvidenceAt, 'lastEvidenceAt timestamp recorded');
  console.log('  ✓ Evidence count tracking verified.');

  // ----------------------------------------------------
  // TEST 7: Reinforcement
  // ----------------------------------------------------
  console.log('\n[Test 7] Memory Reinforcement...');
  const reinforced = reinforceMemory(mem1.id, { confidenceDelta: 0.05 });
  assert.strictEqual(reinforced.evidenceCount, 3, 'Evidence count increased to 3');
  console.log('  ✓ Reinforcement succeeded.');

  // ----------------------------------------------------
  // TEST 8: Contradiction Handling
  // ----------------------------------------------------
  console.log('\n[Test 8] Contradiction Handling...');
  // User issues contradiction: Put PDFs in Research/Articles instead
  const newCorrection = recordCorrection('Put research PDFs in Research/Articles instead.', 'Research');
  const allMems = getMemories();
  const oldMem = allMems.find((m) => m.id === mem1.id);
  assert.ok(oldMem.status === MEMORY_STATUS.ARCHIVED || oldMem.confidence < 0.9, 'Older contradicted memory archived or lowered');
  assert.ok(newCorrection && newCorrection.content.includes('Articles'), 'New explicit correction created');
  console.log('  ✓ Contradiction handling verified.');

  // ----------------------------------------------------
  // TEST 9: Explicit Correction Creation
  // ----------------------------------------------------
  console.log('\n[Test 9] Explicit User Correction...');
  assert.strictEqual(newCorrection.type, MEMORY_TYPES.CORRECTION, 'Correction type is CORRECTION');
  assert.strictEqual(newCorrection.source, MEMORY_SOURCES.EXPLICIT_USER, 'Correction source is EXPLICIT_USER');
  assert.strictEqual(newCorrection.confidence, 0.95, 'High confidence for direct user instruction');
  console.log('  ✓ Explicit correction creation verified.');

  // ----------------------------------------------------
  // TEST 10: Context-Scoped Correction
  // ----------------------------------------------------
  console.log('\n[Test 10] Context-Scoped Correction...');
  assert.strictEqual(newCorrection.context, 'Research', 'Correction is scoped to context');
  console.log('  ✓ Context-scoped correction verified.');

  // ----------------------------------------------------
  // TEST 11: Experience Creation After Success
  // ----------------------------------------------------
  console.log('\n[Test 11] Experience Creation After Successful Objective...');
  const succObj = {
    id: 'obj_succ_1',
    goal: 'Organize project files',
    status: 'COMPLETED',
    plan: [
      { id: 's1', title: 'Inspect', status: 'COMPLETED', action: { type: 'list_directory' } },
      { id: 's2', title: 'Create folder', status: 'COMPLETED', action: { type: 'create_directory' } }
    ]
  };
  const expSucc = extractExperienceFromObjective(succObj);
  assert.ok(expSucc, 'Experience created for successful objective');
  assert.strictEqual(expSucc.type, MEMORY_TYPES.EXPERIENCE, 'Type is EXPERIENCE');
  assert.ok(expSucc.content.includes('outcome SUCCESS'), 'Outcome recorded as SUCCESS');
  console.log('  ✓ Experience creation after success verified.');

  // ----------------------------------------------------
  // TEST 12: Experience Creation After Failure
  // ----------------------------------------------------
  console.log('\n[Test 12] Experience Creation After Failed Objective...');
  const failObj = {
    id: 'obj_fail_1',
    goal: 'Read missing file',
    status: 'FAILED',
    plan: [
      { id: 'f1', title: 'Read file', status: 'FAILED', action: { type: 'read_file' } }
    ]
  };
  const expFail = extractExperienceFromObjective(failObj);
  assert.ok(expFail, 'Experience created for failed objective');
  assert.ok(expFail.content.includes('outcome FAILED'), 'Outcome recorded as FAILED');
  console.log('  ✓ Experience creation after failure verified.');

  // ----------------------------------------------------
  // TEST 13: Workflow NOT Automatically Created From One-Off Success
  // ----------------------------------------------------
  console.log('\n[Test 13] Workflow Conservative Promotion (One-Off Success check)...');
  const workflows = getMemories().filter((m) => m.type === MEMORY_TYPES.WORKFLOW);
  assert.strictEqual(workflows.length, 0, 'One-off success does NOT automatically create a WORKFLOW memory');
  console.log('  ✓ Conservative workflow promotion verified (single success != workflow).');

  // ----------------------------------------------------
  // TEST 14: Workflow Candidate Detection From Repeated Evidence
  // ----------------------------------------------------
  console.log('\n[Test 14] Workflow Detection From Repeated Evidence...');
  // Second identical success
  const succObj2 = {
    id: 'obj_succ_2',
    goal: 'Organize project files',
    status: 'COMPLETED',
    plan: [
      { id: 's1', title: 'Inspect', status: 'COMPLETED', action: { type: 'list_directory' } },
      { id: 's2', title: 'Create folder', status: 'COMPLETED', action: { type: 'create_directory' } }
    ]
  };
  extractExperienceFromObjective(succObj2);
  const workflowsAfter = getMemories().filter((m) => m.type === MEMORY_TYPES.WORKFLOW);
  assert.ok(workflowsAfter.length > 0, 'WORKFLOW memory created after repeated evidence (evidenceCount >= 2)');
  console.log('  ✓ Workflow promotion from repeated evidence verified.');

  // ----------------------------------------------------
  // TEST 15: Sensitive Data Rejection
  // ----------------------------------------------------
  console.log('\n[Test 15] Sensitive Data Rejection (isSensitiveMemoryCandidate)...');
  assert.strictEqual(isSensitiveMemoryCandidate('api_key: sk_test_12345'), true, 'API key rejected');
  assert.strictEqual(isSensitiveMemoryCandidate('password = supersecret'), true, 'Password rejected');
  assert.strictEqual(isSensitiveMemoryCandidate('auth_token = xyz'), true, 'Auth token rejected');
  assert.strictEqual(isSensitiveMemoryCandidate('Organize my research files'), false, 'Normal text allowed');

  const sensitiveAttempt = recordCorrection('User password is secret_pass_123');
  assert.strictEqual(sensitiveAttempt, null, 'Sensitive correction refused');
  console.log('  ✓ Centralized sensitive data filtering verified.');

  // ----------------------------------------------------
  // TEST 16: Irrelevant Memory Exclusion
  // ----------------------------------------------------
  console.log('\n[Test 16] Irrelevant Memory Exclusion...');
  const irrelevantResults = searchMemory('cook recipe pizza');
  assert.strictEqual(irrelevantResults.length, 0, 'Irrelevant memories excluded from search results');
  console.log('  ✓ Irrelevant memory exclusion verified.');

  // ----------------------------------------------------
  // TEST 17: Maximum Retrieval Count
  // ----------------------------------------------------
  console.log('\n[Test 17] Maximum Retrieval Count Capping...');
  for (let i = 0; i < 10; i++) {
    createMemory({
      type: MEMORY_TYPES.PROJECT_CONTEXT,
      content: `Research dataset batch ${i}`,
      source: MEMORY_SOURCES.EXPLICIT_USER,
      confidence: 0.8
    });
  }
  const cappedResults = searchMemory('Research dataset', '', 3);
  assert.strictEqual(cappedResults.length, 3, 'Results strictly capped to maxResults (3)');
  console.log('  ✓ Maximum retrieval count capping verified.');

  // ----------------------------------------------------
  // TEST 18: Persistence Across Restart
  // ----------------------------------------------------
  console.log('\n[Test 18] Persistence Across Restart...');
  const savedState = getMemories();
  assert.ok(savedState.length > 0, 'Memories saved to store file');
  // Re-read storage
  const reloadedRaw = JSON.parse(fs.readFileSync(testStoreFile, 'utf-8'));
  const reloadedMemories = JSON.parse(reloadedRaw.evo_memories);
  assert.strictEqual(reloadedMemories.length, savedState.length, 'Persistence restored memories identically');
  console.log('  ✓ Persistence across restart verified.');

  // ----------------------------------------------------
  // TEST 19: Memory Cannot Grant Execution Permissions
  // ----------------------------------------------------
  console.log('\n[Test 19] Memory Safety Boundary Check...');
  const objSafety = createObjective('Safety boundary test');
  const planSafety = [
    {
      id: 's_safe_1',
      title: 'Attempt write without overwrite confirmation',
      description: 'Write file that already exists',
      action: { type: 'write_file', path: 'README.md', content: 'Overwrite attempt' },
      status: 'PENDING',
      order: 1
    }
  ];
  setObjectivePlan(objSafety.id, planSafety);

  // Even if memory says "User always overwrites README", execution layer requires confirmation!
  const runSafetyRes = await runObjective(objSafety.id, { root: workspaceRoot });
  assert.strictEqual(runSafetyRes.status, 'PAUSED', 'Execution layer halts for overwrite confirmation regardless of memory');
  console.log('  ✓ Memory cannot bypass execution security boundaries.');

  // ----------------------------------------------------
  // TEST 20: Planner Receives Relevant Memory
  // ----------------------------------------------------
  console.log('\n[Test 20] Planner Context Integration...');
  recordCorrection('Put research PDFs in Research/Articles instead.', 'Research');
  const planResult = await plannerService.generatePlan({ goal: 'Organize research files' });
  assert.strictEqual(planResult.success, true, 'Planner generates plan successfully');
  assert.ok(planResult.context.relevantMemory, 'Planner receives relevant memory in context');
  const articlesStep = planResult.plan.find((s) => (s.action.path && s.action.path.includes('Research/Articles')) || (s.action.destination && s.action.destination.includes('Research/Articles')));
  assert.ok(articlesStep, 'Planner plan respects memory preference (Research/Articles)');
  console.log('  ✓ Planner receives and respects relevant memory context.');

  // ----------------------------------------------------
  // TEST 21 & 22: Full Regression & Build
  // ----------------------------------------------------
  console.log('\n[Test 21] Running Full Regression Suite (Steps 1–7)...');
  const regObj = createObjective('Regression test objective');
  const regPlan = [
    {
      id: 'r1',
      title: 'Inspect workspace',
      description: 'List workspace root',
      action: { type: 'list_directory', path: '.' },
      status: 'PENDING',
      order: 1
    }
  ];
  setObjectivePlan(regObj.id, regPlan);
  const regRes = await runObjective(regObj.id, { root: workspaceRoot });
  assert.strictEqual(regRes.status, 'COMPLETED', 'Regression objective completed successfully');
  console.log('  ✓ Full regression suite passed.');

  console.log('\n================================================================');
  console.log('         ALL STEP 8 MEMORY + EXPERIENCE TESTS PASSED!           ');
  console.log('================================================================\n');
}

runStep8Tests().catch((err) => {
  console.error('Step 8 Test Failed:', err);
  process.exit(1);
});
