import Parser, { Query } from "tree-sitter";
import tsLanguage from "tree-sitter-typescript";
import jsLanguage from "tree-sitter-javascript";
import fs from "fs";
import path from "path";
import { builtinModules } from "module";
import type { MultiDirectedGraph } from "graphology";
import { NodeData, EdgeData, NodeType } from "../core/graph.js";

const NODE_CORE_MODULES = new Set(builtinModules);

const BUILT_INS = new Set([
  "map", "filter", "reduce", "reduceRight", "forEach", "flat", "flatMap", "find", "findIndex", "findLast", "some", "every", "sort", "reverse", "includes", "indexOf", "lastIndexOf", "push", "pop", "shift", "unshift", "splice", "slice", "fill", "copyWithin", "at",
  "hasOwnProperty", "toString", "valueOf", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString",
  "assign", "create", "freeze", "seal", "keys", "values", "entries", "getOwnPropertyNames", "getOwnPropertyDescriptor", "getPrototypeOf", "defineProperty",
  "has", "get", "set", "add", "delete", "clear",
  "split", "replace", "replaceAll", "match", "matchAll", "search", "substring", "substr", "trim", "trimStart", "trimEnd", "charAt", "charCodeAt", "codePointAt", "concat", "repeat", "normalize", "startsWith", "endsWith", "padStart", "padEnd", "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase",
  "join", "getDate", "getDay", "getFullYear", "getHours", "getMilliseconds", "getMinutes", "getMonth", "getSeconds", "getTime", "getTimezoneOffset", "getUTCDate", "getUTCDay", "getUTCFullYear", "getUTCHours", "getUTCMilliseconds", "getUTCMinutes", "getUTCMonth", "getUTCSeconds", "setDate", "setFullYear", "setHours", "setMilliseconds", "setMinutes", "setMonth", "setSeconds", "setTime", "setUTCDate", "setUTCFullYear", "setUTCHours", "setUTCMilliseconds", "setUTCMinutes", "setUTCMonth", "setUTCSeconds", "toISOString", "toJSON", "toDateString", "toTimeString", "toUTCString", "toLocaleDateString", "toLocaleTimeString",
  "then", "catch", "finally", "from", "of", "fromEntries", "fromCharCode", "fromCodePoint", "parseInt", "parseFloat", "isNaN", "isFinite", "isInteger", "isSafeInteger", "toFixed", "toPrecision", "toExponential", "call", "apply", "bind", "next", "cwd", "exit", "chdir", "memoryUsage", "hrtime", "nextTick", "uptime", "cpuUsage", "resourceUsage", "send", "abort", "on", "off", "emit", "once", "removeListener", "removeAllListeners", "addListener", "listeners", "listenerCount", "eventNames", "prependListener", "construct", "ownKeys", "for", "keyFor", "format", "formatToParts", "resolvedOptions", "supportedLocalesOf",
  "Partial", "Required", "Readonly", "Record", "Pick", "Omit", "Exclude", "Extract", "NonNullable", "Parameters", "ConstructorParameters", "ReturnType", "InstanceType", "ThisParameterType", "OmitThisParameter", "ThisType", "Awaited", "String", "Number", "Boolean", "Symbol", "Object", "Array", "Promise", "Date", "Error", "RegExp",
  "JSON", "Math", "console", "process", "Buffer",
  "postMessage", "terminate", "info", "warn", "error", "debug", "succeed", "fail", "start", "stop", "command", "option", "action", "description", "parse", "version"
]);

function resolveImportToNode(importPath: string, sourceFilePath: string): string | null {
  if (!importPath.startsWith(".")) return null;
  const sourceDir = path.dirname(sourceFilePath);
  const normalizedImport = importPath.replace(/\.js$/, "");
  const resolvedBase = path.resolve(sourceDir, normalizedImport);
  
  const candidates: string[] = [
    resolvedBase + ".ts",
    resolvedBase + ".tsx",
    resolvedBase + "/index.ts",
    resolvedBase + "/index.tsx",
    resolvedBase + ".js",
    resolvedBase + ".jsx",
    resolvedBase + "/index.js",
    resolvedBase + "/index.jsx",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function parseTypeScript(
  filePath: string,
  graph: MultiDirectedGraph<NodeData, EdgeData>,
) {
  const isTs = filePath.endsWith(".ts") || filePath.endsWith(".tsx");
  const isTsx = filePath.endsWith(".tsx");
  const basename = path.basename(filePath);

  let language;
  if (isTs) {
    const tsObj = tsLanguage;
    language = isTsx ? (tsObj.tsx || tsObj) : (tsObj.typescript || tsObj);
  } else {
    language = jsLanguage;
  }

  const parser = new Parser();
  try {
    parser.setLanguage(language);
  } catch {
    return;
  }

  let sourceCode: string;
  try {
    sourceCode = fs.readFileSync(filePath, "utf8").replace(/\0/g, "");
  } catch {
    return;
  }

  const tree = parser.parse((index: number) => {
    if (index >= sourceCode.length) return null;
    return sourceCode.substring(index, index + 10240);
  });

  const importMap = new Map<string, string>();
  const localDefinitions = new Set<string>(); 

  const baseQueryString = `
    (import_statement (import_clause (identifier) @default_import) source: (string) @import_source)
    (import_statement (import_clause (named_imports (import_specifier name: (identifier) @named_import))) source: (string) @import_source)
    (import_statement source: (string) @import_source)
    
    (call_expression
      function: (identifier) @req_fn
      arguments: (arguments (string) @require_source)
      (#eq? @req_fn "require")
    )
    
    ${isTs ? "[(class_declaration) (abstract_class_declaration)] @class_decl" : "(class_declaration) @class_decl"}
    
    ${isTs ? `
    (interface_declaration name: (type_identifier) @interface_name)
    (type_alias_declaration name: (type_identifier) @type_name)
    (enum_declaration name: (identifier) @enum_name)
    
    (type_identifier) @type_reference
    ` : ""}
    
    [
      (function_declaration name: (_) @func_name)
      (method_definition name: (_) @method_name)
      (variable_declarator 
        name: (identifier) @var_func_name 
        value: [(arrow_function) (function_expression)]
      )
    ]

    (call_expression function: (identifier) @call_name)
    (call_expression
      function: (member_expression
        object: (_) @call_method_object
        property: (property_identifier) @call_method_name
      )
    )
    (new_expression constructor: (_) @constructor_name)
  `;

  const query = new Query(language, baseQueryString);
  const matches = query.matches(tree.rootNode);

  const getEnclosingScope = (node: Parser.SyntaxNode): { name: string; type: NodeType } | null => {
    let current = node.parent;
    while (current) {
      if (current.type === "function_declaration" || current.type === "method_definition") {
        const nameNode = current.childForFieldName("name");
        if (nameNode) return { name: nameNode.text, type: "function" };
      } else if (current.type === "variable_declarator") {
        const valueNode = current.childForFieldName("value");
        if (valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
          const nameNode = current.childForFieldName("name");
          if (nameNode) return { name: nameNode.text, type: "function" };
        }
      } else if (current.type === "class_declaration" || current.type === "abstract_class_declaration") {
          const nameNode = current.childForFieldName("name");
          if (nameNode) return { name: nameNode.text, type: "class" };
      } else if (current.type === "interface_declaration") {
          const nameNode = current.childForFieldName("name");
          if (nameNode) return { name: nameNode.text, type: "interface" };
      } else if (current.type === "type_alias_declaration") {
          const nameNode = current.childForFieldName("name");
          if (nameNode) return { name: nameNode.text, type: "type" };
      }
      current = current.parent;
    }
    return null;
  };

  const ensureScopeNode = (node: Parser.SyntaxNode): string => {
    const scope = getEnclosingScope(node);
    const id = scope ? `${filePath}::${scope.name}` : `${filePath}::top-level`;
    
    if (!graph.hasNode(id)) {
      graph.addNode(id, {
        type: scope ? scope.type : "function",
        name: scope ? scope.name : `[script] ${basename}`,
        file: filePath,
        startLine: node.startPosition.row + 1,
        metadata: { endLine: node.endPosition.row + 1 }
      });
      graph.addEdge(filePath, id, { type: "defines", confidence: "EXTRACTED" });
    }
    return id;
  };

  // 1. First pass: Collect imports AND local definitions
  for (const match of matches) {
    let currentSource = "";
    for (const capture of match.captures) {
      if (capture.name === "import_source") {
        currentSource = capture.node.text.replace(/['"]/g, "");
      }
    }
    if (currentSource) {
      for (const capture of match.captures) {
        if (capture.name === "default_import" || capture.name === "named_import") {
          importMap.set(capture.node.text, currentSource);
        }
      }
    }
    for (const capture of match.captures) {
        if (["func_name", "method_name", "var_func_name", "class_decl", "interface_name", "type_name", "enum_name"].includes(capture.name)) {
            localDefinitions.add(capture.node.text);
        }
    }
  }

  const getRootIdentifier = (node: Parser.SyntaxNode | null): string => {
    if (!node) return "";
    if (node.type === "identifier") return node.text.trim();
    if (node.type === "member_expression") {
        return getRootIdentifier(node.childForFieldName("object"));
    }
    if (node.type === "call_expression") {
        return getRootIdentifier(node.childForFieldName("function"));
    }
    return "";
  };

  // 2. Second pass: Build graph nodes and edges
  for (const match of matches) {
    for (const capture of match.captures) {
      const name = capture.name;
      const node = capture.node;

      if (name === "import_source" || name === "require_source") {
        const importPath = node.text.replace(/['"]/g, "");
        const importLine = node.startPosition.row + 1;
        const normalizedPath = importPath.replace(/^node:/, "");
        const rootModule = normalizedPath.split("/")[0] as string;

        if (!importPath.startsWith(".") && !importPath.startsWith("/") && (NODE_CORE_MODULES.has(normalizedPath) || NODE_CORE_MODULES.has(rootModule))) continue;

        const resolvedId = resolveImportToNode(importPath, filePath);
        const targetNodeId = resolvedId || `import::${importPath}`;

        if (!graph.hasNode(targetNodeId)) {
          graph.addNode(targetNodeId, {
            type: "file",
            name: resolvedId ? path.basename(resolvedId) : importPath,
            file: resolvedId || filePath,
            startLine: resolvedId ? 0 : importLine,
            metadata: resolvedId ? {} : { external: true, callerFile: filePath, callerLine: importLine }
          });
        }
        graph.addEdge(filePath, targetNodeId, { type: "imports", confidence: "EXTRACTED" });

      } else if (["class_decl", "interface_name", "type_name", "enum_name", "func_name", "method_name", "var_func_name"].includes(name)) {
        const symName = node.text.trim();
        const symId = `${filePath}::${symName}`;
        const typeMap: Record<string, NodeType> = {
            class_decl: "class", interface_name: "interface", type_name: "type", enum_name: "enum",
            func_name: "function", method_name: "function", var_func_name: "function"
        };

        if (!graph.hasNode(symId)) {
          graph.addNode(symId, {
            type: typeMap[name] || "function",
            name: symName,
            file: filePath,
            startLine: node.startPosition.row + 1,
            metadata: { endLine: (node.parent?.endPosition?.row ?? node.startPosition.row) + 1 }
          });
          graph.addEdge(filePath, symId, { type: "defines", confidence: "EXTRACTED" });
        }

      } else if (name === "type_reference") {
        const referencedTypeName = node.text.trim();
        
        let moduleName = "";
        if (node.parent?.type === "nested_type_identifier") {
            const moduleNode = node.parent.childForFieldName("module");
            if (moduleNode) {
                moduleName = moduleNode.text.trim();
            }
        }
        
        if (BUILT_INS.has(referencedTypeName) && !localDefinitions.has(referencedTypeName) && !importMap.has(referencedTypeName) && !moduleName) continue;
        
        // Skip identifiers that ARE the name of a definition
        if (["interface_declaration", "type_alias_declaration", "import_specifier", "class_declaration", "function_declaration", "variable_declarator"].includes(node.parent?.type || "")) continue;

        const callerId = ensureScopeNode(node);
        const importSource = importMap.get(moduleName || referencedTypeName);
        
        const isCoreModule = importSource && (NODE_CORE_MODULES.has(importSource) || NODE_CORE_MODULES.has(importSource.replace(/^node:/, "")));
        if (isCoreModule) continue;

        let targetId: string;
        if (localDefinitions.has(referencedTypeName)) {
            targetId = `${filePath}::${referencedTypeName}`;
        } else if (importSource) {
            const resolvedSource = resolveImportToNode(importSource, filePath) || importSource;
            targetId = `${resolvedSource}::${referencedTypeName}`;
        } else {
            targetId = `unresolved::${referencedTypeName}`;
        }

        const isUnresolved = !importSource && !localDefinitions.has(referencedTypeName);

        if (!graph.hasNode(targetId)) {
          graph.addNode(targetId, {
            type: "interface",
            name: referencedTypeName,
            file: (importSource && resolveImportToNode(importSource, filePath)) || importSource || filePath,
            startLine: 0,
            metadata: { 
                external: !!importSource, 
                unresolved: isUnresolved, 
                endLine: 0,
                callerFile: isUnresolved ? filePath : undefined,
                callerLine: isUnresolved ? node.startPosition.row + 1 : undefined,
                doc: isUnresolved ? "Called/Instantiated but not defined in any scanned file. Likely from an external package or a dynamic import." : undefined
            }
          });
        }
        if (!graph.hasEdge(callerId, targetId)) {
          graph.addEdge(callerId, targetId, { type: "references", confidence: "EXTRACTED" });
        }

        if (importSource) {
            const resolvedSource = resolveImportToNode(importSource, filePath) || importSource;
            const importNodeId = resolveImportToNode(importSource, filePath) || `import::${importSource}`;
            if (!graph.hasNode(importNodeId)) {
                graph.addNode(importNodeId, { type: "file", name: importSource, file: resolvedSource, startLine: 0, metadata: { external: true } });
            }
            if (!graph.hasEdge(importNodeId, targetId)) {
                graph.addEdge(importNodeId, targetId, { type: "defines", confidence: "EXTRACTED" });
            }
        }

      } else if (name === "call_name" || name === "constructor_name" || name === "call_method_name") {
        const methodName = node.text.trim();
        let calledName = methodName;
        let objectName = "";

        if (name === "call_method_name" && node.parent?.type === "member_expression") {
            const objectNode = node.parent.childForFieldName("object");
            if (objectNode) {
                objectName = getRootIdentifier(objectNode);
                if (objectName) {
                    calledName = `${objectName}.${calledName}`;
                }
            }
        }

        if (name === "call_method_name") {
            if (BUILT_INS.has(methodName) && !localDefinitions.has(methodName) && !importMap.has(methodName)) {
                continue;
            }
        }

        const baseName = objectName || calledName;
        if (BUILT_INS.has(baseName) && !localDefinitions.has(baseName) && !importMap.has(baseName)) continue;

        const callerId = ensureScopeNode(node);
        const importSource = importMap.get(baseName);
        
        const isCoreModule = importSource && (NODE_CORE_MODULES.has(importSource) || NODE_CORE_MODULES.has(importSource.replace(/^node:/, "")));
        if (isCoreModule) continue;

        let symId: string;
        if (localDefinitions.has(baseName)) {
            symId = `${filePath}::${calledName}`;
        } else if (importSource) {
            const resolvedSource = resolveImportToNode(importSource, filePath) || importSource;
            symId = `${resolvedSource}::${calledName}`;
        } else {
            symId = `unresolved::${calledName}`;
        }

        const isUnresolved = !importSource && !localDefinitions.has(baseName);

        if (!graph.hasNode(symId)) {
          const callLine = node.startPosition.row + 1;
          const resolvedSource = (importSource && resolveImportToNode(importSource, filePath)) || importSource;
          graph.addNode(symId, {
            type: (name === "constructor_name" ? "class" : "function"),
            name: calledName,
            file: resolvedSource || filePath,
            startLine: importSource ? 0 : callLine,
            metadata: { 
                external: !!importSource, 
                unresolved: isUnresolved, 
                endLine: importSource ? 0 : callLine,
                callerFile: isUnresolved ? filePath : undefined,
                callerLine: isUnresolved ? callLine : undefined,
                doc: isUnresolved ? "Called/Instantiated but not defined in any scanned file. Likely from an external package or a dynamic import." : undefined
            }
          });
        }

        if (!graph.hasEdge(callerId, symId)) {
          graph.addEdge(callerId, symId, { type: "calls", confidence: "AMBIGUOUS" });
        }

        if (importSource) {
          const resolvedSource = resolveImportToNode(importSource, filePath) || importSource;
          const importNodeId = resolveImportToNode(importSource, filePath) || `import::${importSource}`;
          if (!graph.hasNode(importNodeId)) {
            graph.addNode(importNodeId, {
              type: "file",
              name: importSource,
              file: resolvedSource,
              startLine: 0,
              metadata: { external: true }
            });
          }
          if (!graph.hasEdge(importNodeId, symId)) {
            graph.addEdge(importNodeId, symId, { type: "defines", confidence: "EXTRACTED" });
          }
        }
      }
    }
  }
}
