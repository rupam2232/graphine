import fs from 'fs';
import path from 'path';
import type { MultiDirectedGraph } from 'graphology';
import type { NodeData, EdgeData } from '../core/graph.js';

export function parseMarkdown(
  filePath: string,
  graph: MultiDirectedGraph<NodeData, EdgeData>
) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Simple approximation of word count
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

  if (!graph.hasNode(filePath)) {
    graph.addNode(filePath, {
      type: 'file',
      name: path.basename(filePath),
      metadata: {
        extension: '.md',
        wordCount
      }
    });
  }
}
