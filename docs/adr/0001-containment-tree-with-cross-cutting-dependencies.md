# Containment Tree with Cross-Cutting Dependencies

In Goal Guru, goals, milestones, and actions form a strict single-parent containment tree, while dependencies and blockers are modeled as secondary cross-cutting directed edges.

A pure graph allows arbitrary multi-parent hierarchies, but complicates UI tree views, cycle detection, path addressing, and deterministic subgraph context selection. A strict tree backbone gives every entity a single canonical home and ancestor path, while secondary dependency edges preserve the full expressive power of a DAG for execution ordering.
