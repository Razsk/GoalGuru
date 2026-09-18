import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { Repository } from '../../src/storage/repository.js';

describe('Fastify REST API & LLM Protocol Integration (Seam 5)', () => {
  let db: DatabaseSync;
  let repo: Repository;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    repo = new Repository(db);
    repo.initSchema();
    app = buildApp({ repo });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates workspace and lists graph with initial empty state', async () => {
    const wsRes = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
    });
    expect(wsRes.statusCode).toBe(200);
    const workspaces = wsRes.json();
    expect(workspaces).toHaveLength(1);
    const wsId = workspaces[0].id;

    const graphRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/graph`,
    });
    expect(graphRes.statusCode).toBe(200);
    expect(graphRes.json().nodes).toHaveLength(0);
    expect(graphRes.json().stateVersion).toBe(1);
  });

  it('runs complete clipboard round-trip: export -> parse proposal -> commit -> undo', async () => {
    // 1. Get default workspace
    const wsRes = await app.inject({ method: 'GET', url: '/api/workspaces' });
    const wsId = wsRes.json()[0].id;

    // 2. Create a top-level Goal
    const nodeRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/nodes`,
      payload: {
        type: 'goal',
        title: 'Launch Product',
        description: 'Launch version 1.0',
        status: 'in_progress',
      },
    });
    expect(nodeRes.statusCode).toBe(200);
    const goalId = nodeRes.json().id;

    // 3. Export Context for LLM
    const exportRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/export`,
      payload: {
        focusNodeId: goalId,
        requestMode: 'create_plan',
        userNote: 'Break this down into 2 key tasks',
      },
    });
    expect(exportRes.statusCode).toBe(200);
    const { prompt } = exportRes.json();
    expect(prompt).toContain('Launch Product');
    expect(prompt).toContain('=== BEGIN APPLICATION STATE');

    // 4. Simulate LLM response from clipboard
    const simulatedLLMResponse = `
Here is your breakdown:

\`\`\`goalguru-proposal
{
  "protocolVersion": "1.0",
  "stateVersion": 1,
  "advice": {
    "summary": "Generated 2 initial tasks"
  },
  "changeSet": [
    {
      "type": "create_node",
      "tempId": "temp:act-1",
      "nodeType": "action",
      "parentId": "${goalId}",
      "title": "Design Mockups"
    },
    {
      "type": "create_node",
      "tempId": "temp:act-2",
      "nodeType": "action",
      "parentId": "${goalId}",
      "title": "Build Frontend"
    },
    {
      "type": "add_dependency",
      "fromNodeId": "temp:act-2",
      "toNodeId": "temp:act-1"
    }
  ]
}
\`\`\`
Good luck!
`;

    // 5. Parse & Pre-Validate Proposal
    const parseRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/parse-proposal`,
      payload: { rawText: simulatedLLMResponse },
    });
    expect(parseRes.statusCode).toBe(200);
    const parsedData = parseRes.json();
    expect(parsedData.hasCollision).toBe(false);
    expect(parsedData.hasCycle).toBe(false);
    expect(parsedData.changeSet).toHaveLength(3);

    // 6. Commit Proposal
    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/commit-proposal`,
      payload: {
        baseStateVersion: 1,
        adviceSummary: parsedData.advice?.summary,
        selectedMutations: parsedData.changeSet,
      },
    });
    expect(commitRes.statusCode).toBe(200);
    expect(commitRes.json().success).toBe(true);

    // Verify graph updated
    const updatedGraphRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/graph`,
    });
    const graphData = updatedGraphRes.json();
    expect(graphData.nodes).toHaveLength(3); // 1 goal + 2 actions
    expect(graphData.dependencies).toHaveLength(1);

    // Dynamic readiness check: act-2 should be blocked by act-1
    const act2 = graphData.nodes.find((n: any) => n.title === 'Build Frontend');
    expect(graphData.readiness[act2.id].readiness).toBe('blocked');

    // 7. Undo
    const undoRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/undo`,
    });
    expect(undoRes.statusCode).toBe(200);
    expect(undoRes.json().success).toBe(true);

    // Verify graph reverted to 1 goal
    const revertedGraphRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/graph`,
    });
    expect(revertedGraphRes.json().nodes).toHaveLength(1);
    expect(revertedGraphRes.json().dependencies).toHaveLength(0);
  });

  it('successfully commits proposal containing multiple root goals without parentId', async () => {
    const wsRes = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'Multi-Goal Test' },
    });
    const wsId = wsRes.json().id;

    const rawProposal = `
Here are 3 recommended goals:
\`\`\`goalguru-proposal
{
  "protocolVersion": "1.0",
  "stateVersion": 1,
  "advice": { "summary": "3 new high-level goals" },
  "changeSet": [
    { "type": "create_node", "tempId": "temp:g-1", "nodeType": "goal", "title": "Launch App" },
    { "type": "create_node", "tempId": "temp:g-2", "nodeType": "goal", "parentId": null, "title": "Run Marathon" },
    { "type": "create_node", "tempId": "temp:g-3", "nodeType": "goal", "title": "Write Book" }
  ]
}
\`\`\`
`;

    const parseRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/parse-proposal`,
      payload: { rawText: rawProposal },
    });
    expect(parseRes.statusCode).toBe(200);
    const parsedData = parseRes.json();
    expect(parsedData.changeSet).toHaveLength(3);

    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/commit-proposal`,
      payload: {
        baseStateVersion: 1,
        selectedMutations: parsedData.changeSet,
      },
    });
    expect(commitRes.statusCode).toBe(200);
    expect(commitRes.json().success).toBe(true);

    const graphRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/graph`,
    });
    expect(graphRes.json().nodes).toHaveLength(3);
  });

  it('handles and queries error telemetry via API (ADR 0019)', async () => {
    // 1. Post a client error
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/errors',
      payload: {
        category: 'client_ui_test',
        message: 'Test client exception',
        stack: 'Error: Test client exception at...',
      },
    });
    expect(postRes.statusCode).toBe(200);
    const errRecord = postRes.json();
    expect(errRecord.id).toMatch(/^err_/);
    expect(errRecord.status).toBe('unresolved');

    // 2. Query errors
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/errors?status=unresolved',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().errors.length).toBeGreaterThanOrEqual(1);

    // 3. Mark as resolved
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/errors/${errRecord.id}`,
      payload: { status: 'resolved' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().success).toBe(true);

    // 4. Clear all errors
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/errors',
    });
    expect(delRes.statusCode).toBe(200);

    const emptyList = await app.inject({
      method: 'GET',
      url: '/api/errors',
    });
    expect(emptyList.json().errors).toHaveLength(0);
  });

  it('auto-creates container Goal when proposal contains actions without a parent goal', async () => {
    const wsRes = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'Orphan Action Test' },
    });
    const wsId = wsRes.json().id;

    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/commit-proposal`,
      payload: {
        baseStateVersion: 1,
        adviceSummary: 'Build authentication service',
        selectedMutations: [
          { type: 'create_node', tempId: 'temp:act-1', nodeType: 'action', title: 'Write OAuth Handler' },
          { type: 'create_node', tempId: 'temp:act-2', nodeType: 'action', title: 'Add Session Cookie' },
        ],
      },
    });

    expect(commitRes.statusCode).toBe(200);
    expect(commitRes.json().success).toBe(true);

    const graphRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/graph`,
    });
    const nodes = graphRes.json().nodes;
    expect(nodes).toHaveLength(3); // 1 auto-goal + 2 actions
    const autoGoal = nodes.find((n: any) => n.type === 'goal');
    expect(autoGoal).toBeDefined();
    expect(autoGoal.title).toBe('Build authentication service');

    // Undo rollback
    const undoRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${wsId}/undo`,
    });
    expect(undoRes.statusCode).toBe(200);

    const emptyGraphRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/graph`,
    });
    expect(emptyGraphRes.json().nodes).toHaveLength(0);
  });
});
