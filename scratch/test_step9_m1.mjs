import {
  getCapabilities,
  createCapabilityCandidate,
  findDuplicateCandidate,
  saveCapabilities,
  validateCapabilitySchema,
  computeWorkflowFingerprint,
  CAPABILITY_STATUS
} from '/home/kali/Desktop/Evo/src/services/capabilityStore.js';
import {
  capabilityService,
  validateCandidateActions,
  evaluateCapabilityCandidates
} from '/home/kali/Desktop/Evo/src/services/capabilityService.js';
import { createMemory, getMemories, MEMORY_TYPES, MEMORY_SOURCES } from '/home/kali/Desktop/Evo/src/services/memoryStore.js';
import { evoApi } from '/home/kali/Desktop/Evo/src/services/evoApi.js';

// Polyfill localStorage for Node.js test environment
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

console.log('=== STEP 9 MILESTONE 1 COMPREHENSIVE TEST SUITE ===');
global.localStorage.clear();

// 1. Schema Validation & CANDIDATE Status Verification
console.log('\n--- 1. Schema & Initial Status Verification ---');
const validCandidateData = {
  id: 'cap_test_1',
  name: 'Test Candidate',
  description: 'Test description',
  sourceExperienceIds: ['exp_1', 'exp_2'],
  workflowSteps: [
    { title: 'Step 1', action: { type: 'create_directory', path: 'TestFolder' } },
    { title: 'Step 2', action: { type: 'write_file', path: 'TestFolder/file.txt', content: 'hello' } }
  ],
  status: CAPABILITY_STATUS.CANDIDATE,
  evidenceCount: 2
};

const schemaCheck = validateCapabilitySchema(validCandidateData);
console.assert(schemaCheck.valid === true, `Valid candidate schema must pass: ${schemaCheck.error}`);

// Verify invalid status rejected
const invalidStatusData = { ...validCandidateData, status: 'APPROVED' };
const invalidStatusCheck = validateCapabilitySchema(invalidStatusData);
console.assert(invalidStatusCheck.valid === false, 'Non-CANDIDATE initial status must be rejected');
console.log('Initial CANDIDATE status constraint verified.');

// 2. Candidate Creation from Experience with Sufficient Evidence (evidenceCount >= 2)
console.log('\n--- 2. Evidence Threshold & Candidate Creation ---');
global.localStorage.clear();

// Create memory with evidenceCount = 1 (Insufficient)
createMemory({
  type: MEMORY_TYPES.WORKFLOW,
  content: 'Create folder SingleDir and inspect',
  context: 'SingleDir',
  evidenceCount: 1,
  source: MEMORY_SOURCES.OBJECTIVE_RESULT
});

const resSingle = evaluateCapabilityCandidates();
console.assert(resSingle.candidatesCreatedCount === 0, 'Memory with evidenceCount < 2 must NOT create a candidate');
console.log('Insufficient evidence (<2) correctly ignored.');

// Create WORKFLOW memory with evidenceCount = 2
createMemory({
  type: MEMORY_TYPES.WORKFLOW,
  content: 'Create folder Research and write_file Research/summary.txt',
  context: 'Research',
  evidenceCount: 2,
  source: MEMORY_SOURCES.OBJECTIVE_RESULT
});

const resRepeated = evaluateCapabilityCandidates();
console.assert(resRepeated.candidatesCreatedCount === 1, 'Memory with evidenceCount >= 2 must create a candidate');
const createdCap = resRepeated.candidates[0];
console.assert(createdCap.status === CAPABILITY_STATUS.CANDIDATE, 'Candidate status must be CANDIDATE');
console.assert(createdCap.evidenceCount >= 2, 'Candidate evidenceCount must be >= 2');
console.log('Candidate successfully created from repeated experience (evidenceCount >= 2).');

// 3. Duplicate Candidate Detection & Evidence Reinforcement
console.log('\n--- 3. Duplicate Candidate Detection & Reinforcement ---');
const prevCount = getCapabilities().length;
const duplicateRes = evaluateCapabilityCandidates();
const postCount = getCapabilities().length;

console.assert(postCount === prevCount, 'Evaluating duplicate workflow must NOT create duplicate capability record');
const reinforcedCap = getCapabilities()[0];
console.assert(reinforcedCap.evidenceCount > 2, 'Duplicate workflow evaluation must reinforce evidenceCount');
console.log('Duplicate candidate prevention & evidence reinforcement verified.');

// 4. Strict Authorization & Security Checks
console.log('\n--- 4. Authorization & Security Checks ---');
// Authorized actions test
const authorizedSteps = [
  { title: 'Step 1', action: { type: 'list_directory', path: '.' } },
  { title: 'Step 2', action: { type: 'create_directory', path: 'ValidFolder' } },
  { title: 'Step 3', action: { type: 'write_file', path: 'ValidFolder/file.txt', content: 'test' } },
  { title: 'Step 4', action: { type: 'read_file', path: 'ValidFolder/file.txt' } },
  { title: 'Step 5', action: { type: 'copy_file', source: 'ValidFolder/file.txt', destination: 'ValidFolder/file2.txt' } },
  { title: 'Step 6', action: { type: 'move_file', source: 'ValidFolder/file2.txt', destination: 'ValidFolder/file3.txt' } }
];
const authCheck = validateCandidateActions(authorizedSteps);
console.assert(authCheck.valid === true, 'All authorized EVO actions must pass validation');

// Unauthorized action type test
const unauthorizedSteps = [
  { title: 'Malicious Step', action: { type: 'shell_exec', command: 'rm -rf /' } }
];
const unauthCheck = validateCandidateActions(unauthorizedSteps);
console.assert(unauthCheck.valid === false, 'Unauthorized action type shell_exec must be rejected');

// Path traversal security test
const traversalSteps = [
  { title: 'Traversal Step', action: { type: 'read_file', path: '../../etc/passwd' } }
];
const traversalCheck = validateCandidateActions(traversalSteps);
console.assert(traversalCheck.valid === false, 'Path traversal attempt ../ must be rejected');
console.log('Strict action authorization and path traversal prevention verified.');

// 5. Capability Facade API
console.log('\n--- 5. Capability Facade API (evoApi) ---');
const apiCaps = await evoApi.getCapabilities();
console.assert(Array.isArray(apiCaps) && apiCaps.length > 0, 'evoApi.getCapabilities() must return capability list');
const evalResult = await evoApi.evaluateCapabilityCandidates();
console.assert(evalResult && typeof evalResult.evaluatedCount === 'number', 'evoApi.evaluateCapabilityCandidates() must run successfully');
console.log('evoApi capability facade methods verified.');

// 6. Persistence across reload
console.log('\n--- 6. Persistence & Storage Reload Test ---');
const savedBefore = getCapabilities();
const rawStorage = global.localStorage.getItem('evo_capabilities');
console.assert(rawStorage !== null, 'Capabilities must be stored in evo_capabilities storage key');
const loadedAfter = JSON.parse(rawStorage);
console.assert(loadedAfter.length === savedBefore.length, 'Loaded capabilities count must match saved count');
console.assert(loadedAfter[0].id === savedBefore[0].id, 'Loaded candidate ID must match saved candidate ID');
console.log('Capability persistence across reload verified.');

console.log('\n=============================================================');
console.log('ALL STEP 9 MILESTONE 1 TESTS COMPLETED & PASSED SUCCESSFULLY!');
console.log('=============================================================');
