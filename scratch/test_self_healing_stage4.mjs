/**
 * Focused Regression Test Suite for Stage 4 Capability Self-Healing:
 * Controlled Promotion of Validated Repair Candidates
 *
 * Proves:
 * 1. Validated repair candidate with sufficient evidence becomes eligible for promotion.
 * 2. Proposal with insufficient evidence (< 2) is blocked from promotion.
 * 3. Unvalidated proposal (validationStatus !== VALIDATED) is blocked from promotion.
 * 4. Stale base-version proposal (baseVersion !== cap.activeVersion) is blocked from promotion.
 * 5. Unsafe candidate (path traversal or unauthorized action) is blocked from promotion.
 * 6. Successful promotion creates correct v2 capability version.
 * 7. v1 remains fully recoverable in versionHistory.
 * 8. activeVersion updates correctly to v2.
 * 9. Proposal status transitions to APPLIED upon promotion.
 * 10. Atomic persistence failure reverts state cleanly without corrupting capabilities.
 * 11. Explicit rollback restores v1 workflow steps and activeVersion.
 * 12. Rollback history is preserved cleanly in rollbackHistory.
 * 13. Repeated promotion of an already APPLIED proposal is prevented.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_self_healing_stage4_storage.json';
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
  createImprovementProposal,
  updateImprovementProposal,
  saveCapabilities
} from '../src/services/capabilityStore.js';

import {
  validateCapability,
  checkPromotionEligibility,
  promoteRepairCandidate,
  rollbackCapability
} from '../src/services/capabilityService.js';

async function runStage4ControlledPromotionTests() {
  console.log('===========================================================');
  console.log('STAGE 4 CAPABILITY CONTROLLED PROMOTION REGRESSION SUITE');
  console.log('===========================================================\n');

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

  // Setup Base Capability
  const baseCap = createCapabilityCandidate({
    name: 'Stage 4 Base Capability',
    description: 'Capability for Stage 4 promotion testing.',
    sourceExperienceIds: ['exp_stg4_1', 'exp_stg4_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'Stg4Folder' } },
      { action: { type: 'write_file', path: 'Stg4Folder/output.txt', content: 'Original v1 Content' } }
    ],
    invariants: [
      { id: 'inv_stg4_1', type: INVARIANT_TYPES.DIRECTORY_EXISTS, targetPath: 'Stg4Folder' },
      { id: 'inv_stg4_2', type: INVARIANT_TYPES.EXACT_FILE_CONTENT, targetPath: 'Stg4Folder/output.txt', expectedContent: 'Promoted v2 Content' }
    ],
    evidenceCount: 2
  });

  const valRes = validateCapability(baseCap.id);
  assert(valRes.success && valRes.capability.status === 'VALIDATED', 'Base capability v1 validated');

  // Test 1: Unvalidated Proposal cannot be promoted
  const unvalProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 1,
    reason: 'Unvalidated proposal test',
    evidenceIds: ['exp_1', 'exp_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'Stg4Folder' } },
      { action: { type: 'write_file', path: 'Stg4Folder/output.txt', content: 'Promoted v2 Content' } }
    ]
  });

  const unvalCheck = checkPromotionEligibility(unvalProposal.id);
  assert(!unvalCheck.eligible, 'Unvalidated proposal is ineligible for promotion');
  const unvalPromRes = promoteRepairCandidate(unvalProposal.id);
  assert(!unvalPromRes.promoted, 'Promotion blocked for unvalidated proposal');

  // Mark proposal as VALIDATED for subsequent tests
  updateImprovementProposal(unvalProposal.id, {
    validationStatus: 'VALIDATED',
    validationResult: true
  });

  // Test 2: Insufficient Evidence prevents promotion
  const lowEvidenceProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 1,
    reason: 'Low evidence proposal test',
    evidenceIds: ['exp_single_1'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'Stg4Folder' } }
    ]
  });
  updateImprovementProposal(lowEvidenceProposal.id, {
    validationStatus: 'VALIDATED',
    validationResult: true
  });

  const lowEvCheck = checkPromotionEligibility(lowEvidenceProposal.id, { evidenceCount: 1 });
  assert(!lowEvCheck.eligible, 'Proposal with insufficient evidence (< 2) is ineligible for promotion');
  assert(lowEvCheck.reasons.some((r) => r.includes('Insufficient failure evidence')), 'Reason explicitly mentions insufficient failure evidence');

  // Test 3: Stale Base-Version Proposal cannot be promoted
  const staleProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 99, // Active is v1
    reason: 'Stale version proposal test',
    evidenceIds: ['exp_1', 'exp_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'Stg4Folder' } }
    ]
  });
  updateImprovementProposal(staleProposal.id, {
    validationStatus: 'VALIDATED',
    validationResult: true
  });

  const staleCheck = checkPromotionEligibility(staleProposal.id, { evidenceCount: 2 });
  assert(!staleCheck.eligible, 'Stale base-version proposal is ineligible for promotion');
  assert(staleCheck.reasons.some((r) => r.includes('Stale base version')), 'Reason explicitly mentions stale base version');

  // Test 4: Unsafe Candidate cannot be promoted
  const unsafeProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 1,
    reason: 'Unsafe traversal proposal test',
    evidenceIds: ['exp_1', 'exp_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: '../escaped_dir' } }
    ]
  });
  updateImprovementProposal(unsafeProposal.id, {
    validationStatus: 'VALIDATED',
    validationResult: true
  });

  const unsafeCheck = checkPromotionEligibility(unsafeProposal.id, { evidenceCount: 2 });
  assert(!unsafeCheck.eligible, 'Unsafe proposal with path traversal is ineligible for promotion');

  // Test 5: Valid Proposal with Sufficient Evidence is Eligible & Promoted Successfully
  const validProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 1,
    reason: 'Valid Stage 4 repair candidate proposal',
    evidenceIds: ['exp_fail_1', 'exp_fail_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'Stg4Folder' } },
      { action: { type: 'write_file', path: 'Stg4Folder/output.txt', content: 'Promoted v2 Content' } }
    ],
    invariants: [
      { id: 'inv_stg4_1', type: INVARIANT_TYPES.DIRECTORY_EXISTS, targetPath: 'Stg4Folder' },
      { id: 'inv_stg4_2', type: INVARIANT_TYPES.EXACT_FILE_CONTENT, targetPath: 'Stg4Folder/output.txt', expectedContent: 'Promoted v2 Content' }
    ]
  });
  updateImprovementProposal(validProposal.id, {
    validationStatus: 'VALIDATED',
    validationResult: true,
    sandboxTestResult: { success: true }
  });

  const validCheck = checkPromotionEligibility(validProposal.id, { evidenceCount: 2 });
  assert(validCheck.eligible, 'Valid proposal with sandbox pass & evidence >= 2 is eligible for promotion');

  const promoteRes = promoteRepairCandidate(validProposal.id, { evidenceCount: 2 });
  assert(promoteRes.promoted && promoteRes.success, 'Repair candidate successfully promoted');
  assert(promoteRes.newVersion === 2, 'New capability version is v2');

  const promotedCap = getCapabilities().find((c) => c.id === baseCap.id);
  assert(promotedCap.version === 2, 'Capability version updated to 2');
  assert(promotedCap.activeVersion === 2, 'Capability activeVersion updated to 2');
  assert(promotedCap.versionHistory && promotedCap.versionHistory.length === 1, 'v1 preserved in versionHistory');
  assert(promotedCap.versionHistory[0].version === 1, 'versionHistory entry contains v1');
  assert(promotedCap.workflowSteps[1].action.content === 'Promoted v2 Content', 'v2 workflow steps updated to candidate steps');

  const updatedValidProp = getImprovementProposals().find((p) => p.id === validProposal.id);
  assert(updatedValidProp.status === 'APPLIED', 'Proposal status transitioned to APPLIED');

  // Test 6: Repeated Promotion of already APPLIED Proposal is Prevented
  const rePromRes = promoteRepairCandidate(validProposal.id, { evidenceCount: 2 });
  assert(!rePromRes.promoted, 'Repeated promotion of already APPLIED proposal is blocked');

  // Test 7: Atomic Persistence Failure Protection
  const failProposal = createImprovementProposal({
    capabilityId: baseCap.id,
    baseVersion: 2, // Active is v2
    reason: 'Persistence failure test proposal',
    evidenceIds: ['exp_1', 'exp_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'Stg4Folder' } },
      { action: { type: 'write_file', path: 'Stg4Folder/output.txt', content: 'Attempted v3 Content' } }
    ]
  });
  updateImprovementProposal(failProposal.id, {
    validationStatus: 'VALIDATED',
    validationResult: true
  });

  const failPromRes = promoteRepairCandidate(failProposal.id, {
    evidenceCount: 2,
    simulatePersistenceFailure: true
  });

  assert(!failPromRes.promoted, 'Promotion failed due to simulated persistence failure');
  const capAfterFail = getCapabilities().find((c) => c.id === baseCap.id);
  assert(capAfterFail.version === 2, 'Capability state cleanly reverted to v2 on persistence failure');

  // Test 8: Explicit Rollback restores v1 and records Rollback History
  const rollbackRes = rollbackCapability(baseCap.id, 'Stage 4 explicit rollback test');
  assert(rollbackRes.rolledBack && rollbackRes.success, 'Explicit rollback succeeded');

  const rolledBackCap = getCapabilities().find((c) => c.id === baseCap.id);
  assert(rolledBackCap.version === 1, 'Capability version restored to v1');
  assert(rolledBackCap.activeVersion === 1, 'Capability activeVersion restored to v1');
  assert(rolledBackCap.workflowSteps[1].action.content === 'Original v1 Content', 'v1 workflow steps restored');
  assert(rolledBackCap.rollbackHistory && rolledBackCap.rollbackHistory.length === 1, 'Rollback history entry recorded');
  assert(rolledBackCap.rollbackHistory[0].fromVersion === 2 && rolledBackCap.rollbackHistory[0].toVersion === 1, 'Rollback history records fromVersion 2 toVersion 1');

  console.log('\n-----------------------------------------------------------');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('-----------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage4ControlledPromotionTests().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
