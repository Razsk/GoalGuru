# Node-Attached Evidence

Research, facts, risks, and constraints are attached directly to their relevant Goal, Milestone, or Action as Evidence objects, rather than existing as standalone graph nodes.

Although the original design spec considered modeling facts and risks as graph nodes, treating every piece of research as a node leads to severe graph pollution and ballooning context windows during LLM export. Attaching evidence directly preserves tight context locality, simplifies subgraph extraction, and keeps provenance tracking coupled to the entity it informs.
