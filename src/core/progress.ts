import { Node, NodeType, NodeStatus } from './types.js';
import { NodeReadinessInfo } from './readiness.js';

export interface ProgressMetric {
  total: number;
  completed: number;
  inProgress: number;
  todo: number;
  abandoned: number;
  percentage: number; // 0 to 100
}

export interface RingData {
  id: string;
  label: string;
  category?: string;
  completed: number;
  total: number;
  percentage: number; // 0 to 100
  color: string;
  bgColor?: string;
}

export interface ReadinessPipeline {
  ready: Node[];
  inProgress: Node[];
  blocked: Node[];
  done: Node[];
  abandoned: Node[];
}

export interface GoalProgressInfo {
  goal: Node;
  totalActions: number;
  completedActions: number;
  percentage: number;
  milestonesCount: number;
  completedMilestonesCount: number;
  status: NodeStatus;
}

export interface WorkspaceProgressSummary {
  overallPercentage: number;
  totalNodes: number;
  completedNodes: number;
  actions: ProgressMetric;
  milestones: ProgressMetric;
  goals: ProgressMetric;
  pipeline: ReadinessPipeline;
  tierRings: RingData[];
  goalRings: RingData[];
  goalSummaries: GoalProgressInfo[];
}

const DEFAULT_RING_COLORS = [
  '#10b981', // Emerald / Green
  '#6366f1', // Indigo / Purple
  '#06b6d4', // Cyan
  '#f59e0b', // Amber / Orange
  '#ec4899', // Pink
  '#8b5cf6', // Violet
];

/**
 * Recursively retrieves all descendant nodes of a given parent node.
 */
export function getDescendantNodes(parentId: string, nodes: Node[]): Node[] {
  const childrenMap = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.parentId) {
      if (!childrenMap.has(node.parentId)) {
        childrenMap.set(node.parentId, []);
      }
      childrenMap.get(node.parentId)!.push(node);
    }
  }

  const descendants: Node[] = [];
  const queue: string[] = [parentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = childrenMap.get(currentId) || [];
    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

/**
 * Computes the progress percentage and action counts for a specific node and its subtree.
 */
export function computeNodeProgress(node: Node, allNodes: Node[]): { completed: number; total: number; percentage: number } {
  if (node.type === 'action' || node.type === 'sub_action') {
    const descendants = getDescendantNodes(node.id, allNodes);
    const subActions = descendants.filter((n) => n.type === 'sub_action');

    if (subActions.length === 0) {
      const isDone = node.status === 'done' ? 1 : 0;
      return { completed: isDone, total: 1, percentage: isDone ? 100 : 0 };
    }

    const total = subActions.length + 1;
    const completed = (node.status === 'done' ? 1 : 0) + subActions.filter((n) => n.status === 'done').length;
    return {
      completed,
      total,
      percentage: Math.round((completed / total) * 100),
    };
  }

  // For Goal, Sub-Goal, Milestone: aggregate descendant actions & sub-actions
  const descendants = getDescendantNodes(node.id, allNodes);
  const actions = descendants.filter((n) => n.type === 'action' || n.type === 'sub_action');

  if (actions.length === 0) {
    // If no child actions exist, fallback to direct node status
    const isDone = node.status === 'done' ? 1 : 0;
    return { completed: isDone, total: 1, percentage: isDone ? 100 : 0 };
  }

  const completed = actions.filter((n) => n.status === 'done').length;
  const total = actions.length;
  return {
    completed,
    total,
    percentage: Math.round((completed / total) * 100),
  };
}

/**
 * Computes progress metrics for a specific subset of nodes (e.g. actions, milestones, goals).
 */
export function computeMetricGroup(nodes: Node[]): ProgressMetric {
  const total = nodes.length;
  if (total === 0) {
    return { total: 0, completed: 0, inProgress: 0, todo: 0, abandoned: 0, percentage: 0 };
  }

  const completed = nodes.filter((n) => n.status === 'done').length;
  const inProgress = nodes.filter((n) => n.status === 'in_progress').length;
  const todo = nodes.filter((n) => n.status === 'todo').length;
  const abandoned = nodes.filter((n) => n.status === 'abandoned').length;
  const percentage = Math.round((completed / total) * 100);

  return { total, completed, inProgress, todo, abandoned, percentage };
}

/**
 * Computes comprehensive workspace progress summary, including multi-ring chart datasets
 * and execution readiness pipeline.
 */
export function computeWorkspaceProgress(
  nodes: Node[],
  readinessMap?: Map<string, NodeReadinessInfo> | Record<string, NodeReadinessInfo>
): WorkspaceProgressSummary {
  const actionsList = nodes.filter((n) => n.type === 'action' || n.type === 'sub_action');
  const milestonesList = nodes.filter((n) => n.type === 'milestone');
  const goalsList = nodes.filter((n) => n.type === 'goal' || n.type === 'sub_goal');
  const rootGoals = nodes.filter((n) => n.type === 'goal');

  const actions = computeMetricGroup(actionsList);
  const milestones = computeMetricGroup(milestonesList);
  const goals = computeMetricGroup(goalsList);

  const totalNodes = nodes.length;
  const completedNodes = nodes.filter((n) => n.status === 'done').length;
  const overallPercentage = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

  // Readiness pipeline categorization
  const pipeline: ReadinessPipeline = {
    ready: [],
    inProgress: [],
    blocked: [],
    done: [],
    abandoned: [],
  };

  const getReadiness = (nodeId: string): string => {
    if (!readinessMap) return 'ready';
    if (readinessMap instanceof Map) {
      return readinessMap.get(nodeId)?.readiness || 'ready';
    }
    return (readinessMap as Record<string, NodeReadinessInfo>)[nodeId]?.readiness || 'ready';
  };

  for (const node of nodes) {
    if (node.status === 'done') {
      pipeline.done.push(node);
    } else if (node.status === 'abandoned') {
      pipeline.abandoned.push(node);
    } else if (getReadiness(node.id) === 'blocked') {
      pipeline.blocked.push(node);
    } else if (node.status === 'in_progress') {
      pipeline.inProgress.push(node);
    } else {
      pipeline.ready.push(node);
    }
  }

  // Tier Rings (Concentric Rings: Actions outer, Milestones middle, Goals inner)
  const tierRings: RingData[] = [
    {
      id: 'ring_actions',
      label: 'Actions & Tasks',
      category: 'execution',
      completed: actions.completed,
      total: actions.total,
      percentage: actions.percentage,
      color: '#10b981', // Emerald green
      bgColor: '#a7f3d0',
    },
    {
      id: 'ring_milestones',
      label: 'Milestones',
      category: 'checkpoints',
      completed: milestones.completed,
      total: milestones.total,
      percentage: milestones.percentage,
      color: '#6366f1', // Brand Indigo
      bgColor: '#c7d2fe',
    },
    {
      id: 'ring_goals',
      label: 'Goals & Objectives',
      category: 'outcomes',
      completed: goals.completed,
      total: goals.total,
      percentage: goals.percentage,
      color: '#06b6d4', // Cyan
      bgColor: '#a5f3fc',
    },
  ];

  // Per-Goal breakdown & Goal Rings
  const goalSummaries: GoalProgressInfo[] = [];
  const goalRings: RingData[] = [];

  rootGoals.forEach((goal, index) => {
    const descendants = getDescendantNodes(goal.id, nodes);
    const goalActions = descendants.filter((n) => n.type === 'action' || n.type === 'sub_action');
    const goalMilestones = descendants.filter((n) => n.type === 'milestone');

    const totalActions = goalActions.length;
    const completedActions = goalActions.filter((n) => n.status === 'done').length;
    const milestonesCount = goalMilestones.length;
    const completedMilestonesCount = goalMilestones.filter((n) => n.status === 'done').length;

    let percentage = 0;
    if (totalActions > 0) {
      percentage = Math.round((completedActions / totalActions) * 100);
    } else {
      percentage = goal.status === 'done' ? 100 : 0;
    }

    goalSummaries.push({
      goal,
      totalActions,
      completedActions,
      percentage,
      milestonesCount,
      completedMilestonesCount,
      status: goal.status,
    });

    const color = DEFAULT_RING_COLORS[index % DEFAULT_RING_COLORS.length];
    goalRings.push({
      id: `ring_goal_${goal.id}`,
      label: goal.title,
      category: 'goal',
      completed: completedActions,
      total: totalActions,
      percentage,
      color,
    });
  });

  return {
    overallPercentage,
    totalNodes,
    completedNodes,
    actions,
    milestones,
    goals,
    pipeline,
    tierRings,
    goalRings,
    goalSummaries,
  };
}
