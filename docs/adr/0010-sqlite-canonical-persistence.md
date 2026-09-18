# Local SQLite Storage

Goal Guru persists canonical graph state in a local SQLite database file rather than flat JSON files or markdown vaults.

SQLite provides ACID transactions for multi-node change-set commits, enforces foreign key referential integrity across dependencies and containment hierarchies, and executes rapid touch-set collision queries. File-based JSON or markdown approaches suffer from file write races, lack transactional rollback on partial failures, and become slow when indexing graph edges.
