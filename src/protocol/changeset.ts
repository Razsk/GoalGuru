import { Mutation, CreateNodeMutation } from './types.js';
import { Node } from '../core/types.js';
import { generateId, generateNodeId } from '../core/id.js';

export interface ResolvedChangeSet {
  resolvedMutations: Mutation[];
  idMap: Map<string, string>;
}

/**
 * Resolves all temporary references (e.g. 'temp:act-1') to permanent application NanoIDs (ADR 0009)
 */
export function resolveTemporaryIds(mutations: Mutation[]): ResolvedChangeSet {
  const idMap = new Map<string, string>();

  // Pass 1: generate permanent IDs for all create_node mutations with tempId
  for (const m of mutations) {
    if (m.type === 'create_node' && m.tempId) {
      if (!idMap.has(m.tempId)) {
        idMap.set(m.tempId, generateNodeId(m.nodeType));
      }
    }
  }

  // Pass 2: rewrite all temporary references in the mutations
  const resolvedMutations = mutations.map((m): Mutation => {
    switch (m.type) {
      case 'create_node': {
        const nodeId = m.nodeId || (m.tempId ? idMap.get(m.tempId) : undefined) || generateNodeId(m.nodeType);
        const parentId = m.parentId ? (idMap.get(m.parentId) || m.parentId) : null;
        return {
          ...m,
          nodeId,
          parentId,
        };
      }
      case 'update_node':
      case 'update_status':
      case 'delete_node': {
        const nodeId = idMap.get(m.nodeId) || m.nodeId;
        return {
          ...m,
          nodeId,
        };
      }
      case 'add_dependency':
      case 'remove_dependency': {
        const fromNodeId = idMap.get(m.fromNodeId) || m.fromNodeId;
        const toNodeId = idMap.get(m.toNodeId) || m.toNodeId;
        return {
          ...m,
          fromNodeId,
          toNodeId,
        };
      }
      case 'add_evidence': {
        const nodeId = idMap.get(m.nodeId) || m.nodeId;
        const evidenceId = m.evidenceId || generateId('ev');
        return {
          ...m,
          nodeId,
          evidenceId,
        };
      }
      default:
        return m;
    }
  });

  return { resolvedMutations, idMap };
}

// Helper to get mutation key
export function getMutationKey(m: Mutation, index: number = 0): string {
  if (m.type === 'create_node') return m.tempId || m.nodeId || `create_${index}`;
  if (m.type === 'update_node') return `update_${m.nodeId}`;
  if (m.type === 'update_status') return `status_${m.nodeId}`;
  if (m.type === 'delete_node') return `delete_${m.nodeId}`;
  if (m.type === 'add_dependency') return `dep_${m.fromNodeId}_${m.toNodeId}`;
  if (m.type === 'remove_dependency') return `remdep_${m.fromNodeId}_${m.toNodeId}`;
  if (m.type === 'add_evidence') return m.evidenceId || `ev_${m.nodeId}_${index}`;
  if (m.type === 'remove_evidence') return `remev_${m.evidenceId}`;
  return `mut_${index}`;
}

/**
 * Prunes deselected mutations and applies cascading pruning for dependent and child nodes (ADR 0005)
 */
export function pruneDeselectedMutations(
  mutations: Mutation[],
  selectedKeys: Set<string>
): Mutation[] {
  // Active set of surviving node IDs / temp IDs created in this proposal
  let currentActive = mutations.filter((m, i) => {
    const key = getMutationKey(m, i);
    const altKey = m.type === 'create_node' ? m.tempId || m.nodeId : undefined;
    return selectedKeys.has(key) || (altKey && selectedKeys.has(altKey));
  });

  let changed = true;
  while (changed) {
    changed = false;
    const survivingNodeIds = new Set<string>();

    for (const m of currentActive) {
      if (m.type === 'create_node') {
        if (m.tempId) survivingNodeIds.add(m.tempId);
        if (m.nodeId) survivingNodeIds.add(m.nodeId);
      }
    }

    const nextActive: Mutation[] = [];

    for (const m of currentActive) {
      // Rule 1 (ADR 0005): If this is a create_node whose parentId was a proposed node that is now pruned, prune this child
      if (m.type === 'create_node') {
        if (m.parentId) {
          const isParentProposed =
            m.parentId.startsWith('temp:') ||
            mutations.some(
              (other) => other.type === 'create_node' && (other.tempId === m.parentId || other.nodeId === m.parentId)
            );
          if (isParentProposed && !survivingNodeIds.has(m.parentId)) {
            changed = true;
            continue; // Pruned!
          }
        }
      }

      // Rule 2: If an add_dependency references a proposed node that is no longer surviving, prune the dependency
      if (m.type === 'add_dependency') {
        const isFromProposed =
          (m.fromNodeId && m.fromNodeId.startsWith('temp:')) ||
          mutations.some(
            (other) => other.type === 'create_node' && (other.tempId === m.fromNodeId || other.nodeId === m.fromNodeId)
          );
        const isToProposed =
          (m.toNodeId && m.toNodeId.startsWith('temp:')) ||
          mutations.some(
            (other) => other.type === 'create_node' && (other.tempId === m.toNodeId || other.nodeId === m.toNodeId)
          );

        if ((isFromProposed && !survivingNodeIds.has(m.fromNodeId)) || (isToProposed && !survivingNodeIds.has(m.toNodeId))) {
          changed = true;
          continue; // Pruned!
        }
      }

      nextActive.push(m);
    }

    currentActive = nextActive;
  }

  return currentActive;
}

/**
 * Computes inverse mutations for rollbacks and undo (ADR 0016)
 */
export function generateInverseMutations(
  appliedMutations: Mutation[],
  currentNodes: Node[]
): Mutation[] {
  const nodeMap = new Map<string, Node>();
  for (const n of currentNodes) {
    nodeMap.set(n.id, n);
  }

  const inverses: Mutation[] = [];

  // Iterate in reverse order to unwind operations
  for (let i = appliedMutations.length - 1; i >= 0; i--) {
    const m = appliedMutations[i];

    switch (m.type) {
      case 'create_node': {
        const nodeId = m.nodeId || m.tempId;
        if (nodeId) {
          inverses.push({
            type: 'delete_node',
            nodeId,
          });
        }
        break;
      }
      case 'update_node': {
        const existing = nodeMap.get(m.nodeId);
        if (existing) {
          inverses.push({
            type: 'update_node',
            nodeId: m.nodeId,
            title: existing.title,
            description: existing.description,
            inputs: existing.inputs,
            expectedOutputs: existing.expectedOutputs,
            actualOutputs: existing.actualOutputs,
          });
        }
        break;
      }
      case 'update_status': {
        const existing = nodeMap.get(m.nodeId);
        if (existing) {
          inverses.push({
            type: 'update_status',
            nodeId: m.nodeId,
            status: existing.status,
          });
        }
        break;
      }
      case 'delete_node': {
        const existing = nodeMap.get(m.nodeId);
        if (existing) {
          inverses.push({
            type: 'create_node',
            nodeId: existing.id,
            nodeType: existing.type,
            parentId: existing.parentId || '',
            title: existing.title,
            description: existing.description,
            inputs: existing.inputs,
            expectedOutputs: existing.expectedOutputs,
            actualOutputs: existing.actualOutputs,
          });
        }
        break;
      }
      case 'add_dependency': {
        inverses.push({
          type: 'remove_dependency',
          fromNodeId: m.fromNodeId,
          toNodeId: m.toNodeId,
        });
        break;
      }
      case 'remove_dependency': {
        inverses.push({
          type: 'add_dependency',
          fromNodeId: m.fromNodeId,
          toNodeId: m.toNodeId,
        });
        break;
      }
      case 'add_evidence': {
        if (m.evidenceId) {
          inverses.push({
            type: 'remove_evidence',
            evidenceId: m.evidenceId,
          });
        }
        break;
      }
      case 'remove_evidence': {
        // No-op or restore if needed
        break;
      }
    }
  }

  return inverses;
}
