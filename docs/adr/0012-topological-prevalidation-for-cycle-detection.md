# Topological Pre-Validation for Cycle Detection

The application runs cycle detection (Kahn's algorithm) on the combined canonical and proposed graph immediately upon parsing an LLM proposal, proactively highlighting and disabling cyclic edges before the user begins review.

Deferring cycle validation to database commit time risks frustrating the user if an invalid cycle aborts their review after they have already customized checkboxes. Early pre-validation provides immediate, transparent feedback on why an edge is disabled.
