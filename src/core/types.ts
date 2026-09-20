/**
 * Goal Guru - Domain Types
 * Conforms to CONTEXT.md and ADRs 0001-0018
 */

export type NodeType = 'goal' | 'sub_goal' | 'milestone' | 'action' | 'sub_action';

export type NodeStatus = 'todo' | 'in_progress' | 'done' | 'abandoned';

export type NodeReadiness = 'ready' | 'blocked';

export type EvidenceConfidence = 'high' | 'medium' | 'low';

export type EvidenceSourceType = 'user' | 'llm';

export interface Evidence {
  id: string;
  content: string;
  sourceUrl?: string;
  sourceTitle?: string;
  retrievedAt: string; // ISO 8601
  addedBy: EvidenceSourceType;
  confidence?: EvidenceConfidence;
}

export interface Node {
  id: string;
  workspaceId: string;
  type: NodeType;
  parentId: string | null;
  title: string;
  description?: string;
  status: NodeStatus;
  inputs?: string;
  expectedOutputs?: string;
  actualOutputs?: string;
  evidence: Evidence[];
  archivedAt?: string | null; // ISO 8601 when archived
  createdAt: string;
  updatedAt: string;
}

export interface Dependency {
  id: string;
  workspaceId: string;
  fromNodeId: string; // The dependent node (e.g. Action A)
  toNodeId: string;   // The dependency target node that must be completed first (e.g. Action B)
  createdAt: string;
}

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string; // Google OAuth sub or local offline id
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

/**
 * Valid parent-child nesting rules (ADR 0001 & ADR 0004)
 */
export function isValidParentChild(parentType: NodeType | null, childType: NodeType): boolean {
  if (parentType === null) {
    // Top-level must be a Goal
    return childType === 'goal';
  }

  switch (parentType) {
    case 'goal':
    case 'sub_goal':
      // Goals can contain sub-goals, milestones, or direct actions (ADR 0004)
      return childType === 'sub_goal' || childType === 'milestone' || childType === 'action';
    case 'milestone':
      // Milestones contain actions
      return childType === 'action';
    case 'action':
    case 'sub_action':
      // Actions can recursively contain sub-actions
      return childType === 'sub_action';
    default:
      return false;
  }
}

/**
 * Valid dependency target rules (ADR 0001 & ADR 0003)
 * Dependencies are allowed between Actions and Milestones. Goals cannot have direct dependencies.
 */
export function isValidDependencyType(fromType: NodeType, toType: NodeType): boolean {
  const allowedTypes: NodeType[] = ['action', 'sub_action', 'milestone'];
  return allowedTypes.includes(fromType) && allowedTypes.includes(toType);
}
