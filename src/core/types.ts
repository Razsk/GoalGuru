/**
 * Goal Guru - Domain Types
 * Conforms to CONTEXT.md and ADRs 0001-0018
 */

export type NodeType = 'goal' | 'sub_goal' | 'milestone' | 'action';

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
  fromNodeId: string; // The prerequisite node that must be completed first
  toNodeId: string;   // The dependent node waiting on fromNodeId
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
 * Valid parent-child nesting rules (ADR 0001, ADR 0004 & Milestone Refactor)
 * Hierarchy is strictly: Goal -> (Sub-Goal ->) Milestone -> Action
 */
export function isValidParentChild(parentType: NodeType | null, childType: NodeType): boolean {
  if (parentType === null) {
    // Top-level must be a Goal
    return childType === 'goal';
  }

  switch (parentType) {
    case 'goal':
    case 'sub_goal':
      // Goals can contain sub-goals or milestones
      return childType === 'sub_goal' || childType === 'milestone';
    case 'milestone':
      // Milestones contain concrete actions
      return childType === 'action';
    case 'action':
      // Actions are concrete execution leaf units and cannot contain child nodes
      return false;
    default:
      return false;
  }
}

/**
 * Valid dependency target rules
 * Dependencies are allowed between Actions (intra or cross-milestone) and between Milestones.
 * Cross-type dependencies (Action <-> Milestone) and direct Goal dependencies are disallowed.
 */
export function isValidDependencyType(fromType: NodeType, toType: NodeType): boolean {
  if (fromType === 'milestone' && toType === 'milestone') return true;
  if (fromType === 'action' && toType === 'action') return true;
  return false;
}
