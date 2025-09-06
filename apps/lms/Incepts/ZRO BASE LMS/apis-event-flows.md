# APIs & Event Flows

## Key REST Endpoints

```plaintext
GET /api/roadmap?pathId={pathId}&userId={userId}
  Returns: Concept graph with progress and unlocked nodes

POST /api/progress
  Body: { userId, conceptId, eventType, score, attemptDetails }
  Response: { status, masteryScore, unlockedNodes }

GET /api/recommendations?userId={userId}
  Returns: { recommendedConcepts: [], suggestedPathId }

POST /api/sync
  Body: { ops: [{ opId, type, payload, clientTs }] }
  Response: { status, mergedOps, conflicts }

POST /api/xp/events
  Body: { userId, amount, reason }
  Response: { status, newXpTotal }

GET /api/community/threads?conceptId={conceptId}
  Returns: { threads: [], pagination }

POST /api/community/threads
  Body: { userId, conceptId, title, content }
  Response: { threadId, status }
```

## Event Flow: Quiz Completion

1. Client submits: `POST /api/progress { userId, conceptId, eventType: "quiz_attempt", score, attemptDetails }`.
2. **Progress Service**:
   - Logs attempt in `user_progress.attempts`.
   - Recalculates `mastery_score` using weighted formula.
   - If `mastery_score >= mastery_threshold`, updates `status = 'mastered'`.
   - Triggers `concept.mastered` event to Kafka.
3. **Graph Service**: Unlocks child concepts in the roadmap.
4. **Gamification Service**: Awards XP (e.g., `score * 10`) and checks for badge eligibility.
5. **Notification Service**: Sends WebSocket update and push notification (e.g., “You mastered React Hooks!”).
6. **Analytics Pipeline**: Ingests `quiz.attempt` and `concept.mastered` events for reporting.

[Back to Main Page](./index.md)