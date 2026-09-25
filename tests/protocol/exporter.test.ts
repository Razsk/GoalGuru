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

  it('instructs LLM to create sequential milestones and link them when decomposing goals in create_plan', () => {
    const subgraph = extractCausalSubgraph('goal_1', allNodes, dependencies, 'create_plan');
    const prompt = formatExportPrompt({
      requestMode: 'create_plan',
      focusNodeId: 'goal_1',
      stateVersion: 1,
      subgraph,
    });

    expect(prompt).toContain("When planning a 'goal': First establish 2-4 sequential intermediate milestones (nodeType: 'milestone')");
    expect(prompt).toContain("Connect milestones sequentially with 'add_dependency' edges");
    expect(prompt).toContain('OBJECTIVE FOR REQUEST MODE (create_plan):');
  });

  it('formats mode-specific instructions and strict negative constraints for action_assistance', () => {
    const subgraph = extractCausalSubgraph('act_db', allNodes, dependencies, 'action_assistance');
    const prompt = formatExportPrompt({
      requestMode: 'action_assistance',
      focusNodeId: 'act_db',
      stateVersion: 2,
      subgraph,
    });

    expect(prompt).toContain('OBJECTIVE FOR REQUEST MODE (action_assistance):');
    expect(prompt).toContain('STRICT NEGATIVE CONSTRAINT: Do NOT alter graph structure');
    expect(prompt).toContain('Leave the changeSet empty ([]) or restricted to \'add_evidence\'');
  });

  it('formats mode-specific instructions for report_progress reconciliation', () => {
    const subgraph = extractCausalSubgraph('act_db', allNodes, dependencies, 'report_progress');
    const prompt = formatExportPrompt({
      requestMode: 'report_progress',
      focusNodeId: 'act_db',
      stateVersion: 3,
      subgraph,
      userNote: 'Completed initial schema migrations and tested connection.',
    });

    expect(prompt).toContain('OBJECTIVE FOR REQUEST MODE (report_progress):');
    expect(prompt).toContain('Reconcile the user\'s free-form progress notes against the active tasks');
    expect(prompt).toContain('propose \'update_status\' mutations with status: \'done\'');
  });

  it('formats mode-specific instructions and preservation constraints for replan', () => {
    const subgraph = extractCausalSubgraph('act_db', allNodes, dependencies, 'replan');
    const prompt = formatExportPrompt({
      requestMode: 'replan',
      focusNodeId: 'act_db',
      stateVersion: 4,
      subgraph,
    });

    expect(prompt).toContain('OBJECTIVE FOR REQUEST MODE (replan):');
    expect(prompt).toContain('STRICT CONSTRAINT: Preserve completed work');
    expect(prompt).toContain('Never delete or alter nodes whose status is already \'done\'');
  });
});

