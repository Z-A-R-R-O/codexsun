# Data Model

## Core Entities

- `users`: Profile data, preferences, and roles.
- `concepts`: Lessons, quizzes, or projects with metadata and prerequisites.
- `paths`: Ordered collections of concepts (predefined or custom).
- `user_progress`: Tracks status, mastery, and review schedules.
- `quizzes` / `questions`: Quiz items with difficulty and analytics.
- `projects`: Assignments with submission and review metadata.
- `xp_events` / `badges`: Gamification data.
- `notifications`: User alerts and messages.

## Sample JSON Schema (Concept)

```json
{
  "id": "react-hooks",
  "title": "React Hooks",
  "type": "concept",
  "category": "frontend",
  "summary": "Learn useState, useEffect, and rules of hooks",
  "difficulty": "medium",
  "prerequisites": ["javascript-closures", "react-intro"],
  "mastery_threshold": 0.8,
  "estimated_minutes": 45,
  "content": {
    "tutorial": "markdown_url",
    "exercises": ["exercise_id_1", "exercise_id_2"],
    "quiz_id": "quiz_react_hooks_01"
  },
  "created_at": "2025-09-06T18:59:00Z",
  "updated_at": "2025-09-06T18:59:00Z"
}
```

## Relational Schema (Simplified)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  role ENUM('learner', 'admin', 'moderator') DEFAULT 'learner',
  settings JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE concepts (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255),
  type ENUM('lesson', 'quiz', 'project'),
  category VARCHAR(50),
  meta JSONB,
  difficulty ENUM('easy', 'medium', 'hard'),
  mastery_threshold FLOAT DEFAULT 0.8,
  estimated_minutes INT
);

CREATE TABLE prerequisites (
  concept_id VARCHAR(50),
  prerequisite_concept_id VARCHAR(50),
  PRIMARY KEY (concept_id, prerequisite_concept_id),
  FOREIGN KEY (concept_id) REFERENCES concepts(id),
  FOREIGN KEY (prerequisite_concept_id) REFERENCES concepts(id)
);

CREATE TABLE paths (
  id UUID PRIMARY KEY,
  title VARCHAR(255),
  owner_id UUID,
  is_public BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE path_nodes (
  path_id UUID,
  concept_id VARCHAR(50),
  position INT,
  optional BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (path_id, concept_id),
  FOREIGN KEY (path_id) REFERENCES paths(id),
  FOREIGN KEY (concept_id) REFERENCES concepts(id)
);

CREATE TABLE user_progress (
  user_id UUID,
  concept_id VARCHAR(50),
  status ENUM('not_started', 'in_progress', 'mastered') DEFAULT 'not_started',
  mastery_score FLOAT DEFAULT 0.0,
  last_activity TIMESTAMP,
  next_review_at TIMESTAMP,
  attempts JSONB,
  PRIMARY KEY (user_id, concept_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (concept_id) REFERENCES concepts(id)
);

CREATE TABLE xp_events (
  id UUID PRIMARY KEY,
  user_id UUID,
  amount INT,
  reason VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE badges (
  id UUID PRIMARY KEY,
  user_id UUID,
  name VARCHAR(255),
  description TEXT,
  awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

[Back to Main Page](./index.md)