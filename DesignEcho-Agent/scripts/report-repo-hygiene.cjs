#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const INDEX_CLEANUP_PREFIXES = [
  'DesignEcho-Agent/node_modules',
  'DesignEcho-Agent/dist',
  'DesignEcho-Agent/tmp',
  'DesignEcho-UXP/node_modules',
  'DesignEcho-UXP/dist'
];

const IGNORED_TEMP_TARGETS = [
  'DesignEcho-Agent/tmp',
  'DesignEcho-Agent/.cache',
  'DesignEcho-UXP/.cache'
];

const REVIEWABLE_SCRATCH_PATTERNS = [
  /(^|\/)_[^/]*_(backup|restore|tmp)[^/]*$/i,
  /(^|\/)(tmp_|_tmp|.*_tmp_)[^/]*$/i,
  /(^|\/)[^/]*\.(bak|old)$/i,
  /(^|\/)[^/]*\.corrupted\.[^/]*$/i
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

function parseStatusLine(line) {
  const status = line.slice(0, 2);
  let filePath = line.slice(2).trim();
  if (filePath.includes(' -> ')) {
    filePath = filePath.split(' -> ').pop().trim();
  }
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    try {
      filePath = JSON.parse(filePath);
    } catch {
      filePath = filePath.slice(1, -1);
    }
  }
  return { status, filePath: filePath.replace(/\\/g, '/') };
}

function classify(filePath) {
  if (filePath.includes('/node_modules/')) return 'dependency';
  if (filePath.includes('/dist/') || filePath.endsWith('/dist')) return 'build-output';
  if (filePath.includes('/tmp/') || /^tmp[_-]/.test(filePath) || filePath.includes('/localappdata/')) return 'temporary';
  if (/_backup|_restore|\.corrupted\.|tmp_/.test(filePath)) return 'scratch-or-repair';
  if (filePath.includes('/src/')) return 'source';
  if (filePath.includes('/public/')) return 'source';
  if (filePath.includes('/project-memory/')) return 'project-memory';
  if (filePath.includes('/docs/') || filePath.startsWith('docs/')) return 'docs';
  if (/package(-lock)?\.json$/.test(filePath) || /(?:webpack|vite|rollup|tsup)\.config\.[cm]?[jt]s$/.test(filePath)) return 'package';
  if (/(\.gitignore|\.gitattributes|AGENTS\.md)$/.test(filePath)) return 'repo-config';
  if (filePath.includes('/benchmarks/')) return 'benchmark';
  if (filePath.includes('/scripts/')) return 'script';
  return 'other';
}

function getIndexCleanupPrefix(entry) {
  if (entry.status[0] !== 'D') return null;
  return INDEX_CLEANUP_PREFIXES.find((prefix) => entry.filePath === prefix || entry.filePath.startsWith(`${prefix}/`)) || null;
}

function isReviewableScratch(filePath) {
  return REVIEWABLE_SCRATCH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function countTracked(root, prefix) {
  const output = runGit(['ls-files', prefix], root);
  if (!output) return 0;
  return output.split(/\r?\n/).filter(Boolean).length;
}

function isUnderRoot(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isGitIgnored(root, relativePath) {
  try {
    execFileSync('git', ['check-ignore', '-q', relativePath], {
      cwd: root,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

function inspectDirectory(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return { exists: false, files: 0, bytes: 0 };
  }
  const stack = [targetPath];
  let files = 0;
  let bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(child).size;
      }
    }
  }
  return { exists: true, files, bytes };
}

function inspectIgnoredTemp(root) {
  return Object.fromEntries(IGNORED_TEMP_TARGETS.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    return [relativePath, {
      ...inspectDirectory(absolutePath),
      gitIgnored: isGitIgnored(root, `${relativePath}/.designecho-hygiene-probe`)
        || isGitIgnored(root, relativePath)
    }];
  }));
}

function cleanIgnoredTemp(root) {
  const cleaned = [];
  for (const relativePath of IGNORED_TEMP_TARGETS) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    if (!isUnderRoot(root, absolutePath)) {
      throw new Error(`Refusing to clean outside repo: ${absolutePath}`);
    }
    const ignored = isGitIgnored(root, `${relativePath}/.designecho-hygiene-probe`)
      || isGitIgnored(root, relativePath);
    if (!ignored) {
      throw new Error(`Refusing to clean non-ignored path: ${relativePath}`);
    }
    const before = inspectDirectory(absolutePath);
    try {
      fs.rmSync(absolutePath, { recursive: true, force: true });
      cleaned.push({ path: relativePath, ...before });
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : '';
      if (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM') throw error;
      cleaned.push({
        path: relativePath,
        ...before,
        skipped: true,
        reason: `${code || 'LOCKED'}: ignored temp path is currently locked by a running process`
      });
    }
  }
  return cleaned;
}

function buildReport() {
  const root = getRepoRoot();
  const statusOutput = runGit(['status', '--porcelain=v1'], root);
  const lines = statusOutput ? statusOutput.split(/\r?\n/).filter(Boolean) : [];
  const entries = lines.map(parseStatusLine);
  const indexCleanup = new Map(INDEX_CLEANUP_PREFIXES.map((prefix) => [prefix, { count: 0, examples: [] }]));
  const residualCleanup = new Map();
  const groups = new Map();
  const reviewableScratch = { total: 0, examples: [] };

  for (const entry of entries) {
    const cleanupPrefix = getIndexCleanupPrefix(entry);
    if (cleanupPrefix) {
      const cleanupGroup = indexCleanup.get(cleanupPrefix);
      cleanupGroup.count += 1;
      if (cleanupGroup.examples.length < 8) cleanupGroup.examples.push(`${entry.status} ${entry.filePath}`);
      continue;
    }

    const category = classify(entry.filePath);
    if (entry.status[0] === 'D' && (category === 'scratch-or-repair' || category === 'temporary')) {
      if (!residualCleanup.has(category)) {
        residualCleanup.set(category, { count: 0, examples: [] });
      }
      const cleanupGroup = residualCleanup.get(category);
      cleanupGroup.count += 1;
      if (cleanupGroup.examples.length < 8) cleanupGroup.examples.push(`${entry.status} ${entry.filePath}`);
      continue;
    }

    if (isReviewableScratch(entry.filePath)) {
      reviewableScratch.total += 1;
      if (reviewableScratch.examples.length < 12) {
        reviewableScratch.examples.push(`${entry.status} ${entry.filePath}`);
      }
    }

    if (!groups.has(category)) {
      groups.set(category, { count: 0, modified: 0, added: 0, deleted: 0, untracked: 0, examples: [] });
    }
    const group = groups.get(category);
    group.count += 1;
    if (entry.status.includes('M')) group.modified += 1;
    if (entry.status.includes('A')) group.added += 1;
    if (entry.status.includes('D')) group.deleted += 1;
    if (entry.status === '??') group.untracked += 1;
    if (group.examples.length < 8) group.examples.push(`${entry.status} ${entry.filePath}`);
  }

  const trackedNoise = {
    'DesignEcho-Agent/node_modules': countTracked(root, 'DesignEcho-Agent/node_modules'),
    'DesignEcho-Agent/dist': countTracked(root, 'DesignEcho-Agent/dist'),
    'DesignEcho-Agent/tmp': countTracked(root, 'DesignEcho-Agent/tmp'),
    'DesignEcho-UXP/node_modules': countTracked(root, 'DesignEcho-UXP/node_modules'),
    'DesignEcho-UXP/dist': countTracked(root, 'DesignEcho-UXP/dist')
  };
  const ignoredTemp = inspectIgnoredTemp(root);

  const pendingChangeCount = entries.length;
  const reviewableChangeCount = [...groups.values()].reduce((total, group) => total + group.count, 0);

  const report = {
    repoRoot: root,
    pendingChangeCount,
    reviewableChangeCount,
    // Backward-compatible aliases for older local notes/scripts.
    dirtyCount: pendingChangeCount,
    actionableDirtyCount: reviewableChangeCount,
    categories: Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b))),
    indexCleanup: {
      total: [...indexCleanup.values()].reduce((total, group) => total + group.count, 0),
      byPrefix: Object.fromEntries([...indexCleanup.entries()].filter(([, group]) => group.count > 0))
    },
    residualCleanup: {
      total: [...residualCleanup.values()].reduce((total, group) => total + group.count, 0),
      byCategory: Object.fromEntries([...residualCleanup.entries()].sort(([a], [b]) => a.localeCompare(b)))
    },
    reviewableScratch,
    trackedNoise,
    ignoredTemp,
    recommendation: [
      'Do not delete or reset pending source changes blindly.',
      'Generated/dependency files should be removed from the git index only, not deleted from disk.',
      'Use --clean-ignored-temp only for ignored tmp/cache outputs, never for source, docs, scripts, benchmarks, or project-memory.',
      'If reviewableScratch.total is greater than 0, inspect those files before committing; do not auto-delete them.',
      'If indexCleanup.total is greater than 0, commit those removals together with .gitignore/.gitattributes.',
      'Review source/project-memory/docs separately from dependency/build-output/temporary categories.'
    ]
  };

  return report;
}

function formatSummary(report) {
  const lines = [
    `repoRoot: ${report.repoRoot}`,
    `pendingChangeCount: ${report.pendingChangeCount}`,
    `reviewableChangeCount: ${report.reviewableChangeCount}`,
    `indexCleanup.total: ${report.indexCleanup.total}`,
    '',
    'categories:'
  ];

  for (const [name, group] of Object.entries(report.categories)) {
    lines.push(`- ${name}: ${group.count} (modified ${group.modified}, added ${group.added}, deleted ${group.deleted}, untracked ${group.untracked})`);
  }

  lines.push('', 'trackedNoise:');
  for (const [prefix, count] of Object.entries(report.trackedNoise)) {
    lines.push(`- ${prefix}: ${count}`);
  }

  if (report.indexCleanup.total > 0) {
    lines.push('', 'indexCleanup:');
    for (const [prefix, group] of Object.entries(report.indexCleanup.byPrefix)) {
      lines.push(`- ${prefix}: ${group.count}`);
    }
  }

  if (report.residualCleanup.total > 0) {
    lines.push('', 'residualCleanup:');
    for (const [category, group] of Object.entries(report.residualCleanup.byCategory)) {
      lines.push(`- ${category}: ${group.count}`);
    }
  }

  lines.push('', `reviewableScratch.total: ${report.reviewableScratch.total}`);
  for (const example of report.reviewableScratch.examples) {
    lines.push(`- ${example}`);
  }

  lines.push('', 'ignoredTemp:');
  for (const [target, group] of Object.entries(report.ignoredTemp)) {
    lines.push(`- ${target}: exists ${group.exists}, files ${group.files}, bytes ${group.bytes}, gitIgnored ${group.gitIgnored}`);
  }

  return lines.join('\n');
}

function hasTrackedNoise(report) {
  return Object.values(report.trackedNoise).some((count) => count > 0);
}

function hasReviewableScratch(report) {
  return report.reviewableScratch.total > 0;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const root = getRepoRoot();
  if (args.has('--clean-ignored-temp')) {
    const cleaned = cleanIgnoredTemp(root);
    console.log(JSON.stringify({ success: true, cleaned }, null, 2));
    return;
  }
  const report = buildReport();

  if (args.has('--summary')) {
    console.log(formatSummary(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (args.has('--fail-on-tracked-noise') && hasTrackedNoise(report)) {
    process.exitCode = 2;
  } else if (args.has('--fail-on-reviewable-scratch') && hasReviewableScratch(report)) {
    process.exitCode = 3;
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
