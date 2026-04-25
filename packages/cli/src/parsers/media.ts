import fs from 'fs';
import path from 'path';
import type { MultiDirectedGraph } from 'graphology';
import type { NodeData, EdgeData } from '../core/graph.js';

export function parseMedia(
  filePath: string,
  graph: MultiDirectedGraph<NodeData, EdgeData>
) {
  const stats = fs.statSync(filePath);
  
  if (!graph.hasNode(filePath)) {
    graph.addNode(filePath, {
      type: 'media',
      name: path.basename(filePath),
      metadata: {
        extension: path.extname(filePath),
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
      }
    });
  }
}
