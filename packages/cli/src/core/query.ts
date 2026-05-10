import fs from "fs";
import path from "path";
import { MultiDirectedGraph } from "graphology";
import { NodeData, EdgeData, NodeType, EdgeType, ConfidenceType } from "./graph.js";

export interface QueryOptions {
  incoming: boolean;
  outgoing: boolean;
  depth: number;
}

export interface QueryResultNode {
  id: string;
  name: string;
  type: string;
  file: string;
  line: number;
  metadata?: Record<string, unknown>;
}

export interface QueryResult {
  target: QueryResultNode;
  incoming: Array<{ source: QueryResultNode; relation: string; confidence: string }>;
  outgoing: Array<{ target: QueryResultNode; relation: string; confidence: string }>;
}

function normalizeId(id: string): string {
  return id.replace(/\\/g, "/");
}

export async function queryGraph(
  targetDir: string,
  symbol: string,
  options: QueryOptions
): Promise<QueryResult> {
  const graphPath = path.join(targetDir, ".graphine", "graph.json");
  if (!fs.existsSync(graphPath)) {
    throw new Error("Graph data not found. Run 'graphine scan' first.");
  }

  const rawData = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
  const graph = new MultiDirectedGraph<NodeData, EdgeData>();
  
  const nodes = (rawData.nodes || []) as Array<Record<string, any>>;
  const edges = (rawData.edges || []) as Array<Record<string, any>>;

  nodes.forEach((n) => {
    const nid = normalizeId(n.id as string);
    if (!graph.hasNode(nid)) {
      const { name, type, file, startLine, ...metadata } = n;
      graph.addNode(nid, {
        name: (name as string) || "",
        type: type as NodeType,
        file: (file as string) || "",
        startLine: (startLine as number) || 0,
        metadata: (metadata as Record<string, unknown>) || {},
      });
    }
  });

  edges.forEach((e) => {
    const source = normalizeId(e.source);
    const target = normalizeId(e.target);
    if (graph.hasNode(source) && graph.hasNode(target)) {
      graph.addEdge(source, target, {
        type: (e.relation || e.type) as EdgeType,
        confidence: e.confidence as ConfidenceType,
        metadata: e.metadata || {},
      });
    }
  });

  // Find node by exact ID first, then fuzzy match name
  const normSymbol = normalizeId(symbol);
  let targetNodeId = graph.hasNode(normSymbol) ? normSymbol : null;

  if (!targetNodeId) {
    targetNodeId = graph.findNode((nodeId, attr) => 
      (attr && attr.name && attr.name.toLowerCase() === symbol.toLowerCase()) || 
      nodeId.toLowerCase() === normSymbol.toLowerCase() ||
      nodeId.toLowerCase().endsWith("/" + normSymbol.toLowerCase()) ||
      nodeId.toLowerCase().endsWith("::" + normSymbol.toLowerCase())
    ) ?? null;
  }

  if (!targetNodeId) {
    throw new Error(`Symbol '${symbol}' not found in the graph.`);
  }

  const targetAttr = graph.getNodeAttributes(targetNodeId);
  const result: QueryResult = {
    target: {
      id: targetNodeId,
      name: targetAttr.name,
      type: targetAttr.type,
      file: targetAttr.file,
      line: targetAttr.startLine,
      metadata: targetAttr.metadata,
    },
    incoming: [],
    outgoing: [],
  };

  const collectEdges = (nodeId: string, isOutgoing: boolean, seenKeys: Set<string>) => {
    const iterator = isOutgoing ? graph.forEachOutEdge.bind(graph) : graph.forEachInEdge.bind(graph);
    
    iterator(nodeId, (edge, attr, source, target) => {
      const neighborId = isOutgoing ? target : source;
      
      // Strict Self-Loop Filter: Never include the target node itself in neighbor lists
      if (neighborId === targetNodeId) return;
      
      const key = `${neighborId}:${attr.type}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const neighborAttr = graph.getNodeAttributes(neighborId);
      
      const nodeInfo = {
        id: neighborId,
        name: neighborAttr.name,
        type: neighborAttr.type,
        file: neighborAttr.file,
        line: neighborAttr.startLine,
      };

      if (isOutgoing) {
        result.outgoing.push({
          relation: attr.type,
          confidence: attr.confidence,
          target: nodeInfo
        });
      } else {
        result.incoming.push({
          relation: attr.type,
          confidence: attr.confidence,
          source: nodeInfo
        });
      }
    });
  };

  const seenIn = new Set<string>();
  const seenOut = new Set<string>();

  // 1. Surgical Accuracy: Only collect DIRECT neighbors.
  // This ensures 100% parity with the HTML graph visualization.
  if (options.incoming) collectEdges(targetNodeId, false, seenIn);
  if (options.outgoing) collectEdges(targetNodeId, true, seenOut);

  return result;
}
