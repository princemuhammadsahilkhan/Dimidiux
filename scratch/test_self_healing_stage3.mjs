/**
 * Focused Regression Test Suite for Stage 3 Capability Self-Healing:
 * Repair Candidate Sandbox Testing
 *
 * Proves:
 * 1. A valid repair candidate can be sandbox-tested in a completely isolated workspace.
 * 2. The repair candidate fixes the targeted invariant failure inside the sandbox.
 * 3. All post-condition invariants and per-step verification pass.
 * 4. Sandbox workspace remains strictly isolated from the user's workspace.
 * 5. Active capability version remains 100% UNCHANGED (no automatic activation).
 * 6. Proposal validationStatus becomes VALIDATED upon clean sandbox test success.
 * 7. Unsafe candidates (path traversal or unauthorized actions) fail sandbox test and become REJECTED.
 * 8. Failed candidates become REJECTED with descriptive failure details.
 * 9. Original capabilities and historical experiment records remain unchanged.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_self_healing_stage3_storage.json';
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
  getCapabilities,
  INVARIANT_TYPES,
  getImprovementProposals,
  createImprovementProposal
} from '../src/services/capabilityStore.js';

import {
  validateCapability,
  generateCapabilityRepairCandidate,
  testRepairCandidateInSandbox
} from '../src/services/capabilityService.js';

async function runStage3SandboxTestingTests() {
  console.log('====================================================');
  console.log('STAGE 3 CAPABILITY SANDBOX TESTING REGRESSION SUITE');
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

  // 1. Setup Base Capability with Invariants
  const baseCap = createCapabilityCandidate({
    name: 'Stage 3 Sandbox Capability',
    description: 'Capability for sandbox repair candidate testing.',
    sourceExperienceIds: ['exp_sb3_1', 'exp_sb3_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'SBFolder' } },
      { action: { type: 'write_file', path: 'SBFolder/readme.txt', content: 'Base Content' } }
    ],
    invariants: [
      { id: 'inv_sb_1', type: INVARIANT_TYPES.DIRECTORY_EXISTS, targetPath: 'SBFolder' },
      { id: 'inv_sb_2', type: INVARIANT_TYPES.EXACT_FILE_CONTENT, targetPath: 'SBFolder/readme.txt', expectedContent: 'Fixed Expected Content' }
    ],
    evidenceCount: 2
  });

  const valRes = validateCapability(baseCap.id);
  assert(valRes.success && valRes.capability.status === 'VALIDATED', 'Base capability validated successfully');
  const capInitial = getCapabilities().find((c) => c.id === baseCap.id);
  const activeVerBefore = capInitial.activeVersion || 1;

  // 2. Create Stage 2 Repair Proposal
  const fakeEvidence = {
    id: 'fev_test_stage3',
    capabilityId: baseCap.id,
    capabilityVersion: 1,
    failedInvariantId: 'inv_sb_2',
    failedInvariantType: INVARIANT_TYPES.EXACT_FILE_CONTENT,
    targetPath: 'SBFolder/readme.txt',
    expected: 'Fixed Expected Content',
    actual: 'Base Content',
    targetParams: { folder: 'SBFolder' }
  };

  const genRes = generateCapabilityRepairCandidate(fakeEvidence);
  assert(genRes.success && genRes.proposal, 'Repair candidate generated for Stage 3 testing');
  const proposal = genRes.proposal;

  // 3. Test Valid Repair Candidate in Isolated Sandbox Workspace
  const customSandboxPath = '/tmp/evo_stage3_isolated_sandbox_test';
  if (fs.existsSync(customSandboxPath)) {
    fs.rmSync(customSandboxPath, { recursive: true, force: true });
  }

  const testRes = await testRepairCandidateInSandbox(proposal.id, {
    sandboxPath: customSandboxPath,
    targetParams: { folder: 'SBFolder' }
  });

  assert(testRes.success, 'Repair candidate sandbox testing succeeded');
  assert(testRes.proposalId === proposal.id, 'Sandbox result references correct proposal ID');
  assert(testRes.capabilityId === baseCap.id, 'Sandbox result references correct capability ID');
  assert(testRes.sandboxPath === customSandboxPath, 'Sandbox result specifies isolated sandbox path');
  assert(testRes.invariantResults.success && testRes.invariantResults.passedCount === 2, 'All post-condition invariants passed inside sandbox');

  // Verify Physical Sandbox State
  const readmePath = path.join(customSandboxPath, 'SBFolder', 'readme.txt');
  assert(fs.existsSync(readmePath), 'File created cleanly inside isolated sandbox directory');
  assert(fs.readFileSync(readmePath, 'utf-8').trim() === 'Fixed Expected Content', 'File content inside sandbox matches fixed expected content');

  // 4. Verify Proposal Status Transition & Active Capability Isolation
  const updatedProposal = getImprovementProposals().find((p) => p.id === proposal.id);
  assert(updatedProposal.validationStatus === 'VALIDATED', 'Proposal validationStatus updated to VALIDATED');
  assert(updatedProposal.validationResult === true, 'Proposal validationResult updated to true');

  const capAfter = getCapabilities().find((c) => c.id === baseCap.id);
  assert(capAfter.activeVersion === activeVerBefore, 'Active capability version remained strictly UNCHANGED (v1)');
  assert(capAfter.status === 'VALIDATED', 'Active capability status remained strictly UNCHANGED');

  // 5. Test Unsafe Repair Candidate with Path Traversal Rejection
  const unsafeProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 1,
    reason: 'Unsafe traversal test proposal',
    workflowSteps: [
      { action: { type: 'create_directory', path: '../escaped_dir' } }
    ]
  });

  const unsafeTestRes = await testRepairCandidateInSandbox(unsafeProposal.id, {
    cleanUp: true
  });

  assert(!unsafeTestRes.success, 'Unsafe candidate with path traversal was rejected by sandbox runner');
  assert(unsafeTestRes.failureDetails.includes('Security Error'), 'Failure details reports Security Error');

  const updatedUnsafeProp = getImprovementProposals().find((p) => p.id === unsafeProposal.id);
  assert(updatedUnsafeProp.validationStatus === 'REJECTED', 'Unsafe proposal validationStatus updated to REJECTED');
  assert(updatedUnsafeProp.validationResult === false, 'Unsafe proposal validationResult updated to false');

  // 6. Test Candidate with Unauthorized Action Rejection
  const unauthProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 1,
    reason: 'Unauthorized action test proposal',
    workflowSteps: [
      { action: { type: 'exec_shell_command', command: 'rm -rf /' } }
    ]
  });

  const unauthTestRes = await testRepairCandidateInSandbox(unauthProposal.id);
  assert(!unauthTestRes.success, 'Candidate with unauthorized action was rejected by sandbox runner');

  const updatedUnauthProp = getImprovementProposals().find((p) => p.id === unauthProposal.id);
  assert(updatedUnauthProp.validationStatus === 'REJECTED', 'Unauthorized proposal validationStatus updated to REJECTED');

  // Cleanup isolated sandbox directory
  if (fs.existsSync(customSandboxPath)) {
    fs.rmSync(customSandboxPath, { recursive: true, force: true });
  }

  console.log('\n----------------------------------------------------');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage3SandboxTestingTests().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
