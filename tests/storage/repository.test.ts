import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../../src/storage/repository.js';
import { Mutation } from '../../src/protocol/types.js';

describe('SQLite Repository & Scoping (ADR 0010 & ADR 0018)', () => {
  let db: DatabaseSync;
  let repo: Repository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    repo = new Repository(db);
    repo.initSchema();
  });

  it('creates user and isolated workspace', () => {
    const user = repo.ensureUser({
      id: 'google_123',
      email: 'user@example.com',
      displayName: 'Jane Doe',
    });

    const ws = repo.createWorkspace(user.id, 'My Launch Workspace');
    expect(ws.id).toMatch(/^ws_/);
    expect(ws.userId).toBe('google_123');
    expect(ws.name).toBe('My Launch Workspace');

    const workspaces = repo.listWorkspaces(user.id);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].id).toBe(ws.id);
  });

  it('applies a proposal change set atomically and computes inverse mutations (ADR 0016)', () => {
    const user = repo.ensureUser({ id: 'u1', email: 'u1@test.com', displayName: 'U1' });
    const ws = repo.createWorkspace(user.id, 'WS 1');

    // 1. Create a goal and milestone manually
    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Build Web App',
      status: 'in_progress',
    });

    const milestone = repo.createNode({
      workspaceId: ws.id,
      type: 'milestone',
      parentId: goal.id,
      title: 'Phase 1 MVP',
      status: 'in_progress',
    });

    expect(repo.getStateVersion(ws.id)).toBe(1);

    // 2. Apply proposal with 2 new actions and 1 dependency
    const mutations: Mutation[] = [
      {
        type: 'create_node',
        nodeId: 'act_101',
        nodeType: 'action',
        parentId: milestone.id,
        title: 'Task 1',
      },
      {
        type: 'create_node',
        nodeId: 'act_102',
        nodeType: 'action',
        parentId: milestone.id,
        title: 'Task 2',
      },
      {
        type: 'add_dependency',
        fromNodeId: 'act_102',
        toNodeId: 'act_101',
      },
    ];

    const result = repo.commitProposal({
      workspaceId: ws.id,
      baseStateVersion: 1,
      adviceSummary: 'Initial planning',
      mutations,
    });

    expect(result.newStateVersion).toBe(2);
    expect(repo.getStateVersion(ws.id)).toBe(2);

    const nodes = repo.listNodes(ws.id);
    expect(nodes).toHaveLength(4); // Goal + Milestone + 2 Actions

    const deps = repo.listDependencies(ws.id);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ fromNodeId: 'act_102', toNodeId: 'act_101' });

    // 3. Test Undo
    const undoResult = repo.undoLastProposal(ws.id);
    expect(undoResult.success).toBe(true);

    const nodesAfterUndo = repo.listNodes(ws.id);
    expect(nodesAfterUndo).toHaveLength(2); // Goal + Milestone

    const depsAfterUndo = repo.listDependencies(ws.id);
    expect(depsAfterUndo).toHaveLength(0);
  });

  it('detects touch-set collisions when proposal touches modified nodes (ADR 0004 & Collision Rules)', () => {
    const user = repo.ensureUser({ id: 'u2', email: 'u2@test.com', displayName: 'U2' });
    const ws = repo.createWorkspace(user.id, 'WS 2');

    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Main Goal',
    });

    const milestone = repo.createNode({
      workspaceId: ws.id,
      type: 'milestone',
      parentId: goal.id,
      title: 'Milestone 1',
    });

    const action = repo.createNode({
      workspaceId: ws.id,
      type: 'action',
      parentId: milestone.id,
      title: 'Original Title',
      status: 'todo',
    });

    // Assume proposal was exported at stateVersion 1
    const baseVersion = repo.getStateVersion(ws.id);

    // User modifies action locally
    repo.updateNode(action.id, { title: 'User Updated Title Locally' });
    expect(repo.getStateVersion(ws.id)).toBe(2);

    // Proposal tries to update the same action based on baseVersion
    const proposalMutations: Mutation[] = [
      {
        type: 'update_node',
        nodeId: action.id,
        title: 'LLM Proposed Title',
      },
    ];

    const collision = repo.checkCollisions(ws.id, baseVersion, proposalMutations);
    expect(collision.hasCollision).toBe(true);
    expect(collision.collidingNodeIds).toContain(action.id);
  });

  it('enforces hierarchy rules and rejects invalid parents', () => {
    const user = repo.ensureUser({ id: 'u3', email: 'u3@test.com', displayName: 'U3' });
    const ws = repo.createWorkspace(user.id, 'WS 3');

    // Action cannot be top-level root
    expect(() =>
      repo.createNode({
        workspaceId: ws.id,
        type: 'action',
        parentId: null,
        title: 'Invalid Root Action',
      })
    ).toThrow(/Invalid hierarchy/);

    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Valid Goal',
    });

    // Action cannot be child of Goal directly without Milestone
    expect(() =>
      repo.createNode({
        workspaceId: ws.id,
        type: 'action',
        parentId: goal.id,
        title: 'Invalid Direct Action',
      })
    ).toThrow(/Invalid hierarchy/);
  });

  it('supports undoing added evidence (ADR 0016)', () => {
    const user = repo.ensureUser({ id: 'u4', email: 'u4@test.com', displayName: 'U4' });
    const ws = repo.createWorkspace(user.id, 'WS 4');

    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Research Goal',
    });

    const mutations: Mutation[] = [
      {
        type: 'add_evidence',
        evidenceId: 'ev_test1',
        nodeId: goal.id,
        content: 'Candidate technology: SQLite',
      },
    ];

    repo.commitProposal({
      workspaceId: ws.id,
      baseStateVersion: 1,
      mutations,
    });

    const nodeWithEv = repo.getNode(goal.id);
    expect(nodeWithEv?.evidence).toHaveLength(1);

    // Undo should remove the evidence
    repo.undoLastProposal(ws.id);

    const nodeAfterUndo = repo.getNode(goal.id);
    expect(nodeAfterUndo?.evidence).toHaveLength(0);
  });

  it('records, queries, and updates error telemetry records (ADR 0019)', () => {
    const err1 = repo.logError({
      source: 'server',
      category: 'proposal_commit',
      message: 'Cannot read properties of undefined',
      stack: 'TypeError: Cannot read properties...',
      contextJson: JSON.stringify({ workspaceId: 'ws_test' }),
    });

    expect(err1.id).toMatch(/^err_/);
    expect(err1.status).toBe('unresolved');

    const err2 = repo.logError({
      source: 'client',
      category: 'window_onerror',
      message: 'Failed to fetch',
    });

    const unresolved = repo.listErrors({ status: 'unresolved' });
    expect(unresolved.length).toBeGreaterThanOrEqual(2);

    // Mark first error resolved
    const updated = repo.markErrorStatus(err1.id, 'resolved');
    expect(updated).toBe(true);

    const resolved = repo.listErrors({ status: 'resolved' });
    expect(resolved.some((e) => e.id === err1.id)).toBe(true);

    // Clear all
    repo.clearErrors();
    expect(repo.listErrors()).toHaveLength(0);
  });

  it('allows user to attach and remove evidence on nodes directly (ADR 0002)', () => {
    const user = repo.ensureUser({ id: 'u5', email: 'u5@test.com', displayName: 'U5' });
    const ws = repo.createWorkspace(user.id, 'WS 5');

    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Infrastructure Upgrade',
    });

    const v1 = repo.getStateVersion(ws.id);

    // Add user-authored evidence
    const ev = repo.addEvidence({
      nodeId: goal.id,
      content: 'Evaluated Cloudflare Workers vs Node.js for edge latency.',
      sourceTitle: 'Edge Computing Benchmark 2026',
      sourceUrl: 'https://example.com/benchmark',
      confidence: 'high',
      addedBy: 'user',
    });

    expect(ev.id).toMatch(/^ev_/);
    expect(ev.content).toBe('Evaluated Cloudflare Workers vs Node.js for edge latency.');
    expect(ev.addedBy).toBe('user');
    expect(ev.confidence).toBe('high');
    expect(ev.sourceUrl).toBe('https://example.com/benchmark');

    // State version incremented
    expect(repo.getStateVersion(ws.id)).toBe(v1 + 1);

    // Verify in getNode and listNodes
    const fetchedNode = repo.getNode(goal.id);
    expect(fetchedNode?.evidence).toHaveLength(1);
    expect(fetchedNode?.evidence[0].id).toBe(ev.id);

    const allNodes = repo.listNodes(ws.id);
    expect(allNodes[0].evidence).toHaveLength(1);
    expect(allNodes[0].evidence[0].id).toBe(ev.id);

    // Remove evidence
    const removed = repo.removeEvidence(ev.id);
    expect(removed).toBe(true);
    expect(repo.getStateVersion(ws.id)).toBe(v1 + 2);

    const nodeAfterRemove = repo.getNode(goal.id);
    expect(nodeAfterRemove?.evidence).toHaveLength(0);
  });

  it('archives a completed goal and all its descendants, and unarchives successfully', () => {
    const user = repo.ensureUser({ id: 'u1', email: 'u1@test.com', displayName: 'U1' });
    const ws = repo.createWorkspace(user.id, 'WS 1');

    // 1. Create a goal with a milestone and action
    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Complete Project Alpha',
      status: 'in_progress',
    });

    const milestone = repo.createNode({
      workspaceId: ws.id,
      type: 'milestone',
      parentId: goal.id,
      title: 'Milestone Alpha',
      status: 'todo',
    });

    const action = repo.createNode({
      workspaceId: ws.id,
      type: 'action',
      parentId: milestone.id,
      title: 'Finalize QA',
      status: 'done',
    });

    // Cannot archive an incomplete goal
    expect(() => repo.archiveGoal(goal.id)).toThrow(/Only completed goals/);

    // Mark goal done
    repo.updateNode(goal.id, { status: 'done' });
    const vBefore = repo.getStateVersion(ws.id);

    // Archive completed goal
    repo.archiveGoal(goal.id);
    expect(repo.getStateVersion(ws.id)).toBe(vBefore + 1);

    const archivedGoal = repo.getNode(goal.id);
    const archivedMilestone = repo.getNode(milestone.id);
    const archivedAction = repo.getNode(action.id);

    expect(archivedGoal?.archivedAt).toBeTruthy();
    expect(archivedMilestone?.archivedAt).toBeTruthy();
    expect(archivedAction?.archivedAt).toBeTruthy();

    // Unarchive goal
    repo.unarchiveGoal(goal.id);
    expect(repo.getStateVersion(ws.id)).toBe(vBefore + 2);

    const restoredGoal = repo.getNode(goal.id);
    const restoredMilestone = repo.getNode(milestone.id);
    const restoredAction = repo.getNode(action.id);

    expect(restoredGoal?.archivedAt).toBeNull();
    expect(restoredMilestone?.archivedAt).toBeNull();
    expect(restoredAction?.archivedAt).toBeNull();
  });

  it('cascades deletion from milestone to all its child actions', () => {
    const user = repo.ensureUser({ id: 'u_casc', email: 'c@test.com', displayName: 'Casc' });
    const ws = repo.createWorkspace(user.id, 'WS Casc');

    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Goal',
    });

    const ms = repo.createNode({
      workspaceId: ws.id,
      type: 'milestone',
      parentId: goal.id,
      title: 'Milestone to delete',
    });

    const act1 = repo.createNode({
      workspaceId: ws.id,
      type: 'action',
      parentId: ms.id,
      title: 'Action 1',
    });

    const act2 = repo.createNode({
      workspaceId: ws.id,
      type: 'action',
      parentId: ms.id,
      title: 'Action 2',
    });

    expect(repo.listNodes(ws.id)).toHaveLength(4);

    repo.deleteNode(ms.id);

    const remaining = repo.listNodes(ws.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(goal.id);
    expect(repo.getNode(act1.id)).toBeNull();
    expect(repo.getNode(act2.id)).toBeNull();
  });

  it('migrates legacy sub_actions and loose actions to milestone architecture', () => {
    const legacyDb = new DatabaseSync(':memory:');
    const legacyRepo = new Repository(legacyDb);
    legacyRepo.initSchema();

    // Insert raw legacy rows simulating an older DB version
    const now = new Date().toISOString();
    legacyDb.prepare(`
      INSERT INTO users VALUES ('u_leg', 'leg@test.com', 'Leg', NULL, ?);
    `).run(now);
    legacyDb.prepare(`
      INSERT INTO workspaces VALUES ('ws_leg', 'u_leg', 'Legacy WS', 1, ?, ?);
    `).run(now, now);

    // Goal
    legacyDb.prepare(`
      INSERT INTO nodes (id, workspace_id, type, parent_id, title, status, version, created_at, updated_at)
      VALUES ('g_leg', 'ws_leg', 'goal', NULL, 'Legacy Goal', 'todo', 1, ?, ?);
    `).run(now, now);

    // Parent action with sub-actions
    legacyDb.prepare(`
      INSERT INTO nodes (id, workspace_id, type, parent_id, title, status, version, created_at, updated_at)
      VALUES ('act_parent', 'ws_leg', 'action', 'g_leg', 'Parent Task', 'in_progress', 1, ?, ?);
    `).run(now, now);

    // Sub-action under parent action
    legacyDb.prepare(`
      INSERT INTO nodes (id, workspace_id, type, parent_id, title, status, version, created_at, updated_at)
      VALUES ('sub_1', 'ws_leg', 'sub_action', 'act_parent', 'Child Step', 'done', 1, ?, ?);
    `).run(now, now);

    // Re-run initSchema() to trigger migration
    legacyRepo.initSchema();

    // Verify 'act_parent' was promoted to 'milestone'
    const parentNode = legacyRepo.getNode('act_parent');
    expect(parentNode?.type).toBe('milestone');

    // Verify 'sub_1' was promoted to 'action'
    const childNode = legacyRepo.getNode('sub_1');
    expect(childNode?.type).toBe('action');
    expect(childNode?.parentId).toBe('act_parent');
  });
});
