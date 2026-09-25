import { Node, Dependency, NodeReadiness, NodeStatus } from './types.js';

export interface NodeReadinessInfo {
  readiness: NodeReadiness;
  blockingNodeIds: string[];
  blockingNodeTitles?: string[];
}

/**
 * Computes derived execution status for a milestone based on its child actions.
 * - Empty milestone: 'todo'
 * - 100% of actions abandoned: 'abandoned'
 * - All actions done or abandoned (with >= 1 done): 'done'
 * - At least one action in_progress or done: 'in_progress'
 * - Otherwise: 'todo'
 */
export function deriveMilestoneStatus(milestoneId: string, allNodes: Node[]): NodeStatus {
  const childActions = allNodes.filter((n) => n.parentId === milestoneId && n.type === 'action' && !n.archivedAt);
  if (childActions.length === 0) return 'todo';

  const allAbandoned = childActions.every((a) => a.status === 'abandoned');
  if (allAbandoned) return 'abandoned';

  const nonAbandoned = childActions.filter((a) => a.status !== 'abandoned');
  const allDoneOrAbandoned = childActions.every((a) => a.status === 'done' || a.status === 'abandoned');
  if (allDoneOrAbandoned && nonAbandoned.length > 0) return 'done';

  const anyStarted = childActions.some((a) => a.status === 'in_progress' || a.status === 'done');
  if (anyStarted) return 'in_progress';

  return 'todo';
}

/**
 * Computes dynamic readiness for all nodes based on dependency states (ADR 0003)
 * A dependency edge `fromNodeId -> toNodeId` indicates that `fromNodeId` is a prerequisite
 * that must be 'done' before `toNodeId` can proceed.
 * 
 * Strict Milestone Cascading:
 * If Milestone B depends on Milestone A, any action inside Milestone B is blocked until
 * Milestone A is completed ('done').
 */
export function computeReadiness(
  nodes: Node[],
  dependencies: Dependency[]
): Map<string, NodeReadinessInfo> {
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Pre-calculate derived status for milestones
  const milestoneDerivedStatus = new Map<string, NodeStatus>();
  for (const node of nodes) {
    if (node.type === 'milestone') {
      milestoneDerivedStatus.set(node.id, deriveMilestoneStatus(node.id, nodes));
    }
  }

  const getEffectiveStatus = (node: Node): NodeStatus => {
    if (node.type === 'milestone') {
      return milestoneDerivedStatus.get(node.id) || 'todo';
    }
    return node.status;
  };

  // Group dependencies by dependent node (toNodeId) -> list of prerequisite IDs (fromNodeIds)
  const prereqsByDependent = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!prereqsByDependent.has(dep.toNodeId)) {
      prereqsByDependent.set(dep.toNodeId, []);
    }
    prereqsByDependent.get(dep.toNodeId)!.push(dep.fromNodeId);
  }

  const result = new Map<string, NodeReadinessInfo>();

  for (const node of nodes) {
    const blockingNodeIds: string[] = [];
    const blockingNodeTitles: string[] = [];

    // 1. Direct dependencies targeting this node
    const prereqIds = prereqsByDependent.get(node.id) || [];
    for (const prereqId of prereqIds) {
      const prereqNode = nodeMap.get(prereqId);
      if (!prereqNode || getEffectiveStatus(prereqNode) !== 'done') {
        blockingNodeIds.push(prereqId);
        blockingNodeTitles.push(prereqNode ? prereqNode.title : prereqId);
      }
    }

    // 2. Strict Milestone Cascading: If this node is an action, it is blocked if its parent milestone is blocked
    if (node.type === 'action' && node.parentId) {
      const parentMilestone = nodeMap.get(node.parentId);
      if (parentMilestone && parentMilestone.type === 'milestone') {
        const milestonePrereqIds = prereqsByDependent.get(parentMilestone.id) || [];
        for (const msPrereqId of milestonePrereqIds) {
          const msPrereqNode = nodeMap.get(msPrereqId);
          if (!msPrereqNode || getEffectiveStatus(msPrereqNode) !== 'done') {
            if (!blockingNodeIds.includes(msPrereqId)) {
              blockingNodeIds.push(msPrereqId);
              blockingNodeTitles.push(msPrereqNode ? msPrereqNode.title : msPrereqId);
            }
          }
        }
      }
    }

    const readiness: NodeReadiness = blockingNodeIds.length > 0 ? 'blocked' : 'ready';
    result.set(node.id, { readiness, blockingNodeIds, blockingNodeTitles });
  }

  return result;
}
