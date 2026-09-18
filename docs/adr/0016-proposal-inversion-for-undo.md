# Proposal Inversion for Undo and Rollback

Every committed change set automatically generates and stores an inverse mutation log alongside the proposal in SQLite, enabling instant multi-step undo and redo.

Deriving full database snapshots before every mutation causes unbounded storage growth, while full event sourcing introduces unnecessary query complexity. Storing paired inverse operations (`delete_node` for `create_node`, previous status for `update_status`) guarantees atomic rollbacks for specific proposals without touching unrelated graph edits.
