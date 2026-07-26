#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(agentRoot, 'src');
const forbiddenPattern = /\bFEX\b|fex/;

const allowedRuntimeRelativePrefixes = [
  'src/main/testing/'
];

function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (/\.(ts|tsx|js|jsx|cjs|mjs|json|md)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function isAllowed(relativePath) {
  return allowedRuntimeRelativePrefixes.some((prefix) => relativePath.startsWith(prefix));
}

const violations = [];
for (const filePath of walk(srcRoot)) {
  const relativePath = toPosix(path.relative(agentRoot, filePath));
  if (isAllowed(relativePath)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  if (forbiddenPattern.test(content)) {
    violations.push(relativePath);
  }
}

if (violations.length > 0) {
  console.error('[smoke:reference:benchmark-scope] FEX benchmark fixture leaked into runtime source:');
  for (const item of violations) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log('[smoke:reference:benchmark-scope] OK');
