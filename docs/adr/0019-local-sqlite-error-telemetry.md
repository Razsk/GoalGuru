# Local SQLite Error Telemetry and In-App Diagnostics

All runtime exceptions, protocol parsing errors, and uncaught frontend rejections are persisted directly into a dedicated SQLite telemetry table (`dev_errors`), exposed via inspection API endpoints and an in-app viewer.

Relying solely on ephemeral terminal logs obscures errors when users interact with the app via modals or background tasks. Storing error records with status, origin (`server` vs `client`), timestamp, stack trace, and JSON context preserves an authoritative diagnostic audit trail accessible even when offline.
