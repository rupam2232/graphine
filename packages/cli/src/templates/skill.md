---
name: graphine
description: "Architectural Knowledge Engine. Trigger: /graphine <symbol or ID>"
trigger: /graphine
---

# Graphine Operational Manual

You are an architectural specialist. Use this tool to navigate the codebase Knowledge Graph. The `graphine` CLI provides dependency-aware, structural intelligence for all codebase operations. You must use `npx graphine query '<symbol>'` before making significant architectural changes, refactoring, or attempting to understand a complex execution flow.

## Core Concepts

Graphine parses the codebase and builds a highly accurate Knowledge Graph consisting of Files, Functions, Classes, Interfaces, and Scripts. 

### Node Naming and Identification
- **Symbol Names**: Nodes are named after their symbol (e.g., `saveCache`, `chalk.red`, `Command`, `GitCache`).
- **Unique IDs**: Every node has a strict unique identifier (e.g., `src/core/git.ts::saveCache`). 
- **The [script] Node**: Nodes named `[script] filename.ts` represent the top-level execution block of a file (code outside of any function or class). If you need to understand what a file does when executed, query its `[script]` node.

## Operational Protocol

1. **Mandatory Quoting**: Always wrap your query input in single quotes to prevent terminal expansion: `npx graphine query 'saveCache'`.
2. **Initial Search by Name**: When investigating a new component, query by its standard name (e.g., `npx graphine query 'cli.ts'`).
3. **Surgical Lookup by ID**: The initial query result will return the exact `id` of the target node and all connected nodes. **For all subsequent queries regarding those nodes, you MUST use their unique ID instead of their name.** This guarantees 100% precision and avoids naming collisions.
4. **No Assumptions**: If a query returns an empty result, the symbol does not exist in the indexed graph. Check your spelling or query a related file instead.

## Standard Use Cases

### 1. "What does this function do?"
When asked to explain a function or file:
- Run `npx graphine query '<function_name>'`.
- Analyze the `outgoing` connections to see what dependencies, types, and internal functions it relies on.
- Analyze the `incoming` connections to see where it is used across the codebase.
- Use the `file` and `line` metadata to read the exact implementation.

### 2. "Add this feature" or "Change this component"
Before writing code:
- Query the target component.
- Analyze `incoming` edges to identify all dependents. You must ensure your changes do not break these dependent modules.
- Look for `defines` edges from the file node to see what else lives in the same file.

## Types and Glossary

### Node Types
- `file`: A source code file (e.g., `git.ts` or `package.json`).
- `function`: A standard function or method (e.g., `saveCache` or `chalk.red`).
- `class`: A class definition (e.g., `Command`).
- `interface` / `type` / `enum`: TypeScript type definitions.
- `media`: Non-code asset files (e.g., `.png`, `.mp4`).
- `intent`: A Git commit containing historical context and explanations.

### Edge Types
- `imports`: File A imports File B.
- `calls`: Function A executes Function B.
- `defines`: A file contains a function, class, or type.
- `references`: A function or class uses a specific type or variable.
- `extends` / `implements`: Object-oriented inheritance.
- `explains`: A Git commit explains the existence or modification of a node.
- `superseded_by`: A node was replaced by another node (historical tracking).

### Confidence Levels
- `EXTRACTED`: Perfect confidence (100%). The relationship was definitively extracted via static analysis.
- `INFERRED`: High confidence. The relationship was deduced via strong heuristics.
- `AMBIGUOUS`: Moderate confidence. The relationship (e.g., dynamic method call) was mapped, but there may be overlapping names or dynamic imports involved. Verify manually if critical.
