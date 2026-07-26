#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const REQUIRED_FILES = [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.github/workflows/ci.yml',
  '.github/dependabot.yml'
];
const TEXT_EXTENSIONS = new Set([
  '.bat', '.cjs', '.cmd', '.css', '.html', '.js', '.json', '.jsx', '.md',
  '.mjs', '.ps1', '.py', '.scss', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml'
]);

const FORBIDDEN_PATH_PATTERNS = [
  { label: 'environment file', pattern: /(^|\/)\.env(?:\.|$)/i, allow: /\.env\.example$/i },
  { label: 'private key or certificate', pattern: /\.(?:key|p12|pem|pfx)$/i },
  { label: 'private design source', pattern: /\.(?:onnx(?:_data)?|psb|psd|tif|tiff)$/i },
  { label: 'dependency or build output', pattern: /(^|\/)(?:node_modules|dist|release|tmp)(\/|$)/i },
  { label: 'trash directory', pattern: /(^|\/)\.trash(\/|$)/i },
  { label: 'personal Eagle dump', pattern: /(^|\/)eagle-(?:folders|fonts|items-sample|psd)\.json$/i }
];

const SECRET_PATTERNS = [
  { label: 'AWS access key', pattern: /(^|[^A-Z0-9])AKIA[A-Z0-9]{16}([^A-Z0-9]|$)/ },
  { label: 'OpenAI-style token', pattern: /(^|[^A-Za-z0-9])sk-(?!ant-)[A-Za-z0-9_-]{20,}/ },
  { label: 'Anthropic token', pattern: /(^|[^A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: 'GitHub token', pattern: /(^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: 'Slack token', pattern: /(^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]+/ },
  { label: 'Google API key', pattern: /(^|[^A-Za-z0-9])AIza[A-Za-z0-9_-]{35}([^A-Za-z0-9_-]|$)/ },
  { label: 'private key block', pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/ }
];

const PRIVATE_CONTENT_PATTERNS = [
  { label: 'Windows user profile path', pattern: /C:\\Users\\(?!<USER>|%USERNAME%)[^\\\s"'`]+/i },
  { label: 'private workspace path', pattern: /C:[\\/]UXP[\\/]2\.0/i },
  { label: 'private project root', pattern: /[A-Za-z]:[\\/]WERKE[\\/]/i },
  { label: 'private brand marker', pattern: /neveralone/i }
];

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return output.split('\0').filter(Boolean);
}

function normalize(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function inspectRepository() {
  const issues = [];
  const files = trackedFiles();

  for (const requiredFile of REQUIRED_FILES) {
    if (!files.includes(requiredFile)) {
      issues.push(`missing required public file: ${requiredFile}`);
    }
  }

  for (const relativePath of files) {
    const normalizedPath = normalize(relativePath);
    const absolutePath = path.join(ROOT, relativePath);
    const stats = fs.statSync(absolutePath);

    if (stats.size > MAX_FILE_BYTES) {
      issues.push(`file exceeds 50 MiB: ${normalizedPath}`);
    }

    for (const rule of FORBIDDEN_PATH_PATTERNS) {
      if (rule.pattern.test(normalizedPath) && !(rule.allow && rule.allow.test(normalizedPath))) {
        issues.push(`${rule.label}: ${normalizedPath}`);
      }
    }

    if (
      normalizedPath === 'scripts/check-public-repo-safety.cjs'
      || !TEXT_EXTENSIONS.has(path.extname(normalizedPath).toLowerCase())
      || stats.size > 5 * 1024 * 1024
    ) {
      continue;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    for (const rule of SECRET_PATTERNS) {
      if (rule.pattern.test(content)) {
        issues.push(`${rule.label}: ${normalizedPath}`);
      }
    }
    for (const rule of PRIVATE_CONTENT_PATTERNS) {
      if (rule.pattern.test(content)) {
        issues.push(`${rule.label}: ${normalizedPath}`);
      }
    }
  }

  return {
    fileCount: files.length,
    issues: [...new Set(issues)].sort()
  };
}

const result = inspectRepository();
if (result.issues.length > 0) {
  console.error(JSON.stringify({
    success: false,
    fileCount: result.fileCount,
    issues: result.issues
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  success: true,
  fileCount: result.fileCount,
  checks: [
    'required public files',
    'forbidden tracked paths',
    '50 MiB file ceiling',
    'high-confidence secret patterns',
    'private machine and brand markers'
  ]
}, null, 2));
