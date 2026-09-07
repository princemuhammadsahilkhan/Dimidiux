# EVO V1 Requirements Traceability & Status Matrix

| ID | Category | Requirement Description | Status | Implementation File(s) | Test / Verification File |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-01** | Objective | Create objective with goal text and unique ID | `COMPLETE` | `src/services/objectiveStore.js` | `scratch/test_step7.mjs` |
| **FR-02** | Objective | Status tracking: PLANNED, RUNNING, PAUSED, WAITING, COMPLETED, FAILED | `COMPLETE` | `src/services/objectiveStore.js` | `scratch/test_step7.mjs` |
| **FR-03** | Planning | Deterministic goal parsing & multi-step plan generation | `COMPLETE` | `src/services/plannerService.js` | `scratch/test_plan_correctness.mjs` |
| **FR-04** | Planning | Plan validation & structural integrity check | `COMPLETE` | `src/services/plannerService.js` | `scratch/test_plan_correctness.mjs` |
| **FR-05** | Execution | Step-by-step execution through ObjectiveRunner & ExecutionEngine | `COMPLETE` | `src/services/objectiveRunner.js`, `executionEngine.js` | `scratch/test_e2e_smoke.mjs` |
| **FR-06** | Execution | Verification of step outcome before marking step COMPLETED | `COMPLETE` | `src/services/executionEngine.js` | `scratch/test_e2e_smoke.mjs` |
| **FR-07** | Safety | Pre-execution state backup & transaction rollback on failure | `COMPLETE` | `src/services/transactionStore.js`, `executionEngine.js` | `scratch/test_store.mjs` |
| **FR-08** | Safety | Overwrite confirmation required before mutating existing files | `COMPLETE` | `src/services/objectiveRunner.js`, `executionEngine.js` | `scratch/test_step7.mjs` |
| **FR-09** | Control | Pause execution gracefully after current step completes | `COMPLETE` | `src/services/objectiveRunner.js` | `scratch/test_e2e_smoke.mjs` |
| **FR-10** | Control | Resume execution from last pending step without repeating completed steps | `COMPLETE` | `src/services/objectiveRunner.js` | `scratch/test_e2e_smoke.mjs` |
| **FR-11** | Control | Retry planning and retry execution on failed objectives | `COMPLETE` | `src/services/evoApi.js` | `scratch/test_e2e_smoke.mjs` |
| **FR-12** | Control | Objective cancellation | `COMPLETE` | `src/services/objectiveStore.js` | `scratch/test_step7.mjs` |
| **FR-13** | Budgets | Enforce explicit per-objective budgets: duration, action count, retries | `COMPLETE` | `src/services/objectiveBudgetService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-14** | Budgets | Factual state/result on budget violation | `COMPLETE` | `src/services/objectiveBudgetService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-15** | Tools | Complete safe filesystem tools: list, search, read, write, create, copy, move, rename | `COMPLETE` | `src/services/filesystemTool.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-16** | Tools | System tools: time (`get_time`), basic system info (`get_system_info`) | `COMPLETE` | `src/services/systemTool.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-17** | Tools | Constrained command runner with allowlisting, typed args, timeouts | `COMPLETE` | `src/services/systemTool.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-18** | Audit | Tool auditability: record inputs, input hash, timestamps, outcome, verification | `COMPLETE` | `src/services/actionEventStore.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-19** | Sandbox | Workspace sandboxing & absolute path scoping under `workspace/` | `COMPLETE` | `src/services/filesystemTool.js` | `scratch/test_step7.mjs` |
| **FR-20** | Sandbox | Path traversal protection (`../` or `..\` rejection) | `COMPLETE` | `src/services/filesystemTool.js` | `scratch/test_step7.mjs` |
| **FR-21** | Sandbox | System path escape prevention (`/etc/`, system root rejection) | `COMPLETE` | `src/services/filesystemTool.js` | `scratch/test_step7.mjs` |
| **FR-22** | Sandbox | Action allowlisting: reject unauthorized commands (shell, network, code eval) | `COMPLETE` | `src/services/capabilityService.js` | `scratch/test_step9_m2.mjs` |
| **FR-23** | User Safety | Overwrite confirmation boundary | `COMPLETE` | `src/services/executionEngine.js` | `scratch/test_step7.mjs` |
| **FR-24** | User Safety | Explicit confirmation payload validation | `COMPLETE` | `electron/main.js` | `scratch/test_step7.mjs` |
| **FR-25** | User Safety | Atomic step verification | `COMPLETE` | `src/services/executionEngine.js` | `scratch/test_e2e_smoke.mjs` |
| **FR-26** | User Safety | Immutable transaction logs | `COMPLETE` | `src/services/transactionStore.js` | `scratch/test_store.mjs` |
| **FR-27** | User Safety | Concurrency lock (single runner active per objective) | `COMPLETE` | `src/services/objectiveRunner.js` | `scratch/test_step7.mjs` |
| **FR-28** | Skill Factory | Candidate skill creation from repeated experience | `COMPLETE` | `src/services/capabilityStore.js` | `scratch/test_step9_m1.mjs` |
| **FR-29** | Skill Factory | In-memory dry-run candidate validation | `COMPLETE` | `src/services/capabilityService.js` | `scratch/test_step9_m2.mjs` |
| **FR-30** | Skill Factory | Candidate skill representation as workflow data outside trusted core | `COMPLETE` | `src/services/skillFactoryService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-31** | Skill Factory | Candidate tests & quality threshold evaluation | `COMPLETE` | `src/services/skillFactoryService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-32** | Skill Factory | Regression testing against previous successful behavior | `COMPLETE` | `src/services/skillFactoryService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-33** | Skill Factory | Version preservation & version history | `COMPLETE` | `src/services/capabilityService.js` | `scratch/test_step9_m4.mjs` |
| **FR-34** | Skill Factory | Controlled promotion (PROPOSED -> VALIDATED -> CONTROLLED APPLY) | `COMPLETE` | `src/services/evolutionService.js` | `scratch/test_step9_m5.mjs` |
| **FR-35** | Skill Factory | Version-aware rollback on repeated failures | `COMPLETE` | `src/services/capabilityService.js` | `scratch/test_step9_m4.mjs` |
| **FR-36** | Background | Bounded scheduler for background-eligible objectives | `COMPLETE` | `src/services/backgroundSchedulerService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-37** | Background | Explicit user authorization required for background execution | `COMPLETE` | `src/services/backgroundSchedulerService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-38** | Background | Persistent scheduler state & startup recovery | `COMPLETE` | `src/services/backgroundSchedulerService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-39** | Background | Background execution time & resource limits | `COMPLETE` | `src/services/backgroundSchedulerService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-40** | Background | Silence boundary: Unauthorized background defaults to WAITING | `COMPLETE` | `src/services/backgroundSchedulerService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-41** | Event Log | Persistent event timeline (`ActionEvent` model) | `COMPLETE` | `src/services/actionEventStore.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-42** | Event Log | Reconstructable objective execution history | `COMPLETE` | `src/services/actionEventStore.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-43** | Event Log | Sensitive parameter redaction and input hashing | `COMPLETE` | `src/services/actionEventStore.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-44** | Event Log | Log tool actions, verification outcomes, failures, recovery | `COMPLETE` | `src/services/actionEventStore.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-45** | Event Log | Log capability/version used, autonomy mode, human interventions | `COMPLETE` | `src/services/actionEventStore.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-46** | Summary | Factual human-readable completion summary | `COMPLETE` | `src/services/objectiveSummaryService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-47** | Metrics | Real performance & resource usage measurements | `COMPLETE` | `src/services/objectiveSummaryService.js` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-48** | Reliability | Failure injection fixtures for reliability testing | `COMPLETE` | `scratch/test_step10_v1_requirements.mjs` | `scratch/test_step10_v1_requirements.mjs` |
| **FR-49** | UI / IPC | IPC input validation & presentation-only renderer | `COMPLETE` | `electron/main.js`, `electron/preload.js` | `scratch/test_step7.mjs` |

---

## Non-Functional & Safety Requirements Matrix

| Requirement | Description | Status | Implementation File(s) |
| :--- | :--- | :--- | :--- |
| **NFR-01** | Local-First Architecture (zero external cloud/AI runtime dependencies) | `COMPLETE` | All `src/services/` files |
| **NFR-02** | Zero Unrestricted Computer Control (no arbitrary shell, network, browser) | `COMPLETE` | `src/services/capabilityService.js`, `systemTool.js` |
| **NFR-03** | Trusted Core Source Code Isolation (skills are JSON workflow data, core untouched) | `COMPLETE` | `src/services/skillFactoryService.js` |
| **NFR-04** | Deterministic & Testable Lifecycle | `COMPLETE` | All test scripts `scratch/test_*.mjs` |
| **NFR-05** | Memory & Capability Privacy (sensitive data filter) | `COMPLETE` | `src/services/memoryService.js` |

---

## Acceptance Tests Matrix (AT-01 through AT-12)

| Test ID | Description | Status | Verification Test Script |
| :--- | :--- | :--- | :--- |
| **AT-01** | Simple objective (Create file and verify) | `COMPLETE` | `scratch/test_e2e_smoke.mjs` |
| **AT-02** | Multi-step objective (Create folder, write file, read & verify) | `COMPLETE` | `scratch/test_plan_correctness.mjs` |
| **AT-03** | Restart recovery (Interrupted IN_PROGRESS recovered to PAUSED) | `COMPLETE` | `scratch/test_step7.mjs` |
| **AT-04** | Failure recovery (Failed step halts execution; retry resumes PENDING) | `COMPLETE` | `scratch/test_e2e_smoke.mjs` |
| **AT-05** | Permission boundary (Path traversal `../` and system escape rejected) | `COMPLETE` | `scratch/test_step7.mjs`, `scratch/test_step9_m2.mjs` |
| **AT-06** | Memory & Capability reuse (Repeated experience matches validated capability) | `COMPLETE` | `scratch/test_step9_m3.mjs`, `scratch/test_step8.mjs` |
| **AT-07** | Skill generation (Candidate created, validated, versioned v1->v2 safely) | `COMPLETE` | `scratch/test_step9_m4.mjs` |
| **AT-08** | Sandbox safety (All file mutations scoped within workspace sandbox) | `COMPLETE` | `scratch/test_step7.mjs` |
| **AT-09** | Regression (Previous successful capability behavior preserved across versions) | `COMPLETE` | `scratch/test_step9_m4.mjs`, `scratch/test_step9_m5.mjs` |
| **AT-10** | Background objective (Bounded background execution with explicit authorization) | `COMPLETE` | `scratch/test_step10_v1_requirements.mjs` |
| **AT-11** | Silence boundary (Unauthorized background task transitions to WAITING) | `COMPLETE` | `scratch/test_step10_v1_requirements.mjs` |
| **AT-12** | Auditability (Every tool call logged in event timeline with inputs/outcomes) | `COMPLETE` | `scratch/test_step10_v1_requirements.mjs` |
