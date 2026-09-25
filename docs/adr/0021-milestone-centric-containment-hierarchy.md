# Milestone-Centric Containment Hierarchy

Goals contain Milestones (and optional Sub-Goals); Milestones contain Actions; Actions are leaf execution items without sub-actions. Milestones represent an achievement reached by performing all actions underneath them, with derived status based on child actions. Dependencies are permitted only between milestones or between actions, with milestone dependencies cascading readiness down to child actions. (Supersedes ADR 0004).

Eliminating recursive sub-actions simplifies the execution model and focuses actions as concrete execution steps enriched with advice and guidance in their markdown descriptions. Grouping actions strictly under milestones ensures every action realizes a distinct benefit and measurable stepping stone toward the goal. Derived milestone statuses prevent conflicting execution intent between milestones and their actions, while milestone dependency cascading dynamically enforces stage-gate prerequisites across phases.
