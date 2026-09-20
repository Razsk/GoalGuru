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

    // 1. Create a goal manually
    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Build Web App',
      status: 'in_progress',
    });

    expect(repo.getStateVersion(ws.id)).toBe(1);

    // 2. Apply proposal with 2 new actions and 1 dependency
    const mutations: Mutation[] = [
      {
        type: 'create_node',
        nodeId: 'act_101',
        nodeType: 'action',
        parentId: goal.id,
        title: 'Task 1',
      },
      {
        type: 'create_node',
        nodeId: 'act_102',
        nodeType: 'action',
        parentId: goal.id,
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
    expect(nodes).toHaveLength(3); // Goal + 2 Actions

    const deps = repo.listDependencies(ws.id);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ fromNodeId: 'act_102', toNodeId: 'act_101' });

    // 3. Test Undo
    const undoResult = repo.undoLastProposal(ws.id);
    expect(undoResult.success).toBe(true);

    const nodesAfterUndo = repo.listNodes(ws.id);
    expect(nodesAfterUndo).toHaveLength(1);
    expect(nodesAfterUndo[0].id).toBe(goal.id);

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

    const action = repo.createNode({
      workspaceId: ws.id,
      type: 'action',
      parentId: goal.id,
      title: 'Original Title',
      status: 'todo',
    });

    // Assume proposal was exported at stateVersion 2
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

    // 1. Create a goal with an action and sub-action
    const goal = repo.createNode({
      workspaceId: ws.id,
      type: 'goal',
      parentId: null,
      title: 'Complete Project Alpha',
      status: 'in_progress',
    });

    const action = repo.createNode({
      workspaceId: ws.id,
      type: 'action',
      parentId: goal.id,
      title: 'Finalize QA',
      status: 'done',
    });

    const subAction = repo.createNode({
      workspaceId: ws.id,
      type: 'sub_action',
      parentId: action.id,
      title: 'Sign off',
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
    const archivedAction = repo.getNode(action.id);
    const archivedSubAction = repo.getNode(subAction.id);

    expect(archivedGoal?.archivedAt).toBeTruthy();
    expect(archivedAction?.archivedAt).toBeTruthy();
    expect(archivedSubAction?.archivedAt).toBeTruthy();

    // Unarchive goal
    repo.unarchiveGoal(goal.id);
    expect(repo.getStateVersion(ws.id)).toBe(vBefore + 2);

    const restoredGoal = repo.getNode(goal.id);
    const restoredAction = repo.getNode(action.id);
    const restoredSubAction = repo.getNode(subAction.id);

    expect(restoredGoal?.archivedAt).toBeNull();
    expect(restoredAction?.archivedAt).toBeNull();
    expect(restoredSubAction?.archivedAt).toBeNull();
  });
});
