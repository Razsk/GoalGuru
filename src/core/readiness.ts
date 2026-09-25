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

/**
 * Computes all effective dependencies in the graph, integrating:
 * 1. Explicit direct dependencies (`fromNodeId -> toNodeId`).
 * 2. Cascaded dependencies from prerequisite milestones to the entry actions of dependent milestones.
 * 3. Dynamic guarantee: Any node marked 'blocked' by computeReadiness is guaranteed to have a directed edge
 *    pointing to it from its blocking node(s).
 */
export function computeEffectiveDependencies(
  nodes: Node[],
  dependencies: Dependency[],
  readinessMap?: Map<string, NodeReadinessInfo>
): Dependency[] {
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const result: Dependency[] = [...dependencies];
  const edgeKeys = new Set(dependencies.map((d) => `${d.fromNodeId}->${d.toNodeId}`));

  // 1. Milestone cascading for entry actions of dependent milestones
  for (const dep of dependencies) {
    const fromNode = nodeMap.get(dep.fromNodeId);
    const toNode = nodeMap.get(dep.toNodeId);
    if (fromNode?.type === 'milestone' && toNode?.type === 'milestone') {
      const childActions = nodes.filter(
        (n) => n.parentId === toNode.id && n.type === 'action' && !n.archivedAt
      );
      for (const action of childActions) {
        // Is this an entry action in toNode? (i.e. has no inbound action deps within toNode)
        const hasInternalInboundDep = dependencies.some(
          (d) => d.toNodeId === action.id && nodeMap.get(d.fromNodeId)?.parentId === toNode.id
        );
        if (!hasInternalInboundDep) {
          const key = `${dep.fromNodeId}->${action.id}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            result.push({
              id: `cascaded_${dep.fromNodeId}_${action.id}`,
              workspaceId: dep.workspaceId || action.workspaceId,
              fromNodeId: dep.fromNodeId,
              toNodeId: action.id,
              createdAt: dep.createdAt || action.createdAt || new Date().toISOString(),
              isCascaded: true,
            });
          }
        }
      }
    }
  }

  // 2. Guarantee: Every blocker in blockingNodeIds must have a directed edge to the blocked node
  const rMap = readinessMap || computeReadiness(nodes, dependencies);
  for (const node of nodes) {
    const info = rMap.get(node.id);
    if (info?.readiness === 'blocked' && info.blockingNodeIds) {
      for (const blockerId of info.blockingNodeIds) {
        const key = `${blockerId}->${node.id}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          result.push({
            id: `cascaded_${blockerId}_${node.id}`,
            workspaceId: node.workspaceId,
            fromNodeId: blockerId,
            toNodeId: node.id,
            createdAt: node.createdAt || new Date().toISOString(),
            isCascaded: true,
          });
        }
      }
    }
  }

  return result;
}

