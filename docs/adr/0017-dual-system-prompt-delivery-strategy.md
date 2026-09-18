# Dual System Prompt Delivery Strategy

Goal Guru provides a comprehensive system prompt export for configuring persistent custom agents (Custom GPT, Claude Project, Gemini Gem) while embedding a lightweight fallback instruction preamble in every clipboard export envelope.

Embedding a full 200-line prompt in every clipboard copy bloats the export payload and wastes context tokens for users with dedicated custom agents. A dual strategy provides full token efficiency for configured agents while ensuring ad-hoc copy-pasting into unconfigured vanilla chat sessions remains compliant.
