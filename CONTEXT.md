# Goal Guru

An application that helps users define goals, build actionable execution plans, track progress, and collaborate with external LLMs via structured clipboard proposal exchanges while maintaining authoritative local state.

## Organization & Accounts

**User**:
An individual authenticated via Google OAuth who owns one or more isolated workspaces.
_Avoid_: Account, client, profile

**Workspace**:
An isolated environment owned by a User containing goals, plans, and history with no cross-workspace dependencies.
_Avoid_: Project, domain, vault

## Core Language

**Goal**:
A high-level desired outcome or objective that contains sub-goals, milestones, and actions.
_Avoid_: Project, epic, target

**Milestone**:
A significant checkpoint or target state within a goal that marks major progress or delivery.
_Avoid_: Phase, sprint, deliverable

**Action**:
An executable task or discrete step performed by the user to advance toward a goal. Can be recursively decomposed into sub-actions.
_Avoid_: Task, todo, ticket, item

**Sub-Action**:
An action nested within a parent action to decompose complex execution steps.
_Avoid_: Sub-task, nested task, child step

**Dependency**:
A directed relationship indicating that a node cannot proceed until another node is completed. Allowed between Actions and Milestones across goals.
_Avoid_: Prerequisite, blocker edge, link

**Evidence**:
Structured research notes, facts, constraints, or citations attached directly to a node rather than floating as independent graph nodes.
_Avoid_: Fact node, note node, attachment, knowledge item

## Proposal & Exchange

**Proposal**:
A structured set of suggested state changes and advisory feedback returned by the LLM.
_Avoid_: Patch, PR, diff, recommendation

**Change Set**:
A grouped collection of proposed node mutations within a proposal that can be granularly reviewed and accepted.
_Avoid_: Mutation batch, transaction, patchset

**Mutation**:
A single atomic graph operation (`create_node`, `update_node`, `update_status`, `delete_node`, `add_dependency`, `remove_dependency`, `add_evidence`) within a change set.
_Avoid_: Action, patch, delta, instruction

**Inverse Mutation**:
A compensating operation recorded when applying a mutation that allows an undo action to restore previous state.
_Avoid_: Rollback patch, compensation, revert delta

**Temporary Reference**:
A provisional identifier (e.g. `temp:action-1`) used by the LLM to cross-reference newly proposed nodes before permanent IDs are assigned by the application.
_Avoid_: Provisional ID, virtual ID, draft key

**Request Mode**:
A distinct interaction objective (e.g. `create_plan`, `report_progress`) that dictates the exported subgraph slice and prompt template.
_Avoid_: Prompt type, command, workflow, intent

**Subgraph Context**:
The minimal causal slice of the graph (selected node, ancestor spine, descendants, and active prerequisites) packaged for LLM exchange.
_Avoid_: Context window, prompt state, export payload

**Asymmetric Pruning**:
The technique of packaging high-fidelity detail for the focused node while collapsing ancestors, descendants, and dependencies into skeletal summaries to conserve context tokens.
_Avoid_: Token cutoff, compression, summarization

**Collision**:
A state divergence detected when an imported proposal modifies nodes that were altered locally since the proposal's export version.
_Avoid_: Merge conflict, race condition

**Cycle**:
An invalid circular dependency path between nodes (e.g. A → B → A) that violates Directed Acyclic Graph invariants.
_Avoid_: Loop, deadlock, recursive link

## Execution & Lifecycle

**Status**:
The stored execution intent of a node (`todo`, `in_progress`, `done`, `abandoned`).
_Avoid_: State, phase, lifecycle

**Readiness**:
The dynamically computed availability of a node based on its dependencies (`ready`, `blocked`).
_Avoid_: Blocked status, ready status

**Archive**:
A preserved collection of completed goals and their historical subtrees, removed from active execution and analytics.
_Avoid_: Trash, backlog, graveyard
