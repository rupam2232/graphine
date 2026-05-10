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
      file: filePath,
      startLine: 0,
      metadata: {
        extension: '.md',
        wordCount
      }
    });
  }

  // Extract references to codebase files
  const fileRefs = new Set<string>();
  
  // Match Markdown links: [Code](./src/core.ts)
  const linkRegex = /\[.*?\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    if (match[1]) fileRefs.add(match[1]);
  }
  
  // Match inline code blocks with paths: `packages/cli/src/core.ts`
  const codeRegex = /`([^`]+)`/g;
  while ((match = codeRegex.exec(content)) !== null) {
    if (match[1] && match[1].includes('.') && !match[1].includes(' ')) {
       fileRefs.add(match[1]);
    }
  }

  const dir = path.dirname(filePath);
  
  for (const ref of fileRefs) {
    let resolvedPath = "";
    if (ref.startsWith('./') || ref.startsWith('../')) {
       resolvedPath = path.resolve(dir, ref);
    } else {
       resolvedPath = path.resolve(process.cwd(), ref);
    }
    
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
       if (!graph.hasNode(resolvedPath)) {
         graph.addNode(resolvedPath, {
           type: 'file',
           name: path.basename(resolvedPath),
           file: resolvedPath,
           startLine: 0,
           metadata: { extension: path.extname(resolvedPath) }
         });
       }
       
       graph.addEdge(filePath, resolvedPath, {
         type: 'explains',
         confidence: 'EXTRACTED'
       });
    }
  }
}
