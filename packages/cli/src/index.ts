#!/usr/bin/env node
import { program } from "./cli.js";

// Parse terminal arguments and execute the corresponding command
program.parse(process.argv);
