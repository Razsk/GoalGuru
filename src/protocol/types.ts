import { NodeType, NodeStatus, EvidenceConfidence } from '../core/types.js';

export interface CreateNodeMutation {
  type: 'create_node';
  tempId?: string;
  nodeId?: string; // assigned when resolved
  nodeType: NodeType;
  parentId?: string | null;
  title: string;
  description?: string;
  inputs?: string;
  expectedOutputs?: string;
  actualOutputs?: string;
}

export interface UpdateNodeMutation {
  type: 'update_node';
  nodeId: string;
  title?: string;
  description?: string;
  inputs?: string;
  expectedOutputs?: string;
  actualOutputs?: string;
}

export interface UpdateStatusMutation {
  type: 'update_status';
  nodeId: string;
  status: NodeStatus;
  comment?: string;
}

export interface DeleteNodeMutation {
  type: 'delete_node';
  nodeId: string;
}

export interface AddDependencyMutation {
  type: 'add_dependency';
  fromNodeId: string;
  toNodeId: string;
}

export interface RemoveDependencyMutation {
  type: 'remove_dependency';
  fromNodeId: string;
  toNodeId: string;
}

export interface AddEvidenceMutation {
  type: 'add_evidence';
  evidenceId?: string;
  nodeId: string;
  content: string;
  sourceUrl?: string;
  sourceTitle?: string;
  confidence?: EvidenceConfidence;
}

export interface RemoveEvidenceMutation {
  type: 'remove_evidence';
  evidenceId: string;
}

export type Mutation =
  | CreateNodeMutation
  | UpdateNodeMutation
  | UpdateStatusMutation
  | DeleteNodeMutation
  | AddDependencyMutation
  | RemoveDependencyMutation
  | AddEvidenceMutation
  | RemoveEvidenceMutation;

export interface ProposalAdvice {
  summary?: string;
  critique?: string;
  nextSteps?: string;
}

export interface ProposalEnvelope {
  protocolVersion: string;
  stateVersion: number;
  advice?: ProposalAdvice;
  changeSet: Mutation[];
}
