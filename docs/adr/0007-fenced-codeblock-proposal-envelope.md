# Fenced Codeblock Proposal Envelope

LLM proposal payloads exchanged via clipboard are enclosed within a custom markdown code fence (```` ```goalguru-proposal ````) containing standard JSON.

Users frequently converse with external LLM chat web interfaces that output conversational preamble or follow-up commentary alongside machine output. Using a dedicated custom language tag enables reliable regex extraction of the JSON envelope from noisy chat transcripts while remaining native and readable within all LLM web interfaces.
