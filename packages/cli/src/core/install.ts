import fs from "fs";
import path from "path";
import os from "os";

const START_MARKER = "<!-- GRAPHINE_START -->";
const END_MARKER = "<!-- GRAPHINE_END -->";

const RULE_CONTENT = `
## graphine
This project uses graphine for architectural intelligence.
- Read \`.graphine/GRAPH_REPORT.md\` first for god nodes and community structure.
- Use \`npx graphine query '<symbol>'\` for dependency tracing instead of grepping raw files.
- Query commits (e.g. \`npx graphine query '<short_hash>'\`) to understand change intent.
- Use IDs returned by query results for subsequent surgical lookups.
- Run \`npx graphine scan\` after structural modifications.
`;

interface PlatformConfig {
  name: string;
  file: string;
  isShared: boolean;
  content: string;
  globalPath?: string;
}

const PLATFORMS: Record<string, PlatformConfig> = {
  claude: {
    name: "Claude Code",
    file: ".claude/graphine.md",
    isShared: false,
    content: RULE_CONTENT,
    globalPath: path.join(os.homedir(), ".claude", "skills", "graphine", "SKILL.md"),
  },
  cursor: {
    name: "Cursor",
    file: ".cursorrules",
    isShared: true,
    content: RULE_CONTENT,
  },
  antigravity: {
    name: "Antigravity",
    file: "AGENTS.md",
    isShared: true,
    content: RULE_CONTENT,
    globalPath: path.join(os.homedir(), ".agent", "skills", "graphine", "SKILL.md"),
  },
  vscode: {
    name: "VS Code / Copilot",
    file: ".github/copilot-instructions.md",
    isShared: true,
    content: RULE_CONTENT,
    globalPath: path.join(os.homedir(), ".copilot", "skills", "graphine", "SKILL.md"),
  },
  copilot: {
    name: "GitHub Copilot",
    file: ".github/copilot-instructions.md",
    isShared: true,
    content: RULE_CONTENT,
    globalPath: path.join(os.homedir(), ".copilot", "skills", "graphine", "SKILL.md"),
  },
};

export interface InstallOptions {
  platform: string;
  force?: boolean;
}

export async function installGraphine(
  targetDir: string,
  options: InstallOptions,
): Promise<string[]> {
  const results: string[] = [];
  const platform = PLATFORMS[options.platform];

  if (!platform) {
    throw new Error(`Unsupported platform: ${options.platform}`);
  }

  // 1. Ensure .graphine directory exists
  const graphineDir = path.join(targetDir, ".graphine");
  if (!fs.existsSync(graphineDir)) {
    fs.mkdirSync(graphineDir, { recursive: true });
  }

  // Load the template content (we use our own internal template for all skills)
  const currentFilePath = new URL(import.meta.url).pathname;
  const normalizedPath = process.platform === "win32" ? currentFilePath.substring(1) : currentFilePath;
  const templatePath = path.resolve(path.dirname(normalizedPath), "..", "templates", "skill.md");
  
  let skillContent = platform.content;
  if (fs.existsSync(templatePath)) {
      skillContent = fs.readFileSync(templatePath, "utf-8");
  }

  // 2. Handle Global Installation (The Slash Command)
  if (platform.globalPath) {
    const globalDir = path.dirname(platform.globalPath);
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }
    fs.writeFileSync(platform.globalPath, skillContent);
    results.push(`Global skill installed to ${platform.globalPath}`);
  }

  // 3. Handle Local Installation (The Project Rule)
  const fullPath = path.join(targetDir, platform.file);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const injection = `\n${START_MARKER}\n${skillContent.trim()}\n${END_MARKER}\n`;

  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, "utf-8");
    const startIndex = content.indexOf(START_MARKER);
    const endIndex = content.indexOf(END_MARKER);

    if (startIndex !== -1 && endIndex !== -1) {
      content =
        content.substring(0, startIndex) +
        injection.trim() +
        content.substring(endIndex + END_MARKER.length);
      fs.writeFileSync(fullPath, content);
      results.push(`${platform.file} updated (existing section replaced)`);
    } else {
      fs.writeFileSync(fullPath, content.trim() + "\n" + injection);
      results.push(`${platform.file} updated (section appended)`);
    }
  } else {
    fs.writeFileSync(fullPath, injection);
    results.push(`${platform.file} created`);
  }

  return results;
}

export async function uninstallGraphine(targetDir: string, options: { global?: boolean } = {}): Promise<string[]> {
  const results: string[] = [];

  for (const platform of Object.values(PLATFORMS)) {
    // Clean local files
    const fullPath = path.join(targetDir, platform.file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      const startIndex = content.indexOf(START_MARKER);
      const endIndex = content.indexOf(END_MARKER);

      if (startIndex !== -1 && endIndex !== -1) {
        const before = content.substring(0, startIndex).trim();
        const after = content.substring(endIndex + END_MARKER.length).trim();
        const cleaned = (before + "\n\n" + after).trim();

        if (cleaned === "") {
          fs.unlinkSync(fullPath);
          results.push(`${platform.file} deleted (empty after cleanup)`);
        } else {
          fs.writeFileSync(fullPath, cleaned + "\n");
          results.push(`${platform.file} cleaned (graphine section removed)`);
        }
      }
    }

    // Clean global files if requested
    if (options.global && platform.globalPath && fs.existsSync(platform.globalPath)) {
        fs.unlinkSync(platform.globalPath);
        results.push(`Global skill removed from ${platform.globalPath}`);
        
        // Cleanup empty parent directories
        let currentDir = path.dirname(platform.globalPath);
        while (currentDir !== os.homedir()) {
            try {
                if (fs.readdirSync(currentDir).length === 0) {
                    fs.rmdirSync(currentDir);
                    currentDir = path.dirname(currentDir);
                } else {
                    break;
                }
            } catch {
                break;
            }
        }
    }
  }

  return results;
}
