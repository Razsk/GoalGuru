# Minimal Causal Path Subgraph Selection

When generating an LLM prompt for a focused node, the exported subgraph includes only the selected node, its direct ancestor chain to the root Goal, its descendants, and immediate active prerequisite dependencies.

Exporting sibling branches, unrelated subtrees, or long-completed prerequisites bloats the LLM context window and distracts reasoning. The minimal causal path supplies the exact context necessary for planning, replanning, and execution assistance without noise.
