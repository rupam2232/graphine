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
import { WorkerMessage } from "./core/types.js";
import {
  exportGraphJson,
  exportReportMarkdown,
  exportGraphHtml,
} from "./core/serializer.js";

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

      // Phase 6: Caveman Mode & Serialization
      spinner.text = chalk.gray("Compressing graph into Caveman Mode...");
      const outDir = path.join(targetDir, ".graphine");
      exportGraphJson(graph, outDir);
      exportReportMarkdown(graph, outDir);
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
      console.log(chalk.dim(`  - Time:  ${durationSeconds}s`));

      console.log(); // Blank line for padding
    } catch (error) {
      spinner.fail(chalk.red("Failed to scan directory."));
      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });
