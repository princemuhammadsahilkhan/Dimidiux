/**
 * Focused Regression Test Suite for Stage 1 Capability Post-Condition Invariants
 *
 * Proves:
 * 1. Valid invariants are accepted by schema validation.
 * 2. Invalid invariant schemas are rejected.
 * 3. Traversal and system paths in invariants are rejected.
 * 4. Invariants are version-specific.
 * 5. Existing capabilities without invariants continue to work cleanly.
 * 6. A valid B02-style capability can evaluate its post-condition invariants successfully.
 * 7. Failed invariant evaluation is reported with structured results.
 * 8. Invariant evaluation performs strictly zero persistence writes (read-only).
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_invariants_storage.json';
if (fs.existsSync(storeFile)) {
  fs.unlinkSync(storeFile);
}
let memoryStore = {};
let setItemCount = 0;

globalThis.localStorage = {
  getItem: (key) => (key in memoryStore ? memoryStore[key] : null),
  setItem: (key, val) => {
    setItemCount++;
    memoryStore[key] = String(val);
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  removeItem: (key) => {
    delete memoryStore[key];
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  clear: () => {
    memoryStore = {};
    setItemCount = 0;
    if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);
  }
};

import {
  createCapabilityCandidate,
  getCapabilities,
  validateCapabilitySchema,
  INVARIANT_TYPES,
  validateInvariantSchema,
  getCapabilityInvariants
} from '../src/services/capabilityStore.js';

import {
  validateCapability,
  evaluateCapabilityInvariants,
  adaptCapabilityInvariants
} from '../src/services/capabilityService.js';

import { fsConfig } from '../src/config/fsConfig.js';

async function runInvariantTests() {
  console.log('====================================================');
  console.log('CAPABILITY POST-CONDITION INVARIANTS TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`✗ [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Valid Invariants Schema Validation
  const validInv1 = { id: 'inv_1', type: INVARIANT_TYPES.DIRECTORY_EXISTS, targetPath: 'ProjectFiles' };
  const validInv2 = { id: 'inv_2', type: INVARIANT_TYPES.FILE_EXISTS, targetPath: 'ProjectFiles/notes.txt' };
  const validInv3 = { id: 'inv_3', type: INVARIANT_TYPES.EXACT_FILE_CONTENT, targetPath: 'ProjectFiles/notes.txt', expectedContent: 'Project Notes' };
  const validInv4 = { id: 'inv_4', type: INVARIANT_TYPES.PATH_RELATIONSHIP, targetPath: 'ProjectFiles/notes.txt', parentPath: 'ProjectFiles' };

  assert(validateInvariantSchema(validInv1).valid, 'directory_exists invariant schema valid');
  assert(validateInvariantSchema(validInv2).valid, 'file_exists invariant schema valid');
  assert(validateInvariantSchema(validInv3).valid, 'exact_file_content invariant schema valid');
  assert(validateInvariantSchema(validInv4).valid, 'path_relationship invariant schema valid');

  // 2. Invalid Invariant Schemas Rejection
  const invNoId = { type: INVARIANT_TYPES.DIRECTORY_EXISTS, targetPath: 'Dir' };
  const invBadType = { id: 'inv_x', type: 'INVALID_TYPE', targetPath: 'Dir' };
  const invNoPath = { id: 'inv_y', type: INVARIANT_TYPES.DIRECTORY_EXISTS };
  const invMissingContent = { id: 'inv_z', type: INVARIANT_TYPES.EXACT_FILE_CONTENT, targetPath: 'file.txt' };

  assert(!validateInvariantSchema(invNoId).valid, 'Invariant without id rejected');
  assert(!validateInvariantSchema(invBadType).valid, 'Unsupported invariant type rejected');
  assert(!validateInvariantSchema(invNoPath).valid, 'Invariant without targetPath rejected');
  assert(!validateInvariantSchema(invMissingContent).valid, 'exact_file_content without expectedContent rejected');

  // 3. Security Boundary & Traversal Rejection
  const invTraversal1 = { id: 'inv_t1', type: INVARIANT_TYPES.FILE_EXISTS, targetPath: '../outside.txt' };
  const invTraversal2 = { id: 'inv_t2', type: INVARIANT_TYPES.PATH_RELATIONSHIP, targetPath: 'file.txt', parentPath: '../outside' };
  const invSysEscape = { id: 'inv_s1', type: INVARIANT_TYPES.FILE_EXISTS, targetPath: '/etc/passwd' };

  assert(!validateInvariantSchema(invTraversal1).valid, 'Path traversal in targetPath rejected');
  assert(!validateInvariantSchema(invTraversal2).valid, 'Path traversal in parentPath rejected');
  assert(!validateInvariantSchema(invSysEscape).valid, 'System path escape rejected');

  // 4. Existing Capabilities Without Invariants Continue to Work
  const legacyCap = createCapabilityCandidate({
    name: 'Legacy Capability Without Invariants',
    description: 'Capability created without invariants field.',
    sourceExperienceIds: ['exp_legacy_1', 'exp_legacy_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'LegacyDir' } }
    ],
    evidenceCount: 2
  });

  const legacyVal = validateCapability(legacyCap.id);
  assert(legacyVal.success, 'Existing capability without invariants validated successfully');
  const legacyInvs = getCapabilityInvariants(legacyCap.id);
  assert(Array.isArray(legacyInvs) && legacyInvs.length === 0, 'Legacy capability returns empty invariants array');

  // 5. Version-Specific Invariants Support
  const capWithInvariants = createCapabilityCandidate({
    name: 'B02 Workflow Capability With Invariants',
    description: 'B02 capability with post-condition invariants.',
    sourceExperienceIds: ['exp_b02_1', 'exp_b02_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'ProjectFiles' } },
      { action: { type: 'write_file', path: 'ProjectFiles/notes.txt', content: 'Project Notes' } }
    ],
    invariants: [
      { id: 'inv_b02_1', type: INVARIANT_TYPES.DIRECTORY_EXISTS, targetPath: 'ProjectFiles' },
      { id: 'inv_b02_2', type: INVARIANT_TYPES.FILE_EXISTS, targetPath: 'ProjectFiles/notes.txt' },
      { id: 'inv_b02_3', type: INVARIANT_TYPES.EXACT_FILE_CONTENT, targetPath: 'ProjectFiles/notes.txt', expectedContent: 'Project Notes' },
      { id: 'inv_b02_4', type: INVARIANT_TYPES.PATH_RELATIONSHIP, targetPath: 'ProjectFiles/notes.txt', parentPath: 'ProjectFiles' }
    ],
    evidenceCount: 2
  });

  const capVal = validateCapability(capWithInvariants.id);
  assert(capVal.success, 'Capability with valid invariants validated successfully');

  const fetchedInvsV1 = getCapabilityInvariants(capWithInvariants.id, 1);
  assert(fetchedInvsV1.length === 4, 'Version 1 invariants retrieved correctly (length === 4)');

  // 6. B02-Style Capability Invariant Evaluation on Physical Disk
  const testFixtureDir = '/tmp/evo_test_invariant_fixture';
  if (fs.existsSync(testFixtureDir)) {
    fs.rmSync(testFixtureDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(testFixtureDir, 'ProjectFiles'), { recursive: true });
  fs.writeFileSync(path.join(testFixtureDir, 'ProjectFiles', 'notes.txt'), 'Project Notes', 'utf-8');

  setItemCount = 0; // Reset write counter
  const evalResSuccess = await evaluateCapabilityInvariants(capWithInvariants.id, {
    rootPath: testFixtureDir,
    targetParams: { folder: 'ProjectFiles' }
  });

  assert(evalResSuccess.success, 'B02 capability post-condition invariants evaluated to SUCCESS');
  assert(evalResSuccess.passedCount === 4, 'All 4 invariants passed evaluation');
  assert(evalResSuccess.failedCount === 0, 'Zero failed invariants');
  assert(setItemCount === 0, 'Invariant evaluation executed strictly READ-ONLY (zero persistence writes)');

  // Verify Structured Result Format
  const res1 = evalResSuccess.results.find((r) => r.id === 'inv_b02_1');
  assert(res1 && res1.passed === true && res1.actual === 'directory_exists', 'Structured result contains id, type, actual, passed');

  const res3 = evalResSuccess.results.find((r) => r.id === 'inv_b02_3');
  assert(res3 && res3.expected === 'Project Notes' && res3.actual === 'Project Notes' && res3.passed === true, 'exact_file_content result contains expected and actual content');

  // 7. Failed Invariant Evaluation Handling
  const failFixtureDir = '/tmp/evo_test_invariant_fail_fixture';
  if (fs.existsSync(failFixtureDir)) {
    fs.rmSync(failFixtureDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(failFixtureDir, 'ProjectFiles'), { recursive: true });
  fs.writeFileSync(path.join(failFixtureDir, 'ProjectFiles', 'notes.txt'), 'Wrong Content', 'utf-8');

  const evalResFail = await evaluateCapabilityInvariants(capWithInvariants.id, {
    rootPath: failFixtureDir,
    targetParams: { folder: 'ProjectFiles' }
  });

  assert(!evalResFail.success, 'Evaluation failed when file content mismatched');
  assert(evalResFail.failedCount === 1, 'Failed count reported correctly (1 failure)');

  const failedResult = evalResFail.results.find((r) => r.id === 'inv_b02_3');
  assert(failedResult && failedResult.passed === false && failedResult.actual === 'Wrong Content' && failedResult.error.includes('Content mismatch'), 'Structured failure result includes expected vs actual content and descriptive error');

  // Cleanup temporary test fixtures
  if (fs.existsSync(testFixtureDir)) fs.rmSync(testFixtureDir, { recursive: true, force: true });
  if (fs.existsSync(failFixtureDir)) fs.rmSync(failFixtureDir, { recursive: true, force: true });

  console.log('\n----------------------------------------------------');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runInvariantTests().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
