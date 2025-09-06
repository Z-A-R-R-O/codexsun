# Mastery, Personalization & Algorithms

## Mastery Formula

```python
def calculate_mastery(quiz_avg, practice_score, recency_factor):
    return 0.6 * quiz_avg + 0.3 * practice_score + 0.1 * recency_factor
```

- **Quiz_avg**: Average score across attempts (weighted by recency).
- **Practice_score**: Completion rate of exercises/projects.
- **Recency_factor**: Decay function (e.g., `e^(-days_since_last_attempt/30)`).
- **Mastery_threshold**: Default 0.8, configurable per concept.

## Personalization Logic

- **Rule-based**: Suggest immediate child nodes of mastered concepts.
- **ML-based**: Collaborative filtering (user-concept matrix) + content-based filtering (difficulty, category).
- **Remediation**: If `mastery_score < 0.5` on a prerequisite, insert micro-lessons or review quizzes.
- **Model**: Use TensorFlow/Keras for recommendation training, deployed via FastAPI.

## Spaced Repetition

- Implement SM-2 algorithm:
  - `interval = previous_interval * ease_factor` (default ease_factor = 2.5).
  - Adjust `next_review_at` based on user performance.
  - Store in `user_progress.next_review_at`.

[Back to Main Page](./index.md)