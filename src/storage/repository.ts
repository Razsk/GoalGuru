import { DatabaseSync } from 'node:sqlite';
import { User, Workspace, Node, Dependency, Evidence, NodeType, NodeStatus, isValidParentChild, isValidDependencyType } from '../core/types.js';
import { Mutation } from '../protocol/types.js';
import { generateId, generateNodeId } from '../core/id.js';
import { generateInverseMutations } from '../protocol/changeset.js';

export interface CollisionResult {
  hasCollision: boolean;
  collidingNodeIds: string[];
}

export class Repository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        state_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        inputs TEXT,
        expected_outputs TEXT,
        actual_outputs TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS dependencies (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY(to_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
        UNIQUE(workspace_id, from_node_id, to_node_id)
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        content TEXT NOT NULL,
        source_url TEXT,
        source_title TEXT,
        retrieved_at TEXT NOT NULL,
        added_by TEXT NOT NULL DEFAULT 'user',
        confidence TEXT,
        FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS proposals_applied (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        base_state_version INTEGER NOT NULL,
        new_state_version INTEGER NOT NULL,
        advice_summary TEXT,
        applied_mutations_json TEXT NOT NULL,
        inverse_mutations_json TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `);
  }

  // --- Users & Workspaces ---

  ensureUser(user: { id: string; email: string; displayName: string; avatarUrl?: string }): User {
    const existing = this.db
      .prepare('SELECT id, email, display_name as displayName, avatar_url as avatarUrl, created_at as createdAt FROM users WHERE id = ?')
      .get(user.id) as unknown as User | undefined;

    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO users (id, email, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.displayName, user.avatarUrl || null, now);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: now,
    };
  }

  createWorkspace(userId: string, name: string): Workspace {
    const id = generateId('ws');
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO workspaces (id, user_id, name, state_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, userId, name, now, now);

    return {
      id,
      userId,
      name,
      createdAt: now,
      updatedAt: now,
    };
  }

  listWorkspaces(userId: string): Workspace[] {
    const rows = this.db
      .prepare('SELECT id, user_id as userId, name, created_at as createdAt, updated_at as updatedAt FROM workspaces WHERE user_id = ? ORDER BY created_at ASC')
      .all(userId) as unknown as Workspace[];
    return rows;
  }

  getStateVersion(workspaceId: string): number {
    const row = this.db
      .prepare('SELECT state_version as stateVersion FROM workspaces WHERE id = ?')
      .get(workspaceId) as unknown as { stateVersion: number } | undefined;
    return row ? row.stateVersion : 1;
  }

  incrementStateVersion(workspaceId: string): number {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE workspaces SET state_version = state_version + 1, updated_at = ? WHERE id = ?')
      .run(now, workspaceId);
    return this.getStateVersion(workspaceId);
  }

  // --- Nodes & Evidence ---

  createNode(params: {
    workspaceId: string;
    id?: string;
    type: NodeType;
    parentId: string | null;
    title: string;
    description?: string;
    status?: NodeStatus;
    inputs?: string;
    expectedOutputs?: string;
    actualOutputs?: string;
  }): Node {
    // Validate hierarchy constraints (ADR 0001 & ADR 0004)
    let parentType: NodeType | null = null;
    if (params.parentId) {
      const parentNode = this.getNode(params.parentId);
      if (parentNode) {
        parentType = parentNode.type;
      }
    }
    if (!isValidParentChild(parentType, params.type)) {
      throw new Error(`Invalid hierarchy: node of type '${params.type}' cannot be child of '${parentType}'.`);
    }

    const id = params.id || generateNodeId(params.type);
    const now = new Date().toISOString();
    const status = params.status || 'todo';
    const version = this.getStateVersion(params.workspaceId);

    this.db
      .prepare(`
        INSERT INTO nodes (id, workspace_id, type, parent_id, title, description, status, inputs, expected_outputs, actual_outputs, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        params.workspaceId,
        params.type,
        params.parentId,
        params.title,
        params.description || null,
        status,
        params.inputs || null,
        params.expectedOutputs || null,
        params.actualOutputs || null,
        version,
        now,
        now
      );

    return {
      id,
      workspaceId: params.workspaceId,
      type: params.type,
      parentId: params.parentId,
      title: params.title,
      description: params.description,
      status,
      inputs: params.inputs,
      expectedOutputs: params.expectedOutputs,
      actualOutputs: params.actualOutputs,
      evidence: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  updateNode(nodeId: string, updates: Partial<Node>): void {
    const existing = this.getNode(nodeId);
    if (!existing) return;

    const newVersion = this.incrementStateVersion(existing.workspaceId);
    const title = updates.title !== undefined ? updates.title : existing.title;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const status = updates.status !== undefined ? updates.status : existing.status;
    const inputs = updates.inputs !== undefined ? updates.inputs : existing.inputs;
    const expectedOutputs = updates.expectedOutputs !== undefined ? updates.expectedOutputs : existing.expectedOutputs;
    const actualOutputs = updates.actualOutputs !== undefined ? updates.actualOutputs : existing.actualOutputs;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE nodes
        SET title = ?, description = ?, status = ?, inputs = ?, expected_outputs = ?, actual_outputs = ?, version = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(title, description || null, status, inputs || null, expectedOutputs || null, actualOutputs || null, newVersion, now, nodeId);
  }

  deleteNode(nodeId: string): void {
    const existing = this.getNode(nodeId);
    if (!existing) return;

    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    this.incrementStateVersion(existing.workspaceId);
  }

  listNodes(workspaceId: string): Node[] {
    const rows = this.db
      .prepare(`
        SELECT id, workspace_id as workspaceId, type, parent_id as parentId, title, description, status,
               inputs, expected_outputs as expectedOutputs, actual_outputs as actualOutputs,
               created_at as createdAt, updated_at as updatedAt
        FROM nodes
        WHERE workspace_id = ?
        ORDER BY created_at ASC
      `)
      .all(workspaceId) as unknown as Node[];

    // Fetch evidence for all nodes in workspace
    const evidenceRows = this.db
      .prepare(`
        SELECT e.id, e.node_id as nodeId, e.content, e.source_url as sourceUrl,
               e.source_title as sourceTitle, e.retrieved_at as retrievedAt,
               e.added_by as addedBy, e.confidence
        FROM evidence e
        JOIN nodes n ON e.node_id = n.id
        WHERE n.workspace_id = ?
      `)
      .all(workspaceId) as unknown as (Evidence & { nodeId: string })[];

    const evidenceByNode = new Map<string, Evidence[]>();
    for (const ev of evidenceRows) {
      if (!evidenceByNode.has(ev.nodeId)) {
        evidenceByNode.set(ev.nodeId, []);
      }
      evidenceByNode.get(ev.nodeId)!.push({
        id: ev.id,
        content: ev.content,
        sourceUrl: ev.sourceUrl,
        sourceTitle: ev.sourceTitle,
        retrievedAt: ev.retrievedAt,
        addedBy: ev.addedBy,
        confidence: ev.confidence,
      });
    }

    for (const node of rows) {
      node.evidence = evidenceByNode.get(node.id) || [];
    }

    return rows;
  }

  getNode(nodeId: string): Node | null {
    const row = this.db
      .prepare(`
        SELECT id, workspace_id as workspaceId, type, parent_id as parentId, title, description, status,
               inputs, expected_outputs as expectedOutputs, actual_outputs as actualOutputs,
               created_at as createdAt, updated_at as updatedAt
        FROM nodes
        WHERE id = ?
      `)
      .get(nodeId) as unknown as Node | undefined;

    if (!row) return null;

    const evidenceRows = this.db
      .prepare(`
        SELECT id, content, source_url as sourceUrl, source_title as sourceTitle,
               retrieved_at as retrievedAt, added_by as addedBy, confidence
        FROM evidence
        WHERE node_id = ?
      `)
      .all(nodeId) as unknown as Evidence[];

    row.evidence = evidenceRows;
    return row;
  }

  // --- Dependencies ---

  addDependency(workspaceId: string, fromNodeId: string, toNodeId: string): void {
    const fromNode = this.getNode(fromNodeId);
    const toNode = this.getNode(toNodeId);

    // Validate dependency target rules (ADR 0001 & ADR 0003)
    if (fromNode && toNode && !isValidDependencyType(fromNode.type, toNode.type)) {
      throw new Error(`Invalid dependency: '${fromNode.type}' cannot depend on '${toNode.type}'.`);
    }

    const id = generateId('dep');
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT OR IGNORE INTO dependencies (id, workspace_id, from_node_id, to_node_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, workspaceId, fromNodeId, toNodeId, now);
  }

  removeDependency(workspaceId: string, fromNodeId: string, toNodeId: string): void {
    this.db
      .prepare('DELETE FROM dependencies WHERE workspace_id = ? AND from_node_id = ? AND to_node_id = ?')
      .run(workspaceId, fromNodeId, toNodeId);
  }

  removeEvidence(evidenceId: string): void {
    this.db.prepare('DELETE FROM evidence WHERE id = ?').run(evidenceId);
  }

  listDependencies(workspaceId: string): Dependency[] {
    return this.db
      .prepare('SELECT id, workspace_id as workspaceId, from_node_id as fromNodeId, to_node_id as toNodeId, created_at as createdAt FROM dependencies WHERE workspace_id = ?')
      .all(workspaceId) as unknown as Dependency[];
  }

  // --- Collision Detection (ADR 0004) ---

  checkCollisions(workspaceId: string, baseStateVersion: number, mutations: Mutation[]): CollisionResult {
    const currentVersion = this.getStateVersion(workspaceId);
    if (baseStateVersion >= currentVersion) {
      return { hasCollision: false, collidingNodeIds: [] };
    }

    // Collect all target node IDs touched by incoming proposal
    const touchedNodeIds = new Set<string>();
    for (const m of mutations) {
      if (m.type === 'update_node' || m.type === 'update_status' || m.type === 'delete_node' || m.type === 'add_evidence') {
        touchedNodeIds.add(m.nodeId);
      }
    }

    if (touchedNodeIds.size === 0) {
      return { hasCollision: false, collidingNodeIds: [] };
    }

    const collidingNodeIds: string[] = [];

    // Check if any touched nodes were directly updated since baseStateVersion was recorded
    const placeholders = Array.from(touchedNodeIds).map(() => '?').join(',');
    const modifiedNodes = this.db
      .prepare(`SELECT id FROM nodes WHERE workspace_id = ? AND id IN (${placeholders}) AND version > ?`)
      .all(workspaceId, ...Array.from(touchedNodeIds), baseStateVersion) as { id: string }[];

    for (const n of modifiedNodes) {
      collidingNodeIds.push(n.id);
    }

    const colliding = Array.from(new Set(collidingNodeIds));
    return {
      hasCollision: colliding.length > 0,
      collidingNodeIds: colliding,
    };
  }

  // --- Apply Single Mutation (Deduplicated Dispatch) ---

  applyMutation(workspaceId: string, m: Mutation): void {
    switch (m.type) {
      case 'create_node': {
        this.createNode({
          workspaceId,
          id: m.nodeId,
          type: m.nodeType,
          parentId: m.parentId || null,
          title: m.title,
          description: m.description,
          inputs: m.inputs,
          expectedOutputs: m.expectedOutputs,
          actualOutputs: m.actualOutputs,
        });
        break;
      }
      case 'update_node': {
        this.updateNode(m.nodeId, {
          title: m.title,
          description: m.description,
          inputs: m.inputs,
          expectedOutputs: m.expectedOutputs,
          actualOutputs: m.actualOutputs,
        });
        break;
      }
      case 'update_status': {
        this.updateNode(m.nodeId, { status: m.status });
        break;
      }
      case 'delete_node': {
        this.deleteNode(m.nodeId);
        break;
      }
      case 'add_dependency': {
        this.addDependency(workspaceId, m.fromNodeId, m.toNodeId);
        break;
      }
      case 'remove_dependency': {
        this.removeDependency(workspaceId, m.fromNodeId, m.toNodeId);
        break;
      }
      case 'add_evidence': {
        const evId = m.evidenceId || generateId('ev');
        const now = new Date().toISOString();
        this.db
          .prepare('INSERT INTO evidence (id, node_id, content, source_url, source_title, retrieved_at, added_by, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(evId, m.nodeId, m.content, m.sourceUrl || null, m.sourceTitle || null, now, 'llm', m.confidence || null);
        break;
      }
      case 'remove_evidence': {
        this.removeEvidence(m.evidenceId);
        break;
      }
    }
  }

  // --- Commit Proposal & Undo (ADR 0016) ---

  commitProposal(params: {
    workspaceId: string;
    baseStateVersion: number;
    adviceSummary?: string;
    mutations: Mutation[];
  }): { success: boolean; newStateVersion: number } {
    const { workspaceId, baseStateVersion, adviceSummary, mutations } = params;

    const currentNodes = this.listNodes(workspaceId);

    // Compute inverse mutations before applying (ADR 0016)
    const inverseMutations = generateInverseMutations(mutations, currentNodes);

    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const m of mutations) {
        this.applyMutation(workspaceId, m);
      }

      const newStateVersion = this.incrementStateVersion(workspaceId);
      const propId = generateId('prop');
      const now = new Date().toISOString();

      this.db
        .prepare(`
          INSERT INTO proposals_applied (id, workspace_id, base_state_version, new_state_version, advice_summary, applied_mutations_json, inverse_mutations_json, applied_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          propId,
          workspaceId,
          baseStateVersion,
          newStateVersion,
          adviceSummary || null,
          JSON.stringify(mutations),
          JSON.stringify(inverseMutations),
          now
        );

      this.db.exec('COMMIT;');
      return { success: true, newStateVersion };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  undoLastProposal(workspaceId: string): { success: boolean; newStateVersion?: number } {
    const lastProposal = this.db
      .prepare('SELECT id, inverse_mutations_json as inverseJson FROM proposals_applied WHERE workspace_id = ? ORDER BY applied_at DESC LIMIT 1')
      .get(workspaceId) as { id: string; inverseJson: string } | undefined;

    if (!lastProposal) {
      return { success: false };
    }

    const inverseMutations = JSON.parse(lastProposal.inverseJson) as Mutation[];

    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const m of inverseMutations) {
        this.applyMutation(workspaceId, m);
      }

      this.db.prepare('DELETE FROM proposals_applied WHERE id = ?').run(lastProposal.id);
      const newStateVersion = this.incrementStateVersion(workspaceId);
      this.db.exec('COMMIT;');
      return { success: true, newStateVersion };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }
}
