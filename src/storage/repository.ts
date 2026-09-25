import { DatabaseSync } from 'node:sqlite';
import { User, Workspace, Node, Dependency, Evidence, EvidenceConfidence, EvidenceSourceType, NodeType, NodeStatus, isValidParentChild, isValidDependencyType } from '../core/types.js';
import { Mutation } from '../protocol/types.js';
import { generateId, generateNodeId } from '../core/id.js';
import { generateInverseMutations } from '../protocol/changeset.js';
import { getDescendantNodes } from '../core/progress.js';
import { deriveMilestoneStatus } from '../core/readiness.js';
import { validateHierarchicalDependencies } from '../core/cycle.js';

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
        archived_at TEXT,
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

      CREATE TABLE IF NOT EXISTS dev_errors (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        context_json TEXT,
        status TEXT NOT NULL DEFAULT 'unresolved',
        fix_notes TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dev_errors_status ON dev_errors(status);
    `);

    try {
      this.db.exec('ALTER TABLE dev_errors ADD COLUMN fix_notes TEXT;');
    } catch {}
    try {
      this.db.exec('ALTER TABLE dev_errors ADD COLUMN resolved_at TEXT;');
    } catch {}
    try {
      this.db.exec('ALTER TABLE nodes ADD COLUMN archived_at TEXT;');
    } catch {}

    // Migration: Promote actions with sub-actions to milestones, and sub-actions to actions
    try {
      const subActions = this.db.prepare("SELECT * FROM nodes WHERE type = 'sub_action'").all() as any[];
      if (subActions.length > 0) {
        const parentActionIds = [...new Set(subActions.map((s) => s.parent_id).filter(Boolean))];
        for (const parentId of parentActionIds) {
          this.db.prepare("UPDATE nodes SET type = 'milestone' WHERE id = ? AND type = 'action'").run(parentId);
        }
        this.db.prepare("UPDATE nodes SET type = 'action' WHERE type = 'sub_action'").run();
      }
    } catch {}

    // Migration: Wrap any loose actions directly under goals/sub-goals into a milestone
    try {
      const looseActions = this.db.prepare(`
        SELECT a.id, a.workspace_id, a.parent_id
        FROM nodes a 
        JOIN nodes p ON a.parent_id = p.id 
        WHERE a.type = 'action' AND p.type IN ('goal', 'sub_goal')
      `).all() as any[];

      if (looseActions.length > 0) {
        const now = new Date().toISOString();
        const byParent = new Map<string, any[]>();
        for (const la of looseActions) {
          if (!byParent.has(la.parent_id)) byParent.set(la.parent_id, []);
          byParent.get(la.parent_id)!.push(la);
        }

        for (const [parentId, actions] of byParent.entries()) {
          const wsId = actions[0].workspace_id;
          const msId = generateNodeId('milestone');
          this.db.prepare(`
            INSERT INTO nodes (id, workspace_id, type, parent_id, title, description, status, version, created_at, updated_at)
            VALUES (?, ?, 'milestone', ?, 'Initial Milestone', 'Auto-created milestone to house actions', 'todo', 1, ?, ?)
          `).run(msId, wsId, parentId, now, now);

          for (const act of actions) {
            this.db.prepare('UPDATE nodes SET parent_id = ? WHERE id = ?').run(msId, act.id);
          }
        }
      }
    } catch {}
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
        INSERT INTO nodes (id, workspace_id, type, parent_id, title, description, status, inputs, expected_outputs, actual_outputs, version, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        null,
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
      archivedAt: null,
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
    const archivedAt = updates.archivedAt !== undefined ? updates.archivedAt : existing.archivedAt;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE nodes
        SET title = ?, description = ?, status = ?, inputs = ?, expected_outputs = ?, actual_outputs = ?, version = ?, archived_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(title, description || null, status, inputs || null, expectedOutputs || null, actualOutputs || null, newVersion, archivedAt || null, now, nodeId);
  }

  deleteNode(nodeId: string): void {
    const existing = this.getNode(nodeId);
    if (!existing) return;

    const allNodes = this.listNodes(existing.workspaceId);
    const descendants = getDescendantNodes(nodeId, allNodes);
    const idsToDelete = [nodeId, ...descendants.map((n) => n.id)];

    const deleteStmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    for (const id of idsToDelete) {
      deleteStmt.run(id);
    }
    this.incrementStateVersion(existing.workspaceId);
  }

  archiveGoal(goalId: string): void {
    const goal = this.getNode(goalId);
    if (!goal) {
      throw new Error(`Goal with id '${goalId}' not found.`);
    }
    if (goal.type !== 'goal') {
      throw new Error(`Only nodes of type 'goal' can be archived. Node '${goalId}' is of type '${goal.type}'.`);
    }
    if (goal.status !== 'done') {
      throw new Error(`Only completed goals (status 'done') can be archived. Current status is '${goal.status}'.`);
    }

    const allNodes = this.listNodes(goal.workspaceId);
    const descendants = getDescendantNodes(goalId, allNodes);
    const targetIds = [goalId, ...descendants.map(n => n.id)];

    const now = new Date().toISOString();
    const updateStmt = this.db.prepare('UPDATE nodes SET archived_at = ?, updated_at = ? WHERE id = ?');
    for (const id of targetIds) {
      updateStmt.run(now, now, id);
    }

    this.incrementStateVersion(goal.workspaceId);
  }

  unarchiveGoal(goalId: string): void {
    const goal = this.getNode(goalId);
    if (!goal) {
      throw new Error(`Goal with id '${goalId}' not found.`);
    }
    if (!goal.archivedAt) {
      throw new Error(`Goal '${goalId}' is not archived.`);
    }

    const allNodes = this.listNodes(goal.workspaceId);
    const descendants = getDescendantNodes(goalId, allNodes);
    const targetIds = [goalId, ...descendants.map(n => n.id)];

    const now = new Date().toISOString();
    const updateStmt = this.db.prepare('UPDATE nodes SET archived_at = NULL, updated_at = ? WHERE id = ?');
    for (const id of targetIds) {
      updateStmt.run(now, id);
    }

    this.incrementStateVersion(goal.workspaceId);
  }

  listNodes(workspaceId: string): Node[] {
    const rows = this.db
      .prepare(`
        SELECT id, workspace_id as workspaceId, type, parent_id as parentId, title, description, status,
               inputs, expected_outputs as expectedOutputs, actual_outputs as actualOutputs,
               archived_at as archivedAt, created_at as createdAt, updated_at as updatedAt
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

    for (const node of rows) {
      if (node.type === 'milestone') {
        node.status = deriveMilestoneStatus(node.id, rows);
      }
    }

    return rows;
  }

  getNode(nodeId: string): Node | null {
    const row = this.db
      .prepare(`
        SELECT id, workspace_id as workspaceId, type, parent_id as parentId, title, description, status,
               inputs, expected_outputs as expectedOutputs, actual_outputs as actualOutputs,
               archived_at as archivedAt, created_at as createdAt, updated_at as updatedAt
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

    if (row.type === 'milestone') {
      const allWorkspaceNodes = this.listNodes(row.workspaceId);
      row.status = deriveMilestoneStatus(row.id, allWorkspaceNodes);
    }

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

    const currentDeps = this.listDependencies(workspaceId);
    const candidateDeps = [...currentDeps, { fromNodeId, toNodeId }];
    const allNodes = this.listNodes(workspaceId);
    const cycleCheck = validateHierarchicalDependencies(candidateDeps, allNodes);
    if (cycleCheck.hasCycle) {
      throw new Error(cycleCheck.error || 'Circular or hierarchical dependency detected.');
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

  addEvidence(params: {
    nodeId: string;
    content: string;
    sourceUrl?: string;
    sourceTitle?: string;
    confidence?: EvidenceConfidence;
    addedBy?: EvidenceSourceType;
  }): Evidence {
    const node = this.getNode(params.nodeId);
    if (!node) {
      throw new Error(`Node '${params.nodeId}' not found.`);
    }

    const evId = generateId('ev');
    const now = new Date().toISOString();
    const addedBy: EvidenceSourceType = params.addedBy || 'user';
    const confidence = params.confidence || null;

    this.db
      .prepare(
        'INSERT INTO evidence (id, node_id, content, source_url, source_title, retrieved_at, added_by, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        evId,
        params.nodeId,
        params.content,
        params.sourceUrl || null,
        params.sourceTitle || null,
        now,
        addedBy,
        confidence
      );

    this.incrementStateVersion(node.workspaceId);

    return {
      id: evId,
      content: params.content,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      retrievedAt: now,
      addedBy,
      confidence: params.confidence,
    };
  }

  removeEvidence(evidenceId: string): boolean {
    const row = this.db
      .prepare('SELECT node_id as nodeId FROM evidence WHERE id = ?')
      .get(evidenceId) as unknown as { nodeId: string } | undefined;

    if (!row) return false;

    const node = this.getNode(row.nodeId);
    this.db.prepare('DELETE FROM evidence WHERE id = ?').run(evidenceId);

    if (node) {
      this.incrementStateVersion(node.workspaceId);
    }
    return true;
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
        let nodeType = m.nodeType;
        if ((nodeType as any) === 'sub_action') {
          nodeType = 'action';
        }
        let parentId = m.parentId || null;
        if (nodeType === 'action' && parentId) {
          const parent = this.getNode(parentId);
          if (parent && (parent.type === 'goal' || parent.type === 'sub_goal')) {
            const siblings = this.listNodes(workspaceId).filter(
              (n) => n.parentId === parentId && n.type === 'milestone'
            );
            if (siblings.length > 0) {
              parentId = siblings[0].id;
            } else {
              const msNode = this.createNode({
                workspaceId,
                type: 'milestone',
                parentId,
                title: 'Initial Milestone',
                description: 'Milestone created to hold actions',
              });
              parentId = msNode.id;
            }
          }
        }
        this.createNode({
          workspaceId,
          id: m.nodeId,
          type: nodeType,
          parentId,
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
    let fallbackGoalId: string | null = null;
    const existingGoals = currentNodes.filter((n) => n.type === 'goal');
    if (existingGoals.length > 0) {
      fallbackGoalId = existingGoals[0].id;
    }

    const proposedNodeIds = new Set(
      mutations.filter((m) => m.type === 'create_node').map((m: any) => m.nodeId)
    );
    const existingNodeIds = new Set(currentNodes.map((n) => n.id));

    // Sort mutations safely: create_nodes first (parents before children), then updates, dependencies, evidence, deletions
    const rankMap: Record<string, number> = {
      goal: 0,
      sub_goal: 1,
      milestone: 2,
      action: 3,
    };

    const orderedMutations = [...mutations].sort((a, b) => {
      if (a.type === 'create_node' && b.type === 'create_node') {
        return (rankMap[a.nodeType] ?? 3) - (rankMap[b.nodeType] ?? 3);
      }
      if (a.type === 'create_node') return -1;
      if (b.type === 'create_node') return 1;
      if (a.type === 'delete_node') return 1;
      if (b.type === 'delete_node') return -1;
      return 0;
    });

    // Check if an auto-created fallback goal is needed for orphaned actions/milestones
    let autoCreatedGoal: Node | null = null;
    const needsFallback = orderedMutations.some(
      (m) =>
        m.type === 'create_node' &&
        m.nodeType !== 'goal' &&
        (!m.parentId || (!proposedNodeIds.has(m.parentId) && !existingNodeIds.has(m.parentId)))
    );

    if (needsFallback && !fallbackGoalId) {
      autoCreatedGoal = this.createNode({
        workspaceId,
        type: 'goal',
        parentId: null,
        title: adviceSummary || 'Imported Plan',
        description: 'Auto-created container for imported plan items',
      });
      fallbackGoalId = autoCreatedGoal.id;
    }

    // Map existing nodes and newly proposed nodes to their types for hierarchy validation
    const idToTypeMap = new Map<string, NodeType>();
    for (const n of currentNodes) {
      idToTypeMap.set(n.id, n.type);
    }
    if (autoCreatedGoal) {
      idToTypeMap.set(autoCreatedGoal.id, autoCreatedGoal.type);
    }

    // Map goals to milestones for auto-attaching direct actions
    const goalToMilestone = new Map<string, string>();
    for (const n of currentNodes) {
      if (n.type === 'milestone' && n.parentId) {
        if (!goalToMilestone.has(n.parentId)) {
          goalToMilestone.set(n.parentId, n.id);
        }
      }
    }
    for (const m of orderedMutations) {
      if (m.type === 'create_node' && m.nodeType === 'milestone' && m.parentId) {
        if (!goalToMilestone.has(m.parentId)) {
          goalToMilestone.set(m.parentId, m.nodeId || m.tempId || '');
        }
      }
    }

    // Attach any orphans to the fallback goal and conform node types to valid hierarchy
    for (const m of orderedMutations) {
      if (m.type === 'create_node' && m.nodeType !== 'goal') {
        if ((m.nodeType as any) === 'sub_action') {
          m.nodeType = 'action';
        }
        if (!m.parentId || (!proposedNodeIds.has(m.parentId) && !existingNodeIds.has(m.parentId))) {
          m.parentId = fallbackGoalId!;
        }
        const parentType = m.parentId ? idToTypeMap.get(m.parentId) : null;
        if (m.nodeType === 'action' && (parentType === 'goal' || parentType === 'sub_goal')) {
          let targetMilestoneId = goalToMilestone.get(m.parentId);
          if (!targetMilestoneId) {
            const newMsId = generateNodeId('milestone');
            goalToMilestone.set(m.parentId, newMsId);
            orderedMutations.unshift({
              type: 'create_node',
              nodeId: newMsId,
              nodeType: 'milestone',
              parentId: m.parentId,
              title: 'Initial Milestone',
              description: 'Auto-created milestone to house actions',
            });
            idToTypeMap.set(newMsId, 'milestone');
            proposedNodeIds.add(newMsId);
            targetMilestoneId = newMsId;
          }
          m.parentId = targetMilestoneId;
        }
        if (m.nodeId) {
          idToTypeMap.set(m.nodeId, m.nodeType);
        }
      }
    }

    // Compute inverse mutations before applying (ADR 0016)
    const inverseMutations = generateInverseMutations(orderedMutations, currentNodes);
    if (autoCreatedGoal) {
      inverseMutations.push({
        type: 'delete_node',
        nodeId: autoCreatedGoal.id,
      });
    }

    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const m of orderedMutations) {
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
          JSON.stringify(orderedMutations),
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

  // --- Error Telemetry (ADR 0019) ---

  logError(params: {
    source?: 'server' | 'client';
    category?: string;
    message: string;
    stack?: string;
    contextJson?: string;
  }): DevErrorRecord {
    const id = generateId('err');
    const source = params.source || 'server';
    const category = params.category || 'general';
    const now = new Date().toISOString();

    this.db
      .prepare(
        'INSERT INTO dev_errors (id, source, category, message, stack, context_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, source, category, params.message, params.stack || null, params.contextJson || null, 'unresolved', now);

    return {
      id,
      source,
      category,
      message: params.message,
      stack: params.stack || null,
      contextJson: params.contextJson || null,
      status: 'unresolved',
      createdAt: now,
    };
  }

  getError(id: string): DevErrorRecord | undefined {
    const row = this.db
      .prepare(
        'SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors WHERE id = ?'
      )
      .get(id) as unknown as DevErrorRecord | undefined;
    return row;
  }

  listErrors(options?: { status?: string; limit?: number }): DevErrorRecord[] {
    const limit = options?.limit ?? 100;
    if (options?.status && options.status !== 'all') {
      const rows = this.db
        .prepare(
          'SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors WHERE status = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(options.status, limit) as unknown as DevErrorRecord[];
      return rows;
    }
    const rows = this.db
      .prepare(
        'SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors ORDER BY created_at DESC LIMIT ?'
      )
      .all(limit) as unknown as DevErrorRecord[];
    return rows;
  }

  markErrorStatus(
    id: string,
    status: 'unresolved' | 'in_progress' | 'resolved' | 'ignored',
    fixNotes?: string
  ): boolean {
    const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
    let res;
    if (fixNotes !== undefined) {
      res = this.db
        .prepare(
          'UPDATE dev_errors SET status = ?, fix_notes = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?'
        )
        .run(status, fixNotes, resolvedAt, id);
    } else {
      res = this.db
        .prepare('UPDATE dev_errors SET status = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?')
        .run(status, resolvedAt, id);
    }
    return res.changes > 0;
  }

  getErrorStats(): {
    total: number;
    unresolved: number;
    in_progress: number;
    resolved: number;
    ignored: number;
  } {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM dev_errors GROUP BY status')
      .all() as { status: string; count: number }[];

    const stats = {
      total: 0,
      unresolved: 0,
      in_progress: 0,
      resolved: 0,
      ignored: 0,
    };

    for (const r of rows) {
      stats.total += r.count;
      if (r.status in stats) {
        (stats as any)[r.status] = r.count;
      }
    }

    return stats;
  }

  clearErrors(): void {
    this.db.exec('DELETE FROM dev_errors;');
  }

  clearResolvedErrors(keepRecentDays?: number): void {
    if (keepRecentDays && keepRecentDays > 0) {
      const cutoff = new Date(Date.now() - keepRecentDays * 86400000).toISOString();
      this.db
        .prepare("DELETE FROM dev_errors WHERE status IN ('resolved', 'ignored') AND resolved_at < ?")
        .run(cutoff);
    } else {
      this.db.exec("DELETE FROM dev_errors WHERE status IN ('resolved', 'ignored');");
    }
  }
}

export interface DevErrorRecord {
  id: string;
  source: 'server' | 'client';
  category: string;
  message: string;
  stack?: string | null;
  contextJson?: string | null;
  status: 'unresolved' | 'in_progress' | 'resolved' | 'ignored';
  fixNotes?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}
