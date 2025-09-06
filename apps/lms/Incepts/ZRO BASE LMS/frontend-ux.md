# Frontend UX & Components

## Key Pages/Components

- **RoadmapCanvas**: Zoomable graph (React-Flow), showing nodes, progress, and prerequisites.
- **NodeCard**: Displays concept summary, progress bar, and estimated time.
- **LessonPane**: Renders markdown content, exercises, and user notes.
- **QuizModal**: Adaptive MCQs with dynamic difficulty and hints.
- **ProjectWorkspace**: Code editor (Monaco), terminal, and submission UI.
- **Dashboard**: Shows progress, XP, badges, and next recommended nodes.
- **Community**: Threaded Q&A with upvote/downvote and rich text.

## Tech Stack

- **React + TypeScript**: Core framework for modular components.
- **React-Flow**: Graph visualization for roadmap.
- **Tailwind CSS**: Utility-first styling for rapid prototyping.
- **Framer Motion**: Smooth animations for node transitions and modals.
- **React Query**: Data fetching, caching, and optimistic updates.
- **Monaco Editor**: Code editing for projects.
- **Vite**: Build tool for fast development and production bundles.

## Sample Roadmap Component (React)

```jsx
import { ReactFlow, Controls, Background } from '@xyflow/react-flow';
import NodeCard from './NodeCard';

const RoadmapCanvas = ({ nodes, edges, userProgress }) => {
  const nodeTypes = { concept: NodeCard };

  return (
    <div style={{ height: '80vh' }}>
      <ReactFlow
        nodes={nodes.map(node => ({
          ...node,
          data: { ...node.data, progress: userProgress[node.id] },
        ))}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
      >
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
};

export default RoadmapCanvas;
```

[Back to Main Page](./index.md)