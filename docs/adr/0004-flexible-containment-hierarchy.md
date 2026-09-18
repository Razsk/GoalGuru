# Flexible Containment Hierarchy

Goals can directly contain Sub-Goals, Milestones, or Actions; Milestones contain Actions; and Actions can recursively contain Sub-Actions.

A rigid 3-tier hierarchy (`Goal → Milestone → Action`) imposes unnecessary ceremony when a goal has straightforward actions that do not warrant a milestone wrapper. Permitting direct goal-level actions and recursive sub-actions models real-world task decomposition naturally while preserving single-parent containment.
