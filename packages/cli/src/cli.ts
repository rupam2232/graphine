import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "path";
import { scanDirectory } from "./core/scanner.js";
import { createKnowledgeGraph } from "./core/graph.js";
import { parseFile } from "./parsers/index.js";

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
      spinner.text = chalk.gray("Parsing AST for codebase relationships...");
      for (const file of files) {
        parseFile(file, graph);
      }

      spinner.succeed(
        chalk.green(
          `Successfully scanned and parsed ${chalk.bold(files.length)} target files.`,
        ),
      );

      console.log(chalk.gray(`\nGraph Stats:`));
      console.log(chalk.dim(`  - Nodes: ${graph.order}`));
      console.log(chalk.dim(`  - Edges: ${graph.size}`));

      console.log(); // Blank line for padding
    } catch (error) {
      if (error instanceof Error) {
        spinner.fail(chalk.red("Failed to scan directory."));
        console.error(error.message);
      } else {
        spinner.fail(chalk.red("Failed to scan directory."));
        console.error(error);
      }
    }
  });
