# Multi-User Account Scoping and Workspace Isolation

The application isolates user data using Google OAuth identifiers (`sub`), scoping all workspaces, goals, and history under the authenticated user's account ID.

Even within a local-first application, multiple household members or colleagues sharing a device require strict separation of their private goals and workspaces. Partitioning all database records by User ID and Workspace ID prevents cross-user visibility while enabling offline access for previously authenticated sessions.
