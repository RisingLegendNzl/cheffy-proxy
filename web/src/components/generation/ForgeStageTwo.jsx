// web/src/components/generation/ForgeStageTwo.jsx
import React, { useEffect, useState } from ‘react’;
import { COLORS } from ‘../../constants’;
import { prefersReducedMotion } from ‘../../utils/animationHelpers’;

/**

- Forge Stage Two - “Calculating”
- Geometric lattice/grid forms, pulsing with data points
- Visual metaphor: Molecular bonds forming, AI processing data
  */
  const ForgeStageTwo = () => {
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);

useEffect(() => {
if (prefersReducedMotion()) return;

```
// Generate lattice nodes
const gridSize = 5;
const spacing = 60;
const newNodes = [];

for (let row = 0; row < gridSize; row++) {
  for (let col = 0; col < gridSize; col++) {
    newNodes.push({
      id: `${row}-${col}`,
      x: col * spacing,
      y: row * spacing,
      delay: (row + col) * 50,
    });
  }
}

// Generate connections between adjacent nodes
const newConnections = [];
for (let row = 0; row < gridSize; row++) {
  for (let col = 0; col < gridSize; col++) {
    // Horizontal connection
    if (col < gridSize - 1) {
      newConnections.push({
        id: `h-${row}-${col}`,
        x1: col * spacing,
        y1: row * spacing,
        x2: (col + 1) * spacing,
        y2: row * spacing,
        delay: (row + col) * 50,
      });
    }
    // Vertical connection
    if (row < gridSize - 1) {
      newConnections.push({
        id: `v-${row}-${col}`,
        x1: col * spacing,
        y1: row * spacing,
        x2: col * spacing,
        y2: (row + 1) * spacing,
        delay: (row + col) * 50,
      });
    }
    // Diagonal connection (some of them)
    if (row < gridSize - 1 && col < gridSize - 1 && Math.random() > 0.6) {
      newConnections.push({
        id: `d-${row}-${col}`,
        x1: col * spacing,
        y1: row * spacing,
        x2: (col + 1) * spacing,
        y2: (row + 1) * spacing,
        delay: (row + col) * 50,
      });
    }
  }
}

setNodes(newNodes);
setConnections(newConnections);
```

}, []);

if (prefersReducedMotion()) {
return (
<div className="flex items-center justify-center py-12">
<div className="text-white text-lg font-semibold animate-pulse">
Calculating optimal nutrition…
</div>
</div>
);
}

const containerWidth = 240;
const containerHeight = 240;

return (
<div className=“relative flex items-center justify-center” style={{ height: ‘250px’ }}>
<svg
width={containerWidth}
height={containerHeight}
viewBox={`0 0 ${containerWidth} ${containerHeight}`}
className=“animate-latticeFormation”
>
{/* Connections */}
{connections.map((conn) => (
<line
key={conn.id}
x1={conn.x1}
y1={conn.y1}
x2={conn.x2}
y2={conn.y2}
stroke=“rgba(255, 255, 255, 0.4)”
strokeWidth=“2”
className=“animate-latticePulse”
style={{
animationDelay: `${conn.delay}ms`,
}}
/>
))}

```
    {/* Nodes */}
    {nodes.map((node) => (
      <circle
        key={node.id}
        cx={node.x}
        cy={node.y}
        r="4"
        fill="white"
        className="animate-pulse"
        style={{
          animationDelay: `${node.delay}ms`,
        }}
      />
    ))}

    {/* Central pulsing core */}
    <circle
      cx={containerWidth / 2}
      cy={containerHeight / 2}
      r="12"
      fill={COLORS.forge.warm}
      className="animate-forgeHeatPulse"
    />
    <circle
      cx={containerWidth / 2}
      cy={containerHeight / 2}
      r="8"
      fill="white"
      opacity="0.9"
    />
  </svg>

  {/* Data stream effect */}
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    {[...Array(8)].map((_, i) => (
      <div
        key={i}
        className="absolute h-px bg-white opacity-30 animate-slideRight"
        style={{
          top: `${(i + 1) * 12}%`,
          width: '100%',
          animationDelay: `${i * 200}ms`,
          animationDuration: '2s',
        }}
      />
    ))}
  </div>
</div>
```

);
};

export default ForgeStageTwo;