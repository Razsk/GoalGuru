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
