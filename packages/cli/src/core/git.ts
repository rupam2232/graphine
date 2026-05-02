import { simpleGit, SimpleGit } from "simple-git";
import path from "path";
import fs from "fs";
import type { MultiDirectedGraph } from "graphology";
import type { NodeData, EdgeData } from "./graph.js";
import chalk from "chalk";

const COMMIT_LIMIT = 100;
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
  lineToCommit: Record<string, string>;
}

interface CommitMetadata {
  message: string;
  author: string;
  date: string;
}

interface GitCache {
  version: string;
  head: string;
  commits: Record<string, CommitMetadata>;
  fileCommits: Record<string, string[]>;
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
  let repoRoot: string;
  let currentHead: string;

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

    repoRoot = (await git.raw(["rev-parse", "--show-toplevel"])).trim();
    currentHead = (await git.raw(["rev-parse", "HEAD"])).trim();
  } catch {
    return;
  }

  const outDir = path.join(targetDir, ".graphine");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const cacheFile = path.join(outDir, "git-cache.json");

  const cache: GitCache = loadCache(cacheFile) ?? {
    version: CACHE_VERSION,
    head: "",
    commits: {},
    fileCommits: {},
    blame: {},
  };

  async function getCommitMetadata(hash: string): Promise<CommitMetadata> {
    if (cache.commits[hash]) return cache.commits[hash]!;
    // Format: AuthorName===GRAPHINE===AuthorISODate===GRAPHINE===MessageBody
    const rawOut = await git.raw(["show", "-s", "--format=%an===GRAPHINE===%aI===GRAPHINE===%B", hash]);
    const parts = rawOut.split("===GRAPHINE===");
    
    const meta: CommitMetadata = {
      author: parts[0]?.trim() || "Unknown",
      date: parts[1]?.trim() || new Date().toISOString(),
      message: parts.slice(2).join("===GRAPHINE===").trim() || "",
    };
    
    cache.commits[hash] = meta;
    return meta;
  }

  async function ensureCommitNode(hash: string): Promise<string> {
    const intentNodeId = `commit::${hash}`;
    if (!graph.hasNode(intentNodeId)) {
      const meta = await getCommitMetadata(hash);
      graph.addNode(intentNodeId, {
        type: "intent",
        name: `Commit ${hash.substring(0, 7)}`,
        metadata: { 
          message: meta.message,
          author: meta.author,
          date: meta.date
        },
      });
    }
    return intentNodeId;
  }

  const fileNodeLookup = new Map<string, string>();
  for (const nodeId of graph.nodes()) {
    const data = graph.getNodeAttributes(nodeId);
    if (data.type === "file" && !data.metadata?.external) {
      const basename = path.basename(nodeId);
      if (GIT_ENRICH_SKIP.has(basename)) continue;
      fileNodeLookup.set(path.normalize(nodeId), nodeId);
    }
  }

  // ── Pass 1: git log ───────────────────────────────────────────────────────
  const headChanged = cache.head !== currentHead;
  if (headChanged) {
    const logOut = await git.raw([
      "log",
      `--max-count=${COMMIT_LIMIT}`,
      "--name-only",
      "--format=COMMIT:%H",
      "HEAD",
    ]);

    let currentHash: string | null = null;
    for (const rawLine of logOut.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("COMMIT:")) {
        currentHash = line.slice("COMMIT:".length);
        continue;
      }
      if (!currentHash) continue;

      const absolutePath = path.normalize(path.join(repoRoot, line));
      if (!cache.fileCommits[absolutePath]) cache.fileCommits[absolutePath] = [];
      if (!cache.fileCommits[absolutePath]!.includes(currentHash)) {
        cache.fileCommits[absolutePath]!.push(currentHash);
      }
    }
    cache.head = currentHead;
  }

  for (const [absolutePath, hashes] of Object.entries(cache.fileCommits)) {
    const fileNodeId = fileNodeLookup.get(absolutePath);
    if (!fileNodeId) continue;
    for (const hash of hashes) {
      const intentNodeId = await ensureCommitNode(hash);
      if (!graph.hasEdge(intentNodeId, fileNodeId)) {
        graph.addEdge(intentNodeId, fileNodeId, {
          type: "explains",
          confidence: "EXTRACTED",
        });
      }
    }
  }

  // ── Pass 2: git blame (parallel optimized) ───────────────────────────────
  const funcClassNodes = graph.nodes().filter((id) => {
    const data = graph.getNodeAttributes(id);
    return (
      ["function", "class", "type", "interface", "enum"].includes(data.type) &&
      !data.metadata?.external
    );
  });

  const nodesByFile = new Map<string, string[]>();
  for (const nodeId of funcClassNodes) {
    const filePath = nodeId.split("::")[0];
    if (!filePath) continue;
    if (!nodesByFile.has(filePath)) nodesByFile.set(filePath, []);
    nodesByFile.get(filePath)!.push(nodeId);
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

          let lineToCommit: Map<number, string>;
          if (cachedBlame && cachedBlame.mtime === currentMtime) {
            lineToCommit = new Map(
              Object.entries(cachedBlame.lineToCommit).map(([k, v]) => [
                parseInt(k, 10),
                v,
              ]),
            );
          } else {
            const targetLines = new Set<number>();
            for (const nodeId of nodeIds) {
              const startLine = graph.getNodeAttributes(nodeId).metadata?.startLine as number | undefined;
              if (startLine) targetLines.add(startLine);
            }

            const blameOut = await git.raw(["blame", "--line-porcelain", filePath]);
            lineToCommit = new Map<number, string>();
            for (const line of blameOut.split("\n")) {
              if (line.match(/^[0-9a-f]{40} /)) {
                const parts = line.split(" ");
                const lineNum = parseInt(parts[2]!, 10);
                if (targetLines.has(lineNum)) {
                  lineToCommit.set(lineNum, parts[0]!);
                }
              }
            }
            cache.blame[normalizedPath] = {
              mtime: currentMtime,
              lineToCommit: Object.fromEntries(
                [...lineToCommit.entries()].map(([k, v]) => [String(k), v]),
              ),
            };
          }

          for (const nodeId of nodeIds) {
            const data = graph.getNodeAttributes(nodeId);
            const startLine = data.metadata?.startLine as number | undefined;
            if (startLine && lineToCommit.has(startLine)) {
              const hash = lineToCommit.get(startLine)!;
              if (hash.startsWith("00000000")) continue;
              const intentNodeId = await ensureCommitNode(hash);
              if (!graph.hasEdge(intentNodeId, nodeId)) {
                graph.addEdge(intentNodeId, nodeId, {
                  type: "explains",
                  confidence: "EXTRACTED",
                });
              }
            }
          }
        } catch {
          // Skip
        }
      }),
    );
  }

  saveCache(cacheFile, cache);
}
