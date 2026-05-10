import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "path";
import { availableParallelism } from "os";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";
import { scanDirectory } from "./core/scanner.js";
import { createKnowledgeGraph, resolveCallGraph } from "./core/graph.js";
import { enrichWithGit } from "./core/git.js";
import { analyzeGraph } from "./core/analyze.js";
import { WorkerMessage } from "./core/types.js";
import {
  exportGraphJson,
  exportReportMarkdown,
  exportGraphHtml,
} from "./core/serializer.js";
import { installGraphine, uninstallGraphine } from "./core/install.js";

export const program = new Command();

program
  .name("graphine")
  .description(chalk.blue("Graphine: Local-first AI context extraction tool"))
  .version("0.0.0");

program
  .command("scan")
  .description("Scan the current directory and build the Knowledge Graph")
  .action(async () => {
    console.log(chalk.cyan("\nGraphine Engine Started\n"));

    const targetDir = process.cwd();

    // Modern loading animation
    const spinner = ora({
      text: chalk.gray(`Scanning codebase in ${targetDir}...`),
      color: "cyan",
      spinner: "dots",
    }).start();

    const startTime = performance.now();

    try {
      // Phase 2: Invoke the File Walker
      const files = await scanDirectory(targetDir);

      // Phase 3: Initialize Knowledge Graph
      spinner.text = chalk.gray("Initializing Knowledge Graph...");
      const graph = createKnowledgeGraph();

      // Seed the graph with file nodes
      for (const file of files) {
        if (!graph.hasNode(file)) {
          graph.addNode(file, {
            type: "file",
            name: path.basename(file),
            file,
            startLine: 0,
            metadata: {
              extension: path.extname(file),
            },
          });
        }
      }

      // Phase 4: AST Parsing
      // Optimization: Using Worker Threads to utilize all CPU cores and prevent main-thread freeze.
      spinner.text = chalk.gray(`Parsing AST for ${files.length} files...`);

      const numWorkers = Math.min(availableParallelism(), files.length);
      const workerPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "core",
        "worker.js",
      );

      let parsedCount = 0;
      const workers = Array.from({ length: numWorkers }, () => new Worker(workerPath));
      const queue = [...files];

      await Promise.all(
        workers.map(async (worker) => {
          while (queue.length > 0) {
            const file = queue.shift();
            if (!file) break;

            await new Promise<void>((resolve) => {
              const onMessage = (msg: WorkerMessage) => {
                if (msg.error) {
                  console.error(chalk.yellow(`\n\u26A0\u3000Worker error for ${file}: ${msg.error}`));
                } else {
                  msg.nodes?.forEach((n) => {
                    if (!graph.hasNode(n.id)) {
                      graph.addNode(n.id, n.attr);
                    } else if (n.attr.type !== "file") {
                      // Update attributes if it's not a file (it might have been a ghost node)
                      graph.mergeNodeAttributes(n.id, n.attr);
                    }
                  });
                  msg.edges?.forEach((e) => {
                    if (!graph.hasEdge(e.source, e.target)) {
                      graph.addEdge(e.source, e.target, e.attr);
                    }
                  });
                }
                parsedCount++;
                spinner.text = chalk.gray(
                  `Parsing AST: ${parsedCount}/${files.length} files...`,
                );
                worker.off("message", onMessage);
                worker.off("error", onError);
                resolve();
              };

              const onError = (err: Error) => {
                console.error(chalk.red(`Worker error on ${file}: ${err.message}`));
                parsedCount++;
                worker.off("message", onMessage);
                worker.off("error", onError);
                resolve();
              };

              worker.on("message", onMessage);
              worker.on("error", onError);
              worker.postMessage({ filePath: file });
            });
          }
          // Terminate worker when its part of the queue is empty
          await worker.terminate();
        }),
      );

      // Phase 4.5: Call Graph Resolution
      // Merges unresolved_fn ghost nodes into real defined functions,
      // eliminating duplicates caused by cross-file call references.
      spinner.text = chalk.gray("Resolving call graph...");
      resolveCallGraph(graph);

      // Phase 5: Temporal Fact Management (Git History)
      spinner.text = chalk.gray(
        "Extracting Temporal Facts from Git history...",
      );
      await enrichWithGit(graph, targetDir);

      // Phase 6: Graph Analysis
      spinner.text = chalk.gray("Analyzing graph structure...");
      const analysis = analyzeGraph(graph);

      // Phase 7: Caveman Mode & Serialization
      spinner.text = chalk.gray("Compressing graph into Caveman Mode...");
      const outDir = path.join(targetDir, ".graphine");
      exportGraphJson(graph, outDir, analysis);
      exportReportMarkdown(graph, outDir, analysis);
      exportGraphHtml(graph, outDir);

      const endTime = performance.now();
      const durationSeconds = ((endTime - startTime) / 1000).toFixed(1);

      spinner.succeed(
        chalk.green(
          `Successfully scanned and parsed ${files.length} target files.`,
        ),
      );

      console.log();
      console.log(chalk.bold("Graph Stats:"));
      console.log(chalk.dim(`  - Nodes: ${graph.order}`));
      console.log(chalk.dim(`  - Edges: ${graph.size}`));
      console.log(chalk.dim(`  - Communities: ${analysis.communities.length}`));
      console.log(chalk.dim(`  - Time:  ${durationSeconds}s`));

      if (analysis.godNodes.length > 0) {
        console.log();
        console.log(chalk.bold("God Nodes (architectural pillars):"));
        for (const god of analysis.godNodes.slice(0, 5)) {
          console.log(chalk.yellow(`  ★ ${god.name} (${god.type}, ${god.degree} connections)`));
        }
      }

      if (analysis.surprisingConnections.length > 0) {
        console.log();
        console.log(chalk.bold("Surprising Connections:"));
        for (const s of analysis.surprisingConnections.slice(0, 3)) {
          console.log(chalk.magenta(`  ⚡ ${s.sourceName} ↔ ${s.targetName}: ${s.why}`));
        }
      }

      console.log(); // Blank line for padding
    } catch (error) {
      spinner.fail(chalk.red("Failed to scan directory."));
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });

program
  .command("install")
  .description("Install Graphine context rules for AI agents (Cursor, Claude, etc.)")
  .option("-p, --platform <platform>", "Target platform (claude, cursor, vscode, agents, copilot, antigravity)", "claude")
  .option("-f, --force", "Force overwrite existing rules", false)
  .action(async (options) => {
    const targetDir = process.cwd();

    const spinner = ora({
      text: chalk.gray(`Installing Graphine rules for ${options.platform}...`),
      color: "blue",
      spinner: "dots",
    }).start();

    try {
      const results = await installGraphine(targetDir, options);
      spinner.succeed(chalk.green("Successfully installed Graphine intelligence bridge."));
      console.log();
      results.forEach(r => console.log(chalk.dim(`  - ${r}`)));
      console.log();
      console.log(chalk.cyan("Next Step: Run 'graphine scan' to populate the knowledge base."));
    } catch (error) {
      spinner.fail(chalk.red("Failed to install rules."));
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });

program
  .command("query <symbol>")
  .description("Query the knowledge graph for a specific symbol's relationships")
  .option("-i, --incoming", "Show incoming edges (who uses this?)", true)
  .option("-o, --outgoing", "Show outgoing edges (what does this use?)", true)
  .option("-d, --depth <number>", "Traversal depth", "1")
  .action(async (symbol, options) => {
    const spinner = ora({
      text: chalk.gray(`Querying relationships for: ${symbol}...`),
      color: "blue",
      spinner: "dots",
    }).start();
    try {
      const { queryGraph } = await import("./core/query.js");
      const result = await queryGraph(process.cwd(), symbol, {
        incoming: !!options.incoming,
        outgoing: !!options.outgoing,
        depth: parseInt(options.depth),
      });
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
      console.log();
    } catch (error) {
      spinner.fail(chalk.red(`Query failed: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

program
  .command("uninstall")
  .description("Remove Graphine context rules from the project")
  .option("-g, --global", "Also remove global skills for all supported platforms", false)
  .action(async (options) => {
    const targetDir = process.cwd();
    const spinner = ora({
      text: chalk.gray("Removing Graphine intelligence bridge..."),
      color: "red",
      spinner: "dots",
    }).start();

    try {
      const results = await uninstallGraphine(targetDir, { global: !!options.global });
      if (results.length === 0) {
        spinner.info(chalk.yellow("No Graphine rules found to remove."));
      } else {
        spinner.succeed(chalk.green("Successfully removed Graphine intelligence bridge."));
        console.log();
        results.forEach(r => console.log(chalk.dim(`  - ${r}`)));
      }
      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Failed to remove rules."));
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });
