import fs from 'fs';
import path from 'path';
import type { MultiDirectedGraph } from 'graphology';
import type { NodeData, EdgeData } from '../core/graph.js';

export function parseJson(
  filePath: string,
  graph: MultiDirectedGraph<NodeData, EdgeData>
) {
  const content = fs.readFileSync(filePath, 'utf8');
  let keyCount = 0;
  const fileName = path.basename(filePath);
  let deps: Record<string, string> = {};
  
  try {
    const data = JSON.parse(content);
    if (typeof data === 'object' && data !== null) {
      keyCount = Object.keys(data).length;
      if (fileName === 'package.json') {
        deps = { ...(data.dependencies || {}), ...(data.devDependencies || {}) };
      }
    }
  } catch {
    // ignore parse errors
  }

  if (!graph.hasNode(filePath)) {
    graph.addNode(filePath, {
      type: 'file',
      name: fileName,
      file: filePath,
      startLine: 0,
      metadata: {
        extension: '.json',
        keyCount
      }
    });
  }

  // Draw edges to external dependencies
  for (const dep of Object.keys(deps)) {
    const depNodeId = `import::${dep}`;
    if (!graph.hasNode(depNodeId)) {
      graph.addNode(depNodeId, {
        type: 'file',
        name: dep,
        file: filePath,
        startLine: 0,
        metadata: { external: true, extension: '.json' },
      });
    }
    graph.addEdge(filePath, depNodeId, {
      type: 'imports',
      confidence: 'EXTRACTED'
    });
  }
}
