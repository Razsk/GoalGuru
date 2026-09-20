import { describe, it, expect } from 'vitest';
import { Node } from '../../src/core/types.js';
import {
  computeNodeProgress,
  computeMetricGroup,
  computeWorkspaceProgress,
  getDescendantNodes,
} from '../../src/core/progress.js';

describe('Progress Calculation Engine (src/core/progress.ts)', () => {
  const sampleNodes: Node[] = [
    {
      id: 'g1',
      workspaceId: 'ws1',
      type: 'goal',
      parentId: null,
      title: 'Launch SaaS',
      status: 'in_progress',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'm1',
      workspaceId: 'ws1',
      type: 'milestone',
      parentId: 'g1',
      title: 'MVP Phase',
      status: 'in_progress',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'a1',
      workspaceId: 'ws1',
      type: 'action',
      parentId: 'm1',
      title: 'Design UI',
      status: 'done',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'a2',
      workspaceId: 'ws1',
      type: 'action',
      parentId: 'm1',
      title: 'Build API',
      status: 'in_progress',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'sa1',
      workspaceId: 'ws1',
      type: 'sub_action',
      parentId: 'a2',
      title: 'Write Auth',
      status: 'done',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'sa2',
      workspaceId: 'ws1',
      type: 'sub_action',
      parentId: 'a2',
      title: 'Write DB Schema',
      status: 'todo',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'g2',
      workspaceId: 'ws1',
      type: 'goal',
      parentId: null,
      title: 'Marketing Campaign',
      status: 'done',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('correctly retrieves descendant nodes recursively', () => {
    const g1Descendants = getDescendantNodes('g1', sampleNodes);
    expect(g1Descendants.map((n) => n.id)).toEqual(
      expect.arrayContaining(['m1', 'a1', 'a2', 'sa1', 'sa2'])
    );
    expect(g1Descendants).toHaveLength(5);

    const a2Descendants = getDescendantNodes('a2', sampleNodes);
    expect(a2Descendants.map((n) => n.id)).toEqual(['sa1', 'sa2']);
  });

  it('computes node progress for action with sub-actions', () => {
    // a2 (status in_progress) has 2 sub-actions: sa1 (done), sa2 (todo)
    // Total items for a2 = 1 (a2 itself) + 2 (sub-actions) = 3 items. Completed = 0 + 1 = 1 (33%)
    const progress = computeNodeProgress(sampleNodes.find((n) => n.id === 'a2')!, sampleNodes);
    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.percentage).toBe(33);
  });

  it('computes node progress for leaf action with no sub-actions', () => {
    const a1 = sampleNodes.find((n) => n.id === 'a1')!;
    const progress = computeNodeProgress(a1, sampleNodes);
    expect(progress.total).toBe(1);
    expect(progress.completed).toBe(1);
    expect(progress.percentage).toBe(100);
  });

  it('computes goal subtree progress based on descendant actions and sub-actions', () => {
    // g1 has actions: a1 (done), a2 (in_progress), sa1 (done), sa2 (todo).
    // Total actions/sub-actions = 4. Done = 2 (a1, sa1). Progress = 50%
    const g1 = sampleNodes.find((n) => n.id === 'g1')!;
    const progress = computeNodeProgress(g1, sampleNodes);
    expect(progress.total).toBe(4);
    expect(progress.completed).toBe(2);
    expect(progress.percentage).toBe(50);
  });

  it('computes progress for goal with no actions based on goal status', () => {
    const g2 = sampleNodes.find((n) => n.id === 'g2')!;
    const progress = computeNodeProgress(g2, sampleNodes);
    expect(progress.percentage).toBe(100);
  });

  it('computes metric groups for actions, milestones, and goals', () => {
    const actions = sampleNodes.filter((n) => n.type === 'action' || n.type === 'sub_action');
    const metric = computeMetricGroup(actions);
    expect(metric.total).toBe(4);
    expect(metric.completed).toBe(2);
    expect(metric.inProgress).toBe(1);
    expect(metric.todo).toBe(1);
    expect(metric.percentage).toBe(50);
  });

  it('computes complete workspace summary with tier rings and readiness pipeline', () => {
    const readinessMap = new Map([
      ['sa2', { readiness: 'blocked' as const, blockingNodeIds: ['sa1'] }],
    ]);

    const summary = computeWorkspaceProgress(sampleNodes, readinessMap);

    // Total nodes = 7, completed (a1, sa1, g2) = 3. 3/7 = 43%
    expect(summary.totalNodes).toBe(7);
    expect(summary.completedNodes).toBe(3);
    expect(summary.overallPercentage).toBe(43);

    // Pipeline
    expect(summary.pipeline.done.map((n) => n.id)).toEqual(
      expect.arrayContaining(['a1', 'sa1', 'g2'])
    );
    expect(summary.pipeline.blocked.map((n) => n.id)).toEqual(['sa2']);
    expect(summary.pipeline.inProgress.map((n) => n.id)).toEqual(
      expect.arrayContaining(['g1', 'm1', 'a2'])
    );

    // Tier rings: Actions, Milestones, Goals
    expect(summary.tierRings).toHaveLength(3);
    expect(summary.tierRings[0].label).toBe('Actions & Tasks');
    expect(summary.tierRings[0].percentage).toBe(50);

    // Goal rings: g1 (50%), g2 (100%)
    expect(summary.goalRings).toHaveLength(2);
    expect(summary.goalRings[0].percentage).toBe(50);
    expect(summary.goalRings[1].percentage).toBe(100);
  });

  it('handles empty workspace gracefully', () => {
    const summary = computeWorkspaceProgress([]);
    expect(summary.overallPercentage).toBe(0);
    expect(summary.totalNodes).toBe(0);
    expect(summary.tierRings[0].percentage).toBe(0);
    expect(summary.goalRings).toHaveLength(0);
  });
});
