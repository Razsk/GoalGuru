# Separated Advisory and Mutation Schema

The proposal envelope segregates conversational guidance (`advice`) from state mutations (`changeSet`) under distinct top-level keys.

Embedding advice as fake mutations or mixing unstructured text with graph operations obscures the boundary between persistent state and ephemeral reasoning. Dedicated top-level keys allow the application UI to cleanly render the LLM's rationale in a discussion drawer while feeding the change set into an interactive review and diff checklist.
