import { Node, Dependency, NodeReadiness } from './types.js';

export interface NodeReadinessInfo {
  readiness: NodeReadiness;
  blockingNodeIds: string[];
}

/**
 * Computes dynamic readiness for all nodes based on dependency states (ADR 0003)
 * A node is 'blocked' if any prerequisite node (toNodeId) has status !== 'done'.
 * Otherwise, the node is 'ready'.
 */
export function computeReadiness(
  nodes: Node[],
  dependencies: Dependency[]
): Map<string, NodeReadinessInfo> {
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Group dependencies by dependent node (fromNodeId)
  const depsByFromNode = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!depsByFromNode.has(dep.fromNodeId)) {
      depsByFromNode.set(dep.fromNodeId, []);
    }
    depsByFromNode.get(dep.fromNodeId)!.push(dep.toNodeId);
  }

  const result = new Map<string, NodeReadinessInfo>();

  for (const node of nodes) {
    const prerequisiteIds = depsByFromNode.get(node.id) || [];
    const blockingNodeIds: string[] = [];

    for (const prereqId of prerequisiteIds) {
      const prereqNode = nodeMap.get(prereqId);
      // If prerequisite doesn't exist or is not done, it blocks this node
      if (!prereqNode || prereqNode.status !== 'done') {
        blockingNodeIds.push(prereqId);
      }
    }

    const readiness: NodeReadiness = blockingNodeIds.length > 0 ? 'blocked' : 'ready';
    result.set(node.id, { readiness, blockingNodeIds });
  }

  return result;
}
