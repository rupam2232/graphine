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
  
  try {
    const data = JSON.parse(content);
    if (typeof data === 'object' && data !== null) {
      keyCount = Object.keys(data).length;
    }
  } catch {
    // ignore parse errors
  }

  if (!graph.hasNode(filePath)) {
    graph.addNode(filePath, {
      type: 'file',
      name: path.basename(filePath),
      metadata: {
        extension: '.json',
        keyCount
      }
    });
  }
}
