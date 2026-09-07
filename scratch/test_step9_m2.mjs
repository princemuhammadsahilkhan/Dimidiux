import {
  getCapabilities,
  createCapabilityCandidate,
  findDuplicateCandidate,
  saveCapabilities,
  CAPABILITY_STATUS
} from '/home/kali/Desktop/Evo/src/services/capabilityStore.js';
import {
  capabilityService,
  validateCapability,
  validateAllCapabilityCandidates,
  validateCandidateActions
} from '/home/kali/Desktop/Evo/src/services/capabilityService.js';
import { evoApi } from '/home/kali/Desktop/Evo/src/services/evoApi.js';

// Polyfill localStorage for Node.js test environment
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

console.log('=== STEP 9 MILESTONE 2 COMPREHENSIVE TEST SUITE ===');
global.localStorage.clear();

// 1. Valid Candidate Passes Validation
console.log('\n--- 1. Valid Candidate Passes Validation ---');
const validCap = createCapabilityCandidate({
  name: 'Valid Workflow Candidate',
  description: 'Valid workflow candidate description',
  sourceExperienceIds: ['exp_1', 'exp_2'],
  evidenceCount: 2,
  workflowSteps: [
    { title: 'Create dir', action: { type: 'create_directory', path: 'TestFolder' } },
    { title: 'Write file', action: { type: 'write_file', path: 'TestFolder/hello.txt', content: 'Hello World' } },
    { title: 'Read file', action: { type: 'read_file', path: 'TestFolder/hello.txt' } }
  ]
});

const valRes1 = validateCapability(validCap.id);
console.assert(valRes1.success === true, `Valid candidate must pass validation: ${valRes1.errors}`);
console.assert(valRes1.capability.status === CAPABILITY_STATUS.VALIDATED, 'Candidate status must become VALIDATED');
console.assert(valRes1.capability.validationResult === true, 'validationResult must be true');
console.assert(valRes1.capability.validationVersion === '1.0', 'validationVersion must be 1.0');
console.assert(typeof valRes1.capability.validatedAt === 'string', 'validatedAt timestamp must be recorded');
console.log('Valid candidate successfully validated (status = VALIDATED).');

// 2. Insufficient Evidence (< 2) Fails Validation
console.log('\n--- 2. Insufficient Evidence (< 2) Fails Validation ---');
const insufficientCap = createCapabilityCandidate({
  name: 'Insufficient Evidence Candidate',
  description: 'Insufficient evidence description',
  sourceExperienceIds: ['exp_1'],
  evidenceCount: 2, // Created with 2 to pass schema initially
  workflowSteps: [
    { title: 'Create dir', action: { type: 'create_directory', path: 'FolderA' } }
  ]
});
// Manually mutate evidenceCount to 1
const allCaps = getCapabilities();
const target = allCaps.find(c => c.id === insufficientCap.id);
target.evidenceCount = 1;
saveCapabilities(allCaps);

const valRes2 = validateCapability(insufficientCap.id);
console.assert(valRes2.success === false, 'Candidate with evidenceCount < 2 must fail validation');
console.assert(valRes2.capability.status === CAPABILITY_STATUS.REJECTED, 'Candidate status must become REJECTED');
console.assert(valRes2.errors.some(e => e.includes('Insufficient evidence')), 'Error must mention insufficient evidence');
console.log('Candidate with insufficient evidence correctly REJECTED.');

// 3. Invalid Schema Fails Validation
console.log('\n--- 3. Invalid Schema Fails Validation ---');
const schemaCap = createCapabilityCandidate({
  name: 'Schema Failure Candidate',
  description: 'Schema failure description',
  sourceExperienceIds: ['exp_1', 'exp_2'],
  evidenceCount: 2,
  workflowSteps: [
    { title: 'Create dir', action: { type: 'create_directory', path: 'FolderB' } }
  ]
});

// Corrupt candidate name to empty string
const caps2 = getCapabilities();
const target2 = caps2.find(c => c.id === schemaCap.id);
target2.name = '';
saveCapabilities(caps2);

const valRes3 = validateCapability(schemaCap.id);
console.assert(valRes3.success === false, 'Candidate with invalid schema must fail validation');
console.assert(valRes3.capability.status === CAPABILITY_STATUS.REJECTED, 'Status must become REJECTED');
console.log('Invalid schema candidate correctly REJECTED.');

// 4. Unauthorized Action Fails Validation
console.log('\n--- 4. Unauthorized Action Fails Validation ---');
const unauthCap = createCapabilityCandidate({
  name: 'Unauthorized Action Candidate',
  description: 'Unauthorized description',
  sourceExperienceIds: ['exp_1', 'exp_2'],
  evidenceCount: 2,
  workflowSteps: [
    { title: 'Unauthorized Action', action: { type: 'network_fetch', url: 'https://evil.com' } }
  ]
});

const valRes4 = validateCapability(unauthCap.id);
console.assert(valRes4.success === false, 'Unauthorized action type must fail validation');
console.assert(valRes4.capability.status === CAPABILITY_STATUS.REJECTED, 'Status must become REJECTED');
console.assert(valRes4.errors.some(e => e.includes('Unauthorized action type')), 'Error must mention unauthorized action');
console.log('Unauthorized action candidate correctly REJECTED.');

// 5. Path Traversal Fails Validation
console.log('\n--- 5. Path Traversal Fails Validation ---');
const traversalCap = createCapabilityCandidate({
  name: 'Path Traversal Candidate',
  description: 'Path traversal description',
  sourceExperienceIds: ['exp_1', 'exp_2'],
  evidenceCount: 2,
  workflowSteps: [
    { title: 'Path Traversal', action: { type: 'read_file', path: '../../../etc/passwd' } }
  ]
});

const valRes5 = validateCapability(traversalCap.id);
console.assert(valRes5.success === false, 'Path traversal must fail validation');
console.assert(valRes5.capability.status === CAPABILITY_STATUS.REJECTED, 'Status must become REJECTED');
console.assert(valRes5.errors.some(e => e.includes('Traversal attempt')), 'Error must mention traversal attempt');
console.log('Path traversal candidate correctly REJECTED.');

// 6. Shell / Arbitrary Code Execution Fails Validation
console.log('\n--- 6. Shell / Arbitrary Code Execution Fails Validation ---');
const shellCap = createCapabilityCandidate({
  name: 'Shell Exec Candidate',
  description: 'Shell exec description',
  sourceExperienceIds: ['exp_1', 'exp_2'],
  evidenceCount: 2,
  workflowSteps: [
    { title: 'Shell Execution', action: { type: 'shell_exec', command: 'rm -rf /' } }
  ]
});

const valRes6 = validateCapability(shellCap.id);
console.assert(valRes6.success === false, 'Shell execution must fail validation');
console.assert(valRes6.capability.status === CAPABILITY_STATUS.REJECTED, 'Status must become REJECTED');
console.log('Shell execution candidate correctly REJECTED.');

// 7. Rejected Candidate Cannot Become Validated
console.log('\n--- 7. Rejected Candidate Cannot Become Validated ---');
// Attempt to re-validate an already REJECTED candidate (valRes6)
const revalRes7 = validateCapability(shellCap.id);
console.assert(revalRes7.success === false, 'Re-validating a REJECTED candidate must return failure');
console.assert(revalRes7.capability.status === CAPABILITY_STATUS.REJECTED, 'Status must remain REJECTED');
console.assert(revalRes7.errors.includes('Rejected candidate cannot become validated.'), 'Must report rejected candidates cannot become validated');
console.log('Rejected candidate strictly prevented from becoming validated.');

// 8. Validation Metadata Persists Across Storage Reload
console.log('\n--- 8. Validation Metadata Persistence Reload Test ---');
const rawStorage = global.localStorage.getItem('evo_capabilities');
console.assert(rawStorage !== null, 'Storage must contain evo_capabilities');
const reloadedCaps = JSON.parse(rawStorage);
const reloadedValid = reloadedCaps.find(c => c.id === validCap.id);
console.assert(reloadedValid.status === CAPABILITY_STATUS.VALIDATED, 'Reloaded status must be VALIDATED');
console.assert(reloadedValid.validationStatus === CAPABILITY_STATUS.VALIDATED, 'Reloaded validationStatus must be VALIDATED');
console.assert(reloadedValid.validationResult === true, 'Reloaded validationResult must be true');
console.assert(reloadedValid.validationVersion === '1.0', 'Reloaded validationVersion must be 1.0');
console.assert(Array.isArray(reloadedValid.validationErrors), 'Reloaded validationErrors must be an array');
console.log('Validation metadata persistence across reload verified.');

// 9. Already Validated Candidate Handled Safely
console.log('\n--- 9. Already Validated Candidate Handled Safely ---');
const revalValidRes = validateCapability(validCap.id);
console.assert(revalValidRes.success === true, 'Validating an already VALIDATED candidate must succeed safely');
console.assert(revalValidRes.capability.status === CAPABILITY_STATUS.VALIDATED, 'Status must remain VALIDATED');
console.log('Already validated candidate handled safely without error.');

// 10. Duplicate Candidates Remain Prevented
console.log('\n--- 10. Duplicate Candidate Prevention ---');
const duplicateData = {
  name: 'Valid Workflow Candidate Duplicate',
  description: 'Duplicate workflow',
  sourceExperienceIds: ['exp_3'],
  evidenceCount: 2,
  workflowSteps: [
    { title: 'Create dir', action: { type: 'create_directory', path: 'TestFolder' } },
    { title: 'Write file', action: { type: 'write_file', path: 'TestFolder/hello.txt', content: 'Hello World' } },
    { title: 'Read file', action: { type: 'read_file', path: 'TestFolder/hello.txt' } }
  ]
};

const beforeCount = getCapabilities().length;
const duplicateCreated = createCapabilityCandidate(duplicateData);
const afterCount = getCapabilities().length;

console.assert(beforeCount === afterCount, 'Duplicate workflow step sequence must NOT add a new candidate entry');
console.assert(duplicateCreated.id === validCap.id, 'Returned candidate must be the existing candidate');
console.log('Duplicate candidate prevention verified.');

// 11. Capability Facade Validation Methods (evoApi)
console.log('\n--- 11. Capability Facade API (evoApi) ---');
const facadeValRes = await evoApi.validateCapability(validCap.id);
console.assert(facadeValRes.success === true, 'evoApi.validateCapability must function correctly');
const facadeAllRes = await evoApi.validateAllCapabilities();
console.assert(facadeAllRes && typeof facadeAllRes.totalEvaluated === 'number', 'evoApi.validateAllCapabilities must function correctly');
console.log('evoApi capability validation facade methods verified.');

console.log('\n=============================================================');
console.log('ALL STEP 9 MILESTONE 2 TESTS COMPLETED & PASSED SUCCESSFULLY!');
console.log('=============================================================');
