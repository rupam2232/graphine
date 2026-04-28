import fs from "fs";
import path from "path";
import type { MultiDirectedGraph } from "graphology";
import type { NodeData, EdgeData, NodeType } from "./graph.js";

/**
 * Compresses and serializes the Graphology instance into a clean JSON structure
 * suitable for LLM injection ("Caveman Mode").
 */
export function exportGraphJson(
  graph: MultiDirectedGraph<NodeData, EdgeData>,
  outDir: string,
) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const nodes = graph.nodes().map((nodeId) => {
    const data = graph.getNodeAttributes(nodeId);
    return {
      id: nodeId,
      type: data.type,
      name: data.name,
      ...data.metadata,
    };
  });

  const edges = graph.edges().map((edgeId) => {
    const source = graph.source(edgeId);
    const target = graph.target(edgeId);
    const data = graph.getEdgeAttributes(edgeId);
    return {
      source,
      target,
      relation: data.type,
      confidence: data.confidence,
      ...data.metadata,
    };
  });

  const payload = {
    version: "1.0.0",
    nodes,
    edges,
  };

  const jsonPath = path.join(outDir, "graph.json");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf-8");

  return jsonPath;
}

/**
 * Generates a token-efficient plain-language Markdown report.
 * This is an LLM-friendly overview of the codebase architecture and history.
 */
export function exportReportMarkdown(
  graph: MultiDirectedGraph<NodeData, EdgeData>,
  outDir: string,
) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let md = `# Graphine Codebase Report\n\n`;

  // Section 1: Architecture (Files and Functions)
  md += `## Architecture Structure\n`;
  const fileNodes = graph
    .nodes()
    .filter((n) => graph.getNodeAttribute(n, "type") === "file");

  for (const file of fileNodes) {
    const data = graph.getNodeAttributes(file);
    if (data.metadata?.external) continue;

    md += `- **${data.name}**\n`;

    // Find classes and functions defined in this file
    const definesEdges = graph.outEdges(file).filter((edgeId) => {
      return graph.getEdgeAttribute(edgeId, "type") === "defines";
    });

    for (const edgeId of definesEdges) {
      const target = graph.target(edgeId);
      const targetData = graph.getNodeAttributes(target);
      md += `  - \`${targetData.type} ${targetData.name}\`\n`;
    }
  }

  // Section 2: Temporal Facts (Intent)
  const intentNodes = graph
    .nodes()
    .filter((n) => graph.getNodeAttribute(n, "type") === "intent");

  if (intentNodes.length > 0) {
    md += `\n## Recent Architectural Changes & Intent\n`;
    for (const intent of intentNodes) {
      const data = graph.getNodeAttributes(intent);
      const msg = data.metadata?.message || "";
      md += `- **${data.name}**: ${msg}\n`;
    }
  }

  const mdPath = path.join(outDir, "GRAPH_REPORT.md");
  fs.writeFileSync(mdPath, md, "utf-8");

  return mdPath;
}

/**
 * Generates a standalone interactive HTML visualization of the knowledge graph
 * using force-graph. No build step required, opens directly in any browser.
 */
export function exportGraphHtml(
  graph: MultiDirectedGraph<NodeData, EdgeData>,
  outDir: string,
) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const counts: Record<string, number> = {
    file: 0,
    class: 0,
    function: 0,
    intent: 0,
  };

  // Calculate node degrees for sizing and label logic
  const nodeDegrees = new Map<string, number>();
  graph.nodes().forEach((n) => {
    nodeDegrees.set(n, graph.degree(n));
  });

  // Sort nodes by degree to find the top 50 hubs
  const sortedByDegree = [...graph.nodes()].sort(
    (a, b) => (nodeDegrees.get(b) || 0) - (nodeDegrees.get(a) || 0),
  );
  const topHubs = new Set(sortedByDegree.slice(0, 50));
  const maxDegree = Math.max(...Array.from(nodeDegrees.values()), 1);

  const COLORS: Record<NodeType, string> & { default: string } = {
    default: "#64748b",
    file: "#479af3ff",
    class: "#F28E2B",
    function: "#ee272bff",
    intent: "#35d86eff",
    media: "#9C755F",
    variable: "#d835d8ff",
  };

  const RAW_NODES = graph.nodes().map((n) => {
    const data = graph.getNodeAttributes(n);
    const degree = nodeDegrees.get(n) || 0;

    const scaledSize = 10 + 30 * (degree / maxDegree);

    const color = COLORS[data.type] ?? COLORS.default;

    if (data.type && counts[data.type] !== undefined) {
      counts[data.type] = (counts[data.type] || 0) + 1;
    }

    // Label Logic: Show all if <= 50 nodes, otherwise only top 50 hubs
    const showLabel = graph.order <= 50 || topHubs.has(n);
    const fontSize = showLabel ? 12 : 0;

    let sourceFile = "";
    if (n.includes("::")) {
      sourceFile = n.split("::")[0] as string;
    } else if (data.type === "file") {
      sourceFile = n;
    }

    return {
      id: n,
      label: data.name || n,
      title: data.name || n,
      color: {
        background: color,
        border: color,
        highlight: { background: "#ffffff", border: color },
        hover: { background: color, border: "#ffffff" },
      },
      size: scaledSize,
      font: {
        size: fontSize,
        color: "#ffffff",
        strokeWidth: 2,
        strokeColor: "#0f0f1a",
      },
      node_type: data.type,
      source_file: sourceFile,
      degree: degree,
      ...data.metadata,
    };
  });

  const RAW_EDGES = graph.edges().map((id) => {
    return {
      from: graph.source(id),
      to: graph.target(id),
      color: { color: "rgba(255,255,255,0.15)", highlight: "#ffffff" },
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      smooth: { type: "continuous", roundness: 0.2 },
      width: 1,
    };
  });

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Graphine Knowledge Graph</title>
  <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
  <style>
    body, html {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background: #0f0f1a; color: #fff; overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #container { width: 100%; height: 100%; }
    
    #loading-overlay {
      position: absolute; inset: 0; background: #0f0f1a;
      display: flex; align-items: center; justify-content: center;
      z-index: 200; font-size: 1rem; color: #3b82f6;
      transition: opacity 0.5s ease;
    }

    #sidebar {
      position: absolute; left: 20px; top: 20px; bottom: 20px;
      width: 320px; background: rgba(26, 26, 46, 0.9);
      backdrop-filter: blur(10px); border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      display: flex; flex-direction: column; z-index: 100;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    #sidebar-header { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    #sidebar-header h1 { margin: 0; font-size: 1.2rem; color: #fff; }
    #sidebar-header p { margin: 5px 0 0; font-size: 0.8rem; color: #888; }
    
    #search-box { padding: 15px; }
    #search {
      width: 100%; padding: 10px; background: rgba(0,0,0,0.2);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
      color: #fff; box-sizing: border-box; font-family: inherit;
    }
    
    #info-panel { flex: 1; padding: 20px; overflow-y: auto; font-size: 0.9rem; scrollbar-color: rgba(255,255,255,0.1) transparent; scrollbar-width: thin }
    #info-panel h3 { margin-top: 0; font-size: 1rem; color: #3b82f6; }
    #info-content { word-break: break-word; }
    .field { margin-bottom: 12px; }
    .field b { color: #888; display: block; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 2px; }
    .empty { color: #555; font-style: italic; }
    
    #legend { padding: 20px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; gap: 0.3rem; }
    .legend-item { display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; }
    .legend-item-left { display: flex; align-items: center; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; }
    .legend-count { color: #666; font-weight: 600; }
    #stats { padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #666; background: rgba(26, 26, 46, 0.9); border-radius: 0 0 12px 12px; }
  </style>
</head>
<body>
  <div id="loading-overlay">Loading Knowledge Graph...</div>
  <div id="sidebar">
    <div id="sidebar-header">
      <h1>Graphine Map</h1>
      <p>Codebase Knowledge Graph</p>
    </div>
    <div id="search-box">
      <input type="text" id="search" placeholder="Search nodes...">
    </div>
    <div id="info-panel">
      <div id="info-content">
        <span class="empty">Select a node to view its properties</span>
      </div>
    </div>
    <div id="legend">
      <div class="legend-item"><div class="legend-item-left"><div class="legend-dot" style="background: ${COLORS.file};"></div> File</div><span class="legend-count">${counts.file || 0}</span></div>
      <div class="legend-item"><div class="legend-item-left"><div class="legend-dot" style="background: ${COLORS.class};"></div> Class</div><span class="legend-count">${counts.class || 0}</span></div>
      <div class="legend-item"><div class="legend-item-left"><div class="legend-dot" style="background: ${COLORS.function};"></div> Function</div><span class="legend-count">${counts.function || 0}</span></div>
      <div class="legend-item"><div class="legend-item-left"><div class="legend-dot" style="background: ${COLORS.intent};"></div> Intent</div><span class="legend-count">${counts.intent || 0}</span></div>
    </div>
    <div id="stats">${RAW_NODES.length} nodes &middot; ${RAW_EDGES.length} edges</div>
  </div>
  <div id="container"></div>

<script type="text/javascript">
  const RAW_NODES = ${JSON.stringify(RAW_NODES)};
  const RAW_EDGES = ${JSON.stringify(RAW_EDGES)};

  const container = document.getElementById('container');
  const nodes = new vis.DataSet(RAW_NODES);
  const edges = new vis.DataSet(RAW_EDGES);
  const data = { nodes, edges };

  const options = {
    nodes: { shape: 'dot' },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      color: { inherit: 'from' },
      smooth: { type: 'continuous', roundness: 0.2 }
    },
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -60,
        centralGravity: 0.005,
        springLength: 120,
        springConstant: 0.08,
        damping: 0.4,
        avoidOverlap: 0.8
      },
      stabilization: {
        enabled: true,
        iterations: 200,
        updateInterval: 25,
        fit: true
      }
    },
    interaction: { 
      hover: true, 
      tooltipDelay: 100,
      hideEdgesOnDrag: true,
      multiselect: true,
      navigationButtons: false,
      keyboard: true
    }
  };
  
  const network = new vis.Network(container, data, options);

  network.on("stabilizationIterationsDone", function() {
    document.getElementById('loading-overlay').style.opacity = '0';
    setTimeout(() => {
      document.getElementById('loading-overlay').style.display = 'none';
    }, 500);
    network.setOptions({ physics: { enabled: false } });
  });

  network.on("hoverNode", () => container.style.cursor = 'pointer');
  network.on("blurNode", () => container.style.cursor = 'default');
  network.on("hoverEdge", () => container.style.cursor = 'default');
  network.on("blurEdge", () => container.style.cursor = 'default');

  function showNodeInfo(nodeId) {
    const infoContent = document.getElementById('info-content');
    if (!nodeId) {
      infoContent.innerHTML = '<span class="empty">Select a node to view its properties</span>';
      return;
    }
    const nodeData = RAW_NODES.find(n => n.id === nodeId);
    if (!nodeData) return;

    let html = \`<div class="field"><b>ID</b> \${nodeData.id}</div>\`;
    html += \`<div class="field"><b>Type</b> \${nodeData.node_type}</div>\`;
    html += \`<div class="field"><b>Name</b> \${nodeData.label}</div>\`;
    html += \`<div class="field"><b>Links</b> \${nodeData.degree}</div>\`;

    if (nodeData.source_file && !['unresolved_fn', 'import'].includes(nodeData.source_file)) {
      html += \`<div class="field"><b>Source</b> \${nodeData.source_file}</div>\`;
    }

    if (nodeData.startLine) {
      const lineText = nodeData.startLine === nodeData.endLine ? nodeData.startLine : \`\${nodeData.startLine} - \${nodeData.endLine}\`;
      html += \`<div class="field"><b>Lines</b> \${lineText}</div>\`;
    }

    if (nodeData.message) {
      html += \`<div class="field"><b>Message</b> \${nodeData.message.replace(/\\n/g, '<br>')}</div>\`;
    }

    if (nodeData.unresolved) {
      html += \`<div class="field"><b>Status</b> <span style="color:#EDC948">Unresolved</span></div>\`;
      if (nodeData.reason) html += \`<div class="field"><b>Reason</b> \${nodeData.reason}</div>\`;
    }

    infoContent.innerHTML = html;
  }

  network.on("selectNode", (params) => showNodeInfo(params.nodes[0]));
  network.on("deselectNode", () => showNodeInfo(null));

  let searchTimer;
  document.getElementById('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value.toLowerCase();
    if (!val) {
      network.selectNodes([]);
      showNodeInfo(null);
      return;
    }
    searchTimer = setTimeout(() => {
      const matched = RAW_NODES.filter(n => n.label.toLowerCase().includes(val)).map(n => n.id);
      if (matched.length > 0) {
        network.selectNodes(matched);
        network.focus(matched[0], { scale: 1, animation: { duration: 1000, easingFunction: 'easeInOutQuad' }});
        showNodeInfo(matched[0]);
      }
    }, 400);
  });
</script>
</body>
</html>`;

  const htmlPath = path.join(outDir, "graph.html");
  fs.writeFileSync(htmlPath, htmlContent, "utf-8");

  return htmlPath;
}
