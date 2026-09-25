import { describe, it, expect } from 'vitest';
import { Node, Dependency } from '../../src/core/types.js';
import { getTopInitiableActionsForGoal } from '../../src/core/top-actions.js';

describe('Top Initiable Actions Engine (src/core/top-actions.ts)', () => {
  const sampleGoal: Node = {
    id: 'goal-1',
    workspaceId: 'ws-1',
    type: 'goal',
    parentId: null,
    title: 'Launch Online Store',
    status: 'in_progress',
    evidence: [],
    createdAt: '',
    updatedAt: '',
  };

  const sampleNodes: Node[] = [
    sampleGoal,
    // Milestone 1
    {
      id: 'm-1',
      workspaceId: 'ws-1',
      type: 'milestone',
      parentId: 'goal-1',
      title: 'Storefront Setup',
      status: 'in_progress',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    // Actions under Milestone 1
    {
      id: 'act-completed',
      workspaceId: 'ws-1',
      type: 'action',
      parentId: 'm-1',
      title: 'Register Domain',
      status: 'done',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'act-active',
      workspaceId: 'ws-1',
      type: 'action',
      parentId: 'm-1',
      title: 'Setup Hosting & SSL',
      status: 'in_progress',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'act-ready-1',
      workspaceId: 'ws-1',
      type: 'action',
      parentId: 'm-1',
      title: 'Install E-commerce Engine',
      status: 'todo',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'act-ready-2',
      workspaceId: 'ws-1',
      type: 'action',
      parentId: 'm-1',
      title: 'Configure Payment Gateway',
      status: 'todo',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'act-blocked',
      workspaceId: 'ws-1',
      type: 'action',
      parentId: 'm-1',
      title: 'Launch Marketing Ads',
      status: 'todo',
      evidence: [],
      createdAt: '',
      updatedAt: '',
    },
  ];

  // Dependencies:
  // act-blocked depends on act-ready-2 (Payment Gateway must be done before Launching Ads)
  const sampleDependencies: Dependency[] = [
    {
      id: 'dep-1',
      workspaceId: 'ws-1',
      fromNodeId: 'act-ready-2',
      toNodeId: 'act-blocked',
      createdAt: '',
    },
  ];

  it('prioritizes in-progress actions first, then topologically ready actions up to three', () => {
    const summary = getTopInitiableActionsForGoal('goal-1', sampleNodes, sampleDependencies);

    expect(summary.totalActions).toBe(5);
    expect(summary.completedActions).toBe(1);
    expect(summary.inProgressCount).toBe(1);
    expect(summary.readyCount).toBe(2);
    expect(summary.blockedCount).toBe(1);

    // Exactly 3 initiable actions returned
    expect(summary.initiableActions).toHaveLength(3);

    // 1st is in-progress
    expect(summary.initiableActions[0].id).toBe('act-active');

    // 2nd and 3rd are the unblocked ready tasks
    const remainingIds = [summary.initiableActions[1].id, summary.initiableActions[2].id];
    expect(remainingIds).toContain('act-ready-1');
    expect(remainingIds).toContain('act-ready-2');

    // Blocked task is NOT in top initiable actions
    expect(remainingIds).not.toContain('act-blocked');
    // Verify milestoneTitle is populated on initiable actions
    expect(summary.initiableActions[0].milestoneTitle).toBe('Storefront Setup');
  });

  it('respects topological causal ordering among ready actions', () => {
    // Let act-ready-2 depend on act-ready-1:
    // act-ready-1 must precede act-ready-2
    const dependencies: Dependency[] = [
      { id: 'd1', workspaceId: 'ws-1', fromNodeId: 'act-ready-1', toNodeId: 'act-ready-2', createdAt: '' },
      { id: 'd2', workspaceId: 'ws-1', fromNodeId: 'act-ready-2', toNodeId: 'act-blocked', createdAt: '' },
    ];

    // Node act-ready-2 is now blocked by act-ready-1
    const summary = getTopInitiableActionsForGoal('goal-1', sampleNodes, dependencies);

    expect(summary.initiableActions.map((a) => a.id)).toEqual(['act-active', 'act-ready-1']);
    expect(summary.blockedCount).toBe(2); // act-ready-2 and act-blocked
  });

  it('excludes actions from blocked milestone when milestone dependency is not met', () => {
    const multiMilestoneNodes: Node[] = [
      sampleGoal,
      {
        id: 'm-1',
        workspaceId: 'ws-1',
        type: 'milestone',
        parentId: 'goal-1',
        title: 'Phase 1',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'act-m1',
        workspaceId: 'ws-1',
        type: 'action',
        parentId: 'm-1',
        title: 'Task in Phase 1',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'm-2',
        workspaceId: 'ws-1',
        type: 'milestone',
        parentId: 'goal-1',
        title: 'Phase 2',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'act-m2',
        workspaceId: 'ws-1',
        type: 'action',
        parentId: 'm-2',
        title: 'Task in Phase 2',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
    ];

    // m-2 depends on m-1
    const dependencies: Dependency[] = [
      { id: 'dep-m', workspaceId: 'ws-1', fromNodeId: 'm-1', toNodeId: 'm-2', createdAt: '' },
    ];

    const summary = getTopInitiableActionsForGoal('goal-1', multiMilestoneNodes, dependencies);

    // act-m1 is ready; act-m2 is blocked by milestone m-1
    expect(summary.initiableActions.map((a) => a.id)).toEqual(['act-m1']);
    expect(summary.blockedCount).toBe(1);
    expect(summary.readyCount).toBe(1);
  });

  it('handles goals with all actions completed', () => {
    const completedNodes: Node[] = [
      sampleGoal,
      {
        id: 'm-1',
        workspaceId: 'ws-1',
        type: 'milestone',
        parentId: 'goal-1',
        title: 'Milestone 1',
        status: 'done',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'act-1',
        workspaceId: 'ws-1',
        type: 'action',
        parentId: 'm-1',
        title: 'Task 1',
        status: 'done',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'act-2',
        workspaceId: 'ws-1',
        type: 'action',
        parentId: 'm-1',
        title: 'Task 2',
        status: 'done',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
    ];

    const summary = getTopInitiableActionsForGoal('goal-1', completedNodes, []);
    expect(summary.initiableActions).toHaveLength(0);
    expect(summary.completedActions).toBe(2);
    expect(summary.totalActions).toBe(2);
    expect(summary.progressPercent).toBe(100);
    expect(summary.isComplete).toBe(true);
  });

  it('handles goals with all remaining actions blocked', () => {
    const blockedNodes: Node[] = [
      sampleGoal,
      {
        id: 'm-1',
        workspaceId: 'ws-1',
        type: 'milestone',
        parentId: 'goal-1',
        title: 'Milestone 1',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'act-prereq',
        workspaceId: 'ws-1',
        type: 'action',
        parentId: null, // outside goal or in another goal
        title: 'Prerequisite in another goal',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'act-waiting',
        workspaceId: 'ws-1',
        type: 'action',
        parentId: 'm-1',
        title: 'Waiting Action',
        status: 'todo',
        evidence: [],
        createdAt: '',
        updatedAt: '',
      },
    ];

    const dependencies: Dependency[] = [
      { id: 'dep-ext', workspaceId: 'ws-1', fromNodeId: 'act-prereq', toNodeId: 'act-waiting', createdAt: '' },
    ];

    const summary = getTopInitiableActionsForGoal('goal-1', blockedNodes, dependencies);
    expect(summary.initiableActions).toHaveLength(0);
    expect(summary.blockedCount).toBe(1);
    expect(summary.isComplete).toBe(false);
  });
});
