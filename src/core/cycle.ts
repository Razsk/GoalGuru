import { Dependency } from './types.js';

export interface CycleResult {
  hasCycle: boolean;
  cycleNodes: string[];
}

/**
 * Kahn's algorithm for topological sorting and cycle detection (ADR 0012)
 * In our model: fromNodeId depends on toNodeId (toNodeId must be completed first).
 * Therefore, directed edge for processing order is: toNodeId -> fromNodeId.
 */
export function detectCycle(
  dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[]
): CycleResult {
  if (dependencies.length === 0) {
    return { hasCycle: false, cycleNodes: [] };
  }

  // Build adjacency list (toNode -> array of fromNodes that depend on it)
  // and calculate in-degree (number of incoming dependencies each fromNode has)
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const allNodes = new Set<string>();

  for (const dep of dependencies) {
    allNodes.add(dep.fromNodeId);
    allNodes.add(dep.toNodeId);

    if (!adjacency.has(dep.toNodeId)) {
      adjacency.set(dep.toNodeId, []);
    }
    adjacency.get(dep.toNodeId)!.push(dep.fromNodeId);

    inDegree.set(dep.fromNodeId, (inDegree.get(dep.fromNodeId) || 0) + 1);
    if (!inDegree.has(dep.toNodeId)) {
      inDegree.set(dep.toNodeId, 0);
    }
  }

  // Queue of nodes with 0 in-degree (no incoming dependencies)
  const queue: string[] = [];
  for (const node of allNodes) {
    if ((inDegree.get(node) || 0) === 0) {
      queue.push(node);
    }
  }

  let visitedCount = 0;
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    visited.add(current);
    visitedCount++;

    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      const currentInDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, currentInDegree);
      if (currentInDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (visitedCount === allNodes.size) {
    return { hasCycle: false, cycleNodes: [] };
  }

  // Nodes with remaining in-degree > 0 are part of a cycle or downstream of one
  // To find only the nodes in the cycle, backtrack strongly connected components or nodes where all ancestors are unvisited
  const cycleCandidateNodes = Array.from(allNodes).filter((node) => !visited.has(node));

  // Prune downstream leaf nodes that aren't themselves part of the cycle
  // A node is strictly in a cycle if it can reach itself
  const cycleNodes: string[] = [];
  for (const candidate of cycleCandidateNodes) {
    if (canReach(candidate, candidate, adjacency, new Set<string>())) {
      cycleNodes.push(candidate);
    }
  }

  return {
    hasCycle: true,
    cycleNodes: cycleNodes.length > 0 ? cycleNodes : cycleCandidateNodes,
  };
}

function canReach(
  start: string,
  target: string,
  adjacency: Map<string, string[]>,
  visited: Set<string>
): boolean {
  const neighbors = adjacency.get(start) || [];
  for (const next of neighbors) {
    if (next === target) return true;
    if (!visited.has(next)) {
      visited.add(next);
      if (canReach(next, target, adjacency, visited)) return true;
    }
  }
  return false;
}
