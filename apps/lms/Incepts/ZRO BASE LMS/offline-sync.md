# Offline-First & Sync

- **Service Worker**: Cache static assets and API responses using Workbox.
- **IndexedDB**: Store offline operations (`{ opId, type, payload, client_ts }`).
- **Sync Flow**:
  - On reconnect, client sends `POST /api/sync` with operation log.
  - Server merges ops using `max(mastery_score)` and latest `client_ts` for conflict resolution.
  - Returns merged state and any conflicts.
- **Offline Content**: Cache tutorials and PDFs in S3, served via CDN.

[Back to Main Page](./index.md)