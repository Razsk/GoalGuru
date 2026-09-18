# Request Modes Portfolio

Goal Guru interacts with an external LLM using structured request modes. Each mode corresponds to a specific interaction objective, exports a targeted subgraph context, and expects a conformant proposal envelope.

## MVP Implementation (The Core Execution Quad)

The following 4 modes are prioritized for the initial MVP to cover the end-to-end planning and execution loop:

### 1. `create_plan`
* **Intent**: Decompose a newly defined Goal, Sub-Goal, or Milestone into an actionable hierarchy of Actions and Sub-Actions with explicit dependencies.
* **Context Exported**: Target Goal/Milestone, parent Goal context, and any existing peer milestones.
* **Expected Output**: Change Set containing `create_node` mutations for Actions (using `temp:act-N` IDs) and `add_dependency` links, plus high-level execution advice.

### 2. `task_assistance`
* **Intent**: Provide execution advice, step-by-step instructions, or technical research for a specific active Action.
* **Context Exported**: Target Action, its ancestor spine, attached evidence, and immediate prerequisite outputs.
* **Expected Output**: Structured `advice` (approach, best practices, pitfalls), with optional `add_evidence` mutations if external facts or citations were uncovered. Typically leaves graph structure unchanged.

### 3. `report_progress`
* **Intent**: Ingest the user's free-form progress update or raw working notes, interpret what was accomplished, and map them to graph changes.
* **Context Exported**: Currently active / in-progress Actions and direct parents.
* **Expected Output**: Change Set containing `update_status` mutations (marking finished actions `done`), `add_evidence` for recorded notes/outcomes, and `create_node` for any newly discovered follow-up tasks.

### 4. `replan`
* **Intent**: Restructure the remaining open plan when a blocker is encountered, milestones are delayed, or scope/assumptions change.
* **Context Exported**: Unfinished subtree around the bottleneck, blocked nodes, and unmet dependencies.
* **Expected Output**: Change Set modifying existing actions, removing stale dependencies, creating alternative action paths, and updating plan milestones.

---

## Complete Request Modes Catalog (Phased Roadmap)

The remaining 8 modes extend Goal Guru's analytical and advisory capabilities and will be implemented incrementally:

### 5. `goal_definition`
* **Intent**: Help the user articulate, clarify, and sharpen a vague or unformed goal, identifying target outcomes, boundaries, and success criteria before planning begins.
* **Context Exported**: Top-level Goal stub and any user background notes.
* **Expected Output**: Proposed refinements to the Goal title, description, success metrics, and high-level milestone suggestions.

### 6. `research`
* **Intent**: Conduct structured exploration of options, technologies, constraints, or best practices relevant to a Goal or Action.
* **Context Exported**: Target node and specific research query.
* **Expected Output**: Structured `advice` summarizing findings, accompanied by a collection of proposed `add_evidence` items (with sources, retrieval dates, and confidence ratings).

### 7. `plan_refinement`
* **Intent**: Fine-tune an existing plan by sharpening action scopes, estimating effort/complexity, or reordering execution sequences without a full replan.
* **Context Exported**: Focused milestone or action branch.
* **Expected Output**: Mutations updating descriptions, acceptance criteria, or reordering dependencies.

### 8. `dependency_analysis`
* **Intent**: Audit the dependency graph of a Goal to detect missing prerequisites, implicit assumptions, circular dependencies, or bottleneck tasks on the critical path.
* **Context Exported**: Full dependency graph of the target Goal.
* **Expected Output**: Diagnostic advice detailing risks, with proposed `add_dependency` or `remove_dependency` mutations to repair the DAG.

### 9. `next_action`
* **Intent**: Recommend the optimal next 1–3 actions for the user to execute right now based on dependency readiness, priority, and momentum.
* **Context Exported**: All `ready` actions across active goals.
* **Expected Output**: Prioritized recommendations in `advice` explaining why these tasks should be tackled first. Does not mutate state.

### 10. `blocker_analysis`
* **Intent**: Deep-dive into an active blocker preventing an Action from proceeding; brainstorm workarounds, unblocking steps, or escalation strategies.
* **Context Exported**: Blocked Action, its blocker notes, and blocking dependency.
* **Expected Output**: Actionable advice on resolving the impediment, plus proposed sub-actions to unblock the path.

### 11. `review`
* **Intent**: Periodic retrospective on overall goal health, pacing, risk accumulation, and alignment with original intent.
* **Context Exported**: Entire Goal tree with completed and remaining progress metrics.
* **Expected Output**: Comprehensive assessment in `advice` highlighting accomplishments, drift from original goals, and recommendations for the next cycle.

### 12. `completion_review`
* **Intent**: Audit whether a Goal or Milestone has met its definition of done before the user closes it out.
* **Context Exported**: Goal/Milestone, all child actions with actual outputs and evidence.
* **Expected Output**: Verification assessment checking all required deliverables against actual outcomes, advising whether to mark complete or addressing remaining gaps.
