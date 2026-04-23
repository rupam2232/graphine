#!/usr/bin/env node
import fs from 'fs';

const currentFolder = process.cwd();
console.log("Scanning files in:", currentFolder);

const files = fs.readdirSync(currentFolder);
console.log("Found files:", files);