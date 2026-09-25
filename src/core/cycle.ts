import { Dependency } from './types.js';

export interface CycleResult {
  hasCycle: boolean;
  cycleNodes: string[];
}

/**
 * Kahn's algorithm for topological sorting and cycle detection (ADR 0012)
 * In our model: fromNodeId is prerequisite, toNodeId is dependent (toNodeId depends on fromNodeId).
 * Therefore, directed execution edge is: fromNodeId -> toNodeId.
 */
export function detectCycle(
  dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[]
): CycleResult {
  if (dependencies.length === 0) {
    return { hasCycle: false, cycleNodes: [] };
  }

  // Build adjacency list (fromNode -> array of toNodes that depend on it)
  // and calculate in-degree (number of incoming prerequisites each toNode has)
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const allNodes = new Set<string>();

  for (const dep of dependencies) {
    allNodes.add(dep.fromNodeId);
    allNodes.add(dep.toNodeId);

    if (!adjacency.has(dep.fromNodeId)) {
      adjacency.set(dep.fromNodeId, []);
    }
    adjacency.get(dep.fromNodeId)!.push(dep.toNodeId);

    inDegree.set(dep.toNodeId, (inDegree.get(dep.toNodeId) || 0) + 1);
    if (!inDegree.has(dep.fromNodeId)) {
      inDegree.set(dep.fromNodeId, 0);
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

/**
 * Topological Sort (Kahn's Algorithm)
 * Orders items so that all prerequisites appear before items that depend on them.
 * Preserves stable ordering for independent nodes.
 */
export function topologicalSort<T extends { id: string }>(
  items: T[],
  dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[]
): T[] {
  if (items.length <= 1) return [...items];

  const itemMap = new Map<string, T>();
  items.forEach(item => itemMap.set(item.id, item));

  // Only consider dependencies where both nodes exist in items
  const relevantDeps = dependencies.filter(
    d => itemMap.has(d.fromNodeId) && itemMap.has(d.toNodeId)
  );

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  items.forEach(item => {
    inDegree.set(item.id, 0);
    adjacency.set(item.id, []);
  });

  relevantDeps.forEach(dep => {
    adjacency.get(dep.fromNodeId)!.push(dep.toNodeId);
    inDegree.set(dep.toNodeId, (inDegree.get(dep.toNodeId) || 0) + 1);
  });

  const queue: string[] = [];
  items.forEach(item => {
    if ((inDegree.get(item.id) || 0) === 0) {
      queue.push(item.id);
    }
  });

  const sorted: T[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    visited.add(currentId);
    sorted.push(itemMap.get(currentId)!);

    const neighbors = adjacency.get(currentId) || [];
    for (const neighborId of neighbors) {
      const remaining = (inDegree.get(neighborId) || 0) - 1;
      inDegree.set(neighborId, remaining);
      if (remaining === 0) {
        queue.push(neighborId);
      }
    }
  }

  // Any remaining nodes (e.g. if cycle exists) are appended at the end
  items.forEach(item => {
    if (!visited.has(item.id)) {
      sorted.push(item);
    }
  });

  return sorted;
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

export interface HierarchicalCycleResult {
  hasCycle: boolean;
  error?: string;
}

/**
 * Validates dependencies for both direct DAG cycles and hierarchical cross-milestone deadlocks.
 */
export function validateHierarchicalDependencies(
  dependencies: Pick<Dependency, 'fromNodeId' | 'toNodeId'>[],
  nodes: { id: string; type: string; parentId: string | null; title: string }[]
): HierarchicalCycleResult {
  // 1. Direct cycle detection across all dependencies
  const directCycle = detectCycle(dependencies);
  if (directCycle.hasCycle) {
    return {
      hasCycle: true,
      error: `Circular dependency detected involving: ${directCycle.cycleNodes.join(', ')}`,
    };
  }

  const nodeMap = new Map<string, { id: string; type: string; parentId: string | null; title: string }>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  // 2. Build milestone dependency reachability
  // fromNodeId is prerequisite, toNodeId is dependent (toNodeId depends on fromNodeId)
  const milestoneAdjacency = new Map<string, string[]>();
  for (const dep of dependencies) {
    const fromNode = nodeMap.get(dep.fromNodeId);
    const toNode = nodeMap.get(dep.toNodeId);
    if (fromNode?.type === 'milestone' && toNode?.type === 'milestone') {
      if (!milestoneAdjacency.has(dep.fromNodeId)) {
        milestoneAdjacency.set(dep.fromNodeId, []);
      }
      milestoneAdjacency.get(dep.fromNodeId)!.push(dep.toNodeId);
    }
  }

  const milestoneDependsOn = (dependent: string, prerequisite: string): boolean => {
    return canReach(prerequisite, dependent, milestoneAdjacency, new Set<string>());
  };

  // 3. Check for cross-milestone backward dependencies
  for (const dep of dependencies) {
    const fromNode = nodeMap.get(dep.fromNodeId);
    const toNode = nodeMap.get(dep.toNodeId);
    if (fromNode?.type === 'action' && toNode?.type === 'action') {
      const mFrom = fromNode.parentId;
      const mTo = toNode.parentId;
      if (mFrom && mTo && mFrom !== mTo) {
        if (milestoneDependsOn(mFrom, mTo)) {
          const fromMilestoneTitle = nodeMap.get(mFrom)?.title || mFrom;
          const toMilestoneTitle = nodeMap.get(mTo)?.title || mTo;
          return {
            hasCycle: true,
            error: `Hierarchical cycle: Action '${toNode.title}' in milestone '${toMilestoneTitle}' cannot depend on action '${fromNode.title}' in downstream milestone '${fromMilestoneTitle}'.`,
          };
        }
      }
    }
  }

  return { hasCycle: false };
}

