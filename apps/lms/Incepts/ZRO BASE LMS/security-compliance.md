# Security & Compliance

- **Authentication**: OAuth2 with JWT (refresh tokens stored in Redis).
- **Encryption**: PII encrypted at rest (AES-256) in PostgreSQL.
- **Compliance**: GDPR/CCPA support with `GET /api/data/export` and `DELETE /api/data`.
- **Rate Limiting**: API Gateway limits (e.g., 100 req/min per user).
- **DDoS Protection**: Cloudflare or AWS WAF.
- **Content Moderation**: Flag/report system for community posts.

[Back to Main Page](./index.md)