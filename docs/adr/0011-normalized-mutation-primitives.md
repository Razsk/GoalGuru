# Normalized 7-Op Mutation Primitives

The proposal change set schema defines exactly seven explicit mutation operations: `create_node`, `update_node`, `update_status`, `delete_node`, `add_dependency`, `remove_dependency`, and `add_evidence`.

Generic JSON patch formats (RFC 6902) or coarse subtree replacements require complex path resolutions and make granular human review ambiguous. Explicit, high-level domain operations are straightforward for LLMs to generate reliably, allow direct 1-to-1 mapping to UI diff checkboxes, and ensure deterministic schema validation before database execution.
