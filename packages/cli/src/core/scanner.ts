import fs from "fs";
import path from "path";
import fg from "fast-glob";
import ignorePkg, { Ignore } from "ignore";

// Workaround for ignore's CJS typings in NodeNext ESM resolution
const createIgnore = (
  typeof ignorePkg === "function"
    ? ignorePkg
    : (ignorePkg as unknown as { default: () => Ignore }).default
) as () => Ignore;

const SUPPORTED_EXTENSIONS = [
  // Code & Data
  'ts', 'js', 'tsx', 'jsx', 'json', 'md',
  // Images
  'png', 'jpg', 'jpeg', 'svg', 'gif', 'webp',
  // Video & Audio
  'mp4', 'webm', 'mp3', 'wav'
];

export async function scanDirectory(targetDir: string): Promise<string[]> {
  const ig: Ignore = createIgnore();

  // Load .gitignore if it exists
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, "utf8"));
  }

  // Load .graphineignore if it exists
  const graphineignorePath = path.join(targetDir, ".graphineignore");
  if (fs.existsSync(graphineignorePath)) {
    ig.add(fs.readFileSync(graphineignorePath, "utf8"));
  }

  // Always ignore node_modules and typical build directories
  ig.add(["node_modules", "dist", ".git", ".turbo", "build"]);

  // We need to look for files recursively
  const globPatterns = SUPPORTED_EXTENSIONS.map((ext) => `**/*.${ext}`);

  // Perform the glob search
  const allFiles = await fg(globPatterns, {
    cwd: targetDir,
    dot: true,
    absolute: false, // Return relative paths so `ignore` can filter them easily
  });

  // Filter out the files using the `ignore` instance
  const validRelativeFiles = ig.filter(allFiles);

  // Convert back to absolute paths
  return validRelativeFiles.map((file) => path.join(targetDir, file));
}
