# Prefixed NanoID Identifiers

Entities use type-prefixed short NanoIDs for permanent application identifiers (e.g. `goal_k7x9`, `act_m3q1`), while proposals use type-prefixed temporary references (`temp:act-1`).

Full 36-character UUIDs consume excessive context window tokens and are prone to character transposition errors when referenced by LLMs in generated dependencies. Type-prefixed 8-character NanoIDs provide collision resistance while remaining compact, human-readable, and explicit about entity types.
