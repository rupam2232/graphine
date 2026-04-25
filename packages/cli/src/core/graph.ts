import { MultiDirectedGraph } from "graphology";

// Define strict types for our Knowledge Graph
export type NodeType = "file" | "media" | "function" | "class" | "variable" | "intent";
export type EdgeType =
  | "imports"
  | "calls"
  | "defines"
  | "superseded_by"
  | "explains";

export interface NodeData {
  type: NodeType;
  name: string;
  metadata?: Record<string, unknown>; // Safe typing, avoids "any"
}

export interface EdgeData {
  type: EdgeType;
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
