export interface HelpSection {
  title: string;
  content: string; // Markdown or rich text with cross-links
  tips?: string[];
}

export interface HelpTopic {
  id: string;
  title: string;
  category: 'Getting Started' | 'Core Concepts' | 'Collaboration Protocol' | 'Execution & Analytics';
  summary: string;
  readTime: string;
  icon: string;
  sections: HelpSection[];
  relatedTopicIds: string[];
  relatedTermIds: string[];
}

export interface GlossaryTerm {
  id: string;
  term: string;
  category: 'Organization & Accounts' | 'Core Language' | 'Proposal & Exchange' | 'Execution & Lifecycle';
  definition: string;
  avoid: string[];
  details: string;
  relatedTermIds: string[];
  relatedTopicIds: string[];
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  // --- Organization & Accounts ---
  {
    id: 'user',
    term: 'User',
    category: 'Organization & Accounts',
    definition: 'An individual authenticated via Google OAuth who owns one or more isolated workspaces.',
    avoid: ['Account', 'client', 'profile'],
    details: 'Each user is strictly scoped to their own workspace data. In offline or local development mode, a local fallback user ensures full offline functionality.',
    relatedTermIds: ['workspace'],
    relatedTopicIds: ['getting-started', 'safety-undo'],
  },
  {
    id: 'workspace',
    term: 'Workspace',
    category: 'Organization & Accounts',
    definition: 'An isolated environment owned by a User containing goals, plans, and history with no cross-workspace dependencies.',
    avoid: ['Project', 'domain', 'vault'],
    details: 'All nodes, dependencies, evidence, and state versions are encapsulated within a single workspace. Workspaces never leak or cross-reference dependencies into other workspaces.',
    relatedTermIds: ['user', 'goal'],
    relatedTopicIds: ['getting-started', 'goals-and-actions'],
  },

  // --- Core Language ---
  {
    id: 'goal',
    term: 'Goal',
    category: 'Core Language',
    definition: 'A high-level desired outcome or objective that contains sub-goals, milestones, and actions.',
    avoid: ['Project', 'epic', 'target'],
    details: 'Goals form the root containers in the containment tree. They define the overarching mission and measure completion through descendant action and milestone progress.',
    relatedTermIds: ['milestone', 'action', 'sub-action', 'workspace'],
    relatedTopicIds: ['goals-and-actions', 'progress-analytics'],
  },
  {
    id: 'milestone',
    term: 'Milestone',
    category: 'Core Language',
    definition: 'A significant checkpoint or target state within a goal that marks major progress or delivery.',
    avoid: ['Phase', 'sprint', 'deliverable'],
    details: 'Milestones anchor the sequential roadmap. They can participate in cross-goal dependency chains to enforce prerequisite stage gates before subsequent actions proceed.',
    relatedTermIds: ['goal', 'action', 'dependency', 'readiness'],
    relatedTopicIds: ['goals-and-actions', 'dependencies-readiness', 'progress-analytics'],
  },
  {
    id: 'action',
    term: 'Action',
    category: 'Core Language',
    definition: 'An executable task or discrete step performed by the user to advance toward a goal. Can be recursively decomposed into sub-actions.',
    avoid: ['Task', 'todo', 'ticket', 'item'],
    details: 'Actions are the foundational execution units. They have stored execution status and dynamically computed readiness based on inbound prerequisites.',
    relatedTermIds: ['sub-action', 'goal', 'milestone', 'status', 'readiness', 'evidence'],
    relatedTopicIds: ['goals-and-actions', 'dependencies-readiness'],
  },
  {
    id: 'sub-action',
    term: 'Sub-Action',
    category: 'Core Language',
    definition: 'An action nested within a parent action to decompose complex execution steps.',
    avoid: ['Sub-task', 'nested task', 'child step'],
    details: 'Sub-actions enable arbitrary recursive nesting of tasks without altering execution semantics. If a parent action is deselected during proposal review, child sub-actions cascade automatically.',
    relatedTermIds: ['action', 'change-set'],
    relatedTopicIds: ['goals-and-actions', 'proposals-exchange'],
  },
  {
    id: 'dependency',
    term: 'Dependency',
    category: 'Core Language',
    definition: 'A directed relationship indicating that a node cannot proceed until another node is completed. Allowed between Actions and Milestones across goals.',
    avoid: ['Prerequisite', 'blocker edge', 'link'],
    details: 'Dependencies model graph constraints: fromNodeId must reach "done" before toNodeId becomes "ready". Dependencies are strictly validated against Directed Acyclic Graph (DAG) cycles.',
    relatedTermIds: ['readiness', 'cycle', 'action', 'milestone'],
    relatedTopicIds: ['dependencies-readiness', 'safety-undo'],
  },
  {
    id: 'evidence',
    term: 'Evidence',
    category: 'Core Language',
    definition: 'Structured research notes, facts, constraints, or citations attached directly to a node rather than floating as independent graph nodes.',
    avoid: ['Fact node', 'note node', 'attachment', 'knowledge item'],
    details: 'By attaching evidence directly to relevant nodes with confidence ratings and source URLs, context stays localized and avoids graph sprawl.',
    relatedTermIds: ['action', 'goal', 'proposal'],
    relatedTopicIds: ['evidence-notes', 'request-modes'],
  },

  // --- Proposal & Exchange ---
  {
    id: 'proposal',
    term: 'Proposal',
    category: 'Proposal & Exchange',
    definition: 'A structured set of suggested state changes and advisory feedback returned by the LLM.',
    avoid: ['Patch', 'PR', 'diff', 'recommendation'],
    details: 'Returned inside fenced ```goalguru-proposal code blocks. Contains a protocol version, base state version, advisory text (summary, critique, next steps), and an array of normalized mutations.',
    relatedTermIds: ['change-set', 'mutation', 'temporary-reference', 'collision'],
    relatedTopicIds: ['proposals-exchange', 'getting-started'],
  },
  {
    id: 'change-set',
    term: 'Change Set',
    category: 'Proposal & Exchange',
    definition: 'A grouped collection of proposed node mutations within a proposal that can be granularly reviewed and accepted.',
    avoid: ['Mutation batch', 'transaction', 'patchset'],
    details: 'Users review the change set in the Import Modal. Individual mutations can be toggled; deselecting a parent node automatically cascades to deselect its child mutations.',
    relatedTermIds: ['proposal', 'mutation', 'asymmetric-pruning'],
    relatedTopicIds: ['proposals-exchange'],
  },
  {
    id: 'mutation',
    term: 'Mutation',
    category: 'Proposal & Exchange',
    definition: 'A single atomic graph operation (create_node, update_node, update_status, delete_node, add_dependency, remove_dependency, add_evidence) within a change set.',
    avoid: ['Action', 'patch', 'delta', 'instruction'],
    details: 'Mutations represent normalized atomic operations. Every applied mutation produces an inverse mutation to support reliable single-click undo operations.',
    relatedTermIds: ['inverse-mutation', 'change-set', 'proposal'],
    relatedTopicIds: ['proposals-exchange', 'safety-undo'],
  },
  {
    id: 'inverse-mutation',
    term: 'Inverse Mutation',
    category: 'Proposal & Exchange',
    definition: 'A compensating operation recorded when applying a mutation that allows an undo action to restore previous state.',
    avoid: ['Rollback patch', 'compensation', 'revert delta'],
    details: 'Computed during proposal commit (e.g., inverse of create_node is delete_node; inverse of update_status is restore prior status). Enables lossless undo even across multi-step mutations.',
    relatedTermIds: ['mutation', 'proposal'],
    relatedTopicIds: ['safety-undo', 'proposals-exchange'],
  },
  {
    id: 'temporary-reference',
    term: 'Temporary Reference',
    category: 'Proposal & Exchange',
    definition: 'A provisional identifier (e.g. temp:action-1) used by the LLM to cross-reference newly proposed nodes before permanent IDs are assigned by the application.',
    avoid: ['Provisional ID', 'virtual ID', 'draft key'],
    details: 'Allows the LLM to propose new nodes and simultaneously declare dependencies between them before the application database generates permanent nanoid keys.',
    relatedTermIds: ['proposal', 'mutation', 'dependency'],
    relatedTopicIds: ['proposals-exchange'],
  },
  {
    id: 'request-mode',
    term: 'Request Mode',
    category: 'Proposal & Exchange',
    definition: 'A distinct interaction objective (e.g. create_plan, report_progress) that dictates the exported subgraph slice and prompt template.',
    avoid: ['Prompt type', 'command', 'workflow', 'intent'],
    details: 'The Core Quad includes create_plan, action_assistance, report_progress, and replan. Each mode focuses prompt context on relevant causal slices to minimize token usage.',
    relatedTermIds: ['subgraph-context', 'asymmetric-pruning', 'proposal'],
    relatedTopicIds: ['request-modes', 'proposals-exchange'],
  },
  {
    id: 'subgraph-context',
    term: 'Subgraph Context',
    category: 'Proposal & Exchange',
    definition: 'The minimal causal slice of the graph (selected node, ancestor spine, descendants, and active prerequisites) packaged for LLM exchange.',
    avoid: ['Context window', 'prompt state', 'export payload'],
    details: 'Rather than dumping the entire graph, Goal Guru extracts only the focused node along with its immediate causal environment, ensuring the LLM has exact situational awareness.',
    relatedTermIds: ['asymmetric-pruning', 'request-mode'],
    relatedTopicIds: ['request-modes', 'proposals-exchange'],
  },
  {
    id: 'asymmetric-pruning',
    term: 'Asymmetric Pruning',
    category: 'Proposal & Exchange',
    definition: 'The technique of packaging high-fidelity detail for the focused node while collapsing ancestors, descendants, and dependencies into skeletal summaries to conserve context tokens.',
    avoid: ['Token cutoff', 'compression', 'summarization'],
    details: 'Leaves full descriptions, inputs, outputs, and evidence on the focal node while rendering surrounding graph elements as compact single-line markers.',
    relatedTermIds: ['subgraph-context', 'request-mode'],
    relatedTopicIds: ['request-modes', 'proposals-exchange'],
  },
  {
    id: 'collision',
    term: 'Collision',
    category: 'Proposal & Exchange',
    definition: 'A state divergence detected when an imported proposal modifies nodes that were altered locally since the proposal\'s export version.',
    avoid: ['Merge conflict', 'race condition'],
    details: 'Each proposal envelope stamps baseStateVersion. If the workspace stateVersion advanced locally and the proposal touches altered nodes, the system flags a collision before commit.',
    relatedTermIds: ['proposal', 'mutation'],
    relatedTopicIds: ['proposals-exchange', 'safety-undo'],
  },
  {
    id: 'cycle',
    term: 'Cycle',
    category: 'Proposal & Exchange',
    definition: 'An invalid circular dependency path between nodes (e.g. A → B → A) that violates Directed Acyclic Graph invariants.',
    avoid: ['Loop', 'deadlock', 'recursive link'],
    details: 'Detected topologically before any dependency mutation is committed. If a cycle is detected, the import modal alerts the user and identifies the offending cycle nodes.',
    relatedTermIds: ['dependency', 'readiness', 'mutation'],
    relatedTopicIds: ['dependencies-readiness', 'safety-undo'],
  },

  // --- Execution & Lifecycle ---
  {
    id: 'status',
    term: 'Status',
    category: 'Execution & Lifecycle',
    definition: 'The stored execution intent of a node (todo, in_progress, done, abandoned).',
    avoid: ['State', 'phase', 'lifecycle'],
    details: 'Explicitly configured by the user or updated through approved proposals. Distinguishes intent from computed availability (Readiness).',
    relatedTermIds: ['readiness', 'action', 'milestone', 'goal'],
    relatedTopicIds: ['goals-and-actions', 'dependencies-readiness'],
  },
  {
    id: 'readiness',
    term: 'Readiness',
    category: 'Execution & Lifecycle',
    definition: 'The dynamically computed availability of a node based on its dependencies (ready, blocked).',
    avoid: ['Blocked status', 'ready status'],
    details: 'Never stored directly in the database. A node is "blocked" if any of its inbound prerequisite dependencies are not yet "done", and "ready" once all prerequisites are met.',
    relatedTermIds: ['status', 'dependency', 'cycle'],
    relatedTopicIds: ['dependencies-readiness', 'progress-analytics'],
  },
  {
    id: 'archive',
    term: 'Archive',
    category: 'Execution & Lifecycle',
    definition: 'A preserved collection of completed goals and their historical subtrees, removed from active execution and analytics.',
    avoid: ['Trash', 'backlog', 'graveyard'],
    details: 'Completed goals (status "done") can be moved to the archive to keep the active execution tree uncluttered. Archived goals are excluded from workspace progress metrics, multi-ring charts, and readiness pipelines, but remain viewable and can be restored at any time.',
    relatedTermIds: ['goal', 'status'],
    relatedTopicIds: ['goals-and-actions', 'progress-analytics'],
  },
];

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'getting-started',
    title: 'Overview & The Advisor Philosophy',
    category: 'Getting Started',
    summary: 'Understand Goal Guru\'s local authoritative state, the external LLM clipboard exchange loop, and workspace isolation.',
    readTime: '4 min read',
    icon: 'fa-compass',
    sections: [
      {
        title: 'Authoritative Local State vs. External Advisor',
        content: `Goal Guru is built upon a fundamental architectural principle: **the application owns authoritative state**. 

External Large Language Models (LLMs) such as ChatGPT, Claude, and Gemini act strictly as **advisors, researchers, and proposal generators**. They never modify your database directly or execute destructive side-effects.

You interact with AI through a predictable clipboard protocol:
1. **Focus & Export**: Select any Goal, Milestone, or Action and export a minimal [subgraph context](term:subgraph-context).
2. **Consult LLM**: Paste the generated prompt into your favorite LLM interface.
3. **Import Proposal**: Copy the LLM\'s response containing a [proposal](term:proposal) envelope back into Goal Guru.
4. **Selective Review & Commit**: Inspect proposed changes granularly in the [change set](term:change-set), toggle individual items, and commit with complete safety.`,
        tips: [
          'You retain 100% control: no change touches your plan until you explicitly review and commit it.',
          'Goal Guru operates completely offline; all data is stored locally in SQLite.',
        ],
      },
      {
        title: 'Workspaces & Accounts',
        content: `A [user](term:user) owns one or more isolated [workspaces](term:workspace). Each workspace is an autonomous container for your goals, plans, dependencies, and state history. Workspaces never share or leak cross-cutting dependencies, guaranteeing zero accidental cross-contamination.`,
      },
    ],
    relatedTopicIds: ['goals-and-actions', 'proposals-exchange', 'safety-undo'],
    relatedTermIds: ['user', 'workspace', 'proposal', 'change-set'],
  },

  {
    id: 'goals-and-actions',
    title: 'Containment Hierarchy & The Node Model',
    category: 'Core Concepts',
    summary: 'Master the decomposition hierarchy: Goals, Sub-Goals, Milestones, Actions, and recursive Sub-Actions.',
    readTime: '5 min read',
    icon: 'fa-diagram-project',
    sections: [
      {
        title: 'The Decomposition Hierarchy',
        content: `Goal Guru organizes complex endeavors into a clean, hierarchical tree:

* **[Goal](term:goal)**: The top-level desired outcome or strategic objective (e.g. *"Launch SaaS MVP"*).
* **[Milestone](term:milestone)**: A significant checkpoint or deliverable target within a goal (e.g. *"Alpha Testing Completed"*). Milestones can participate in cross-goal dependency chains.
* **[Action](term:action)**: An executable task or discrete step performed to achieve progress (e.g. *"Implement Stripe Billing"*).
* **[Sub-Action](term:sub-action)**: A nested action that decomposes a complex action into granular steps. Sub-actions can be recursively nested to any required depth.`,
        tips: [
          'Keep top-level Goals outcome-focused rather than activity-focused.',
          'Decompose large actions into Sub-Actions when steps take longer than a single work session.',
        ],
      },
      {
        title: 'Stored Status Lifecycle',
        content: `Every node possesses an explicit stored [status](term:status) that captures your execution intent:
* **todo**: Work is planned but not yet started.
* **in_progress**: Work is actively underway.
* **done**: The node has achieved its target outcome.
* **abandoned**: Work was intentionally dropped or superseded.

Clicking the status badge on any node advances it sequentially through the lifecycle (*todo* → *in_progress* → *done* → *todo*).`,
      },
      {
        title: 'Archiving Completed Goals',
        content: `Once a [goal](term:goal) reaches *done* status, you can move it into the [archive](term:archive).

Archiving a completed goal preserves its entire audit tree (milestones, actions, evidence) in a dedicated Archive view, while completely removing it from active analytics, progress dials, and execution readiness. Archived goals can be unarchived and restored to active scope at any time.`,
        tips: [
          'Only goals marked done can be archived.',
          'Archived goals do not affect active workspace progress percentages or LLM proposal context.',
        ],
      },
    ],
    relatedTopicIds: ['dependencies-readiness', 'progress-analytics', 'getting-started'],
    relatedTermIds: ['goal', 'milestone', 'action', 'sub-action', 'status', 'archive'],
  },

  {
    id: 'dependencies-readiness',
    title: 'Dependencies & Dynamic Readiness',
    category: 'Core Concepts',
    summary: 'How directed graph constraints, dynamic readiness computation, and cycle prevention ensure you always know what to do next.',
    readTime: '5 min read',
    icon: 'fa-link',
    sections: [
      {
        title: 'Stored Intent vs. Computed Readiness',
        content: `A core innovation in Goal Guru is separating stored intent ([status](term:status)) from computed availability ([readiness](term:readiness)):

* **Stored Status**: What you or your team *intend* to do (e.g., a task is marked *todo* or *in_progress*).
* **Computed Readiness**: Whether the task can *actually* be started right now based on graph dependencies:
  * **Ready**: All inbound prerequisites are marked *done*. You can execute immediately.
  * **Blocked**: One or more prerequisite nodes have not yet been completed.

Nodes are dynamically evaluated on every graph update. You never have to manually mark a task as "blocked"—the application calculates it in real-time.`,
        tips: [
          'Hover over any red "Blocked" badge in the Plan Tree to see the exact titles of the prerequisite nodes holding it up.',
          'Switch to the Execution Readiness Pipeline in Progress Analytics to see all immediately actionable tasks.',
        ],
      },
      {
        title: 'Directed Relationships & Cycle Detection',
        content: `A [dependency](term:dependency) creates a directed edge: \`fromNodeId\` must reach *done* before \`toNodeId\` becomes *ready*.

To guarantee graph integrity, Goal Guru strictly prevents circular references ([cycles](term:cycle)). When a proposed change introduces an invalid circular path (e.g. A → B → C → A), topological prevalidation rejects the dependency and highlights the offending nodes.`,
      },
    ],
    relatedTopicIds: ['goals-and-actions', 'progress-analytics', 'safety-undo'],
    relatedTermIds: ['dependency', 'readiness', 'status', 'cycle'],
  },

  {
    id: 'evidence-notes',
    title: 'Node-Attached Evidence & Citations',
    category: 'Core Concepts',
    summary: 'Attach research findings, constraints, API notes, and URLs directly to your plan nodes without cluttering the graph.',
    readTime: '3 min read',
    icon: 'fa-note-sticky',
    sections: [
      {
        title: 'Why Attached Evidence Rather Than Floating Nodes?',
        content: `In traditional mind-mapping or knowledge graphs, notes and facts float as independent nodes, quickly causing visual clutter and confusing the execution tree.

Goal Guru solves this with **node-attached [evidence](term:evidence)**. You can attach facts, citations, links, and constraints directly to the specific Goal, Milestone, or Action they inform.

Each evidence item includes:
* **Content**: The note, fact, constraint, or summary text.
* **Confidence Rating**: *High*, *Medium*, or *Low* assessment of the source.
* **Source URL & Title**: Optional links to external documentation, API specs, or benchmark data.
* **Provenance**: Identifies whether the note was added by the user or proposed by the LLM.`,
        tips: [
          'Click the "+ Note" button on any node to record a constraint, research finding, or URL.',
          'Attached notes are automatically packaged when you export the node to an LLM, giving the AI full situational awareness.',
        ],
      },
    ],
    relatedTopicIds: ['goals-and-actions', 'request-modes', 'proposals-exchange'],
    relatedTermIds: ['evidence', 'action', 'goal'],
  },

  {
    id: 'proposals-exchange',
    title: 'The LLM Proposal Exchange Protocol',
    category: 'Collaboration Protocol',
    summary: 'Detailed look at fenced codeblock envelopes, change sets, atomic mutations, collisions, and temporary references.',
    readTime: '6 min read',
    icon: 'fa-clipboard-check',
    sections: [
      {
        title: 'The Proposal Envelope Format',
        content: `When your external LLM responds to an export prompt, it wraps its suggested plan modifications inside a fenced codeblock labeled \`\`\`goalguru-proposal:

\`\`\`json
{
  "protocolVersion": "1.0",
  "stateVersion": 1,
  "advice": {
    "summary": "High-level summary of suggestions",
    "critique": "Constructive observations on risks or bottlenecks",
    "nextSteps": "Recommended immediate execution focus"
  },
  "changeSet": [
    {
      "type": "create_node",
      "tempId": "temp:act-1",
      "nodeType": "action",
      "parentId": "goal_xyz",
      "title": "Set up database migrations",
      "description": "Create initial SQLite schema"
    },
    {
      "type": "add_dependency",
      "fromNodeId": "temp:act-1",
      "toNodeId": "act_launch"
    }
  ]
}
\`\`\``,
      },
      {
        title: 'Temporary References & Normalized Mutations',
        content: `A [proposal](term:proposal) communicates state modifications through normalized [mutations](term:mutation) grouped in a [change set](term:change-set):
* \`create_node\`: Spawns a new node. Uses a [temporary reference](term:temporary-reference) (e.g., \`temp:act-1\`) so sibling mutations and dependencies can link to it before a database ID is minted.
* \`update_node\`: Updates title, description, or criteria.
* \`update_status\`: Advances or updates execution status.
* \`delete_node\`: Removes a node and its sub-tree.
* \`add_dependency\` & \`remove_dependency\`: Adjusts prerequisite constraints.
* \`add_evidence\`: Records structured notes or citations.`,
        tips: [
          'If you deselect a parent mutation during review, Goal Guru automatically cascades and deselects its child sub-actions to preserve referential integrity.',
          'If you edited nodes locally while waiting for an AI response, Goal Guru alerts you to [collisions](term:collision) before committing.',
        ],
      },
    ],
    relatedTopicIds: ['request-modes', 'safety-undo', 'getting-started'],
    relatedTermIds: ['proposal', 'change-set', 'mutation', 'temporary-reference', 'collision'],
  },

  {
    id: 'request-modes',
    title: 'Request Modes & Causal Subgraph Pruning',
    category: 'Collaboration Protocol',
    summary: 'How targeted request modes and asymmetric pruning save tokens and focus LLM attention on the exact causal path.',
    readTime: '5 min read',
    icon: 'fa-filter',
    sections: [
      {
        title: 'The Core Execution Quad',
        content: `Each time you export a node to an LLM, you choose a [request mode](term:request-mode) that dictates the objective and prompt framing:

1. **\`create_plan\`**: Decomposes a newly defined Goal, Sub-Goal, or Milestone into an actionable hierarchy of Actions and Sub-Actions with explicit dependencies.
2. **\`action_assistance\`**: Provides in-depth execution advice, research notes, and step-by-step guidance for a specific active Action without altering graph structure.
3. **\`report_progress\`**: Ingests your free-form work notes, interprets what was accomplished, marks completed tasks *done*, and proposes follow-up steps.
4. **\`replan\`**: Restructures the remaining open plan when a blocker is encountered, milestones shift, or scope changes.`,
      },
      {
        title: 'Asymmetric Causal Path Pruning',
        content: `Sending an entire 100-node graph to an LLM wastes tokens and causes the AI to lose focus. 

Goal Guru applies **[asymmetric pruning](term:asymmetric-pruning)**:
* **Focal Node**: Exported with high-fidelity detail (title, description, status, inputs, outputs, attached evidence).
* **Ancestor Spine & Dependencies**: Collapsed into compact, skeletal single-line summaries to establish causal context without token bloat.
* **Irrelevant Branches**: Stripped completely.

Furthermore, all user content is isolated within passive data boundaries so the LLM cannot be hijacked by prompt injections embedded in node titles.`,
      },
    ],
    relatedTopicIds: ['proposals-exchange', 'goals-and-actions'],
    relatedTermIds: ['request-mode', 'subgraph-context', 'asymmetric-pruning', 'evidence'],
  },

  {
    id: 'progress-analytics',
    title: 'Progress Velocity & Multi-Ring Analytics',
    category: 'Execution & Analytics',
    summary: 'Track completion across tiers and goals with Apple Activity-style multi-rings, radial gauges, and milestone horizon steppers.',
    readTime: '4 min read',
    icon: 'fa-chart-pie',
    sections: [
      {
        title: 'Multi-Ring Visualizations',
        content: `The top of your workspace features an interactive Concentric Multi-Ring Chart inspired by Apple Fitness rings:

* **By Tier Mode**: Tracks completion across three fundamental layers:
  * 🟢 **Actions & Tasks** (inner ring)
  * 🟣 **Milestones** (middle ring)
  * 🔵 **Goals & Objectives** (outer ring)
* **By Goal Mode**: Dynamically generates distinct color-coded concentric rings for each top-level Goal in your workspace, allowing instant side-by-side comparison of goal pacing.

Hovering over any ring highlights its exact percentage, completion count, and label.`,
      },
      {
        title: 'Dedicated Analytics Views',
        content: `Clicking **Progress Analytics** in the top navigation opens a deep execution velocity dashboard featuring:
* **Tier Radial Gauges**: Dedicated speedometer dials for each node category.
* **Milestone Execution Horizon**: A sequential card roadmap displaying milestones, blocker warnings, and action subtree progress bars.
* **Readiness Pipeline Swimlanes**: Live kanban-style swimlanes grouping nodes into *Ready to Start*, *In Progress*, *Blocked*, and *Done*.`,
      },
    ],
    relatedTopicIds: ['goals-and-actions', 'dependencies-readiness'],
    relatedTermIds: ['status', 'readiness', 'goal', 'milestone', 'action'],
  },

  {
    id: 'safety-undo',
    title: 'Safety, Proposal Undo & Error Telemetry',
    category: 'Execution & Analytics',
    summary: 'Single-click proposal rollback via inverse mutations, state versioning, and local SQLite error telemetry.',
    readTime: '4 min read',
    icon: 'fa-shield-halved',
    sections: [
      {
        title: 'Proposal Inversion for Instant Undo',
        content: `When committing a proposal, Goal Guru automatically calculates and records an [inverse mutation](term:inverse-mutation) for every applied graph change:
* Inverse of \`create_node\` → \`delete_node\`
* Inverse of \`delete_node\` → \`create_node\` (with previous attributes restored)
* Inverse of \`update_status\` → \`update_status\` (restoring prior status)
* Inverse of \`add_dependency\` → \`remove_dependency\`

Clicking the **Undo** button in the header reverses the last committed proposal cleanly in a single transaction.`,
      },
      {
        title: 'Local SQLite Error Telemetry (ADR 0019)',
        content: `Goal Guru captures runtime exceptions, unhandled API errors, and proposal parsing failures into a dedicated \`dev_errors\` SQLite table.

Click the **Errors** button in the top navigation bar to inspect captured telemetry, view full stack traces and context JSON, filter by status (*unresolved*, *in_progress*, *resolved*, *ignored*), and run integrated verification checks.`,
        tips: [
          'External agents and MCP tools can also inspect and resolve errors via the goalguru-dev-errors server.',
          'State versions increment monotonically on every commit to guard against touch-set collisions.',
        ],
      },
    ],
    relatedTopicIds: ['proposals-exchange', 'getting-started'],
    relatedTermIds: ['inverse-mutation', 'collision', 'mutation'],
  },
];
