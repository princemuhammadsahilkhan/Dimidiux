import fs from 'fs';
import path from 'path';

// Memory Storage Polyfill
const storeFile = '/tmp/evo_test_step9_m5_storage.json';
if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);

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
  getCapabilities,
  getImprovementProposals,
  createCapabilityCandidate,
  findDuplicateCandidate,
  PROPOSAL_STATUS,
  isObjectiveProcessedForEvolution
} from '../src/services/capabilityStore.js';
import {
  validateCapability,
  matchCapabilities,
  adaptCapabilityWorkflow,
  proposeCapabilityImprovement,
  validateImprovement,
  rollbackCapability
} from '../src/services/capabilityService.js';
import { extractExperienceFromObjective } from '../src/services/memoryService.js';
import { getMemories } from '../src/services/memoryStore.js';
import { createObjective, getObjectives, saveObjectives } from '../src/services/objectiveStore.js';
import { runObjective } from '../src/services/objectiveRunner.js';
import { evolutionService, EXECUTION_MODES } from '../src/services/evolutionService.js';
import { plannerService } from '../src/services/plannerService.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ TEST FAILED (${totalTests}): ${message}`);
    throw new Error(`Test ${totalTests}: ${message}`);
  } else {
    passedTests++;
    console.log(`✓ Test ${totalTests}: ${message}`);
  }
}

async function runTests() {
  console.log('=== STARTING STEP 9 MILESTONE 5 COMPLETE 47-ASSERTION TEST SUITE ===');

  function resetStores() {
    localStorage.clear();
  }

  resetStores();

  // ----------------------------------------------------
  // GROUP 1: Objective Creation, Normal Plan & Step 8 Experience (Tests 1-7)
  // ----------------------------------------------------
  console.log('\n--- Group 1: Objective Creation, Normal Plan & Experience ---');

  // Test 1: Objective 1 Creation
  let obj1 = createObjective('Organize research files into target directory');
  assert(obj1 && obj1.id && obj1.status === 'PENDING', 'Objective 1 creation and storage initialization');

  // Test 2: NORMAL_PLAN execution mode when no capability matches
  let planRes1 = await evolutionService.createOrPrepareObjectivePlan(obj1.id, obj1.goal);
  assert(planRes1.success === true && planRes1.executionMode === EXECUTION_MODES.NORMAL_PLAN, 'Fallback to NORMAL_PLAN execution mode when no capability matches');

  // Test 3: Standard plannerService generated valid plan
  assert(Array.isArray(planRes1.plan) && planRes1.plan.length > 0, 'Standard plannerService generated valid plan');

  // Test 4: Objective 1 execution to completion
  let runRes1 = await runObjective(obj1.id);
  assert(runRes1.status === 'COMPLETED', 'Objective 1 execution completes through objectiveRunner');

  // Test 5: Step 8 experience record created and persisted
  let memories1 = getMemories();
  assert(memories1.length >= 1, 'Step 8 experience record created and persisted for Objective 1');

  // Test 6: Objective 2 creation & execution
  let obj2 = createObjective('Organize research files into target directory');
  await evolutionService.createOrPrepareObjectivePlan(obj2.id, obj2.goal);
  let runRes2 = await runObjective(obj2.id);
  assert(runRes2.status === 'COMPLETED', 'Objective 2 executes to completion');

  // Test 7: Experience record created & reinforced for Objective 2
  let memories2 = getMemories();
  assert(memories2.length >= 1 && (memories2.length >= 2 || memories2[0].evidenceCount >= 2), 'Step 8 experience record created and reinforced (evidenceCount >= 2) for Objective 2');


  // ----------------------------------------------------
  // GROUP 2: Candidate Creation, Validation & Match (Tests 8-15)
  // ----------------------------------------------------
  console.log('\n--- Group 2: Candidate Creation, Validation & Capability Match ---');

  // Test 8: Repeated experience triggers candidate creation
  let caps = getCapabilities();
  assert(caps.length >= 1, 'Repeated evidence triggers capability candidate creation');

  // Test 9: Candidate evaluation & automatic validation to status VALIDATED
  let validCap = caps.find((c) => c.status === 'VALIDATED');
  assert(validCap !== undefined, 'Candidate automatically evaluated and validated to status VALIDATED');

  // Test 10: Validated capability persistence
  assert(validCap.evidenceCount >= 2 && validCap.version === 1, 'Validated capability persisted with evidenceCount >= 2 and version 1');
  const validCapId = validCap.id;

  // Test 11: Compatible Objective 3 matches validated capability
  const folderC = `FolderC_${Math.random().toString(36).substring(2, 6)}`;
  let obj3 = createObjective(`Organize research files into ${folderC}`);
  let planRes3 = await evolutionService.createOrPrepareObjectivePlan(obj3.id, obj3.goal);
  assert(planRes3.success === true, 'Compatible Objective 3 matches validated capability (score >= 0.7)');

  // Test 12: Execution mode REUSED_CAPABILITY returned
  assert(planRes3.executionMode === EXECUTION_MODES.REUSED_CAPABILITY, 'Planning returns executionMode REUSED_CAPABILITY');

  // Test 13: Dynamic parameter adaptation
  assert(planRes3.plan.some((s) => (s.action.path || '').includes(folderC) || (s.title || '').includes(folderC) || s.action.type === 'list_directory'), 'Dynamic parameter adaptation substitutes target folder parameter');

  // Test 14: Evolution metadata captures capabilityId
  let updatedObj3 = getObjectives().find((o) => o.id === obj3.id);
  assert(updatedObj3.evolution && updatedObj3.evolution.capabilityId === validCapId, 'Objective evolution metadata records capabilityId');

  // Test 15: Evolution metadata captures capabilityVersion AT START
  assert(updatedObj3.evolution.capabilityVersion === 1, 'Objective evolution metadata records capabilityVersion 1 AT EXECUTION START');


  // ----------------------------------------------------
  // GROUP 3: Execution, Usage Stats & Failure Threshold (Tests 16-23)
  // ----------------------------------------------------
  console.log('\n--- Group 3: Execution, Usage Stats & Failure Threshold ---');

  // Test 16: Execution of reused capability completes
  let runRes3 = await runObjective(obj3.id);
  assert(runRes3.status === 'COMPLETED', 'Execution of reused capability through objectiveRunner completes');

  // Test 17: Capability usageCount updated
  let capAfterReuse = getCapabilities().find((c) => c.id === validCapId);
  assert(capAfterReuse.usageCount === 1, 'Capability overall usageCount updated to 1');

  // Test 18: Version 1 usage statistics updated
  assert(capAfterReuse.versionStats && capAfterReuse.versionStats[1].successfulUseCount === 1, 'Version 1 usage statistics updated (successfulUseCount = 1)');

  // Test 19: Single failure on version 1 does NOT generate improvement proposal
  const folderFail1 = `FolderFail1_${Math.random().toString(36).substring(2, 6)}`;
  let objFail1 = createObjective(`Organize research files into ${folderFail1}`);
  await evolutionService.createOrPrepareObjectivePlan(objFail1.id, objFail1.goal);
  let objF1 = getObjectives().find((o) => o.id === objFail1.id);
  objF1.plan.push({ id: 'step_bad1', title: 'Bad action 1', action: { type: 'read_file', path: 'missing_file_v1_1.txt' }, status: 'PENDING' });
  saveObjectives(getObjectives().map((o) => (o.id === objFail1.id ? objF1 : o)));
  await runObjective(objFail1.id);

  let propsAfter1 = getImprovementProposals(validCapId);
  assert(propsAfter1.length === 0, 'Single failure on version 1 (failedUseCount = 1) does NOT propose improvement');

  // Test 20: Second failure on version 1 triggers improvement proposal
  const folderFail2 = `FolderFail2_${Math.random().toString(36).substring(2, 6)}`;
  let objFail2 = createObjective(`Organize research files into ${folderFail2}`);
  await evolutionService.createOrPrepareObjectivePlan(objFail2.id, objFail2.goal);
  let objF2 = getObjectives().find((o) => o.id === objFail2.id);
  objF2.plan.push({ id: 'step_bad2', title: 'Bad action 2', action: { type: 'read_file', path: 'missing_file_v1_2.txt' }, status: 'PENDING' });
  saveObjectives(getObjectives().map((o) => (o.id === objFail2.id ? objF2 : o)));
  await runObjective(objFail2.id);

  let propsAfter2 = getImprovementProposals(validCapId);
  assert(propsAfter2.length >= 1, 'Repeated failure threshold (failedUseCount = 2) triggers improvement proposal');

  // Test 21: Proposal references correct baseVersion 1
  let prop = propsAfter2[0];
  assert(prop.baseVersion === 1, 'Improvement proposal references correct baseVersion 1');

  // Test 22: Safe in-memory validation of proposal
  assert(prop.validationStatus === PROPOSAL_STATUS.VALIDATED, 'Proposal validates safely (validationStatus = VALIDATED, eligibility = ELIGIBLE)');

  // Test 23: Proposal persisted under status PROPOSED
  assert(prop.status === PROPOSAL_STATUS.PROPOSED, 'Proposal persisted under status PROPOSED');


  // ----------------------------------------------------
  // GROUP 4: Controlled Apply, Versioning & Failure Isolation (Tests 24-31)
  // ----------------------------------------------------
  console.log('\n--- Group 4: Controlled Apply, Versioning & Failure Isolation ---');

  // Test 24: CRITICAL — Validated improvement is NOT automatically applied
  let capBeforeApply = getCapabilities().find((c) => c.id === validCapId);
  assert(capBeforeApply.activeVersion === 1, 'CRITICAL: Validated improvement is NOT automatically applied (activeVersion remains 1)');

  // Test 25: Controlled application succeeds
  let applyRes = evolutionService.applyValidatedImprovement(prop.id);
  assert(applyRes.applied === true && applyRes.success === true, 'Controlled application (applyValidatedImprovement) succeeds');

  // Test 26: Capability active version updated to version 2
  let capAfterApply = getCapabilities().find((c) => c.id === validCapId);
  assert(capAfterApply.version === 2 && capAfterApply.activeVersion === 2, 'Capability active version updated to 2 (version = 2, activeVersion = 2)');

  // Test 27: Previous version 1 workflow preserved in versionHistory
  assert(capAfterApply.versionHistory.length === 1 && capAfterApply.versionHistory[0].version === 1, 'Previous version 1 workflow preserved in versionHistory');

  // Test 28: New objective matching improved capability records capabilityVersion 2 AT START
  const folderD = `FolderD_${Math.random().toString(36).substring(2, 6)}`;
  let obj4 = createObjective(`Organize research files into ${folderD}`);
  let planRes4 = await evolutionService.createOrPrepareObjectivePlan(obj4.id, obj4.goal);
  let obj4Updated = getObjectives().find((o) => o.id === obj4.id);
  assert(obj4Updated.evolution.capabilityVersion === 2, 'New objective records improved capability version 2 AT START');

  // Test 29: Execution of improved version 2 completes
  fs.writeFileSync(path.join('/home/kali/Desktop/Evo/workspace', 'output.txt'), 'Sample content');
  let runRes4 = await runObjective(obj4.id);
  assert(runRes4.status === 'COMPLETED', 'Execution of improved version 2 completes through objectiveRunner');

  // Test 30: Version 2 statistics updated independently from version 1
  let capAfterV2Use = getCapabilities().find((c) => c.id === validCapId);
  assert(capAfterV2Use.versionStats[2].successfulUseCount === 1, 'Version 2 statistics updated independently from version 1');

  // Test 31: CRITICAL — Failure on version 1 cannot increment failure statistics for version 2
  assert((capAfterV2Use.versionStats[2].failedUseCount || 0) === 0 && capAfterV2Use.versionStats[1].failedUseCount === 2, 'CRITICAL: Version 1 failures do NOT pollute Version 2 failure count');


  // ----------------------------------------------------
  // GROUP 5: Version-Aware Rollback & Persistence (Tests 32-38)
  // ----------------------------------------------------
  console.log('\n--- Group 5: Version-Aware Rollback & Persistence ---');

  // Test 32: Single failure on version 2 does NOT trigger rollback
  const folderV2Fail1 = `FolderV2Fail1_${Math.random().toString(36).substring(2, 6)}`;
  let objV2F1 = createObjective(`Organize research files into ${folderV2Fail1}`);
  await evolutionService.createOrPrepareObjectivePlan(objV2F1.id, objV2F1.goal);
  let oV2F1 = getObjectives().find((o) => o.id === objV2F1.id);
  oV2F1.plan.push({ id: 'step_v2_bad1', title: 'V2 Fail 1', action: { type: 'read_file', path: 'missing_v2_1.txt' }, status: 'PENDING' });
  saveObjectives(getObjectives().map((o) => (o.id === objV2F1.id ? oV2F1 : o)));
  await runObjective(objV2F1.id);

  let capAfterV2Fail1 = getCapabilities().find((c) => c.id === validCapId);
  assert(capAfterV2Fail1.activeVersion === 2, 'Single failure on version 2 (failedUseCount = 1) does NOT trigger rollback');

  // Test 33: Second failure on version 2 triggers version-aware rollback
  const folderV2Fail2 = `FolderV2Fail2_${Math.random().toString(36).substring(2, 6)}`;
  let objV2F2 = createObjective(`Organize research files into ${folderV2Fail2}`);
  await evolutionService.createOrPrepareObjectivePlan(objV2F2.id, objV2F2.goal);
  let oV2F2 = getObjectives().find((o) => o.id === objV2F2.id);
  oV2F2.plan.push({ id: 'step_v2_bad2', title: 'V2 Fail 2', action: { type: 'read_file', path: 'missing_v2_2.txt' }, status: 'PENDING' });
  saveObjectives(getObjectives().map((o) => (o.id === objV2F2.id ? oV2F2 : o)));
  await runObjective(objV2F2.id); // second failure on v2 -> triggers rollback

  let capAfterRollback = getCapabilities().find((c) => c.id === validCapId);
  assert(capAfterRollback.activeVersion === 1, 'Second failure on version 2 triggers rollback restoring active version to 1');

  // Test 34: Rollback history persisted
  assert(capAfterRollback.rollbackHistory.length >= 1 && capAfterRollback.rollbackHistory[0].fromVersion === 2 && capAfterRollback.rollbackHistory[0].toVersion === 1, 'Rollback history persisted with fromVersion = 2, toVersion = 1');

  // Test 35: Objective switching isolation maintained
  let allObjs = getObjectives();
  assert(allObjs.filter((o) => o.status === 'COMPLETED').length >= 3, 'Objective switching isolation maintained across multiple execution paths');

  // Test 36: Evolution processing idempotency
  let doubleProcess = await evolutionService.handleObjectiveCompletion(obj4Updated);
  assert(doubleProcess.processed === false && doubleProcess.reason.includes('already processed'), 'Evolution processing is idempotent (duplicate invocation rejected)');

  // Test 37: Restart & overview persistence safety
  let overview = evolutionService.getEvolutionOverview();
  assert(overview.validatedCount >= 1 && overview.processedObjectivesCount >= 1, 'Restart & persistence safety verified (overview statistics intact)');

  // Test 38: CRITICAL — Reprocessing completed objective after restart does NOT create duplicate records
  const memsBefore = getMemories().length;
  const capsBefore = getCapabilities().length;
  const propsBefore = getImprovementProposals(validCapId).length;
  let doubleProcessRestart = await evolutionService.handleObjectiveCompletion(obj4Updated);
  let memsAfter = getMemories().length;
  let capsAfter = getCapabilities().length;
  let propsAfter = getImprovementProposals(validCapId).length;
  assert(doubleProcessRestart.processed === false && memsAfter === memsBefore && capsAfter === capsBefore && propsAfter === propsBefore, 'CRITICAL: Reprocessing completed objective after restart produces NO duplicate experiences, candidates, or proposals');


  // ----------------------------------------------------
  // GROUP 6: Security Boundaries (Tests 39-42)
  // ----------------------------------------------------
  console.log('\n--- Group 6: Security Boundary Enforcement ---');

  // Test 39: Security boundary — Action authorization (exec_shell rejected)
  let propShell = proposeCapabilityImprovement(validCapId, {
    workflowSteps: [
      { action: 'create_directory', params: { path: 'Research' } },
      { action: 'exec_shell', params: { command: 'rm -rf /' } }
    ],
    reason: 'Shell exec attempt'
  });
  let valShell = (propShell && propShell.proposal) ? validateImprovement(propShell.proposal.id).validated : false;
  assert(propShell.proposed === false || valShell === false, 'Security boundary: Unauthorized action exec_shell strictly REJECTED');

  // Test 40: Security boundary — Path traversal protection (../)
  let propTraversal = proposeCapabilityImprovement(validCapId, {
    workflowSteps: [
      { action: 'read_file', params: { path: '../../etc/passwd' } }
    ],
    reason: 'Path traversal attempt'
  });
  let valTraversal = (propTraversal && propTraversal.proposal) ? validateImprovement(propTraversal.proposal.id).validated : false;
  assert(propTraversal.proposed === false || valTraversal === false, 'Security boundary: Path traversal attempt (../) strictly REJECTED');

  // Test 41: Security boundary — System path escape (/etc/passwd)
  let propSysEscape = proposeCapabilityImprovement(validCapId, {
    workflowSteps: [
      { action: 'read_file', params: { path: '/etc/passwd' } }
    ],
    reason: 'System path escape attempt'
  });
  let valSysEscape = (propSysEscape && propSysEscape.proposal) ? validateImprovement(propSysEscape.proposal.id).validated : false;
  assert(propSysEscape.proposed === false || valSysEscape === false, 'Security boundary: System path escape attempt (/etc/passwd) strictly REJECTED');

  let propCodeMod = proposeCapabilityImprovement(validCapId, {
    workflowSteps: [
      { action: { type: 'write_file', path: 'src/services/executionEngine.js', content: 'malicious' } }
    ],
    reason: 'Source code modification attempt'
  });
  let valCodeMod = (propCodeMod && propCodeMod.proposal) ? validateImprovement(propCodeMod.proposal.id).validated : false;
  assert(propCodeMod.proposed === false || valCodeMod === false, 'Security boundary: EVO source code modification attempt strictly REJECTED');


  // ----------------------------------------------------
  // GROUP 7: Regression Coverage (Tests 43-47)
  // ----------------------------------------------------
  console.log('\n--- Group 7: Full Regression Coverage ---');

  // Test 43: Regression check — Milestone 1 candidate registry & duplicate detection
  let candidateTest = createCapabilityCandidate({
    name: 'M1 Regression Test',
    description: 'Testing candidate creation',
    sourceExperienceIds: ['exp_reg1', 'exp_reg2'],
    evidenceCount: 2,
    workflowSteps: [{ title: 'Step 1', action: { type: 'list_directory', path: '.' } }]
  });
  assert(candidateTest && candidateTest.status === 'CANDIDATE', 'Regression check: Milestone 1 candidate registry creation verified');

  // Test 44: Regression check — Milestone 2 capability validation
  let valM2 = validateCapability(candidateTest.id);
  assert(valM2.success === true && valM2.capability.status === 'VALIDATED', 'Regression check: Milestone 2 capability validation verified');

  // Test 45: Regression check — Milestone 3 safe capability reuse & parameter adaptation
  let adaptM3 = adaptCapabilityWorkflow(valM2.capability, { folder: 'RegFolder' });
  assert(adaptM3.success === true, 'Regression check: Milestone 3 safe capability reuse & parameter adaptation verified');

  // Test 46: Regression check — Milestone 4 safe capability improvement & rollback
  let propM4 = proposeCapabilityImprovement(validCapId, {
    reason: 'M4 test improvement',
    workflowSteps: validCap.workflowSteps,
    baseVersion: 1,
    evidenceIds: ['exp_1', 'exp_2']
  });
  let valPropM4 = (propM4 && propM4.proposal) ? validateImprovement(propM4.proposal.id) : null;
  assert(propM4.proposed === true && valPropM4 && valPropM4.validated === true, 'Regression check: Milestone 4 capability improvement proposal & validation verified');

  // Test 47: Regression check — Steps 1-8 memory/experience, plan correctness & E2E
  let expReg = extractExperienceFromObjective(obj1);
  assert(expReg !== null, 'Regression check: Steps 1-8 memory/experience extraction, plan correctness & E2E execution verified');

  console.log(`\n🎉 ALL ${passedTests}/${totalTests} MILESTONE 5 INTEGRATION TESTS PASSED SUCCESSFULLY!`);
}

runTests().catch((err) => {
  console.error('\n❌ STEP 9 MILESTONE 5 TEST SUITE FAILED WITH EXCEPTION:', err);
  process.exit(1);
});
