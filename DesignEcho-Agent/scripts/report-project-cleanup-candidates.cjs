#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GENERATED_DIR_NAMES = new Set([
  '.cache',
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'tmp'
]);

const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const DOC_EXTENSIONS = new Set(['.md']);

const CODE_SCAN_ROOTS = [
  'DesignEcho-Agent/src',
  'DesignEcho-Agent/scripts',
  'DesignEcho-UXP/src',
  'DesignEcho-UXP/scripts'
];

const DOC_SCAN_ROOTS = [
  'DesignEcho-Agent/docs',
  'DesignEcho-Agent/project-memory',
  'docs'
];

const INDEX_NOISE_PREFIXES = [
  'DesignEcho-Agent/node_modules',
  'DesignEcho-Agent/dist',
  'DesignEcho-Agent/tmp',
  'DesignEcho-UXP/node_modules',
  'DesignEcho-UXP/dist'
];

const HIGH_RISK_DIRECTORIES = [
  {
    path: 'C-649',
    rule: 'Business asset/reference area. Do not delete or simplify as if it were generated output.'
  },
  {
    path: 'Adobe Photoshop scripts',
    rule: 'Manual Photoshop script archive. Keep until each script has an owner and replacement path.'
  },
  {
    path: '_archived_python_backend',
    rule: 'Archived backend boundary. Remove only after confirming no runtime or documentation references remain.'
  },
  {
    path: 'DesignEcho-Agent/project-memory',
    rule: 'Project operating memory. Keep structured and current; do not bulk rewrite Chinese text.'
  }
];

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function getRepoRoot() {
  return runGit(['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

function normalize(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function getArgValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function normalizeLimit(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 20;
  return Math.min(parsed, 100);
}

function countTracked(root, prefix) {
  const output = runGit(['ls-files', prefix], root);
  if (!output) return 0;
  return output.split(/\r?\n/).filter(Boolean).length;
}

function shouldSkipDirectory(entryName) {
  return GENERATED_DIR_NAMES.has(entryName);
}

function walkFiles(root, relativeRoots, extensions) {
  const files = [];

  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = path.join(root, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) continue;

    const stack = [absoluteRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!shouldSkipDirectory(entry.name)) {
            stack.push(path.join(current, entry.name));
          }
          continue;
        }

        if (!entry.isFile()) continue;
        const absolutePath = path.join(current, entry.name);
        if (!extensions.has(path.extname(entry.name))) continue;
        files.push(absolutePath);
      }
    }
  }

  return files;
}

function countLines(content) {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length;
}

function inspectTextFile(root, absolutePath) {
  const content = fs.readFileSync(absolutePath, 'utf8');
  const stat = fs.statSync(absolutePath);
  return {
    path: normalize(path.relative(root, absolutePath)),
    lines: countLines(content),
    bytes: stat.size
  };
}

function classifyCodeArea(filePath) {
  if (filePath.startsWith('DesignEcho-Agent/src/main/')) return 'agent-main';
  if (filePath.startsWith('DesignEcho-Agent/src/renderer/')) return 'agent-renderer';
  if (filePath.startsWith('DesignEcho-Agent/src/shared/')) return 'agent-shared';
  if (filePath.startsWith('DesignEcho-Agent/scripts/')) return 'agent-maintenance-script';
  if (filePath.startsWith('DesignEcho-UXP/src/')) return 'uxp-plugin';
  if (filePath.startsWith('DesignEcho-UXP/scripts/')) return 'uxp-maintenance-script';
  return 'other-code';
}

function withCodeReasons(item) {
  const reasons = [];
  if (item.lines >= 1200) reasons.push('very-large-code-file');
  if (item.lines >= 700 && item.lines < 1200) reasons.push('large-code-file');
  if (item.bytes >= 120 * 1024) reasons.push('large-byte-size');
  if (item.path.includes('/scripts/')) reasons.push('maintenance-tooling-review');
  if (item.path.includes('/components/')) reasons.push('ui-component-split-review');
  if (item.path.includes('/services/')) reasons.push('service-boundary-review');
  return {
    ...item,
    area: classifyCodeArea(item.path),
    reasons: reasons.length > 0 ? reasons : ['top-size-review']
  };
}

function withDocReasons(item) {
  const reasons = [];
  if (item.lines >= 800) reasons.push('very-large-document');
  if (item.lines >= 400 && item.lines < 800) reasons.push('large-document');
  if (item.path.includes('/project-memory/')) reasons.push('project-memory-keep-current');
  if (item.path.includes('/docs/')) reasons.push('documentation-consolidation-review');
  return {
    ...item,
    reasons: reasons.length > 0 ? reasons : ['top-size-review']
  };
}

function inspectDirectoryShallow(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { exists: false, directEntries: 0 };
  }
  return {
    exists: true,
    directEntries: fs.readdirSync(absolutePath).length
  };
}

function buildReport(limit) {
  const root = getRepoRoot();
  const codeFiles = walkFiles(root, CODE_SCAN_ROOTS, CODE_EXTENSIONS)
    .map((file) => inspectTextFile(root, file))
    .sort((a, b) => b.lines - a.lines || b.bytes - a.bytes)
    .map(withCodeReasons);
  const docFiles = walkFiles(root, DOC_SCAN_ROOTS, DOC_EXTENSIONS)
    .map((file) => inspectTextFile(root, file))
    .sort((a, b) => b.lines - a.lines || b.bytes - a.bytes)
    .map(withDocReasons);

  const trackedNoise = Object.fromEntries(
    INDEX_NOISE_PREFIXES.map((prefix) => [prefix, countTracked(root, prefix)])
  );

  const highRiskDirectories = HIGH_RISK_DIRECTORIES.map((item) => ({
    ...item,
    ...inspectDirectoryShallow(root, item.path)
  }));

  const oversizedCodeFiles = codeFiles
    .filter((item) => item.lines >= 700 || item.bytes >= 120 * 1024)
    .slice(0, limit);
  const oversizedDocuments = docFiles
    .filter((item) => item.lines >= 400 || item.bytes >= 100 * 1024)
    .slice(0, limit);

  return {
    repoRoot: root,
    generatedAt: new Date().toISOString(),
    scope: {
      codeScanRoots: CODE_SCAN_ROOTS,
      docScanRoots: DOC_SCAN_ROOTS,
      generatedDirectoriesSkipped: [...GENERATED_DIR_NAMES].sort()
    },
    trackedNoise,
    highRiskDirectories,
    sourceSimplification: {
      scannedCodeFiles: codeFiles.length,
      oversizedCodeFiles,
      topCodeFiles: codeFiles.slice(0, limit)
    },
    documentationConsolidation: {
      scannedDocuments: docFiles.length,
      oversizedDocuments,
      topDocuments: docFiles.slice(0, limit)
    },
    nextReviewOrder: [
      'Keep dependency/build-output cleanup separate from source refactors.',
      'Start source simplification from oversizedCodeFiles with tests or smoke scripts nearby.',
      'Do not delete highRiskDirectories until references, ownership, and runtime boundaries are verified.',
      'Keep project-memory updates small and UTF-8 verified.'
    ]
  };
}

function formatFileLine(item) {
  return `${item.path}: ${item.lines} lines, ${item.bytes} bytes [${item.reasons.join(', ')}]`;
}

function formatSummary(report) {
  const lines = [
    `repoRoot: ${report.repoRoot}`,
    `generatedAt: ${report.generatedAt}`,
    '',
    'trackedNoise:'
  ];

  for (const [prefix, count] of Object.entries(report.trackedNoise)) {
    lines.push(`- ${prefix}: ${count}`);
  }

  lines.push('', 'sourceSimplification.oversizedCodeFiles:');
  if (report.sourceSimplification.oversizedCodeFiles.length === 0) {
    lines.push('- none');
  } else {
    for (const item of report.sourceSimplification.oversizedCodeFiles) {
      lines.push(`- ${formatFileLine(item)}`);
    }
  }

  lines.push('', 'documentationConsolidation.oversizedDocuments:');
  if (report.documentationConsolidation.oversizedDocuments.length === 0) {
    lines.push('- none');
  } else {
    for (const item of report.documentationConsolidation.oversizedDocuments) {
      lines.push(`- ${formatFileLine(item)}`);
    }
  }

  lines.push('', 'highRiskDirectories:');
  for (const item of report.highRiskDirectories) {
    lines.push(`- ${item.path}: exists ${item.exists}, directEntries ${item.directEntries}, rule: ${item.rule}`);
  }

  lines.push('', 'nextReviewOrder:');
  for (const item of report.nextReviewOrder) {
    lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const limit = normalizeLimit(getArgValue(args, '--limit', '20'));
  const report = buildReport(limit);
  if (args.includes('--summary')) {
    console.log(formatSummary(report));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
