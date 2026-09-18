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

    const action = repo.createNode({
      workspaceId: ws.id,
      type: 'action',
      parentId: null,
      title: 'Original Title',
      status: 'todo',
    });

    // Assume proposal was exported at stateVersion 1
    const baseVersion = repo.getStateVersion(ws.id);

    // User modifies action locally
    repo.updateNode(action.id, { title: 'User Updated Title Locally' });
    expect(repo.getStateVersion(ws.id)).toBe(2);

    // Proposal tries to update the same action based on baseVersion 1
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
});
