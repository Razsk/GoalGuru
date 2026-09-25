import { Node, Dependency } from './types.js';
import { topologicalSort } from './cycle.js';
import { getDescendantNodes } from './progress.js';
import { computeReadiness, NodeReadinessInfo } from './readiness.js';

export interface ActionWithMilestoneContext extends Node {
  milestoneTitle?: string;
  milestoneId?: string;
}

export interface GoalTopActionsSummary {
  goalId: string;
  totalActions: number;
  completedActions: number;
  progressPercent: number;
  inProgressCount: number;
  readyCount: number;
  blockedCount: number;
  initiableActions: ActionWithMilestoneContext[];
  isComplete: boolean;
}

/**
 * Computes the top three actions that can be initiated for a specific goal.
 * Prioritizes:
 * 1. In-progress actions (already underway, highest active execution priority)
 * 2. Ready actions (zero unmet blockers, unblocked to execute right now), ordered topologically
 * Excludes completed or abandoned actions, as well as actions blocked by prerequisites or parent milestone dependencies.
 */
export function getTopInitiableActionsForGoal(
  goalId: string,
  allNodes: Node[],
  dependencies: Dependency[],
  readinessMap?: Map<string, NodeReadinessInfo>
): GoalTopActionsSummary {
  const goal = allNodes.find((n) => n.id === goalId);
  const activeNodes = allNodes.filter((n) => !n.archivedAt);
  const descendants = getDescendantNodes(goalId, activeNodes);
  const actions = descendants.filter((n) => n.type === 'action');

  const computedReadiness = readinessMap || computeReadiness(activeNodes, dependencies);

  const totalActions = actions.length;
  const completedActions = actions.filter((a) => a.status === 'done').length;
  const progressPercent = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : (goal?.status === 'done' ? 100 : 0);

  const uncompleted = actions.filter((a) => a.status !== 'done' && a.status !== 'abandoned');
  const sortedUncompleted = topologicalSort(uncompleted, dependencies);

  const inProgress = sortedUncompleted.filter((a) => a.status === 'in_progress');
  const ready = sortedUncompleted.filter((a) => a.status === 'todo' && computedReadiness.get(a.id)?.readiness !== 'blocked');
  const blocked = sortedUncompleted.filter((a) => a.status === 'todo' && computedReadiness.get(a.id)?.readiness === 'blocked');

  const initiable = [...inProgress, ...ready];
  const topThree: ActionWithMilestoneContext[] = initiable.slice(0, 3).map((a) => {
    let milestoneTitle: string | undefined;
    let milestoneId: string | undefined;
    if (a.parentId) {
      const parentNode = allNodes.find((n) => n.id === a.parentId);
      if (parentNode && parentNode.type === 'milestone') {
        milestoneId = parentNode.id;
        milestoneTitle = parentNode.title;
      }
    }
    return {
      ...a,
      milestoneId,
      milestoneTitle,
    };
  });

  return {
    goalId,
    totalActions,
    completedActions,
    progressPercent,
    inProgressCount: inProgress.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    initiableActions: topThree,
    isComplete: goal?.status === 'done' || (totalActions > 0 && completedActions === totalActions),
  };
}
