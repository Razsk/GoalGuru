# Stored Intent with Computed Readiness

Nodes store only user execution intent (`todo`, `in_progress`, `done`, `abandoned`), while readiness (`ready`, `blocked`) is dynamically computed from dependency state.

Persisting static "blocked" or "ready" states in the database requires cascading writes across the graph whenever a single dependency finishes or is deleted. Decoupling user intent from graph-derived readiness ensures the state is always self-consistent by definition and eliminates synchronization bugs.
