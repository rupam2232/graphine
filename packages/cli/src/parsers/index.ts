import type { MultiDirectedGraph } from 'graphology';
import type { NodeData, EdgeData } from '../core/graph.js';
import { parseTypeScript } from './typescript.js';
import { parseJson } from './json.js';
import { parseMarkdown } from './markdown.js';
import { parseMedia } from './media.js';

const MEDIA_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 
  'mp4', 'webm', 'mp3', 'wav'
]);

/**
 * Routes the file to the appropriate AST parser based on its extension.
 */
export function parseFile(
  filePath: string,
  graph: MultiDirectedGraph<NodeData, EdgeData>
) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  
  if (ext === 'ts' || ext === 'js' || ext === 'tsx' || ext === 'jsx') {
    parseTypeScript(filePath, graph);
  } else if (ext === 'json') {
    parseJson(filePath, graph);
  } else if (ext === 'md') {
    parseMarkdown(filePath, graph);
  } else if (MEDIA_EXTS.has(ext)) {
    parseMedia(filePath, graph);
  } else {
    // Unknown file type, just add it as an empty node
    if (!graph.hasNode(filePath)) {
      graph.addNode(filePath, {
        type: 'file',
        name: filePath,
      });
    }
  }
}
