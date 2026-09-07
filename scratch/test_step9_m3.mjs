import fs from 'fs';
import path from 'path';
import assert from 'assert';
import {
  getCapabilities,
  createCapabilityCandidate,
  saveCapabilities,
  recordCapabilityUsage,
  CAPABILITY_STATUS
} from '/home/kali/Desktop/Evo/src/services/capabilityStore.js';
import {
  validateCapability,
  matchCapabilities,
  adaptCapabilityWorkflow,
  reuseCapability,
  extractGoalParameters
} from '/home/kali/Desktop/Evo/src/services/capabilityService.js';
import {
  getObjectives,
  createObjective,
  getActiveObjective,
  setActiveObjectiveId
} from '/home/kali/Desktop/Evo/src/services/objectiveStore.js';
import { evoApi } from '/home/kali/Desktop/Evo/src/services/evoApi.js';

// Polyfill localStorage for Node.js test environment
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

const workspaceRoot = '/home/kali/Desktop/Evo/workspace';

console.log('=== STEP 9 MILESTONE 3 COMPREHENSIVE TEST SUITE ===');
global.localStorage.clear();

// Clean up workspace test folders before start
try {
  fs.rmSync(path.join(workspaceRoot, 'ProjectBeta'), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceRoot, 'ProjectGamma'), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceRoot, 'ProjectDelta'), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceRoot, 'TestProject'), { recursive: true, force: true });
} catch (e) {}

// Helper: Setup a validated capability
function setupValidatedCapability() {
  const candidate = createCapabilityCandidate({
    name: 'Create Folder and Write Document',
    description: 'Creates a workspace directory, writes a file inside it, and reads/verifies the file',
    sourceExperienceIds: ['exp_1', 'exp_2'],
    evidenceCount: 2,
    workflowSteps: [
      { title: 'Create folder TestProject', action: { type: 'create_directory', path: 'TestProject' } },
      { title: 'Write file TestProject/hello.txt', action: { type: 'write_file', path: 'TestProject/hello.txt', content: 'Hello EVO' } },
      { title: 'Read file TestProject/hello.txt', action: { type: 'read_file', path: 'TestProject/hello.txt' } }
    ]
  });

  const valRes = validateCapability(candidate.id);
  assert.strictEqual(valRes.success, true, 'Setup candidate must validate successfully');
  return valRes.capability;
}

// 1. Validated Capability Matching
console.log('\n--- 1. Validated Capability Matching ---');
const valCap = setupValidatedCapability();

const matchRes1 = matchCapabilities('Create a folder called ProjectAlpha and create a file called notes.txt containing Hello.');
assert.strictEqual(matchRes1.matched, true, 'Matching objective must succeed');
assert.strictEqual(matchRes1.capabilityId, valCap.id, 'Matched capability ID must match validated capability');
assert.ok(matchRes1.confidence >= 0.7, 'Matching confidence must be >= 0.7');
console.log('Validated capability matched to compatible objective.');

// 2. CANDIDATE Capability Cannot Be Reused
console.log('\n--- 2. CANDIDATE Capability Cannot Be Reused ---');
const candidateOnly = createCapabilityCandidate({
  name: 'Candidate Only',
  description: 'Unvalidated candidate',
  sourceExperienceIds: ['exp_3', 'exp_4'],
  evidenceCount: 2,
  workflowSteps: [{ title: 'Create dir', action: { type: 'create_directory', path: 'CandFolder' } }]
});

const objCand = createObjective('Create a folder called CandFolder.');
const reuseCandRes = await reuseCapability(candidateOnly.id, objCand.id);
assert.strictEqual(reuseCandRes.success, false, 'CANDIDATE capability must NOT be reused');
assert.ok(reuseCandRes.error.includes('VALIDATED'), 'Error must specify status VALIDATED is required');
console.log('CANDIDATE capability reuse correctly rejected.');

// 3. REJECTED Capability Cannot Be Reused
console.log('\n--- 3. REJECTED Capability Cannot Be Reused ---');
const rejectedCand = createCapabilityCandidate({
  name: 'Rejected Candidate',
  description: 'Rejected candidate',
  sourceExperienceIds: ['exp_5', 'exp_6'],
  evidenceCount: 2,
  workflowSteps: [{ title: 'Malicious step', action: { type: 'shell_exec', command: 'rm -rf /' } }]
});
validateCapability(rejectedCand.id); // Sets status = REJECTED

const objRej = createObjective('Run malicious objective.');
const reuseRejRes = await reuseCapability(rejectedCand.id, objRej.id);
assert.strictEqual(reuseRejRes.success, false, 'REJECTED capability must NOT be reused');
assert.ok(reuseRejRes.error.includes('VALIDATED'), 'Error must specify status VALIDATED is required');
console.log('REJECTED capability reuse correctly rejected.');

// 4. Weak / Unrelated Objective Does Not Match
console.log('\n--- 4. Weak / Unrelated Objective Matching ---');
const weakMatchRes = matchCapabilities('Random unrelated user text without matching intent.');
assert.strictEqual(weakMatchRes.matched, false, 'Weak / unrelated objective must NOT match');
assert.ok(weakMatchRes.confidence < 0.7, 'Confidence must be < 0.7');
console.log('Unrelated objective correctly rejected from matching.');

// 5. Deterministic Matching Verification
console.log('\n--- 5. Deterministic Matching ---');
const matchResA = matchCapabilities('Create a folder called Docs and file paper.txt containing Research');
const matchResB = matchCapabilities('Create a folder called Docs and file paper.txt containing Research');
assert.strictEqual(matchResA.confidence, matchResB.confidence, 'Matching scores must be identical/deterministic');
assert.strictEqual(matchResA.capabilityId, matchResB.capabilityId, 'Matched capability IDs must be identical');
console.log('Deterministic matching verified.');

// 6. Parameter Adaptation (Dynamic Substitution)
console.log('\n--- 6. Parameter Adaptation ---');
const targetParams = { folder: 'ProjectBeta', file: 'readme.txt', content: 'Welcome Beta' };
const adaptRes = adaptCapabilityWorkflow(valCap, targetParams);
assert.strictEqual(adaptRes.success, true, 'Adaptation must succeed');
assert.strictEqual(adaptRes.workflowSteps[0].action.path, 'ProjectBeta', 'Folder parameter substituted correctly in step 1');
assert.strictEqual(adaptRes.workflowSteps[1].action.path, 'ProjectBeta/readme.txt', 'File path substituted correctly in step 2');
assert.strictEqual(adaptRes.workflowSteps[1].action.content, 'Welcome Beta', 'Content substituted correctly in step 2');
console.log('Parameter adaptation (folder/file/content) verified.');

// 7 & 8. Binding to New Objective ID & Isolation from Old Objective
console.log('\n--- 7 & 8. Objective Binding & Execution Isolation ---');
const oldObj = createObjective('Old Objective');
const newObj = createObjective('Create a folder called ProjectBeta and create a file called readme.txt containing Welcome Beta.');

const reuseRes = await reuseCapability(valCap.id, newObj.id);
assert.strictEqual(reuseRes.success, true, 'Capability reuse execution must succeed');
assert.strictEqual(reuseRes.status, 'COMPLETED', 'Runner status must be COMPLETED');

const newObjState = getObjectives().find(o => o.id === newObj.id);
const oldObjState = getObjectives().find(o => o.id === oldObj.id);

assert.strictEqual(newObjState.status, 'COMPLETED', 'New objective status must be COMPLETED');
assert.ok(newObjState.plan.every(s => s.status === 'COMPLETED'), 'All new objective steps must be COMPLETED');
assert.strictEqual(oldObjState.status, 'PENDING', 'Old objective must remain untouched');
console.log('Capability reuse bound to NEW objective ID and isolated from old objective.');

// 9. Safe Filesystem Boundary Check
console.log('\n--- 9. Safe Filesystem Boundary Check ---');
const createdFolderExists = fs.existsSync(path.join(workspaceRoot, 'ProjectBeta'));
const createdFileExists = fs.existsSync(path.join(workspaceRoot, 'ProjectBeta', 'readme.txt'));
assert.strictEqual(createdFolderExists, true, 'workspace/ProjectBeta folder MUST exist on disk');
assert.strictEqual(createdFileExists, true, 'workspace/ProjectBeta/readme.txt file MUST exist on disk');
const fileContent = fs.readFileSync(path.join(workspaceRoot, 'ProjectBeta', 'readme.txt'), 'utf-8');
assert.strictEqual(fileContent, 'Welcome Beta', 'File content MUST match adapted parameter "Welcome Beta"');
console.log('Disk state verified under workspace boundary.');

// 10. Security Test: Injected Unauthorized Action Rejected
console.log('\n--- 10. Injected Unauthorized Action Rejection ---');
const corruptCap = JSON.parse(JSON.stringify(valCap));
corruptCap.workflowSteps.push({ title: 'Evil step', action: { type: 'shell_exec', command: 'whoami' } });
const adaptCorrupt = adaptCapabilityWorkflow(corruptCap, { folder: 'EvilFolder' });
assert.strictEqual(adaptCorrupt.success, false, 'Injected unauthorized action must fail adaptation');
assert.ok(adaptCorrupt.error.includes('Unauthorized action type'), 'Error must mention unauthorized action');
console.log('Injected unauthorized action correctly rejected.');

// 11. Security Test: Path Traversal in Parameters Rejected
console.log('\n--- 11. Path Traversal in Parameters Rejected ---');
const traversalParams = { folder: '../../etc', file: 'passwd', content: 'hacked' };
const adaptTraversal = adaptCapabilityWorkflow(valCap, traversalParams);
assert.strictEqual(adaptTraversal.success, false, 'Path traversal parameter substitution must fail');
assert.ok(adaptTraversal.error.includes('Traversal attempt'), 'Error must mention traversal attempt');
console.log('Path traversal in parameter substitution correctly rejected.');

// 12. Security Test: System Path Escape Rejected
console.log('\n--- 12. System Path Escape Rejected ---');
const escapeParams = { folder: '/etc/shadow', file: 'hacked', content: 'hacked' };
const adaptEscape = adaptCapabilityWorkflow(valCap, escapeParams);
assert.strictEqual(adaptEscape.success, false, 'System path escape parameter substitution must fail');
assert.ok(adaptEscape.error.includes('System path escape'), 'Error must mention system path escape');
console.log('System path escape correctly rejected.');

// 13 & 14 & 15. Execution Engine Flow & Verification
console.log('\n--- 13, 14 & 15. Execution Engine Flow & Verification ---');
const verifiedObj = getObjectives().find(o => o.id === newObj.id);
assert.strictEqual(verifiedObj.plan.length, 3, 'Plan must contain 3 adapted steps');
assert.ok(verifiedObj.plan.every(s => s.resultMetadata && typeof s.resultMetadata.executedAt === 'string'), 'Every step must be executed and verified independently');
console.log('Reuse executed through existing runner with independent step verification.');

// 16 & 17. Usage Statistics Increment (Successful & Failed)
console.log('\n--- 16 & 17. Usage Statistics Tracking ---');
const updatedCapVal = getCapabilities().find(c => c.id === valCap.id);
assert.strictEqual(updatedCapVal.usageCount, 1, `usageCount must be 1 (got ${updatedCapVal.usageCount})`);
assert.strictEqual(updatedCapVal.successfulUseCount, 1, `successfulUseCount must be 1 (got ${updatedCapVal.successfulUseCount})`);
assert.strictEqual(updatedCapVal.failedUseCount, 0, 'failedUseCount must be 0');
assert.strictEqual(typeof updatedCapVal.lastUsedAt, 'string', 'lastUsedAt timestamp must be recorded');

// Record a failed reuse attempt
recordCapabilityUsage(valCap.id, false);
const capAfterFail = getCapabilities().find(c => c.id === valCap.id);
assert.strictEqual(capAfterFail.usageCount, 2, `usageCount must be 2 (got ${capAfterFail.usageCount})`);
assert.strictEqual(capAfterFail.successfulUseCount, 1, 'successfulUseCount must remain 1');
assert.strictEqual(capAfterFail.failedUseCount, 1, 'failedUseCount must be 1');
assert.strictEqual(capAfterFail.status, CAPABILITY_STATUS.VALIDATED, 'Status must remain VALIDATED despite one failed reuse');
console.log('Usage statistics tracking (successfulUseCount & failedUseCount) verified.');

// 18. Usage Metadata Persistence Reload
console.log('\n--- 18. Usage Metadata Persistence Reload ---');
const rawStorage = global.localStorage.getItem('evo_capabilities');
assert.ok(rawStorage !== null, 'evo_capabilities key must exist in localStorage');
const reloadedCaps = JSON.parse(rawStorage);
const reloadedValCap = reloadedCaps.find(c => c.id === valCap.id);
assert.strictEqual(reloadedValCap.usageCount, 2, 'Reloaded usageCount must be 2');
assert.strictEqual(reloadedValCap.successfulUseCount, 1, 'Reloaded successfulUseCount must be 1');
assert.strictEqual(reloadedValCap.failedUseCount, 1, 'Reloaded failedUseCount must be 1');
console.log('Usage metadata persistence across reload verified.');

// 19. Objective Switching Does Not Leak Execution
console.log('\n--- 19. Objective Switching Isolation ---');
const objX = createObjective('Objective X');
const objY = createObjective('Create a folder called ProjectGamma and create a file called notes.txt containing Hello.');

setActiveObjectiveId(objX.id);
assert.strictEqual(getActiveObjective().id, objX.id, 'Active objective is objX');

const reuseYRes = await reuseCapability(valCap.id, objY.id);
assert.strictEqual(reuseYRes.success, true, 'Reusing capability for objY must complete');
assert.strictEqual(getActiveObjective().id, objX.id, 'Active objective MUST remain objX');
const objYState = getObjectives().find(o => o.id === objY.id);
assert.strictEqual(objYState.status, 'COMPLETED', 'objY status must be COMPLETED');
console.log('Objective switching isolation verified.');

// 20. Capability Facade API (evoApi)
console.log('\n--- 20. Capability Facade API (evoApi) ---');
const matchFacade = await evoApi.matchCapabilities('Create a folder called ProjectDelta and file doc.txt containing Test.');
assert.strictEqual(matchFacade.matched, true, 'evoApi.matchCapabilities must return matched = true');

const objZ = createObjective('Create a folder called ProjectDelta and file doc.txt containing Test.');
const reuseFacade = await evoApi.reuseCapability(valCap.id, objZ.id);
assert.strictEqual(reuseFacade.success, true, 'evoApi.reuseCapability must execute cleanly');
console.log('evoApi capability match and reuse facade methods verified.');

// Clean up workspace test folders
try {
  fs.rmSync(path.join(workspaceRoot, 'ProjectBeta'), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceRoot, 'ProjectGamma'), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceRoot, 'ProjectDelta'), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceRoot, 'TestProject'), { recursive: true, force: true });
} catch (e) {}

console.log('\n=============================================================');
console.log('ALL STEP 9 MILESTONE 3 TESTS COMPLETED & PASSED SUCCESSFULLY!');
console.log('=============================================================');
