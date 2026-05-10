import fs from "fs";

fs.mkdirSync("dist/templates", { recursive: true });
fs.copyFileSync("src/templates/skill.md", "dist/templates/skill.md");
