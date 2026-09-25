import { describe, it, expect } from 'vitest';
import { isValidParentChild, isValidDependencyType, Node, Dependency } from '../../src/core/types.js';
import { detectCycle, validateHierarchicalDependencies } from '../../src/core/cycle.js';
import { computeReadiness } from '../../src/core/readiness.js';

describe('Containment Hierarchy Rules (ADR 0001 & ADR 0004 & Milestone Refactor)', () => {
  it('allows top-level goals without a parent', () => {
    expect(isValidParentChild(null, 'goal')).toBe(true);
    expect(isValidParentChild(null, 'action')).toBe(false);
  });

  it('allows goals to contain sub-goals and milestones, but not direct actions', () => {
    expect(isValidParentChild('goal', 'sub_goal')).toBe(true);
    expect(isValidParentChild('goal', 'milestone')).toBe(true);
    expect(isValidParentChild('goal', 'action')).toBe(false);
  });

  it('allows milestones to contain actions', () => {
    expect(isValidParentChild('milestone', 'action')).toBe(true);
    expect(isValidParentChild('milestone', 'milestone')).toBe(false);
  });

  it('actions are leaf execution nodes and cannot contain children', () => {
    expect(isValidParentChild('action', 'action')).toBe(false);
    expect(isValidParentChild('action', 'milestone')).toBe(false);
  });
});

describe('Dependency Target Rules', () => {
  it('allows dependencies between actions and between milestones', () => {
    expect(isValidDependencyType('action', 'action')).toBe(true);
    expect(isValidDependencyType('milestone', 'milestone')).toBe(true);
  });

  it('disallows cross-type dependencies between actions and milestones', () => {
    expect(isValidDependencyType('action', 'milestone')).toBe(false);
    expect(isValidDependencyType('milestone', 'action')).toBe(false);
  });

  it('disallows goals from having direct dependencies', () => {
    expect(isValidDependencyType('goal', 'action')).toBe(false);
    expect(isValidDependencyType('action', 'goal')).toBe(false);
    expect(isValidDependencyType('goal', 'milestone')).toBe(false);
  });
});

describe('Cycle Detection (ADR 0012)', () => {
  it('detects no cycle in linear or branching DAG', () => {
    const dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[] = [
      { fromNodeId: 'act_1', toNodeId: 'act_2' }, // act_1 precedes act_2 (act_2 depends on act_1)
      { fromNodeId: 'act_2', toNodeId: 'act_3' }, // act_2 precedes act_3 (act_3 depends on act_2)
      { fromNodeId: 'act_1', toNodeId: 'act_4' }, // act_1 precedes act_4 (act_4 depends on act_1)
    ];

    const result = detectCycle(dependencies);
    expect(result.hasCycle).toBe(false);
    expect(result.cycleNodes).toEqual([]);
  });

  it('detects direct 2-node cycle (A -> B -> A)', () => {
    const dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[] = [
      { fromNodeId: 'act_1', toNodeId: 'act_2' },
      { fromNodeId: 'act_2', toNodeId: 'act_1' },
    ];

    const result = detectCycle(dependencies);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toContain('act_1');
    expect(result.cycleNodes).toContain('act_2');
  });

  it('detects transitive cycle (A -> B -> C -> A)', () => {
    const dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[] = [
      { fromNodeId: 'act_1', toNodeId: 'act_2' },
      { fromNodeId: 'act_2', toNodeId: 'act_3' },
      { fromNodeId: 'act_3', toNodeId: 'act_1' },
      { fromNodeId: 'act_3', toNodeId: 'act_4' }, // downstream unaffected
    ];

    const result = detectCycle(dependencies);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toEqual(expect.arrayContaining(['act_1', 'act_2', 'act_3']));
    expect(result.cycleNodes).not.toContain('act_4');
  });
});

describe('Dynamic Readiness Computation (ADR 0003)', () => {
  const createMockNode = (id: string, status: Node['status']): Node => ({
    id,
    workspaceId: 'ws_1',
    type: 'action',
    parentId: 'goal_1',
    title: `Node ${id}`,
    status,
    evidence: [],
    createdAt: '2026-09-18T12:00:00Z',
    updatedAt: '2026-09-18T12:00:00Z',
  });

  it('marks node without dependencies as ready', () => {
    const nodes = [createMockNode('act_1', 'todo')];
    const dependencies: Dependency[] = [];

    const readinessMap = computeReadiness(nodes, dependencies);
    expect(readinessMap.get('act_1')).toEqual({ readiness: 'ready', blockingNodeIds: [], blockingNodeTitles: [] });
  });

  it('marks node as blocked if dependency is todo or in_progress', () => {
    const nodes = [
      createMockNode('act_1', 'todo'),
      createMockNode('act_2', 'todo'),
    ];
    // act_1 is prerequisite for act_2 (act_2 depends on act_1)
    const dependencies: Dependency[] = [
      { id: 'dep_1', workspaceId: 'ws_1', fromNodeId: 'act_1', toNodeId: 'act_2', createdAt: '' },
    ];

    const readinessMap = computeReadiness(nodes, dependencies);
    expect(readinessMap.get('act_1')).toEqual({ readiness: 'ready', blockingNodeIds: [], blockingNodeTitles: [] });
    expect(readinessMap.get('act_2')).toEqual({ readiness: 'blocked', blockingNodeIds: ['act_1'], blockingNodeTitles: ['Node act_1'] });
  });

  it('marks node as ready once all dependencies are done', () => {
    const nodes = [
      createMockNode('act_1', 'done'),
      createMockNode('act_2', 'todo'),
    ];
    const dependencies: Dependency[] = [
      { id: 'dep_1', workspaceId: 'ws_1', fromNodeId: 'act_1', toNodeId: 'act_2', createdAt: '' },
    ];

    const readinessMap = computeReadiness(nodes, dependencies);
    expect(readinessMap.get('act_2')).toEqual({ readiness: 'ready', blockingNodeIds: [], blockingNodeTitles: [] });
  });

  it('marks node as blocked if at least one dependency is not done', () => {
    const nodes = [
      createMockNode('act_1', 'done'),
      createMockNode('act_2', 'in_progress'),
      createMockNode('act_3', 'todo'),
    ];
    // act_3 depends on both act_1 and act_2
    const dependencies: Dependency[] = [
      { id: 'dep_1', workspaceId: 'ws_1', fromNodeId: 'act_1', toNodeId: 'act_3', createdAt: '' },
      { id: 'dep_2', workspaceId: 'ws_1', fromNodeId: 'act_2', toNodeId: 'act_3', createdAt: '' },
    ];

    const readinessMap = computeReadiness(nodes, dependencies);
    expect(readinessMap.get('act_3')).toEqual({ readiness: 'blocked', blockingNodeIds: ['act_2'], blockingNodeTitles: ['Node act_2'] });
  });

  it('cascades milestone dependencies down to block child actions', () => {
    const nodes: Node[] = [
      {
        id: 'ms_1',
        workspaceId: 'ws_1',
        type: 'milestone',
        parentId: 'goal_1',
        title: 'Phase 1 Checkpoint',
        status: 'todo',
        evidence: [],
        createdAt: '2026-09-18T12:00:00Z',
        updatedAt: '2026-09-18T12:00:00Z',
      },
      {
        id: 'act_1',
        workspaceId: 'ws_1',
        type: 'action',
        parentId: 'ms_1',
        title: 'Task in Phase 1',
        status: 'todo',
        evidence: [],
        createdAt: '2026-09-18T12:00:00Z',
        updatedAt: '2026-09-18T12:00:00Z',
      },
      {
        id: 'ms_2',
        workspaceId: 'ws_1',
        type: 'milestone',
        parentId: 'goal_1',
        title: 'Phase 2 Checkpoint',
        status: 'todo',
        evidence: [],
        createdAt: '2026-09-18T12:00:00Z',
        updatedAt: '2026-09-18T12:00:00Z',
      },
      {
        id: 'act_2',
        workspaceId: 'ws_1',
        type: 'action',
        parentId: 'ms_2',
        title: 'Task in Phase 2',
        status: 'todo',
        evidence: [],
        createdAt: '2026-09-18T12:00:00Z',
        updatedAt: '2026-09-18T12:00:00Z',
      },
    ];

    // ms_2 depends on ms_1
    const dependencies: Dependency[] = [
      { id: 'dep_ms', workspaceId: 'ws_1', fromNodeId: 'ms_1', toNodeId: 'ms_2', createdAt: '' },
    ];

    // Initially ms_1 is not done, so act_2 in ms_2 must be blocked by ms_1
    const map1 = computeReadiness(nodes, dependencies);
    expect(map1.get('act_1')?.readiness).toBe('ready');
    expect(map1.get('act_2')?.readiness).toBe('blocked');
    expect(map1.get('act_2')?.blockingNodeIds).toContain('ms_1');

    // When act_1 is done, ms_1 achieves derived status 'done', unblocking act_2
    nodes[1].status = 'done';
    const map2 = computeReadiness(nodes, dependencies);
    expect(map2.get('act_2')?.readiness).toBe('ready');
    expect(map2.get('act_2')?.blockingNodeIds).toEqual([]);
  });
});

describe('Hierarchical Cycle Prevention', () => {
  it('detects cross-milestone backward dependency deadlocks', () => {
    const nodes = [
      { id: 'ms_1', type: 'milestone', parentId: 'goal_1', title: 'Milestone 1' },
      { id: 'act_1', type: 'action', parentId: 'ms_1', title: 'Action 1' },
      { id: 'ms_2', type: 'milestone', parentId: 'goal_1', title: 'Milestone 2' },
      { id: 'act_2', type: 'action', parentId: 'ms_2', title: 'Action 2' },
    ];

    // ms_2 depends on ms_1 (ms_1 precedes ms_2)
    const dependencies = [
      { fromNodeId: 'ms_1', toNodeId: 'ms_2' },
      // act_1 (in ms_1) depends on act_2 (in ms_2) - BACKWARD DEADLOCK!
      { fromNodeId: 'act_2', toNodeId: 'act_1' },
    ];

    const result = validateHierarchicalDependencies(dependencies, nodes as any);
    expect(result.hasCycle).toBe(true);
    expect(result.error).toContain('Hierarchical cycle');
  });

  it('allows forward cross-milestone dependencies', () => {
    const nodes = [
      { id: 'ms_1', type: 'milestone', parentId: 'goal_1', title: 'Milestone 1' },
      { id: 'act_1', type: 'action', parentId: 'ms_1', title: 'Action 1' },
      { id: 'ms_2', type: 'milestone', parentId: 'goal_1', title: 'Milestone 2' },
      { id: 'act_2', type: 'action', parentId: 'ms_2', title: 'Action 2' },
    ];

    // ms_2 depends on ms_1, and act_2 (in ms_2) depends on act_1 (in ms_1) - FORWARD VALID!
    const dependencies = [
      { fromNodeId: 'ms_1', toNodeId: 'ms_2' },
      { fromNodeId: 'act_1', toNodeId: 'act_2' },
    ];

    const result = validateHierarchicalDependencies(dependencies, nodes as any);
    expect(result.hasCycle).toBe(false);
  });
});
