import Parser, { Query } from "tree-sitter";
import tsLanguage from "tree-sitter-typescript";
import jsLanguage from "tree-sitter-javascript";
import fs from "fs";
import type { MultiDirectedGraph } from "graphology";
import type { NodeData, EdgeData } from "../core/graph.js";

export function parseTypeScript(
  filePath: string,
  graph: MultiDirectedGraph<NodeData, EdgeData>,
) {
  const isTs = filePath.endsWith(".ts") || filePath.endsWith(".tsx");
  const isTsx = filePath.endsWith(".tsx");

  const parser = new Parser();

  // Resolve language based on extension to support all types of codebases
  let language;
  if (isTs) {
    language = isTsx ? tsLanguage.tsx : tsLanguage.typescript;
  } else {
    language = jsLanguage;
  }

  parser.setLanguage(language);

  const sourceCode = fs.readFileSync(filePath, "utf8");
  const tree = parser.parse(sourceCode);

  // Advanced AST Query to capture Imports, Classes, Functions, and Call Expressions
  const baseQueryString = `
    (import_statement source: (string) @import_source)
    (call_expression
      function: (identifier) @req_fn
      arguments: (arguments (string) @require_source)
      (#eq? @req_fn "require")
    )
    (class_declaration name: (_) @class_name)
    (function_declaration name: (_) @func_name)
    (method_definition name: (_) @method_name)
    (call_expression function: (identifier) @call_name)
    (call_expression function: (member_expression property: (property_identifier) @call_method_name))
  `;

  // type_identifier only exists in TypeScript grammars, not JavaScript
  const queryString = baseQueryString;

  const query = new Query(language, queryString);
  const matches = query.matches(tree.rootNode);

  // Helper to find the function that wraps a specific node (for the call graph)
  const getEnclosingFunction = (node: Parser.SyntaxNode): string | null => {
    let current = node.parent;
    while (current) {
      if (
        current.type === "function_declaration" ||
        current.type === "method_definition"
      ) {
        const nameNode = current.childForFieldName("name");
        if (nameNode) return nameNode.text;
      } else if (current.type === "variable_declarator") {
        const valueNode = current.childForFieldName("value");
        if (
          valueNode &&
          (valueNode.type === "arrow_function" ||
            valueNode.type === "function_expression")
        ) {
          const nameNode = current.childForFieldName("name");
          if (nameNode) return nameNode.text;
        }
      }
      current = current.parent;
    }
    return null;
  };

  for (const match of matches) {
    for (const capture of match.captures) {
      const name = capture.name;
      const node = capture.node;

      if (name === "import_source" || name === "require_source") {
        const importPath = node.text.replace(/['"]/g, "");
        const targetNodeId = `import::${importPath}`;

        if (!graph.hasNode(targetNodeId)) {
          graph.addNode(targetNodeId, {
            type: "file",
            name: importPath,
            metadata: { external: true },
          });
        }
        graph.addEdge(filePath, targetNodeId, { type: "imports" });
      } else if (name === "class_name") {
        const classId = `${filePath}::class::${node.text}`;
        if (!graph.hasNode(classId)) {
          let doc = "";
          const parent = node.parent;
          if (parent?.previousSibling?.type === "comment") {
            doc = parent.previousSibling.text;
          }
          graph.addNode(classId, {
            type: "class",
            name: node.text,
            metadata: { doc },
          });
          graph.addEdge(filePath, classId, { type: "defines" });
        }
      } else if (
        name === "func_name" ||
        name === "method_name" ||
        name === "var_func_name"
      ) {
        const funcId = `${filePath}::function::${node.text}`;
        if (!graph.hasNode(funcId)) {
          let doc = "";
          const declNode =
            name === "var_func_name" ? node.parent?.parent : node.parent;
          if (declNode?.previousSibling?.type === "comment") {
            doc = declNode.previousSibling.text;
          }
          graph.addNode(funcId, {
            type: "function",
            name: node.text,
            metadata: { doc },
          });
          graph.addEdge(filePath, funcId, { type: "defines" });
        }
      } else if (name === "call_name" || name === "call_method_name") {
        const calledName = node.text;
        const callerName = getEnclosingFunction(node);
        const callerId = callerName
          ? `${filePath}::function::${callerName}`
          : filePath;

        const targetFuncId = `unresolved_fn::${calledName}`;
        if (!graph.hasNode(targetFuncId)) {
          graph.addNode(targetFuncId, {
            type: "function",
            name: calledName,
            metadata: { external: true },
          });
        }

        if (!graph.hasNode(callerId)) {
          // Fallback if caller function wasn't parsed (e.g. anonymous func)
          graph.addNode(callerId, {
            type: "function",
            name: callerName || "anonymous",
          });
          graph.addEdge(filePath, callerId, { type: "defines" });
        }

        // Only add edge if it doesn't already exist
        if (!graph.hasEdge(callerId, targetFuncId)) {
          graph.addEdge(callerId, targetFuncId, { type: "calls" });
        }
      }
    }
  }
}
