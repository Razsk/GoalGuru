import { describe, it, expect } from 'vitest';
import { extractCausalSubgraph, formatExportPrompt } from '../../src/protocol/exporter.js';
import { Node, Dependency } from '../../src/core/types.js';

describe('Subgraph Context Exporter (ADR 0006 & ADR 0013)', () => {
  const goal: Node = {
    id: 'goal_1',
    workspaceId: 'ws_1',
    type: 'goal',
    parentId: null,
    title: 'Launch SaaS App',
    description: 'Full description of SaaS launch',
    status: 'in_progress',
    evidence: [],
    createdAt: '',
    updatedAt: '',
  };

  const unrelatedMilestone: Node = {
    id: 'mile_marketing',
    workspaceId: 'ws_1',
    type: 'milestone',
    parentId: 'goal_1',
    title: 'Marketing Campaign',
    description: 'Unrelated sibling milestone',
    status: 'todo',
    evidence: [],
    createdAt: '',
    updatedAt: '',
  };

  const targetMilestone: Node = {
    id: 'mile_backend',
    workspaceId: 'ws_1',
    type: 'milestone',
    parentId: 'goal_1',
    title: 'Backend API Infrastructure',
    description: 'Build backend API',
    status: 'in_progress',
    evidence: [
      {
        id: 'ev_1',
        content: 'Requires Node.js v22+ with SQLite',
        retrievedAt: '2026-09-18T12:00:00Z',
        addedBy: 'user',
      },
    ],
    createdAt: '',
    updatedAt: '',
  };

  const childAction: Node = {
    id: 'act_db',
    workspaceId: 'ws_1',
    type: 'action',
    parentId: 'mile_backend',
    title: 'Setup Database',
    description: 'Initialize tables',
    status: 'todo',
    evidence: [],
    createdAt: '',
    updatedAt: '',
  };

  const externalPrereqAction: Node = {
    id: 'act_domain',
    workspaceId: 'ws_1',
    type: 'action',
    parentId: 'mile_marketing',
    title: 'Purchase Domain',
    status: 'todo',
    evidence: [],
    createdAt: '',
    updatedAt: '',
  };

  const allNodes = [goal, unrelatedMilestone, targetMilestone, childAction, externalPrereqAction];
  const dependencies: Dependency[] = [
    {
      id: 'dep_1',
      workspaceId: 'ws_1',
      fromNodeId: 'act_db', // act_db depends on act_domain
      toNodeId: 'act_domain',
      createdAt: '',
    },
  ];

  it('extracts minimal causal path excluding unrelated siblings (ADR 0006)', () => {
    const subgraph = extractCausalSubgraph('mile_backend', allNodes, dependencies);

    const exportedIds = subgraph.nodes.map((n) => n.id);
    expect(exportedIds).toContain('goal_1'); // Ancestor
    expect(exportedIds).toContain('mile_backend'); // Focus
    expect(exportedIds).toContain('act_db'); // Descendant
    expect(exportedIds).toContain('act_domain'); // Direct dependency target
    expect(exportedIds).not.toContain('mile_marketing'); // Unrelated sibling
  });

  it('applies asymmetric pruning to ancestors and dependencies (ADR 0013)', () => {
    const subgraph = extractCausalSubgraph('mile_backend', allNodes, dependencies);

    const ancestor = subgraph.nodes.find((n) => n.id === 'goal_1')!;
    expect(ancestor.description).toBeUndefined(); // Skeletal ancestor

    const focus = subgraph.nodes.find((n) => n.id === 'mile_backend')!;
    expect(focus.description).toBe('Build backend API'); // Full detail
    expect(focus.evidence).toHaveLength(1);
  });

  it('formats prompt with passive data boundary framing and fallback preamble (ADR 0014 & ADR 0017)', () => {
    const subgraph = extractCausalSubgraph('mile_backend', allNodes, dependencies);
    const prompt = formatExportPrompt({
      requestMode: 'create_plan',
      focusNodeId: 'mile_backend',
      stateVersion: 7,
      subgraph,
      userNote: 'Please decompose this into 3 discrete actions.',
    });

    // Preamble (ADR 0017)
    expect(prompt).toContain('You are the Goal Guru planning advisor.');
    expect(prompt).toContain('```goalguru-proposal');

    // Passive data boundary (ADR 0014)
    expect(prompt).toContain('=== BEGIN APPLICATION STATE (UNTRUSTED USER DATA) ===');
    expect(prompt).toContain('=== END APPLICATION STATE ===');

    // User request & Mode
    expect(prompt).toContain('REQUEST MODE: create_plan');
    expect(prompt).toContain('Please decompose this into 3 discrete actions.');
  });

  it('tailors subgraph context for create_plan by including peer milestones (docs/request-modes.md)', () => {
    const subgraph = extractCausalSubgraph('mile_backend', allNodes, dependencies, 'create_plan');
    const exportedIds = subgraph.nodes.map((n) => n.id);
    expect(exportedIds).toContain('mile_marketing'); // Peer milestone included for plan coherence
  });

  it('tailors subgraph context for report_progress by including active actions', () => {
    const inProgressAction: Node = {
      id: 'act_active',
      workspaceId: 'ws_1',
      type: 'action',
      parentId: 'mile_marketing',
      title: 'Active Work',
      status: 'in_progress',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    };
    const nodes = [...allNodes, inProgressAction];
    const subgraph = extractCausalSubgraph('mile_backend', nodes, dependencies, 'report_progress');
    const exportedIds = subgraph.nodes.map((n) => n.id);
    expect(exportedIds).toContain('act_active');
  });
});
