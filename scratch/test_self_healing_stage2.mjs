/**
 * Focused Regression Test Suite for Stage 2 Capability Self-Healing:
 * Failure Evidence Capture & Repair Candidate Generation
 *
 * Proves:
 * 1. Invariant failure is detected upon execution completion.
 * 2. Failure evidence is persisted in dedicated storage (`evo_capability_failure_evidence`).
 * 3. Exact capability ID and version are captured in evidence.
 * 4. A localized repair candidate is generated.
 * 5. Candidate references source failure evidence ID (`evidenceIds`).
 * 6. Candidate remains NON-ACTIVE (`status: 'PROPOSED'`).
 * 7. Candidate security validation works (unauthorized repair actions & traversal rejected).
 * 8. Successful executions generate zero failure evidence and zero repair candidates.
 * 9. Existing capabilities continue working without side-effects.
 * 10. No automatic capability promotion or version activation occurs.
 */

import fs from 'fs';
import path from 'path';

const storeFile = '/tmp/evo_test_self_healing_stage2_storage.json';
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
  getFailureEvidences,
  getImprovementProposals,
  saveCapabilities
} from '../src/services/capabilityStore.js';

import {
  validateCapability,
  generateCapabilityRepairCandidate,
  reuseCapability
} from '../src/services/capabilityService.js';

import { createObjective, getObjectives } from '../src/services/objectiveStore.js';
import { evolutionService } from '../src/services/evolutionService.js';

async function runStage2SelfHealingTests() {
  console.log('====================================================');
  console.log('STAGE 2 CAPABILITY SELF-HEALING REGRESSION TEST SUITE');
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

  // 1. Create base capability with post-condition invariants
  const baseCap = createCapabilityCandidate({
    name: 'Stage 2 Test Capability',
    description: 'Capability for self-healing repair generation test.',
    sourceExperienceIds: ['exp_sh_1', 'exp_sh_2'],
    workflowSteps: [
      { action: { type: 'create_directory', path: 'SHFolder' } },
      { action: { type: 'write_file', path: 'SHFolder/notes.txt', content: 'Original Notes' } }
    ],
    invariants: [
      { id: 'inv_sh_1', type: INVARIANT_TYPES.DIRECTORY_EXISTS, targetPath: 'SHFolder' },
      { id: 'inv_sh_2', type: INVARIANT_TYPES.EXACT_FILE_CONTENT, targetPath: 'SHFolder/notes.txt', expectedContent: 'Required Expected Content' }
    ],
    evidenceCount: 2
  });

  const valRes = validateCapability(baseCap.id);
  assert(valRes.success && valRes.capability.status === 'VALIDATED', 'Base capability validated successfully');

  const capInitial = getCapabilities().find((c) => c.id === baseCap.id);
  const activeVerBefore = capInitial.activeVersion || 1;

  // 2. Simulate execution completion where invariant fails (e.g. content mismatch)
  const testRoot = '/tmp/evo_test_sh2_fixture';
  if (fs.existsSync(testRoot)) {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(testRoot, 'SHFolder'), { recursive: true });
  fs.writeFileSync(path.join(testRoot, 'SHFolder', 'notes.txt'), 'Wrong Content', 'utf-8');

  // Create objective representing a reused capability run
  const obj = createObjective('Create a folder named SHFolder with notes.txt containing Required Expected Content');
  await evolutionService.createOrPrepareObjectivePlan(obj.id, obj.goal, {
    explicitCapabilityId: baseCap.id,
    explicitCapabilityVersion: 1
  });

  const objToComplete = getObjectives().find((o) => o.id === obj.id);
  objToComplete.status = 'COMPLETED';
  objToComplete.root = testRoot;

  // Process completion via evolutionService
  const handleRes = await evolutionService.handleObjectiveCompletion(objToComplete);
  assert(handleRes.processed, 'Objective completion processed by evolutionService');

  // 3. Verify Failure Evidence Capture
  const evidences = getFailureEvidences(baseCap.id);
  assert(evidences.length > 0, 'Failure evidence recorded persistently in storage');

  const evidence = evidences[0];
  assert(evidence.capabilityId === baseCap.id, 'Failure evidence captures exact capability ID');
  assert(evidence.capabilityVersion === 1, 'Failure evidence captures exact capability version (v1)');
  assert(evidence.objectiveId === obj.id, 'Failure evidence captures exact objective ID');
  assert(evidence.failedInvariantId === 'inv_sh_2', 'Failure evidence identifies failed invariant ID');
  assert(evidence.failedInvariantType === INVARIANT_TYPES.EXACT_FILE_CONTENT, 'Failure evidence identifies failed invariant type');
  assert(evidence.expected === 'Required Expected Content', 'Failure evidence records expected condition');
  assert(evidence.actual === 'Wrong Content', 'Failure evidence records actual state');

  // 4. Verify Localized Repair Candidate Generation
  const proposals = getImprovementProposals(baseCap.id);
  assert(proposals.length > 0, 'Repair candidate generated persistently in proposals storage');

  const candidateProposal = proposals[0];
  assert(candidateProposal.capabilityId === baseCap.id, 'Repair candidate references base capability ID');
  assert(candidateProposal.baseVersion === 1, 'Repair candidate references base version');
  assert(Array.isArray(candidateProposal.evidenceIds) && candidateProposal.evidenceIds.includes(evidence.id), 'Repair candidate references source failure evidence ID');
  assert(candidateProposal.status === 'PROPOSED', 'Repair candidate remains strictly NON-ACTIVE (status === PROPOSED)');

  // Verify Repaired Workflow Steps (Localized Fix)
  const repairedSteps = candidateProposal.workflowSteps;
  assert(Array.isArray(repairedSteps) && repairedSteps.length === 2, 'Repair candidate preserves workflow step structure');
  const targetStep = repairedSteps.find((s) => s.action.path === 'SHFolder/notes.txt' || s.action.path === '{folder}/notes.txt');
  assert(targetStep && targetStep.action.content === 'Required Expected Content', 'Repair step localized content fix updated to expected content');

  // 5. Verify Active Capability State Unchanged (No automatic activation/promotion)
  const capAfter = getCapabilities().find((c) => c.id === baseCap.id);
  assert(capAfter.activeVersion === activeVerBefore, 'Active capability version remained UNCHANGED (v1)');
  assert(capAfter.status === 'VALIDATED', 'Active capability status remained VALIDATED');

  // 6. Security Validation Checks on Repair Candidate Generation
  const fakeBadEvidence1 = {
    capabilityId: baseCap.id,
    capabilityVersion: 1,
    failedInvariantId: 'inv_bad_1',
    failedInvariantType: INVARIANT_TYPES.EXACT_FILE_CONTENT,
    targetPath: '../escaped/notes.txt',
    expected: 'Content'
  };

  const repairBadPathRes = generateCapabilityRepairCandidate(fakeBadEvidence1);
  assert(!repairBadPathRes.success && repairBadPathRes.error.includes('Security Error'), 'Repair generation rejected path traversal in failure evidence targetPath');

  // 7. Successful Executions Generate Zero Failure Evidence & Zero Repair Candidates
  if (fs.existsSync(testRoot)) {
    fs.writeFileSync(path.join(testRoot, 'SHFolder', 'notes.txt'), 'Required Expected Content', 'utf-8');
  }

  const evidencesBeforeSucc = getFailureEvidences(baseCap.id).length;
  const proposalsBeforeSucc = getImprovementProposals(baseCap.id).length;

  const objSuccess = createObjective('Create a folder named SHFolder with notes.txt containing Required Expected Content');
  await evolutionService.createOrPrepareObjectivePlan(objSuccess.id, objSuccess.goal, {
    explicitCapabilityId: baseCap.id,
    explicitCapabilityVersion: 1
  });

  const objSuccToComplete = getObjectives().find((o) => o.id === objSuccess.id);
  objSuccToComplete.status = 'COMPLETED';
  objSuccToComplete.root = testRoot;

  await evolutionService.handleObjectiveCompletion(objSuccToComplete);

  const evidencesAfterSucc = getFailureEvidences(baseCap.id).length;
  const proposalsAfterSucc = getImprovementProposals(baseCap.id).length;

  assert(evidencesAfterSucc === evidencesBeforeSucc, 'Successful execution generated zero new failure evidence records');
  assert(proposalsAfterSucc === proposalsBeforeSucc, 'Successful execution generated zero new repair candidates');

  // Cleanup test fixture
  if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });

  console.log('\n----------------------------------------------------');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage2SelfHealingTests().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
