import { describe, it, expect } from 'vitest';
import { extractProposalFromText, parseProposalEnvelope } from '../../src/protocol/parser.js';
import { resolveTemporaryIds, pruneDeselectedMutations, generateInverseMutations } from '../../src/protocol/changeset.js';
import { Mutation, ProposalEnvelope } from '../../src/protocol/types.js';
import { Node, Dependency } from '../../src/core/types.js';

describe('Proposal Envelope Extraction & Parsing (ADR 0007 & ADR 0008)', () => {
  it('extracts JSON payload from fenced codeblock with surrounding chat text', () => {
    const rawChat = `
I have analyzed your goal. Here is the revised execution plan:

\`\`\`goalguru-proposal
{
  "protocolVersion": "1.0",
  "stateVersion": 3,
  "advice": {
    "summary": "Break down the initial MVP actions",
    "critique": "Action 2 might require extra research",
    "nextSteps": "Focus on database setup first"
  },
  "changeSet": [
    {
      "type": "create_node",
      "tempId": "temp:act-1",
      "nodeType": "action",
      "parentId": "goal_1",
      "title": "Set up database"
    }
  ]
}
\`\`\`

Let me know if you approve this plan!
`;

    const extracted = extractProposalFromText(rawChat);
    expect(extracted).not.toBeNull();
    const parsed = parseProposalEnvelope(extracted!);
    expect(parsed.protocolVersion).toBe('1.0');
    expect(parsed.stateVersion).toBe(3);
    expect(parsed.advice?.summary).toBe('Break down the initial MVP actions');
    expect(parsed.changeSet).toHaveLength(1);
    expect(parsed.changeSet[0].type).toBe('create_node');
  });

  it('throws a descriptive error if codeblock or JSON is invalid', () => {
    expect(() => extractProposalFromText('No proposal here')).toThrow(/No goalguru-proposal codeblock found/);
    expect(() => parseProposalEnvelope('{ invalid json')).toThrow(/Invalid JSON/);
    expect(() => parseProposalEnvelope('{"stateVersion": 1}')).toThrow(/Missing or invalid protocolVersion/);
  });
});

describe('Temporary ID Resolution (ADR 0009)', () => {
  it('replaces temporary IDs with permanent prefixed NanoIDs across change set', () => {
    const mutations: Mutation[] = [
      {
        type: 'create_node',
        tempId: 'temp:act-1',
        nodeType: 'action',
        parentId: 'goal_1',
        title: 'Task 1',
      },
      {
        type: 'create_node',
        tempId: 'temp:act-2',
        nodeType: 'action',
        parentId: 'goal_1',
        title: 'Task 2',
      },
      {
        type: 'add_dependency',
        fromNodeId: 'temp:act-2', // act-2 depends on act-1
        toNodeId: 'temp:act-1',
      },
    ];

    const { resolvedMutations, idMap } = resolveTemporaryIds(mutations);

    const perm1 = idMap.get('temp:act-1')!;
    const perm2 = idMap.get('temp:act-2')!;

    expect(perm1).toMatch(/^act_[a-z0-9]+$/);
    expect(perm2).toMatch(/^act_[a-z0-9]+$/);
    expect(perm1).not.toBe(perm2);

    expect(resolvedMutations[0]).toMatchObject({
      type: 'create_node',
      nodeId: perm1,
      title: 'Task 1',
    });
    expect(resolvedMutations[2]).toMatchObject({
      type: 'add_dependency',
      fromNodeId: perm2,
      toNodeId: perm1,
    });
  });
});

describe('Cascading Deselection Pruning (ADR 0005)', () => {
  it('prunes child sub-actions when a parent action is deselected', () => {
    const mutations: Mutation[] = [
      {
        type: 'create_node',
        tempId: 'temp:act-1',
        nodeType: 'action',
        parentId: 'goal_1',
        title: 'Parent Task',
      },
      {
        type: 'create_node',
        tempId: 'temp:sub-1',
        nodeType: 'sub_action',
        parentId: 'temp:act-1',
        title: 'Child Subtask 1',
      },
      {
        type: 'create_node',
        tempId: 'temp:act-2',
        nodeType: 'action',
        parentId: 'goal_1',
        title: 'Independent Task',
      },
    ];

    // User unchecks temp:act-1 (only selects indices 1 and 2, but 1 is child of 0)
    // Selected IDs: ['temp:sub-1', 'temp:act-2'] -> temp:act-1 was deselected!
    const pruned = pruneDeselectedMutations(mutations, new Set(['temp:sub-1', 'temp:act-2']));

    // temp:sub-1 should be pruned because its parent temp:act-1 was deselected
    expect(pruned.map((m) => (m.type === 'create_node' ? m.tempId : ''))).toEqual(['temp:act-2']);
  });

  it('prunes dependencies when a dependent or dependency target node is deselected', () => {
    const mutations: Mutation[] = [
      {
        type: 'create_node',
        tempId: 'temp:act-1',
        nodeType: 'action',
        parentId: 'goal_1',
        title: 'Action 1',
      },
      {
        type: 'create_node',
        tempId: 'temp:act-2',
        nodeType: 'action',
        parentId: 'goal_1',
        title: 'Action 2',
      },
      {
        type: 'add_dependency',
        fromNodeId: 'temp:act-2',
        toNodeId: 'temp:act-1',
      },
    ];

    // User deselects temp:act-1
    const pruned = pruneDeselectedMutations(mutations, new Set(['temp:act-2', 'dep_0']));

    // The add_dependency should be pruned because temp:act-1 is missing
    expect(pruned).toHaveLength(1);
    expect(pruned[0]).toMatchObject({ tempId: 'temp:act-2' });
  });
});

describe('Inverse Mutation Generation (ADR 0016)', () => {
  it('generates inverse delete_node for create_node', () => {
    const currentNodes: Node[] = [];
    const applied: Mutation[] = [
      {
        type: 'create_node',
        nodeId: 'act_123',
        nodeType: 'action',
        parentId: 'goal_1',
        title: 'New Action',
      },
    ];

    const inverses = generateInverseMutations(applied, currentNodes);
    expect(inverses).toEqual([
      {
        type: 'delete_node',
        nodeId: 'act_123',
      },
    ]);
  });

  it('generates inverse update_status with previous status', () => {
    const currentNodes: Node[] = [
      {
        id: 'act_1',
        workspaceId: 'ws_1',
        type: 'action',
        parentId: 'goal_1',
        title: 'Existing Action',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
    ];
    const applied: Mutation[] = [
      {
        type: 'update_status',
        nodeId: 'act_1',
        status: 'done',
      },
    ];

    const inverses = generateInverseMutations(applied, currentNodes);
    expect(inverses).toEqual([
      {
        type: 'update_status',
        nodeId: 'act_1',
        status: 'todo',
      },
    ]);
  });

  it('generates inverse remove_evidence for add_evidence (ADR 0016)', () => {
    const applied: Mutation[] = [
      {
        type: 'add_evidence',
        evidenceId: 'ev_123',
        nodeId: 'goal_1',
        content: 'Candidate fact',
      },
    ];

    const inverses = generateInverseMutations(applied, []);
    expect(inverses).toEqual([
      {
        type: 'remove_evidence',
        evidenceId: 'ev_123',
      },
    ]);
  });
});
