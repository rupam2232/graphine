import { simpleGit, SimpleGit } from "simple-git";
import path from "path";
import fs from "fs";
import type { MultiDirectedGraph } from "graphology";
import type { NodeData, EdgeData } from "./graph.js";
import chalk from "chalk";

const CACHE_VERSION = "1";

const GIT_ENRICH_SKIP = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "shrinkwrap.json",
  "npm-shrinkwrap.json",
  "Gemfile.lock",
  "Cargo.lock",
  "Pipfile.lock",
  "poetry.lock",
  "composer.lock",
  "packages.lock.json",
  "CHANGELOG.md",
  "CHANGELOG.txt",
]);

interface GitCacheBlameEntry {
  mtime: number;
  nodeToCommits: Record<string, string[]>;
}

interface CommitMetadata {
  message: string;
  author: string;
  date: string;
}

interface GitCache {
  version: string;
  commits: Record<string, CommitMetadata>;
  blame: Record<string, GitCacheBlameEntry>;
}

function loadCache(cacheFile: string): GitCache | null {
  try {
    const raw = fs.readFileSync(cacheFile, "utf-8");
    const parsed = JSON.parse(raw) as GitCache;
    if (parsed.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(cacheFile: string, cache: GitCache): void {
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

export async function enrichWithGit(
  graph: MultiDirectedGraph<NodeData, EdgeData>,
  targetDir: string,
) {
  let git: SimpleGit;

  try {
    git = simpleGit(targetDir);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return;

    // Detect shallow clones (common in GitHub Actions / CI).
    const isShallow = (await git.raw(["rev-parse", "--is-shallow-repository"])).trim() === "true";
    if (isShallow) {
      console.warn(chalk.yellow("\n\u26A0\u3000Shallow Git repository detected. Skipping Git enrichment to save time."));
      return;
    }
  } catch {
    return;
  }

  const outDir = path.join(targetDir, ".graphine");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const cacheFile = path.join(outDir, "git-cache.json");

  const cache: GitCache = loadCache(cacheFile) ?? {
    version: CACHE_VERSION,
    commits: {},
    blame: {},
  };

  const allDiscoveredHashes = new Set<string>();
  const globalNodeCommits = new Map<string, string[]>();


  const nodesByFile = new Map<string, string[]>();

  // Group functions, classes, etc. by their file path
  for (const nodeId of graph.nodes()) {
    const data = graph.getNodeAttributes(nodeId);
    if (data.metadata?.external) continue;
    
    if (["function", "class", "type", "interface", "enum"].includes(data.type)) {
      const filePath = nodeId.split("::")[0];
      if (!filePath) continue;
      if (!nodesByFile.has(filePath)) nodesByFile.set(filePath, []);
      nodesByFile.get(filePath)!.push(nodeId);
    }
  }

  // If a file has NO functions/classes, map commits to the file node itself
  for (const nodeId of graph.nodes()) {
    const data = graph.getNodeAttributes(nodeId);
    if (data.type === "file" && !data.metadata?.external) {
      const basename = path.basename(nodeId);
      if (GIT_ENRICH_SKIP.has(basename)) continue;
      if (!nodesByFile.has(nodeId)) {
        nodesByFile.set(nodeId, [nodeId]);
      }
    }
  }

  const filePaths = Array.from(nodesByFile.keys());
  const BATCH_SIZE = 15;
  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (filePath) => {
        const nodeIds = nodesByFile.get(filePath)!;
        try {
          const normalizedPath = path.normalize(filePath);
          const stat = fs.statSync(filePath);
          const currentMtime = stat.mtimeMs;
          const cachedBlame = cache.blame[normalizedPath];

          let nodeCommits: Record<string, string[]> = {};
          if (cachedBlame && cachedBlame.mtime === currentMtime) {
            nodeCommits = cachedBlame.nodeToCommits;
          } else {
            const blameOut = await git.raw(["blame", "--line-porcelain", filePath]);
            const allLineToCommit = new Map<number, string>();
            let maxLine = 0;
            
            for (const line of blameOut.split("\n")) {
              if (line.match(/^[0-9a-f]{40} /)) {
                const parts = line.split(" ");
                const lineNum = parseInt(parts[2]!, 10);
                allLineToCommit.set(lineNum, parts[0]!);
                if (lineNum > maxLine) maxLine = lineNum;
              }
            }

            for (const nodeId of nodeIds) {
              let startLine = graph.getNodeAttributes(nodeId).startLine as number | undefined;
              let endLine = graph.getNodeAttributes(nodeId).metadata?.endLine as number | undefined;
              
              if (!startLine) {
                if (graph.getNodeAttributes(nodeId).type === "file") {
                  startLine = 1;
                  endLine = maxLine;
                } else {
                  continue;
                }
              }
              const finalEnd = endLine || startLine;
              
              const uniqueCommits = new Set<string>();
              for (let i = startLine; i <= finalEnd; i++) {
                const hash = allLineToCommit.get(i);
                if (hash && !hash.startsWith("00000000")) {
                  uniqueCommits.add(hash);
                }
              }
              nodeCommits[nodeId] = Array.from(uniqueCommits);
            }

            cache.blame[normalizedPath] = {
              mtime: currentMtime,
              nodeToCommits: nodeCommits,
            };
          }

          for (const nodeId of nodeIds) {
            const commits = nodeCommits[nodeId] || [];
            globalNodeCommits.set(nodeId, commits);
            for (const hash of commits) {
              allDiscoveredHashes.add(hash);
            }
          }
        } catch {
          // Skip untracked/unblameable files silently
        }
      }),
    );
  }

  // ── Bulk Fetch Missing Commit Metadata ─────────────────────────────────────
  const missingHashes = Array.from(allDiscoveredHashes).filter(hash => !cache.commits[hash]);
  
  if (missingHashes.length > 0) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < missingHashes.length; i += CHUNK_SIZE) {
      const chunk = missingHashes.slice(i, i + CHUNK_SIZE);
      try {
        const rawOut = await git.raw([
          "show",
          "--no-patch",
          "--format=%H===GRAPHINE===%an===GRAPHINE===%aI===GRAPHINE===%B",
          ...chunk
        ]);
        
        // Split output by hash blocks. Using %H===GRAPHINE=== as an anchor
        const blocks = rawOut.split(/(?=[0-9a-f]{40}===GRAPHINE===)/);
        
        for (const block of blocks) {
          if (!block.trim()) continue;
          const parts = block.split("===GRAPHINE===");
          if (parts.length >= 4) {
            const hash = parts[0]!.trim();
            cache.commits[hash] = {
              author: parts[1]!.trim(),
              date: parts[2]!.trim(),
              message: parts.slice(3).join("===GRAPHINE===").trim(),
            };
          }
        }
      } catch {
        console.warn(chalk.yellow("\n\u26A0\u3000Warning: Failed to bulk-fetch metadata for some commits."));
      }
    }
  }

  // ── Synchronous Graph Insertion ────────────────────────────────────────────
  for (const [nodeId, commits] of globalNodeCommits.entries()) {
    for (const hash of commits) {
      const meta = cache.commits[hash];
      if (!meta) continue;

      const intentNodeId = `commit::${hash}`;
      if (!graph.hasNode(intentNodeId)) {
        graph.addNode(intentNodeId, {
          type: "intent",
          name: `Commit ${hash.substring(0, 7)}`,
          file: "", // Intent nodes are global to the commit
          startLine: 0,
          metadata: { 
            message: meta.message,
            author: meta.author,
            date: meta.date
          },
        });
      }

      if (!graph.hasEdge(intentNodeId, nodeId)) {
        graph.addEdge(intentNodeId, nodeId, {
          type: "explains",
          confidence: "EXTRACTED",
        });
      }
    }
  }

  saveCache(cacheFile, cache);
}
