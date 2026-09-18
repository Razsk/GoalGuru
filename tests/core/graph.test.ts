import { describe, it, expect } from 'vitest';
import { isValidParentChild, isValidDependencyType, Node, Dependency } from '../../src/core/types.js';
import { detectCycle } from '../../src/core/cycle.js';
import { computeReadiness } from '../../src/core/readiness.js';

describe('Containment Hierarchy Rules (ADR 0001 & ADR 0004)', () => {
  it('allows top-level goals without a parent', () => {
    expect(isValidParentChild(null, 'goal')).toBe(true);
    expect(isValidParentChild(null, 'action')).toBe(false);
  });

  it('allows goals to contain sub-goals, milestones, and direct actions', () => {
    expect(isValidParentChild('goal', 'sub_goal')).toBe(true);
    expect(isValidParentChild('goal', 'milestone')).toBe(true);
    expect(isValidParentChild('goal', 'action')).toBe(true);
  });

  it('allows milestones to contain actions', () => {
    expect(isValidParentChild('milestone', 'action')).toBe(true);
    expect(isValidParentChild('milestone', 'milestone')).toBe(false);
  });

  it('allows actions to contain sub-actions recursively', () => {
    expect(isValidParentChild('action', 'sub_action')).toBe(true);
    expect(isValidParentChild('sub_action', 'sub_action')).toBe(true);
    expect(isValidParentChild('action', 'milestone')).toBe(false);
  });
});

describe('Dependency Target Rules (ADR 0001 & ADR 0003)', () => {
  it('allows dependencies between actions and milestones', () => {
    expect(isValidDependencyType('action', 'action')).toBe(true);
    expect(isValidDependencyType('action', 'milestone')).toBe(true);
    expect(isValidDependencyType('milestone', 'action')).toBe(true);
  });

  it('disallows goals from having direct dependencies', () => {
    expect(isValidDependencyType('goal', 'action')).toBe(false);
    expect(isValidDependencyType('action', 'goal')).toBe(false);
  });
});

describe('Cycle Detection (ADR 0012)', () => {
  it('detects no cycle in linear or branching DAG', () => {
    const dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[] = [
      { fromNodeId: 'act_2', toNodeId: 'act_1' }, // act_2 depends on act_1
      { fromNodeId: 'act_3', toNodeId: 'act_2' }, // act_3 depends on act_2
      { fromNodeId: 'act_4', toNodeId: 'act_1' }, // act_4 depends on act_1
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
      { fromNodeId: 'act_4', toNodeId: 'act_3' }, // downstream unaffected
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
    expect(readinessMap.get('act_1')).toEqual({ readiness: 'ready', blockingNodeIds: [] });
  });

  it('marks node as blocked if dependency is todo or in_progress', () => {
    const nodes = [
      createMockNode('act_1', 'todo'),
      createMockNode('act_2', 'todo'),
    ];
    // act_2 depends on act_1
    const dependencies: Dependency[] = [
      { id: 'dep_1', workspaceId: 'ws_1', fromNodeId: 'act_2', toNodeId: 'act_1', createdAt: '' },
    ];

    const readinessMap = computeReadiness(nodes, dependencies);
    expect(readinessMap.get('act_1')).toEqual({ readiness: 'ready', blockingNodeIds: [] });
    expect(readinessMap.get('act_2')).toEqual({ readiness: 'blocked', blockingNodeIds: ['act_1'] });
  });

  it('marks node as ready once all dependencies are done', () => {
    const nodes = [
      createMockNode('act_1', 'done'),
      createMockNode('act_2', 'todo'),
    ];
    const dependencies: Dependency[] = [
      { id: 'dep_1', workspaceId: 'ws_1', fromNodeId: 'act_2', toNodeId: 'act_1', createdAt: '' },
    ];

    const readinessMap = computeReadiness(nodes, dependencies);
    expect(readinessMap.get('act_2')).toEqual({ readiness: 'ready', blockingNodeIds: [] });
  });

  it('marks node as blocked if at least one dependency is not done', () => {
    const nodes = [
      createMockNode('act_1', 'done'),
      createMockNode('act_2', 'in_progress'),
      createMockNode('act_3', 'todo'),
    ];
    // act_3 depends on both act_1 and act_2
    const dependencies: Dependency[] = [
      { id: 'dep_1', workspaceId: 'ws_1', fromNodeId: 'act_3', toNodeId: 'act_1', createdAt: '' },
      { id: 'dep_2', workspaceId: 'ws_1', fromNodeId: 'act_3', toNodeId: 'act_2', createdAt: '' },
    ];

    const readinessMap = computeReadiness(nodes, dependencies);
    expect(readinessMap.get('act_3')).toEqual({ readiness: 'blocked', blockingNodeIds: ['act_2'] });
  });
});
