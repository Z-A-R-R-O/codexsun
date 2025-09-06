# Analytics & KPIs

## Events to Track

- `roadmap.view`: User views roadmap.
- `lesson.start` / `lesson.complete`: Lesson lifecycle.
- `quiz.attempt`: Quiz submission with score.
- `project.submission`: Project submission.
- `concept.mastered`: Mastery threshold reached.
- `node.unlocked`: New concept unlocked.

## KPIs

- **Activation**: % of users completing first concept within 7 days.
- **Progression**: Average nodes completed per user per week.
- **Mastery Rate**: % of nodes mastered vs. attempted.
- **Retention**: D7, D30, and D90 retention rates.
- **Time-to-Mastery**: Average sessions to master a concept.

## Dashboards

- **Retention Funnel**: Track user drop-off by stage.
- **Heatmap**: Identify high drop-off nodes.
- **Personalization Metrics**: Measure recommendation acceptance rate.

## Analytics Stack

- **Ingestion**: Kafka for event streaming.
- **Processing**: Spark for real-time analytics.
- **Visualization**: Metabase or Grafana for dashboards.

[Back to Main Page](./index.md)