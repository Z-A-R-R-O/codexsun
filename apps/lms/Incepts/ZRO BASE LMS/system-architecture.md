# System Architecture

## Layers

- **Client**: Web (React/TypeScript, PWA) and mobile (PWA wrapper). Handles UI, roadmap rendering, and local caching.
- **API Gateway**: Manages authentication, rate limiting, and request routing (e.g., AWS API Gateway or Kong).
- **Microservices**:
  - **Content Service**: Manages lessons, quizzes, and projects (Node.js/Express).
  - **Progress Service**: Tracks user progress and mastery (Python/FastAPI).
  - **Personalization Service**: Recommends content based on user data (Python/TensorFlow).
  - **Gamification Service**: Handles XP, badges, and leaderboards (Go for performance).
  - **Notification Service**: Manages real-time updates via WebSockets and push notifications (Node.js/Socket.IO).
  - **Integration Service**: Connects to external platforms (e.g., GitHub OAuth, LinkedIn APIs).
  - **Analytics Pipeline**: Ingests events for reporting (Kafka + Spark).
- **Datastores**:
  - **PostgreSQL**: Relational data for users, concepts, and progress (JSONB for flexible metadata).
  - **Redis**: Session management and leaderboards.
  - **S3**: Stores assets (images, PDFs).
  - **Elasticsearch**: Powers search and content indexing.
  - **MongoDB** (optional): Stores large free-form user notes.
- **Message Broker**: Kafka for event-driven workflows (e.g., progress updates, notifications).
- **Caching**: Redis for API responses and roadmap calculations.

## Scalability

- Horizontal scaling of microservices via Kubernetes pods.
- Read replicas for PostgreSQL to handle high read traffic.
- CDN (e.g., CloudFront) for static assets and cached content.
- Autoscaling rules based on CPU/memory usage and request rates.

## Architecture Diagram

```plaintext
[Client: React/PWA] ↔ [API Gateway: Auth, Rate Limit]
    ↓
[Microservices: Content, Progress, Personalization, Gamification, Notification, Integration]
    ↓
[Datastores: PostgreSQL, Redis, S3, Elasticsearch, MongoDB]
    ↓
[Message Broker: Kafka] → [Analytics Pipeline: Spark]
```

[Back to Main Page](./index.md)