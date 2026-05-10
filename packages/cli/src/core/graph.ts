import { MultiDirectedGraph } from "graphology";

export type NodeType =
  | "file"
  | "media"
  | "function"
  | "class"
  | "intent"
  | "type"
  | "interface"
  | "enum";
export type EdgeType =
  | "imports"
  | "calls"
  | "defines"
  | "superseded_by"
  | "explains"
  | "extends"
  | "implements"
  | "references";
export type ConfidenceType = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface NodeData {
  type: NodeType;
  name: string;
  file: string;
  startLine: number;
  unresolved?: boolean;
  reason?: string;
  metadata?: Record<string, unknown> & {
    endLine?: number;
    callerFile?: string;
    callerLine?: number;
    message?: string;
  };
}


export interface EdgeData {
  type: EdgeType;
  confidence: ConfidenceType;
  metadata?: Record<string, unknown>;
}

/**
 * Creates and returns a new production-ready Graphology Knowledge Graph instance.
 * We use a "directed" graph because imports and function calls have a specific direction.
 * We allow "multi" edges because two nodes might have multiple relationships.
 */
export function createKnowledgeGraph(): MultiDirectedGraph<NodeData, EdgeData> {
  return new MultiDirectedGraph<NodeData, EdgeData>();
}

/**
 * Resolution pass: After all files are parsed, any `unresolved_fn::X` ghost node
 * is matched against real defined functions in the graph (`someFile::function::X`).
 * If a match is found, all edges to the ghost are rewired to the real node,
 * and the ghost node is deleted. This eliminates duplicate nodes for the same function.
 */
export function resolveCallGraph(
  graph: MultiDirectedGraph<NodeData, EdgeData>,
): void {
  // Build a lookup map: name -> real node ID (prefer first match)
  const realDefs = new Map<string, string>();
  for (const nodeId of graph.nodes()) {
    const data = graph.getNodeAttributes(nodeId);
    if (!nodeId.startsWith("unresolved::") && (data.type === "function" || data.type === "class" || data.type === "type" || data.type === "interface" || data.type === "enum")) {
      const name = data.name;
      if (!realDefs.has(name)) {
        realDefs.set(name, nodeId);
      }
    }
  }

  // Find all ghost nodes and rewire them
  const ghosts = graph.nodes().filter((n) => n.startsWith("unresolved::"));
  for (const ghostId of ghosts) {
    const ghostData = graph.getNodeAttributes(ghostId);
    const realId = realDefs.get(ghostData.name);

    if (realId) {
      // Rewire all incoming edges (callers → ghost) to (callers → real)
      for (const edgeId of graph.inEdges(ghostId)) {
        const src = graph.source(edgeId);
        const edgeData = graph.getEdgeAttributes(edgeId);
        if (!graph.hasEdge(src, realId)) {
          graph.addEdge(src, realId, edgeData);
        }
      }
      // Drop the ghost node (also removes its edges automatically)
      graph.dropNode(ghostId);
    }
  }
}
