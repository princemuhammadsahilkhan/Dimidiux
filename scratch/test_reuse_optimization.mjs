/**
 * Focused Regression Test Suite for Capability Reuse Optimization
 * Proves:
 * 1. Validated capability reuse succeeds.
 * 2. Schema validation is skipped during reuse of VALIDATED capabilities.
 * 3. Simulation is skipped during reuse of VALIDATED capabilities.
 * 4. Security checks (authorized actions & path traversal protection) still execute.
 * 5. Path traversal attempts are still rejected.
 * 6. Unauthorized actions are still rejected.
 * 7. Capability ID and version pinning remain intact.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_reuse_opt_storage.json';
if (fs.existsSync(storeFile)) {
  fs.unlinkSync(storeFile);
}
let memoryStore = {};

globalThis.localStorage = {
  getItem: (key) => (key in memoryStore ? memoryStore[key] : null),
  setItem: (key, val) => {
    memoryStore[key] = String(val);
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  removeItem: (key) => {
    delete memoryStore[key];
    fs.writeFileSync(storeFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
  },
  clear: () => {
    memoryStore = {};
    if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);
  }
};

import {
  createCapabilityCandidate,
  getCapabilities
} from '../src/services/capabilityStore.js';
import {
  validateCapability,
  reuseCapability,
  reuseOptimizationTracker
} from '../src/services/capabilityService.js';
import { createObjective, getObjectives } from '../src/services/objectiveStore.js';
import { evolutionService } from '../src/services/evolutionService.js';

async function runReuseOptimizationTests() {
  console.log('====================================================');
  console.log('REUSE OPTIMIZATION FOCUSED REGRESSION TEST SUITE');
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

  // 1. Create and validate candidate capability
  const candidate = createCapabilityCandidate({
    name: 'Optimization Test Capability',
    description: 'Test capability for reuse optimization verification.',
    sourceExperienceIds: ['exp1', 'exp2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'OptFolder' } },
      { action: { type: 'write_file', path: 'OptFolder/file.txt', content: 'Opt Content' } },
      { action: { type: 'read_file', path: 'OptFolder/file.txt' } }
    ],
    evidenceCount: 2
  });

  const valRes = validateCapability(candidate.id);
  assert(valRes.success && valRes.capability.status === 'VALIDATED', 'Capability successfully promoted to VALIDATED status');

  // 2. Test Reuse Optimization (Skipping redundant schema check & simulation)
  reuseOptimizationTracker.reset();

  const obj = createObjective("Create a folder named OptFolder with file.txt containing 'Opt Content'");
  
  const prepareRes = await evolutionService.createOrPrepareObjectivePlan(obj.id, obj.goal, {
    explicitCapabilityId: candidate.id,
    explicitCapabilityVersion: 1
  });

  assert(prepareRes.success, 'Validated capability reuse objective preparation succeeded');
  assert(reuseOptimizationTracker.schemaValidationCount === 0, 'Schema validation was NOT redundantly executed during reuse (count === 0)');
  assert(reuseOptimizationTracker.simulationCount === 0, 'Simulation was NOT redundantly executed during reuse (count === 0)');
  assert(reuseOptimizationTracker.securityCheckCount > 0, 'Security validation checks WERE executed during reuse (count > 0)');

  const updatedObj = getObjectives().find((o) => o.id === obj.id);
  assert(updatedObj && updatedObj.evolution.capabilityId === candidate.id, 'Capability ID pinned correctly in objective evolution metadata');
  assert(updatedObj && updatedObj.evolution.capabilityVersion === 1, 'Capability Version 1 pinned correctly');

  // 3. Test Security Boundary: Path Traversal Attempt Rejection
  reuseOptimizationTracker.reset();
  const objTraversal = createObjective("Test path traversal protection");
  const traversalRes = await reuseCapability(candidate.id, objTraversal.id, {
    folder: '../escaped_dir'
  }, { execute: false });

  assert(!traversalRes.success, 'Path traversal attempt with "../escaped_dir" was rejected');
  assert(traversalRes.error.includes('Security Violation'), `Rejection error message contains Security Violation: "${traversalRes.error}"`);

  // 4. Test Security Boundary: Unauthorized Action Rejection
  const unauthCap = createCapabilityCandidate({
    name: 'Unauthorized Action Capability',
    description: 'Capability with unauthorized action type',
    sourceExperienceIds: ['exp1', 'exp2'],
    workflowSteps: [
      { action: { type: 'delete_system_file', path: '/etc/passwd' } }
    ],
    evidenceCount: 2
  });
  // Manually force status = VALIDATED to test reuse action validation gate
  const capabilities = getCapabilities();
  const unauthObjInStore = capabilities.find((c) => c.id === unauthCap.id);
  if (unauthObjInStore) unauthObjInStore.status = 'VALIDATED';

  const objUnauth = createObjective("Test unauthorized action rejection");
  const unauthRes = await reuseCapability(unauthCap.id, objUnauth.id, {}, { execute: false });
  assert(!unauthRes.success, 'Unauthorized action type "delete_system_file" was rejected during reuse');

  console.log('\n====================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} assertions`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runReuseOptimizationTests().catch((err) => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
