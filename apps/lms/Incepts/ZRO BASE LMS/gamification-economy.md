# Gamification & Economy

## XP Mechanics

- **Concept Completion**: `50 * difficulty_multiplier` (easy: 1x, medium: 1.5x, hard: 2x).
- **Quiz XP**: `round(10 * score)`.
- **Streak Bonus**: Daily streak increases XP multiplier (max 2x after 7 days).
- **Leaderboards**: Global and friends, updated in Redis every 5 minutes.

## Badges

- **Skill-based**: e.g., “React Master” for completing all React concepts.
- **Activity-based**: e.g., “10-Day Streak” for consecutive logins.
- **Secret Badges**: Easter eggs for unique actions (e.g., “Night Owl” for late-night study).

## Anti-Fraud

- Server-side validation of XP events.
- Rate limit actions (e.g., max 100 XP/minute).
- Audit logs for suspicious activity (stored in PostgreSQL).

[Back to Main Page](./index.md)