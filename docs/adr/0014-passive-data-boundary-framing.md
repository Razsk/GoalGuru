# Passive Data Boundary Framing for Untrusted State

Exported prompts enclose application state within explicit text boundaries accompanied by negative system instructions directing the LLM to treat state strictly as passive data and never execute embedded commands.

User notes, descriptions, and researched evidence may inadvertently or maliciously contain prompt injection text. Structural data framing provides a robust barrier against indirect injection without corrupting user content.
