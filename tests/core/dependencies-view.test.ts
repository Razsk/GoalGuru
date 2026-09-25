import { describe, it, expect } from 'vitest';
import { topologicalSort, detectCycle } from '../../src/core/cycle.js';

describe('Dependencies and Topological Sorting', () => {
  it('orders items so prerequisites precede dependent items', () => {
    const items = [
      { id: 'task-c', title: 'Task C' },
      { id: 'task-a', title: 'Task A' },
      { id: 'task-b', title: 'Task B' },
    ];

    // task-a -> task-b -> task-c
    const deps = [
      { fromNodeId: 'task-a', toNodeId: 'task-b' },
      { fromNodeId: 'task-b', toNodeId: 'task-c' },
    ];

    const sorted = topologicalSort(items, deps);
    const sortedIds = sorted.map((i) => i.id);

    expect(sortedIds.indexOf('task-a')).toBeLessThan(sortedIds.indexOf('task-b'));
    expect(sortedIds.indexOf('task-b')).toBeLessThan(sortedIds.indexOf('task-c'));
    expect(sortedIds).toEqual(['task-a', 'task-b', 'task-c']);
  });

  it('handles branch-merge dependencies cleanly', () => {
    const items = [
      { id: 'deploy', title: 'Deploy' },
      { id: 'frontend', title: 'Frontend' },
      { id: 'backend', title: 'Backend' },
      { id: 'setup', title: 'Setup' },
    ];

    // setup -> frontend -> deploy
    // setup -> backend -> deploy
    const deps = [
      { fromNodeId: 'setup', toNodeId: 'frontend' },
      { fromNodeId: 'setup', toNodeId: 'backend' },
      { fromNodeId: 'frontend', toNodeId: 'deploy' },
      { fromNodeId: 'backend', toNodeId: 'deploy' },
    ];

    const sorted = topologicalSort(items, deps);
    const sortedIds = sorted.map((i) => i.id);

    expect(sortedIds.indexOf('setup')).toBeLessThan(sortedIds.indexOf('frontend'));
    expect(sortedIds.indexOf('setup')).toBeLessThan(sortedIds.indexOf('backend'));
    expect(sortedIds.indexOf('frontend')).toBeLessThan(sortedIds.indexOf('deploy'));
    expect(sortedIds.indexOf('backend')).toBeLessThan(sortedIds.indexOf('deploy'));
    expect(sortedIds[0]).toBe('setup');
    expect(sortedIds[3]).toBe('deploy');
  });

  it('does not choke on cycles and returns all items', () => {
    const items = [
      { id: 'x', title: 'X' },
      { id: 'y', title: 'Y' },
    ];
    const deps = [
      { fromNodeId: 'x', toNodeId: 'y' },
      { fromNodeId: 'y', toNodeId: 'x' },
    ];
    const sorted = topologicalSort(items, deps);
    expect(sorted).toHaveLength(2);
  });
});

describe('Effective Dependencies and Blocker Arrow Integration (Miro Canvas)', () => {
  it('synthesizes cascaded dependencies from prerequisite milestones to entry actions', async () => {
    const { computeEffectiveDependencies, computeReadiness } = await import('../../src/core/readiness.js');
    const nodes: any[] = [
      { id: 'ms_1', type: 'milestone', parentId: 'goal_1', title: 'Milestone 1', status: 'todo' },
      { id: 'ms_2', type: 'milestone', parentId: 'goal_1', title: 'Milestone 2', status: 'todo' },
      { id: 'act_1', type: 'action', parentId: 'ms_2', title: 'Action 1 in MS2', status: 'todo' },
      { id: 'act_2', type: 'action', parentId: 'ms_2', title: 'Action 2 in MS2', status: 'todo' },
    ];
    // ms_2 depends on ms_1
    const deps: any[] = [
      { id: 'dep_1', fromNodeId: 'ms_1', toNodeId: 'ms_2' },
      { id: 'dep_2', fromNodeId: 'act_1', toNodeId: 'act_2' }, // act_2 depends on act_1 within ms_2
    ];

    const readiness = computeReadiness(nodes, deps);
    const effective = computeEffectiveDependencies(nodes, deps, readiness);

    // act_1 is entry action of ms_2: must receive cascaded edge from ms_1
    const ms1ToAct1 = effective.find(d => d.fromNodeId === 'ms_1' && d.toNodeId === 'act_1');
    expect(ms1ToAct1).toBeDefined();
    expect(ms1ToAct1?.isCascaded).toBe(true);

    // Every blocked node must have at least one incoming edge in effective dependencies
    for (const node of nodes) {
      const r = readiness.get(node.id);
      if (r?.readiness === 'blocked') {
        const incoming = effective.filter(d => d.toNodeId === node.id);
        expect(incoming.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('guarantees every blocked action without explicit incoming dependencies has a directed edge pointing to it', async () => {
    const { computeEffectiveDependencies, computeReadiness } = await import('../../src/core/readiness.js');
    const nodes: any[] = [
      { id: 'ms_prereq', type: 'milestone', parentId: 'goal_1', title: 'Prereq Milestone', status: 'todo' },
      { id: 'ms_target', type: 'milestone', parentId: 'goal_1', title: 'Target Milestone', status: 'todo' },
      // Parallel actions in target milestone with zero explicit incoming action deps
      { id: 'act_alpha', type: 'action', parentId: 'ms_target', title: 'Alpha Action', status: 'todo' },
      { id: 'act_beta', type: 'action', parentId: 'ms_target', title: 'Beta Action', status: 'todo' },
    ];

    const deps: any[] = [
      { id: 'dep_ms', fromNodeId: 'ms_prereq', toNodeId: 'ms_target' },
    ];

    const readiness = computeReadiness(nodes, deps);
    expect(readiness.get('act_alpha')?.readiness).toBe('blocked');
    expect(readiness.get('act_beta')?.readiness).toBe('blocked');

    const effective = computeEffectiveDependencies(nodes, deps, readiness);

    // Both parallel entry actions must have incoming arrows from ms_prereq
    const incAlpha = effective.filter(d => d.toNodeId === 'act_alpha');
    const incBeta = effective.filter(d => d.toNodeId === 'act_beta');
    expect(incAlpha.length).toBe(1);
    expect(incAlpha[0].fromNodeId).toBe('ms_prereq');
    expect(incBeta.length).toBe(1);
    expect(incBeta[0].fromNodeId).toBe('ms_prereq');
  });

  it('retains effective dependencies as satisfied edges when prerequisite milestone is completed', async () => {
    const { computeEffectiveDependencies, computeReadiness } = await import('../../src/core/readiness.js');
    const nodes: any[] = [
      { id: 'ms_1', type: 'milestone', parentId: 'goal_1', title: 'Milestone 1', status: 'done' },
      { id: 'act_0', type: 'action', parentId: 'ms_1', title: 'Action in MS1', status: 'done' },
      { id: 'ms_2', type: 'milestone', parentId: 'goal_1', title: 'Milestone 2', status: 'todo' },
      { id: 'act_1', type: 'action', parentId: 'ms_2', title: 'Action in MS2', status: 'todo' },
    ];

    const deps: any[] = [
      { id: 'dep_1', fromNodeId: 'ms_1', toNodeId: 'ms_2' },
    ];

    const readiness = computeReadiness(nodes, deps);
    expect(readiness.get('act_1')?.readiness).toBe('ready');

    const effective = computeEffectiveDependencies(nodes, deps, readiness);
    const ms1ToAct1 = effective.find(d => d.fromNodeId === 'ms_1' && d.toNodeId === 'act_1');
    expect(ms1ToAct1).toBeDefined();
    expect(ms1ToAct1?.isCascaded).toBe(true);

    // Topological sorting properly orders ms_1 before act_1
    const sorted = topologicalSort(nodes, effective);
    const sortedIds = sorted.map(n => n.id);
    expect(sortedIds.indexOf('ms_1')).toBeLessThan(sortedIds.indexOf('act_1'));
  });
});

