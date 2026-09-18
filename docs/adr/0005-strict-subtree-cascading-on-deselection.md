# Strict Subtree Cascading on Deselection

When reviewing a proposed change set, deselecting a parent node automatically deselects and discards all of its proposed descendant children.

Sub-actions are generated strictly within the context and scope of their parent action. Promoting orphaned children up the tree when their parent is rejected produces disconnected, meaningless tasks and clutters the plan.
