# Archived Mode for Completed Goals

Completed goals may be archived, moving their entire containment subtree into a dedicated Archive state that removes them from active analytics, graph rendering, and execution planning while retaining full auditability and unarchiving support.

Overloading stored `status` with an "archived" state conflates execution intent (`done`) with visibility scoping. Storing an explicit `archived_at` timestamp on nodes preserves the integrity of execution metrics while allowing clean partitioning between active and archived subtrees without destructive deletes or artificial workspace duplication.
