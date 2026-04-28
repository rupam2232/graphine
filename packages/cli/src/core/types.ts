import { NodeData, EdgeData } from "./graph.js";

export interface WorkerNode {
  id: string;
  attr: NodeData;
}

export interface WorkerEdge {
  source: string;
  target: string;
  attr: EdgeData;
}

export interface WorkerMessage {
  nodes?: WorkerNode[];
  edges?: WorkerEdge[];
  error?: string;
}
