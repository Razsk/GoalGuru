import { Node, Dependency, NodeReadiness } from './types.js';

export interface NodeReadinessInfo {
  readiness: NodeReadiness;
  blockingNodeIds: string[];
  blockingNodeTitles?: string[];
}

/**
 * Computes dynamic readiness for all nodes based on dependency states (ADR 0003)
 * A dependency edge `fromNodeId -> toNodeId` indicates that `fromNodeId` is a prerequisite
 * that must be 'done' before `toNodeId` can proceed.
 * 
 * Therefore:
 * - A node (`toNodeId`) is 'blocked' if any prerequisite (`fromNodeId`) targeting it has status !== 'done'.
 * - Otherwise, the node is 'ready'.
 */
export function computeReadiness(
  nodes: Node[],
  dependencies: Dependency[]
): Map<string, NodeReadinessInfo> {
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

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
    const prereqIds = prereqsByDependent.get(node.id) || [];
    const blockingNodeIds: string[] = [];
    const blockingNodeTitles: string[] = [];

    for (const prereqId of prereqIds) {
      const prereqNode = nodeMap.get(prereqId);
      // If prerequisite node doesn't exist or is not done, it blocks this node
      if (!prereqNode || prereqNode.status !== 'done') {
        blockingNodeIds.push(prereqId);
        blockingNodeTitles.push(prereqNode ? prereqNode.title : prereqId);
      }
    }

    const readiness: NodeReadiness = blockingNodeIds.length > 0 ? 'blocked' : 'ready';
    result.set(node.id, { readiness, blockingNodeIds, blockingNodeTitles });
  }

  return result;
}
