#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const char = (codePoint) => String.fromCodePoint(codePoint);

const MOJIBAKE_PATTERN_CODEPOINTS = [
  0x9359,
  0x6D93,
  0x923F,
  0x7487,
  0x93C1,
  0x9429,
  0x7EF1,
  0x6FB6,
  0x59AF,
  0x7EAD,
  0x701B,
  0x6D94,
  0x93AC,
  0x51AD,
  0x5EA2,
  0x9983,
  0x20AC,
  0x00C3,
  0x00C2,
  0xFFFD
];

const MOJIBAKE_PATTERNS = MOJIBAKE_PATTERN_CODEPOINTS.map(char);

const SCANNED_TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.ts',
  '.tsx'
]);

const MOJIBAKE_ALLOWLIST = new Map();

const RETIRED_DOCUMENT_PATHS = [
  'docs/agent-architecture.md',
  'docs/agent-architecture-system-review.md',
  'docs/design-agent-execution-plan.md',
  'docs/design-agent-research-and-roadmap.md',
  'docs/agent-foundation-completion-plan.md',
  'docs/design-agent-development-knowledge-base.md',
  'docs/claude-code-haha-architecture-borrowing-review.md',
  'docs/claude-code-haha-full-architecture-study.md',
  'docs/claude-code-haha-multi-agent-study.md',
  'docs/long-horizon-codex-adoption.md',
  'docs/agent-mcp-skills-comparison-and-borrowing.md',
  'docs/design-agent-architecture-borrowing-plan.md',
  'src/main/REFACTOR-PLAN.md'
];

function run(command, args, options = {}) {
  const result = execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  return typeof result === 'string' ? result.trim() : '';
}
let cachedAgentArchitectureJson = null;
let cachedProjectCockpitJson = null;

function readAgentArchitectureJson(agentRoot) {
  if (cachedAgentArchitectureJson === null) {
    cachedAgentArchitectureJson = run('node', ['scripts/report-agent-architecture.cjs', '--json'], {
      cwd: agentRoot,
      capture: true
    });
  }
  return cachedAgentArchitectureJson;
}

function readProjectCockpitJson(agentRoot) {
  if (cachedProjectCockpitJson === null) {
    cachedProjectCockpitJson = run('node', ['scripts/report-project-cockpit.cjs', '--json', '--limit', '3'], {
      cwd: agentRoot,
      capture: true
    });
  }
  return cachedProjectCockpitJson;
}

function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], { capture: true }).replace(/\\/g, '/');
}

function readJson(baseDir, relativePath) {
  const absolutePath = path.resolve(baseDir, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function assertArray(value, pathLabel) {
  if (!Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an array`);
  }
}

function assertString(value, pathLabel) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${pathLabel} must be a non-empty string`);
  }
}

function assertStringArray(value, pathLabel) {
  assertArray(value, pathLabel);
  for (const [index, item] of value.entries()) {
    assertString(item, `${pathLabel}[${index}]`);
  }
}

function assertOptionalObject(value, pathLabel) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an object when present`);
  }
}

function assertProjectStateShape(projectState) {
  assertString(projectState.currentFocus, 'project-state.currentFocus');
  assertString(projectState.currentMilestone, 'project-state.currentMilestone');
  assertString(projectState.milestoneStatus, 'project-state.milestoneStatus');
  if (!projectState.verified || typeof projectState.verified !== 'object') {
    throw new Error('project-state.verified must be an object');
  }
  assertStringArray(projectState.verified.code, 'project-state.verified.code');
  assertStringArray(projectState.verified.build, 'project-state.verified.build');
  assertStringArray(projectState.verified.manual, 'project-state.verified.manual');
  assertStringArray(projectState.unverified, 'project-state.unverified');
  assertStringArray(projectState.topRisks, 'project-state.topRisks');
  assertStringArray(projectState.nextActions, 'project-state.nextActions');
  assertOptionalObject(projectState.activeRequest, 'project-state.activeRequest');
  assertOptionalObject(projectState.activePlan, 'project-state.activePlan');
}

function assertRequiredFile(baseDir, relativePath) {
  const absolutePath = path.resolve(baseDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required project file missing: ${relativePath}`);
  }
}

function assertPlanningMemoryFiles(agentRoot) {
  [
    'project-memory/README.md',
    'project-memory/Prompt.md',
    'project-memory/CurrentTask.md',
    'project-memory/Intake.md',
    'project-memory/Plan.md',
    'project-memory/Implement.md',
    'project-memory/Status.md',
    'project-memory/Backlog.md',
    'project-memory/Risks.md',
    'project-memory/Decisions.md',
    'docs/agent-capability-map.md',
    'docs/agent-development-methodology.md',
    'docs/design-agent-operating-system.md',
    'docs/design-agent-os-implementation-tree.md'
  ].forEach((relativePath) => assertRequiredFile(agentRoot, relativePath));
}

function assertRetiredDocumentsAbsent(agentRoot) {
  const restored = RETIRED_DOCUMENT_PATHS.filter((relativePath) => (
    fs.existsSync(path.resolve(agentRoot, relativePath))
  ));
  const archiveDir = path.resolve(agentRoot, 'project-memory/archive');
  if (fs.existsSync(archiveDir)) {
    for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        restored.push(`project-memory/archive/${entry.name}`);
      }
    }
  }
  if (restored.length > 0) {
    throw new Error(
      `Retired or duplicate documentation restored; use Git history instead:\n${restored.join('\n')}`
    );
  }
}

function findNodeScriptTargets(commandText) {
  const targets = [];
  const pattern = /\bnode(?:\s+--[^\s]+)*\s+(scripts[\\/][^\s"'&|;()]+)/g;
  let match;
  while ((match = pattern.exec(commandText)) !== null) {
    targets.push(match[1].replace(/\\/g, '/'));
  }
  return targets;
}

function findNpmRunTargets(commandText) {
  const targets = [];
  const pattern = /\bnpm\s+run\s+([^\s"'&|;()]+)/g;
  let match;
  while ((match = pattern.exec(commandText)) !== null) {
    const scriptName = match[1];
    if (scriptName && scriptName !== '--') {
      targets.push(scriptName);
    }
  }
  return targets;
}

function assertPackageScriptTargets(packageJson, agentRoot) {
  const scripts = packageJson.scripts || {};
  const missing = [];
  const missingNpmScripts = [];
  for (const [scriptName, commandText] of Object.entries(scripts)) {
    for (const target of findNodeScriptTargets(String(commandText))) {
      if (!fs.existsSync(path.join(agentRoot, target))) {
        missing.push(`${scriptName} -> ${target}`);
      }
    }
    for (const targetScript of findNpmRunTargets(String(commandText))) {
      if (!scripts[targetScript]) {
        missingNpmScripts.push(`${scriptName} -> npm run ${targetScript}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Package scripts reference missing node script files:\n${missing.join('\n')}`);
  }
  if (missingNpmScripts.length > 0) {
    throw new Error(`Package scripts reference missing npm scripts:\n${missingNpmScripts.join('\n')}`);
  }
}

function assertValidationTierScripts(packageJson) {
  const scripts = packageJson.scripts || {};
  const expected = {
    'dev:chat-ui:debug-window': 'node scripts/launch-chat-ui-debug-window.cjs --port 9223 --isolated-user-data --log-file tmp/chat-ui-debug-window.log',
    'dev:chat-ui:debug-window:fake': 'node scripts/launch-chat-ui-debug-window.cjs --port 9223 --fake-model --fake-model-fixture neutral --fake-photoshop --isolated-user-data --log-file tmp/chat-ui-debug-window.log',
    'maintenance:validate:fast': 'node scripts/run-validation-tier.cjs --tier fast',
    'maintenance:validate:risk': 'node scripts/run-validation-tier.cjs --tier risk',
    'maintenance:validate:risk:agent': 'node scripts/run-validation-tier.cjs --tier risk --group agent',
    'maintenance:validate:risk:sku': 'node scripts/run-validation-tier.cjs --tier risk --group sku',
    'maintenance:validate:risk:ui': 'node scripts/run-validation-tier.cjs --tier risk --group ui',
    'maintenance:validate:risk:uxp': 'node scripts/run-validation-tier.cjs --tier risk --group uxp',
    'maintenance:validate:risk:learning': 'node scripts/run-validation-tier.cjs --tier risk --group learning',
    'maintenance:validate:full': 'node scripts/run-validation-tier.cjs --tier full'
  };

  for (const [scriptName, commandText] of Object.entries(expected)) {
    if (scripts[scriptName] !== commandText) {
      throw new Error(`${scriptName} must be ${commandText}`);
    }
  }
}

function assertIncludes(value, expected, label) {
  if (!String(value).includes(expected)) {
    throw new Error(`${label} must include ${expected}`);
  }
}

function listFiles(root, inputs) {
  const files = [];
  for (const input of inputs) {
    const absolute = path.resolve(root, input);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      files.push(absolute);
      continue;
    }
    if (stat.isDirectory()) {
      const stack = [absolute];
      while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const child = path.join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(child);
          } else if (entry.isFile()) {
            files.push(child);
          }
        }
      }
    }
  }
  return files;
}

function shouldScanTextFile(file) {
  return SCANNED_TEXT_EXTENSIONS.has(path.extname(file));
}

function isAllowedMojibakeMatch(root, file, pattern, line) {
  const relativePath = path.relative(root, file).replace(/\\/g, '/');
  const allowedSnippets = MOJIBAKE_ALLOWLIST.get(relativePath) || [];
  return allowedSnippets.some((snippet) => snippet.includes(pattern) && line.includes(snippet));
}

function assertNoMojibake(root) {
  const files = [...new Set(listFiles(root, [
    '.gitignore',
    '.gitattributes',
    'DesignEcho-Agent/src',
    'DesignEcho-Agent/scripts',
    'DesignEcho-Agent/docs',
    'DesignEcho-Agent/project-memory',
    'DesignEcho-Agent/benchmarks',
    'DesignEcho-UXP/scripts/smoke-image-generation-error-helpers.cjs',
    'DesignEcho-UXP/scripts/smoke-image-generation-options.cjs',
    'DesignEcho-UXP/scripts/smoke-image-to-image-selection.cjs',
    'DesignEcho-UXP/scripts/smoke-template-library-core.cjs',
    'DesignEcho-UXP/scripts/smoke-webview-panel-layout.cjs',
    'DesignEcho-UXP/scripts/smoke-webview-message-core.cjs',
    'DesignEcho-UXP/src',
    'DesignEcho-Agent/scripts/report-repo-hygiene.cjs',
    'DesignEcho-Agent/scripts/report-change-boundaries.cjs',
    'DesignEcho-Agent/scripts/report-project-cleanup-candidates.cjs',
    'DesignEcho-Agent/scripts/validate-maintenance-hygiene.cjs',
    'DesignEcho-Agent/docs/repository-maintenance-hygiene.md',
    'DesignEcho-Agent/docs/repository-change-boundary-report.md'
  ]))].filter(shouldScanTextFile);

  const matches = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const pattern of MOJIBAKE_PATTERNS) {
        if (line.includes(pattern) && !isAllowedMojibakeMatch(root, file, pattern, line)) {
          matches.push(`${path.relative(root, file).replace(/\\/g, '/')}:${index + 1}: ${pattern}`);
        }
      }
    }
  }

  if (matches.length > 0) {
    throw new Error(`Mojibake patterns found:\n${matches.join('\n')}`);
  }
}

function main() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');
  const uxpRoot = path.join(root, 'DesignEcho-UXP');

  const packageJson = readJson(agentRoot, 'package.json');
  assertPackageScriptTargets(packageJson, agentRoot);
  assertValidationTierScripts(packageJson);
  const maintenancePreflight = String(packageJson.scripts?.['maintenance:preflight'] || '');
  for (const requiredPreflightScript of [
    'smoke:agent:thinking-tool-boundary',
    'smoke:main-image:white-bg-sku-material-contract'
  ]) {
    assertIncludes(
      maintenancePreflight,
      `npm run ${requiredPreflightScript}`,
      `maintenance:preflight ${requiredPreflightScript}`
    );
  }
  assertProjectStateShape(readJson(agentRoot, 'project-memory/project-state.json'));
  assertPlanningMemoryFiles(agentRoot);
  assertRetiredDocumentsAbsent(agentRoot);

  run('node', ['--check', 'scripts/report-repo-hygiene.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-change-boundaries.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-project-cockpit.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-project-cleanup-candidates.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-agent-architecture.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/run-validation-tier.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/launch-chat-ui-debug-window.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/inspect-chat-ui-running-window.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-image-generation-error-helpers.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-image-generation-options.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-image-to-image-selection.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-template-library-core.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-webview-panel-layout.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-webview-message-core.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-sku-auto-layout-plan.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-sku-auto-layout-post-qa.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-sku-layout-auto-planner-integration.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/smoke-main-image-white-bg-from-sku-tool.cjs'], { cwd: uxpRoot });
  run('node', ['--check', 'scripts/report-main-image-screenshot-probe-readiness.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-agent-capability-map.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-planning-contract.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-user-visible-state.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-thinking-tool-boundary.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-public-plan-photoshop-adapter.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-design-preflight.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-configured-execution-plan.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-export-readback.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-visual-review-intake.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-color-card-retouch-strategy.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-color-card-image-probes.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-c1163-live-acceptance.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-no-placeholder-live-acceptance.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-agent-os-contracts.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-agent-os-architecture-tree.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-project-asset-index.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-project-visual-insight-cache.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-project-visual-insight-cache-fill.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-eagle-candidate-visual-insight-request.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-placement-candidate-ranking.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-experience.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-memory-review.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-memory-review-queue.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-review-settings-entry.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-runtime-settings-entry.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-memory-persistence.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-cadence-scheduler.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-runtime-trigger.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-runtime-trigger-service.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-runtime-entry-service.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-runtime-runner.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-eagle-runtime-provider.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-reference-analyzer.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-learning-runtime-orchestrator-service.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-preflight-planner-context.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-visual-evidence-refresh-plan.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-visual-evidence-refresh-runner.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-visual-evidence-refresh-runtime.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-visual-evidence-pre-execution-gate.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-visual-evidence-refresh-executor-wiring.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-memory-context.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-memory-strategy.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-readiness-contract.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-execution-intake.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-business-skill-visual-evidence-diagnostic.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-diagnostic-control.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-diagnostic-export.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-business-skill-verification.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-intent-decision-intake.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-triage.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-agent-acceptance-triage.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-triage-report.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-verification-matrix.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-agent-acceptance-verification-matrix.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-execution-suite.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/run-agent-acceptance-suite.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-reference-replication-readiness.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/record-reference-replication-result.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/plan-reference-replication-capture.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/evaluate-reference-replication-result.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/validate-reference-result-evidence.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-reference-evidence-pipeline.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/plan-reference-real-case-intake.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/check-reference-quality-claim-gate.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-reference-replication-status.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/lib/reference-source-kinds.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/check-planning-alignment.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/validate-maintenance-hygiene.cjs'], { cwd: agentRoot });
  run('node', ['scripts/check-planning-alignment.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-image-generation-error-helpers.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-image-generation-options.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-image-to-image-selection.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-template-library-core.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-webview-panel-layout.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-webview-message-core.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-sku-auto-layout-plan.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-sku-auto-layout-post-qa.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-sku-layout-auto-planner-integration.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/smoke-main-image-white-bg-from-sku-tool.cjs'], { cwd: uxpRoot });
  run('node', ['scripts/report-agent-capability-map.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-performance-policy.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-planning-contract.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-user-visible-state.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-thinking-tool-boundary.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-public-plan-photoshop-adapter.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-agent-os-contracts.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-agent-os-architecture-tree.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-project-asset-index.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-project-visual-insight-cache.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-project-visual-insight-cache-fill.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-eagle-candidate-visual-insight-request.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-planner-preflight-control.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-preflight-planner-context.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-visual-evidence-refresh-plan.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-visual-evidence-refresh-runner.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-visual-evidence-refresh-runtime.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-visual-evidence-pre-execution-gate.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-visual-evidence-refresh-executor-wiring.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-memory-context.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-memory-strategy.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-readiness-contract.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-execution-intake.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-business-skill-visual-evidence-diagnostic.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-diagnostic-control.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-diagnostic-export.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-business-skill-verification.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-intent-decision-intake.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-worker-identity.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-runtime-mode.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-entry.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-strategy-checkpoint.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-child-strategy-packets.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-child-strategy-review-gate.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-child-strategy-handoff.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-child-strategy-consumption.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-dispatch-checkpoint.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-dispatch-lifecycle.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-dispatch-orchestration.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-dispatch-authorization.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-child-dispatch-runner.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ecommerce-socks-design-child-report-aggregation.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-observation-channels.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-provider-observation-capabilities.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-provider-native-tools.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-searxng-design-knowledge.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-knowledge-settings-entry.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-knowledge-runtime-capability.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-eagle-writeback-gate.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-placement-candidate-ranking.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-experience.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-memory-review.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-memory-review-queue.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-review-settings-entry.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-runtime-settings-entry.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-memory-persistence.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-cadence-scheduler.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-runtime-trigger.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-runtime-trigger-service.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-runtime-entry-service.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-runtime-runner.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-eagle-runtime-provider.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-reference-analyzer.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-design-learning-runtime-orchestrator-service.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ui-workbench-information-architecture.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ui-agent-process-inspector.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ui-human-review-intake.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-human-review-record-persistence.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ui-asset-gallery-polish.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ui-eagle-asset-candidates.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-ui-design-result-review-panel.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-execution-lifecycle.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-execution-lifecycle-acceptance.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-triage.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-triage-report.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-verification-matrix.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-agent-acceptance-execution-suite.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-strategy-contract.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-strategy-input-builder.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-white-bg-sku-material-contract.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-detail-page-dpi-readonly-evidence.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-sku-dpi-readonly-evidence.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-sku-configured-execution-plan.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-sku-export-readback.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-sku-visual-review-intake.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-sku-color-card-retouch-strategy.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-sku-color-card-image-probes.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-asset-hero-strategy.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-design-standards.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-design-readiness-report.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-live-executor-request.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-live-executor-checkpoint.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-live-executor-runner.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-live-photoshop-adapter-contract.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-production-structure.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-production-execution-plan.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-production-executor-handoff.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-production-executor-bridge.cjs'], { cwd: agentRoot });
  run('node', ['scripts/smoke-main-image-production-executor-dry-run.cjs'], { cwd: agentRoot });
  run('node', ['scripts/report-reference-replication-readiness.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-acceptance-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-acceptance-write-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-simple-operations-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-mcp-conditional.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-acceptance-snapshot-diff.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-acceptance-tool-evidence.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-tool-semantics.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-text-tool-benchmarks.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-text-tools-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-text-font-replace-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-controlled-export-execution.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-controlled-export-execution-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-controlled-image-placement-execution.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-controlled-image-placement-execution-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-photoshop-rasterize-popup-guard-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-text-optimization-contract.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-debug-bridge-redaction.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-tool-result-redaction.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-chat-ui-execution-chain.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-chat-ui-electron-bridge.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ui-workbench-information-architecture.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ui-agent-process-inspector.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ui-human-review-intake.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-human-review-record-persistence.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ui-asset-gallery-polish.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ui-eagle-asset-candidates.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ui-design-result-review-panel.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-runtime-guard.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-performance-policy.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-worker-identity.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-acceptance-runtime-mode.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-entry.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-strategy-checkpoint.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-child-strategy-packets.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-child-strategy-review-gate.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-child-strategy-handoff.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-child-strategy-consumption.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-dispatch-checkpoint.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-dispatch-lifecycle.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-dispatch-orchestration.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-dispatch-authorization.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-child-dispatch-runner.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-ecommerce-socks-design-child-report-aggregation.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-observation-channels.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-provider-observation-capabilities.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-provider-native-tools.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-searxng-design-knowledge.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-knowledge-settings-entry.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-knowledge-runtime-capability.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-eagle-writeback-gate.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-execution-lifecycle.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-agent-execution-lifecycle-acceptance.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-team-coordinator.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-model-provider-deepseek.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-asset-selection.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-visual-loop.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-vision-preflight.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-candidate-preflight.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-execution-alignment.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-screenshot-qa.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-screenshot-probe-readiness.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-pixel-probe-adapter.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-qa-report.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-agent-draft-plan.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-strategy-contract.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-strategy-input-builder.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-white-bg-sku-material-contract.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-detail-page-dpi-readonly-evidence.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-dpi-readonly-evidence.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-configured-execution-plan.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-export-readback.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-visual-review-intake.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-sku-color-card-image-probes.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-asset-hero-strategy.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-design-standards.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-design-readiness-report.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-live-executor-request.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-live-executor-checkpoint.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-live-executor-runner.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-live-photoshop-adapter-contract.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-production-structure.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-production-execution-plan.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-production-executor-handoff.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-production-executor-bridge.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-main-image-production-executor-dry-run.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-design-planner-preflight-control.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-blueprint-groups.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-match-validation.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-layout-replication-text-placement.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-layout-replication-canvas-policy.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-overlay-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-overlay-live-contract.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-fex-text-layout-case.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-fex-text-placement-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/validate-reference-replication-benchmarks.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-benchmark-validator.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-benchmark-scope.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-benchmark-coverage.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-readiness-report.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-record-result.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-capture-plan.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-live-capture-guard.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/report-reference-live-capture-readiness.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-live-capture-readiness.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-result-evidence.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-result-evidence-validator.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-evidence-pipeline.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-real-case-intake.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-quality-claim-gate.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-quality-gate-consistency.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-replication-status.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-neutral-text-layout-case.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-reference-neutral-text-pixel-bounds.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-chat-ui-reference-replication-neutral.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/smoke-chat-ui-reference-replication-live.cjs'], { cwd: agentRoot });
  run('node', ['--check', 'scripts/lib/reference-benchmark-categories.cjs'], { cwd: agentRoot });

  run('node', ['scripts/report-repo-hygiene.cjs', '--summary', '--fail-on-tracked-noise'], { cwd: agentRoot });
  run('node', ['scripts/report-change-boundaries.cjs', '--summary', '--fail-on-uncategorized'], { cwd: agentRoot });
  run('node', ['scripts/report-change-boundaries.cjs', '--entries', 'other'], { cwd: agentRoot, capture: true });
  run('node', ['scripts/report-change-boundaries.cjs', '--paths', 'other'], { cwd: agentRoot, capture: true });
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:intent-engine',
    'change-boundaries --validation agent-routing-models'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:planning-contract',
    'change-boundaries --validation agent-routing-models planning contract'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:runtime-guard',
    'change-boundaries --validation agent-routing-models'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:model-provider:deepseek',
    'change-boundaries --validation agent-routing-models'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:provider-observation-capabilities',
    'change-boundaries --validation agent-routing-models'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:worker-identity',
    'change-boundaries --validation agent-routing-models'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:sku:design-preflight',
    'change-boundaries --validation agent-routing-models'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'design-skill-execution-core'], { cwd: agentRoot, capture: true }),
    'smoke:ecommerce-socks-design:entry',
    'change-boundaries --validation design-skill-execution-core'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'design-skill-execution-core'], { cwd: agentRoot, capture: true }),
    'smoke:ecommerce-socks-design:dispatch-checkpoint',
    'change-boundaries --validation design-skill-execution-core dispatch checkpoint'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'design-skill-execution-core'], { cwd: agentRoot, capture: true }),
    'smoke:ecommerce-socks-design:dispatch-lifecycle',
    'change-boundaries --validation design-skill-execution-core dispatch lifecycle'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'design-skill-execution-core'], { cwd: agentRoot, capture: true }),
    'smoke:ecommerce-socks-design:dispatch-orchestration',
    'change-boundaries --validation design-skill-execution-core dispatch orchestration'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'design-skill-execution-core'], { cwd: agentRoot, capture: true }),
    'smoke:ecommerce-socks-design:dispatch-authorization',
    'change-boundaries --validation design-skill-execution-core dispatch authorization'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'design-skill-execution-core'], { cwd: agentRoot, capture: true }),
    'smoke:ecommerce-socks-design:child-dispatch-runner',
    'change-boundaries --validation design-skill-execution-core child dispatch runner'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'design-skill-execution-core'], { cwd: agentRoot, capture: true }),
    'smoke:ecommerce-socks-design:child-report-aggregation',
    'change-boundaries --validation design-skill-execution-core child report aggregation'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:provider-native:tools',
    'change-boundaries --validation agent-routing-models'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'currentFocus',
    'project cockpit json export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'liveCapture',
    'project cockpit reference live capture export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'evidenceChain',
    'project cockpit reference status evidence chain export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'benchmark:reference-replication:validate-evidence',
    'project cockpit reference status validate-evidence export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'hasResultScreenshotBlocker',
    'project cockpit quality gate result screenshot blocker export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'hasManualReviewBlocker',
    'project cockpit quality gate manual review blocker export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'qualityGateConsistency',
    'project cockpit quality gate consistency export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'readinessSmokeInPreflight',
    'project cockpit reference live readiness export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-status.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'evidenceChain',
    'reference status evidence chain export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-status.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'benchmark:reference-replication:validate-evidence',
    'reference status validate-evidence export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-status.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'hasResultScreenshotBlocker',
    'reference status quality gate result screenshot blocker export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-status.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'hasManualReviewBlocker',
    'reference status quality gate manual review blocker export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-status.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'qualityGateConsistency',
    'reference status quality gate consistency export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-evidence-pipeline.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'hasResultScreenshotBlocker',
    'reference evidence pipeline quality gate result screenshot blocker export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-evidence-pipeline.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'hasManualReviewBlocker',
    'reference evidence pipeline quality gate manual review blocker export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-evidence-pipeline.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'qualityGateConsistency',
    'reference evidence pipeline quality gate consistency export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'architectureStatus',
    'agent architecture json export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'capabilityMapInventory',
    'agent architecture capability map inventory export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'referenceReplicationReadiness',
    'agent architecture reference replication readiness export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'referenceStatusResume',
    'agent architecture reference status resume export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'hasResultScreenshotBlocker',
    'agent architecture quality gate result screenshot blocker export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'hasManualReviewBlocker',
    'agent architecture quality gate manual review blocker export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'referenceQualityGateConsistency',
    'agent architecture quality gate consistency export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'designAgentOsSubsystems',
    'agent architecture design agent os subsystem export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'projectAssetIndex',
    'agent architecture project asset index export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentPerformancePolicy',
    'agent architecture performance policy export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'autonomousAgentUsesRuntimeBudget',
    'agent architecture autonomous agent runtime budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'designTeamCoordinatorUsesRuntimeBudget',
    'agent architecture design team runtime budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'contextManagerUsesWindowBudget',
    'agent architecture context window budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'resourceManagerUsesCacheBudget',
    'agent architecture resource cache budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'providerAdaptersUseTokenBudget',
    'agent architecture provider token budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'modelServiceUsesTokenBudget',
    'agent architecture model-service token budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'streamAdapterUsesTokenBudget',
    'agent architecture stream-adapter token budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'toolAcceptanceUsesCaptureBudget',
    'agent architecture acceptance capture budget export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'projectVisualSamplingUsesBudget',
    'agent architecture visual sampling budget export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentPerformancePolicy',
    'project cockpit performance policy export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'runtimeBudgetHelperAvailable',
    'project cockpit runtime budget helper export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'designTeamRuntimeBudgetHelperAvailable',
    'project cockpit design team runtime budget helper export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'contextWindowBudgetHelperAvailable',
    'project cockpit context window budget helper export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'resourceCacheBudgetHelperAvailable',
    'project cockpit resource cache budget helper export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'providerTokenBudgetHelperAvailable',
    'project cockpit provider token budget helper export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'modelServiceUsesTokenBudget',
    'project cockpit model-service token budget export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'streamAdapterUsesTokenBudget',
    'project cockpit stream-adapter token budget export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'acceptanceCaptureBudgetHelperAvailable',
    'project cockpit acceptance capture budget helper export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'visualSamplingBudgetHelperAvailable',
    'project cockpit visual sampling budget helper export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'visualInsightCacheHelperAvailable',
    'project cockpit visual insight cache export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'visualInsightCacheFillHelperAvailable',
    'project cockpit visual insight cache fill export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessVisualContextHelperAvailable',
    'project cockpit business visual context export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessVisualObservationFeedbackUiAvailable',
    'project cockpit business visual evidence feedback UI export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessVisualObservationFeedbackDesktopSmokeAvailable',
    'project cockpit business visual evidence feedback desktop smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillDesignGovernanceSmokeAvailable',
    'project cockpit business skill design governance smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillImplementationCheckpointSmokeAvailable',
    'project cockpit business skill implementation checkpoint smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillReadinessContractSmokeAvailable',
    'project cockpit business skill readiness contract smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillReadinessContractNoQualityClaim',
    'project cockpit business skill readiness contract no-quality-claim export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillExecutionPreflightGateSmokeAvailable',
    'project cockpit business skill execution preflight gate smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillExecutionPreflightWiringSmokeAvailable',
    'project cockpit business skill execution preflight wiring smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillPreflightPlannerEvidenceSmokeAvailable',
    'project cockpit business skill preflight planner evidence smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillVisualObservationRefreshPlanSmokeAvailable',
    'project cockpit business skill visual evidence refresh plan smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillVisualObservationRefreshPlanDefaultDisabled',
    'project cockpit business skill visual evidence refresh plan default disabled export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillVisualObservationRefreshRunnerSmokeAvailable',
    'project cockpit business skill visual evidence refresh runner smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillVisualObservationRefreshRunnerPostExecutor',
    'project cockpit business skill visual evidence refresh runner post-executor export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillVisualObservationRefreshRuntimeSmokeAvailable',
    'project cockpit business skill visual evidence refresh runtime smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable',
    'project cockpit business skill visual evidence refresh executor wiring smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillExecutionIntakeSmokeAvailable',
    'project cockpit business skill execution intake smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillImagePlacementVerificationIntakeSmokeAvailable',
    'project cockpit business skill image placement verification intake smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'businessSkillExecutionPlanIntakeSmokeAvailable',
    'project cockpit business skill execution plan intake smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceDiagnosticExportSmokeAvailable',
    'project cockpit agent acceptance diagnostic export smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceBusinessSkillVerificationSmokeAvailable',
    'project cockpit agent acceptance business skill evidence smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentIntentDecisionIntakeSmokeAvailable',
    'project cockpit agent intent decision intake smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentIntentDecisionIntakeNoExecutionBoundary',
    'project cockpit agent intent decision intake no-execution boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentWorkerIdentitySmokeAvailable',
    'project cockpit agent worker identity smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentWorkerIdentityTeammateBoundary',
    'project cockpit agent worker identity teammate boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceRuntimeModeSmokeAvailable',
    'project cockpit agent acceptance runtime mode smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceRuntimeModeProductionBoundary',
    'project cockpit agent acceptance runtime mode production boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDesignEntrySmokeAvailable',
    'project cockpit ecommerce socks parent skill entry smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksStrategyCheckpointSmokeAvailable',
    'project cockpit ecommerce socks strategy checkpoint smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksStrategyCheckpointNoQualityClaim',
    'project cockpit ecommerce socks strategy checkpoint no-quality export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildStrategyPacketsSmokeAvailable',
    'project cockpit ecommerce socks child strategy packets smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildStrategyPacketsNoImplementation',
    'project cockpit ecommerce socks child strategy packets no-implementation export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildStrategyReviewGateSmokeAvailable',
    'project cockpit ecommerce socks child strategy review gate smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildStrategyReviewGateNoExecution',
    'project cockpit ecommerce socks child strategy review gate no-execution export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchCheckpointSmokeAvailable',
    'project cockpit ecommerce socks dispatch checkpoint smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchLifecycleSmokeAvailable',
    'project cockpit ecommerce socks dispatch lifecycle smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchOrchestrationSmokeAvailable',
    'project cockpit ecommerce socks dispatch orchestration smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchAuthorizationSmokeAvailable',
    'project cockpit ecommerce socks dispatch authorization smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildDispatchRunnerSmokeAvailable',
    'project cockpit ecommerce socks child dispatch runner smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildReportAggregationSmokeAvailable',
    'project cockpit ecommerce socks child report aggregation smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDesignNoPhotoshopToolsBoundary',
    'project cockpit ecommerce socks parent no-photoshop boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchNoChildExecutionBoundary',
    'project cockpit ecommerce socks no-child-execution boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchLifecycleBoundary',
    'project cockpit ecommerce socks dispatch lifecycle boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchOrchestrationBoundary',
    'project cockpit ecommerce socks dispatch orchestration boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksDispatchAuthorizationBoundary',
    'project cockpit ecommerce socks dispatch authorization boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildDispatchRunnerBoundary',
    'project cockpit ecommerce socks child dispatch runner boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'ecommerceSocksChildReportAggregationBoundary',
    'project cockpit ecommerce socks child report aggregation boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentObservationChannelPolicyAvailable',
    'project cockpit agent observation channel policy export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentObservationChannelPolicySmokeAvailable',
    'project cockpit agent observation channel smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentObservationChannelPolicyWiredToChatPanel',
    'project cockpit agent observation channel ChatPanel wiring export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentProviderObservationCapabilitiesAvailable',
    'project cockpit agent provider observation capability export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentProviderObservationCapabilitiesSmokeAvailable',
    'project cockpit agent provider observation capability smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentProviderObservationCapabilitiesNoFakeThinkingBoundary',
    'project cockpit agent provider observation capability no-fake-thinking boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'providerNativeToolsContractAvailable',
    'project cockpit provider-native tools contract export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'providerNativeToolsSmokeAvailable',
    'project cockpit provider-native tools smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'providerNativeToolsNoFunctionToolBoundary',
    'project cockpit provider-native tools no-function-tool boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'searxngDesignKnowledgeConnectorAvailable',
    'project cockpit SearXNG design knowledge connector export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'searxngDesignKnowledgeSmokeAvailable',
    'project cockpit SearXNG design knowledge smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'searxngDesignKnowledgeNoDockerBoundary',
    'project cockpit SearXNG no-Docker boundary export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'designKnowledgeSettingsEntryAvailable',
    'project cockpit design knowledge settings entry export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'designKnowledgeSettingsEntrySmokeAvailable',
    'project cockpit design knowledge settings smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'designKnowledgeRuntimeCapabilityAvailable',
    'project cockpit design knowledge runtime capability export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'designKnowledgeRuntimeCapabilitySmokeAvailable',
    'project cockpit design knowledge runtime capability smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'xiaomiWebSearchRuntimeSmokeAvailable',
    'project cockpit Xiaomi web search runtime smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'xiaomiWebSearchRuntimeWiringAvailable',
    'project cockpit Xiaomi web search runtime wiring export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentExecutionLifecycleAcceptanceSmokeAvailable',
    'project cockpit agent execution lifecycle acceptance smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentExecutionLifecycleAcceptanceReportAvailable',
    'project cockpit agent execution lifecycle acceptance report export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentExecutionLifecycleAcceptanceExportAvailable',
    'project cockpit agent execution lifecycle acceptance debug export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable',
    'project cockpit live Photoshop acceptance evidence intake smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceTriageSmokeAvailable',
    'project cockpit agent acceptance triage smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceTriageReportSmokeAvailable',
    'project cockpit agent acceptance triage report smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceTriageReportCommandAvailable',
    'project cockpit agent acceptance triage report command export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceVerificationMatrixSmokeAvailable',
    'project cockpit agent acceptance evidence matrix smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceVerificationMatrixCommandAvailable',
    'project cockpit agent acceptance evidence matrix command export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceExecutionSuiteCommandAvailable',
    'project cockpit agent acceptance execution suite command export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceExecutionSuiteDefaultSafeOnly',
    'project cockpit agent acceptance execution suite default-safe export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'agentAcceptanceControlPlaneSmokeAvailable',
    'project cockpit agent acceptance control plane smoke export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'imagePlacementCore',
    'project cockpit image placement core export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'readinessSmokeAvailable',
    'project cockpit image placement readiness smoke export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:design-placement:candidate-ranking',
    'change-boundaries design placement candidate ranking validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:performance-policy',
    'change-boundaries agent performance policy validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:project-visual-insight-cache',
    'change-boundaries project visual insight cache validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:project-visual-insight-cache-fill',
    'change-boundaries project visual insight cache fill validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:design-knowledge:eagle-candidate-visual-insight-request',
    'change-boundaries Eagle candidate visual insight request validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:visual-evidence-gate',
    'change-boundaries business visual evidence gate validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:visual-evidence-feedback',
    'change-boundaries business visual evidence feedback validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:chat-ui:business-visual-feedback',
    'change-boundaries business visual evidence feedback desktop validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:design-governance',
    'change-boundaries business skill design governance validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:implementation-checkpoint',
    'change-boundaries business skill implementation checkpoint validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:readiness-contract',
    'change-boundaries business skill readiness contract validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:execution-preflight-gate',
    'change-boundaries business skill execution preflight gate validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:execution-preflight-wiring',
    'change-boundaries business skill execution preflight wiring validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:memory-context',
    'change-boundaries business skill memory evidence validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:memory-strategy',
    'change-boundaries business skill memory strategy validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:preflight-planner-context',
    'change-boundaries business skill preflight planner context validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:visual-evidence-refresh-plan',
    'change-boundaries business skill visual evidence refresh plan validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:visual-evidence-refresh-runner',
    'change-boundaries business skill visual evidence refresh runner validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:execution-intake',
    'change-boundaries business skill execution intake validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:image-placement-verification-intake',
    'change-boundaries business skill image placement verification intake validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:business-skill:execution-plan-intake',
    'change-boundaries business skill execution plan intake validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:live-photoshop:acceptance-evidence-intake',
    'change-boundaries live Photoshop acceptance evidence intake validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:acceptance-verification-matrix',
    'change-boundaries agent acceptance evidence matrix validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:acceptance-execution-suite',
    'change-boundaries agent acceptance execution suite smoke validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'maintenance:acceptance-suite',
    'change-boundaries agent acceptance execution suite command validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:agent:acceptance-control-plane',
    'change-boundaries agent acceptance control plane validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:image-placement:core',
    'change-boundaries image placement core validation export'
  );
  assertIncludes(
    run('node', ['scripts/report-change-boundaries.cjs', '--validation', 'agent-routing-models'], { cwd: agentRoot, capture: true }),
    'smoke:image-placement:readiness',
    'change-boundaries image placement readiness validation export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'smoke:project-asset-index',
    'agent architecture project asset index validation export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'smoke:project-visual-insight-cache',
    'agent architecture project visual insight cache validation export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'visualInsightCacheFillSmokeAvailable',
    'agent architecture project visual insight cache fill export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessVisualContextSmokeAvailable',
    'agent architecture business visual context export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessVisualObservationFeedbackSmokeAvailable',
    'agent architecture business visual evidence feedback export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessVisualObservationFeedbackDesktopSmokeAvailable',
    'agent architecture business visual evidence feedback desktop smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillDesignGovernanceSmokeAvailable',
    'agent architecture business skill design governance smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillImplementationCheckpointSmokeAvailable',
    'agent architecture business skill implementation checkpoint smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillReadinessContractSmokeAvailable',
    'agent architecture business skill readiness contract smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillReadinessContractNoQualityClaim',
    'agent architecture business skill readiness contract no-quality-claim export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillExecutionPreflightGateSmokeAvailable',
    'agent architecture business skill execution preflight gate smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillExecutionPreflightWiringSmokeAvailable',
    'agent architecture business skill execution preflight wiring smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillPreflightPlannerEvidenceSmokeAvailable',
    'agent architecture business skill preflight planner evidence smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillVisualObservationRefreshPlanSmokeAvailable',
    'agent architecture business skill visual evidence refresh plan smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillVisualObservationRefreshPlanDefaultDisabled',
    'agent architecture business skill visual evidence refresh plan default disabled export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillVisualObservationRefreshRunnerSmokeAvailable',
    'agent architecture business skill visual evidence refresh runner smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillVisualObservationRefreshRunnerPostExecutor',
    'agent architecture business skill visual evidence refresh runner post-executor export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillVisualObservationRefreshRuntimeSmokeAvailable',
    'agent architecture business skill visual evidence refresh runtime smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillVisualObservationRefreshExecutorWiringSmokeAvailable',
    'agent architecture business skill visual evidence refresh executor wiring smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillExecutionIntakeSmokeAvailable',
    'agent architecture business skill execution intake smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillImagePlacementVerificationIntakeSmokeAvailable',
    'agent architecture business skill image placement verification intake smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'businessSkillExecutionPlanIntakeSmokeAvailable',
    'agent architecture business skill execution plan intake smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceDiagnosticExportSmokeAvailable',
    'agent architecture acceptance diagnostic export smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceBusinessSkillVerificationSmokeAvailable',
    'agent architecture acceptance business skill evidence smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentIntentDecisionIntakeSmokeAvailable',
    'agent architecture agent intent decision intake smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentIntentDecisionIntakeNoExecutionBoundary',
    'agent architecture agent intent decision intake no-execution boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentWorkerIdentitySmokeAvailable',
    'agent architecture agent worker identity smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentWorkerIdentityTeammateBoundary',
    'agent architecture agent worker identity teammate boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceRuntimeModeSmokeAvailable',
    'agent architecture agent acceptance runtime mode smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceRuntimeModeProductionBoundary',
    'agent architecture agent acceptance runtime mode production boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDesignEntrySmokeAvailable',
    'agent architecture ecommerce socks parent skill entry smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksStrategyCheckpointSmokeAvailable',
    'agent architecture ecommerce socks strategy checkpoint smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildStrategyPacketsSmokeAvailable',
    'agent architecture ecommerce socks child strategy packets smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildStrategyPacketsNoImplementation',
    'agent architecture ecommerce socks child strategy packets no-implementation export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildStrategyReviewGateSmokeAvailable',
    'agent architecture ecommerce socks child strategy review gate smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildStrategyReviewGateNoExecution',
    'agent architecture ecommerce socks child strategy review gate no-execution export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksStrategyCheckpointNoQualityClaim',
    'agent architecture ecommerce socks strategy checkpoint no-quality export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchCheckpointSmokeAvailable',
    'agent architecture ecommerce socks dispatch checkpoint smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchLifecycleSmokeAvailable',
    'agent architecture ecommerce socks dispatch lifecycle smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchOrchestrationSmokeAvailable',
    'agent architecture ecommerce socks dispatch orchestration smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchAuthorizationSmokeAvailable',
    'agent architecture ecommerce socks dispatch authorization smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildDispatchRunnerSmokeAvailable',
    'agent architecture ecommerce socks child dispatch runner smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildReportAggregationSmokeAvailable',
    'agent architecture ecommerce socks child report aggregation smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDesignNoPhotoshopToolsBoundary',
    'agent architecture ecommerce socks parent no-photoshop boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchNoChildExecutionBoundary',
    'agent architecture ecommerce socks no-child-execution boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchLifecycleBoundary',
    'agent architecture ecommerce socks dispatch lifecycle boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchOrchestrationBoundary',
    'agent architecture ecommerce socks dispatch orchestration boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksDispatchAuthorizationBoundary',
    'agent architecture ecommerce socks dispatch authorization boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildDispatchRunnerBoundary',
    'agent architecture ecommerce socks child dispatch runner boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'ecommerceSocksChildReportAggregationBoundary',
    'agent architecture ecommerce socks child report aggregation boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentObservationChannelPolicyAvailable',
    'agent architecture agent observation channel policy export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentObservationChannelPolicySmokeAvailable',
    'agent architecture agent observation channel smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentObservationChannelPolicyWiredToChatPanel',
    'agent architecture agent observation channel ChatPanel wiring export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentProviderObservationCapabilitiesAvailable',
    'agent architecture agent provider observation capability export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentProviderObservationCapabilitiesSmokeAvailable',
    'agent architecture agent provider observation capability smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentProviderObservationCapabilitiesNoFakeThinkingBoundary',
    'agent architecture agent provider observation capability no-fake-thinking boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'providerNativeToolsContractAvailable',
    'agent architecture provider-native tools contract export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'providerNativeToolsSmokeAvailable',
    'agent architecture provider-native tools smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'providerNativeToolsNoFunctionToolBoundary',
    'agent architecture provider-native tools no-function-tool boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'searxngDesignKnowledgeConnectorAvailable',
    'agent architecture SearXNG design knowledge connector export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'searxngDesignKnowledgeSmokeAvailable',
    'agent architecture SearXNG design knowledge smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'searxngDesignKnowledgeNoDockerBoundary',
    'agent architecture SearXNG no-Docker boundary export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'designKnowledgeSettingsEntryAvailable',
    'agent architecture design knowledge settings entry export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'designKnowledgeSettingsEntrySmokeAvailable',
    'agent architecture design knowledge settings smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'designKnowledgeRuntimeCapabilityAvailable',
    'agent architecture design knowledge runtime capability export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'designKnowledgeRuntimeCapabilitySmokeAvailable',
    'agent architecture design knowledge runtime capability smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'xiaomiWebSearchRuntimeSmokeAvailable',
    'agent architecture Xiaomi web search runtime smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'xiaomiWebSearchRuntimeWiringAvailable',
    'agent architecture Xiaomi web search runtime wiring export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentExecutionLifecycleAcceptanceSmokeAvailable',
    'agent architecture agent execution lifecycle acceptance smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentExecutionLifecycleAcceptanceReportAvailable',
    'agent architecture agent execution lifecycle acceptance report export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentExecutionLifecycleAcceptanceExportAvailable',
    'agent architecture agent execution lifecycle acceptance debug export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'livePhotoshopAcceptanceEvidenceIntakeSmokeAvailable',
    'agent architecture live Photoshop acceptance evidence intake smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceTriageSmokeAvailable',
    'agent architecture acceptance triage smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceTriageReportSmokeAvailable',
    'agent architecture acceptance triage report smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceTriageReportCommandAvailable',
    'agent architecture acceptance triage report command export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceVerificationMatrixSmokeAvailable',
    'agent architecture acceptance evidence matrix smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceVerificationMatrixCommandAvailable',
    'agent architecture acceptance evidence matrix command export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceExecutionSuiteCommandAvailable',
    'agent architecture acceptance execution suite command export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceExecutionSuiteDefaultSafeOnly',
    'agent architecture acceptance execution suite default-safe export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'agentAcceptanceControlPlaneSmokeAvailable',
    'agent architecture acceptance control plane smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'imagePlacementCore',
    'agent architecture image placement core export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'readinessSmokeAvailable',
    'agent architecture image placement readiness smoke export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'smoke:reference:live-readiness',
    'agent architecture reference live readiness validation export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'mainImageAgentDraft',
    'agent architecture main image agent draft export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'smoke:design-planner:preflight-control',
    'agent architecture planner preflight control validation export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'assetSelectionHelperAvailable',
    'agent architecture main image asset selection export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'visualLoopHelperAvailable',
    'agent architecture main image visual loop export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'visionPreflightHelperAvailable',
    'agent architecture main image vision preflight export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'candidatePreflightSmokeAvailable',
    'agent architecture main image candidate preflight export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'executionAlignmentSmokeAvailable',
    'agent architecture main image execution alignment export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'screenshotQaSmokeAvailable',
    'agent architecture main image screenshot QA export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'screenshotProbeReadinessSmokeAvailable',
    'agent architecture main image screenshot probe readiness export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'qaReportSmokeAvailable',
    'agent architecture main image QA report export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'strategyContractSmokeAvailable',
    'agent architecture main image strategy contract export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'strategyInputBuilderSmokeAvailable',
    'agent architecture main image strategy input builder export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'assetHeroStrategySmokeAvailable',
    'agent architecture main image asset hero strategy export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'strategyContractNoExecution',
    'agent architecture main image strategy no-execution export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'strategyInputBuilderNoExecution',
    'agent architecture main image strategy input builder no-execution export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'assetHeroStrategyNoExecution',
    'agent architecture main image asset hero strategy no-execution export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'strategyInputBuilderUsesAssetHeroStrategy',
    'agent architecture main image strategy input builder uses asset hero strategy export'
  );
  assertIncludes(
    run('node', ['scripts/report-main-image-screenshot-probe-readiness.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'executorProbesResultFiles',
    'main image screenshot probe readiness report export'
  );
  assertIncludes(
    run('node', ['scripts/report-main-image-screenshot-probe-readiness.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'resourceCompareImageFilesAvailable',
    'main image pixel probe adapter report export'
  );
  assertIncludes(
    run('node', ['scripts/report-main-image-screenshot-probe-readiness.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'qaReportSmokeAvailable',
    'main image QA report readiness export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'mainImageAgentDraft',
    'project cockpit main image agent draft export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'assetSelectionHelperAvailable',
    'project cockpit main image asset selection export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'visualLoopHelperAvailable',
    'project cockpit main image visual loop export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'visionPreflightHelperAvailable',
    'project cockpit main image vision preflight export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'candidatePreflightSmokeAvailable',
    'project cockpit main image candidate preflight export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'executionAlignmentSmokeAvailable',
    'project cockpit main image execution alignment export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'screenshotQaSmokeAvailable',
    'project cockpit main image screenshot QA export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'screenshotProbeReadinessSmokeAvailable',
    'project cockpit main image screenshot probe readiness export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'qaReportSmokeAvailable',
    'project cockpit main image QA report export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'strategyContractSmokeAvailable',
    'project cockpit main image strategy contract export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'strategyInputBuilderSmokeAvailable',
    'project cockpit main image strategy input builder export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'assetHeroStrategySmokeAvailable',
    'project cockpit main image asset hero strategy export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'strategyContractNoExecution',
    'project cockpit main image strategy no-execution export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'strategyInputBuilderNoExecution',
    'project cockpit main image strategy input builder no-execution export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'assetHeroStrategyNoExecution',
    'project cockpit main image asset hero strategy no-execution export'
  );
  assertIncludes(
    readProjectCockpitJson(agentRoot),
    'strategyInputBuilderUsesAssetHeroStrategy',
    'project cockpit main image strategy input builder uses asset hero strategy export'
  );
  assertIncludes(
    readAgentArchitectureJson(agentRoot),
    'validateEvidenceInResume',
    'agent architecture reference status validate-evidence resume export'
  );
  assertIncludes(
    run('node', ['scripts/report-agent-capability-map.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'inventory-not-control-plane',
    'agent capability map json export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-readiness.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'suiteReadyForQualityClaim',
    'reference replication readiness json export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-readiness.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'hasResultScreenshotBlocker',
    'reference readiness quality gate result screenshot blocker export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-readiness.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'hasManualReviewBlocker',
    'reference readiness quality gate manual review blocker export'
  );
  assertIncludes(
    run('node', ['scripts/report-reference-replication-readiness.cjs', '--json'], { cwd: agentRoot, capture: true }),
    'qualityGateConsistency',
    'reference readiness quality gate consistency export'
  );
  run('node', ['scripts/smoke-reference-quality-gate-consistency.cjs'], { cwd: agentRoot });

  run('git', [
    'diff',
    '--check',
    '--',
    '.gitignore',
    '.gitattributes',
    'DesignEcho-Agent/package.json',
    'DesignEcho-Agent/scripts/report-repo-hygiene.cjs',
    'DesignEcho-Agent/scripts/report-change-boundaries.cjs',
    'DesignEcho-Agent/scripts/report-project-cockpit.cjs',
    'DesignEcho-Agent/scripts/report-project-cleanup-candidates.cjs',
    'DesignEcho-Agent/scripts/report-agent-architecture.cjs',
    'DesignEcho-Agent/scripts/report-image-placement-core-readiness.cjs',
    'DesignEcho-Agent/scripts/report-main-image-screenshot-probe-readiness.cjs',
    'DesignEcho-Agent/scripts/report-agent-capability-map.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-planning-contract.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-user-visible-state.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-thinking-tool-boundary.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-performance-policy.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-preflight-planner-context.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-visual-evidence-refresh-plan.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-visual-evidence-refresh-runner.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-visual-evidence-refresh-runtime.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-visual-evidence-pre-execution-gate.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-visual-evidence-refresh-executor-wiring.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-memory-context.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-memory-strategy.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-experience.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-memory-review.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-memory-review-queue.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-review-settings-entry.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-runtime-settings-entry.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-memory-persistence.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-cadence-scheduler.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-runtime-trigger.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-runtime-trigger-service.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-runtime-entry-service.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-runtime-runner.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-eagle-runtime-provider.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-reference-analyzer.cjs',
    'DesignEcho-Agent/scripts/smoke-design-learning-runtime-orchestrator-service.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-readiness-contract.cjs',
    'DesignEcho-Agent/scripts/smoke-ecommerce-socks-design-strategy-checkpoint.cjs',
    'DesignEcho-Agent/scripts/smoke-ecommerce-socks-design-child-strategy-packets.cjs',
    'DesignEcho-Agent/scripts/smoke-ecommerce-socks-design-child-strategy-review-gate.cjs',
    'DesignEcho-Agent/scripts/smoke-ecommerce-socks-design-child-strategy-handoff.cjs',
    'DesignEcho-Agent/scripts/smoke-ecommerce-socks-design-child-strategy-consumption.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-execution-intake.cjs',
    'DesignEcho-Agent/scripts/smoke-business-skill-visual-evidence-diagnostic.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-acceptance-diagnostic-control.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-acceptance-diagnostic-export.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-acceptance-business-skill-verification.cjs',
    'DesignEcho-Agent/scripts/smoke-live-photoshop-acceptance-intake.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-acceptance-triage.cjs',
    'DesignEcho-Agent/scripts/report-agent-acceptance-triage.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-acceptance-triage-report.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-acceptance-verification-matrix.cjs',
    'DesignEcho-Agent/scripts/report-agent-acceptance-verification-matrix.cjs',
    'DesignEcho-Agent/scripts/smoke-agent-acceptance-execution-suite.cjs',
    'DesignEcho-Agent/scripts/run-agent-acceptance-suite.cjs',
    'DesignEcho-Agent/src/shared/agent-acceptance-export.ts',
    'DesignEcho-Agent/src/shared/agent-acceptance-triage.ts',
    'DesignEcho-Agent/src/shared/agent-acceptance-triage-report.ts',
    'DesignEcho-Agent/src/shared/agent-acceptance-verification-matrix.ts',
    'DesignEcho-Agent/src/shared/live-photoshop-acceptance-intake.ts',
    'DesignEcho-Agent/src/shared/agent-acceptance-execution-suite.ts',
    'DesignEcho-Agent/scripts/smoke-design-agent-os-contracts.cjs',
    'DesignEcho-Agent/scripts/smoke-image-placement-core.cjs',
    'DesignEcho-Agent/scripts/smoke-image-placement-readiness.cjs',
    'DesignEcho-Agent/scripts/smoke-project-asset-index.cjs',
    'DesignEcho-Agent/scripts/smoke-project-visual-insight-cache-fill.cjs',
    'DesignEcho-Agent/scripts/smoke-eagle-candidate-visual-insight-request.cjs',
    'DesignEcho-Agent/scripts/report-reference-replication-readiness.cjs',
    'DesignEcho-Agent/scripts/record-reference-replication-result.cjs',
    'DesignEcho-Agent/scripts/plan-reference-replication-capture.cjs',
    'DesignEcho-Agent/scripts/evaluate-reference-replication-result.cjs',
    'DesignEcho-Agent/scripts/validate-reference-result-evidence.cjs',
    'DesignEcho-Agent/scripts/report-reference-evidence-pipeline.cjs',
    'DesignEcho-Agent/scripts/plan-reference-real-case-intake.cjs',
    'DesignEcho-Agent/scripts/check-reference-quality-claim-gate.cjs',
    'DesignEcho-Agent/scripts/report-reference-replication-status.cjs',
    'DesignEcho-Agent/scripts/lib/reference-source-kinds.cjs',
    'DesignEcho-Agent/scripts/check-planning-alignment.cjs',
    'DesignEcho-Agent/scripts/validate-maintenance-hygiene.cjs',
    'DesignEcho-UXP/scripts/smoke-image-generation-error-helpers.cjs',
    'DesignEcho-UXP/scripts/smoke-image-generation-options.cjs',
    'DesignEcho-UXP/scripts/smoke-image-to-image-selection.cjs',
    'DesignEcho-UXP/scripts/smoke-template-library-core.cjs',
    'DesignEcho-UXP/scripts/smoke-webview-panel-layout.cjs',
    'DesignEcho-UXP/scripts/smoke-webview-message-core.cjs',
    'DesignEcho-UXP/scripts/smoke-sku-auto-layout-plan.cjs',
    'DesignEcho-UXP/scripts/smoke-sku-auto-layout-post-qa.cjs',
    'DesignEcho-UXP/scripts/smoke-sku-layout-auto-planner-integration.cjs',
    'DesignEcho-UXP/scripts/smoke-main-image-white-bg-from-sku-tool.cjs',
    'DesignEcho-UXP/src/core/image-generation-errors.ts',
    'DesignEcho-UXP/src/core/image-generation-options.ts',
    'DesignEcho-UXP/src/core/image-to-image-selection.ts',
    'DesignEcho-UXP/src/core/image-generation-stage-labels.ts',
    'DesignEcho-UXP/src/core/template-library-core.ts',
    'DesignEcho-UXP/src/core/webview-panel-layout.ts',
    'DesignEcho-UXP/src/core/webview-message-core.ts',
    'DesignEcho-UXP/src/core/base64.ts',
    'DesignEcho-UXP/src/core/canvas-refresh.ts',
    'DesignEcho-UXP/src/core/friendly-progress.ts',
    'DesignEcho-UXP/src/tools/sku/sku-auto-layout-plan.ts',
    'DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts',
    'DesignEcho-UXP/src/tools/image/white-bg-from-sku-material.ts',
    'DesignEcho-Agent/scripts/smoke-photoshop-acceptance-live.cjs',
    'DesignEcho-Agent/scripts/smoke-photoshop-acceptance-write-live.cjs',
    'DesignEcho-Agent/scripts/smoke-photoshop-mcp-conditional.cjs',
    'DesignEcho-Agent/scripts/smoke-acceptance-snapshot-diff.cjs',
    'DesignEcho-Agent/scripts/smoke-acceptance-tool-evidence.cjs',
    'DesignEcho-Agent/scripts/smoke-photoshop-tool-semantics.cjs',
    'DesignEcho-Agent/scripts/smoke-photoshop-text-tool-benchmarks.cjs',
    'DesignEcho-Agent/scripts/smoke-photoshop-text-tools-live.cjs',
    'DesignEcho-Agent/scripts/smoke-text-optimization-contract.cjs',
    'DesignEcho-Agent/scripts/smoke-debug-bridge-redaction.cjs',
    'DesignEcho-Agent/scripts/smoke-tool-result-redaction.cjs',
    'DesignEcho-Agent/scripts/smoke-chat-ui-execution-chain.cjs',
    'DesignEcho-Agent/scripts/smoke-chat-ui-electron-bridge.cjs',
    'DesignEcho-Agent/scripts/smoke-ui-workbench-information-architecture.cjs',
    'DesignEcho-Agent/scripts/smoke-ui-agent-process-inspector.cjs',
    'DesignEcho-Agent/scripts/smoke-ui-human-review-intake.cjs',
    'DesignEcho-Agent/scripts/smoke-human-review-record-persistence.cjs',
    'DesignEcho-Agent/scripts/smoke-ui-asset-gallery-polish.cjs',
    'DesignEcho-Agent/scripts/smoke-ui-eagle-asset-candidates.cjs',
    'DesignEcho-Agent/scripts/smoke-ui-design-result-review-panel.cjs',
    'DesignEcho-Agent/src/renderer/components/EagleAssetCandidatesPanel.tsx',
    'DesignEcho-Agent/src/renderer/components/DesignLearningReviewSettingsPanel.tsx',
    'DesignEcho-Agent/src/renderer/components/DesignLearningRuntimeSettingsPanel.tsx',
    'DesignEcho-Agent/src/renderer/components/DesignAgentWorkbench.tsx',
    'DesignEcho-Agent/src/renderer/components/DesignAgentWorkbench.css',
    'DesignEcho-Agent/src/renderer/components/WorkflowBoard.tsx',
    'DesignEcho-Agent/src/renderer/components/WorkflowBoard.css',
    'DesignEcho-Agent/src/renderer/components/WorkflowCanvasNodePreview.tsx',
    'DesignEcho-Agent/src/renderer/components/workflow-graph-persistence.ts',
    'DesignEcho-Agent/src/renderer/components/ProjectManager.tsx',
    'DesignEcho-Agent/src/renderer/components/ProjectManager.css',
    'DesignEcho-Agent/src/renderer/components/WorkspaceTabBar.tsx',
    'DesignEcho-Agent/src/renderer/components/WorkspaceTabBar.css',
    'DesignEcho-Agent/src/renderer/components/ThinkingModeControl.tsx',
    'DesignEcho-Agent/src/renderer/components/ThinkingModeControl.css',
    'DesignEcho-Agent/src/renderer/components/AssetGallery.tsx',
    'DesignEcho-Agent/src/renderer/components/asset-gallery-view-model.ts',
    'DesignEcho-Agent/src/renderer/services/eagle-asset-candidates.service.ts',
    'DesignEcho-Agent/src/shared/agent-process-inspector.ts',
    'DesignEcho-Agent/src/shared/design-result-review-panel.ts',
    'DesignEcho-Agent/src/shared/eagle-asset-candidates-panel.ts',
    'DesignEcho-Agent/src/shared/eagle-candidate-visual-handoff.ts',
    'DesignEcho-Agent/src/shared/human-review-intake.ts',
    'DesignEcho-Agent/src/shared/human-review-record.ts',
    'DesignEcho-Agent/scripts/smoke-agent-runtime-guard.cjs',
    'DesignEcho-Agent/scripts/smoke-design-team-coordinator.cjs',
    'DesignEcho-Agent/scripts/smoke-model-provider-deepseek.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-asset-selection.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-visual-loop.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-vision-preflight.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-candidate-preflight.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-execution-alignment.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-screenshot-qa.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-screenshot-probe-readiness.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-pixel-probe-adapter.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-qa-report.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-agent-draft-plan.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-strategy-contract.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-strategy-input-builder.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-white-bg-sku-material-contract.cjs',
    'DesignEcho-Agent/scripts/smoke-design-placement-candidate-ranking.cjs',
    'DesignEcho-Agent/scripts/smoke-detail-page-dpi-readonly-evidence.cjs',
    'DesignEcho-Agent/scripts/smoke-sku-dpi-readonly-evidence.cjs',
    'DesignEcho-Agent/scripts/smoke-sku-configured-execution-plan.cjs',
    'DesignEcho-Agent/scripts/smoke-sku-export-readback.cjs',
    'DesignEcho-Agent/scripts/smoke-sku-visual-review-intake.cjs',
    'DesignEcho-Agent/scripts/smoke-sku-color-card-retouch-strategy.cjs',
    'DesignEcho-Agent/scripts/smoke-sku-color-card-image-probes.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-asset-hero-strategy.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-project-style-strategy.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-design-standards.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-design-readiness-report.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-live-executor-request.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-live-executor-checkpoint.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-live-executor-runner.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-live-photoshop-adapter-contract.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-variant-placement-strategy.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-production-structure.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-production-execution-plan.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-production-executor-handoff.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-production-executor-bridge.cjs',
    'DesignEcho-Agent/scripts/smoke-main-image-production-executor-dry-run.cjs',
    'DesignEcho-Agent/src/shared/main-image-asset-selection.ts',
    'DesignEcho-Agent/src/shared/main-image-asset-hero-strategy.ts',
    'DesignEcho-Agent/src/shared/main-image-visual-loop.ts',
    'DesignEcho-Agent/src/shared/main-image-vision-preflight.ts',
    'DesignEcho-Agent/src/shared/main-image-execution-alignment.ts',
    'DesignEcho-Agent/src/shared/main-image-screenshot-qa.ts',
    'DesignEcho-Agent/src/shared/main-image-screenshot-probe-readiness.ts',
    'DesignEcho-Agent/src/shared/main-image-qa-report.ts',
    'DesignEcho-Agent/src/shared/main-image-agent-draft-plan.ts',
    'DesignEcho-Agent/src/shared/main-image-strategy-contract.ts',
    'DesignEcho-Agent/src/shared/main-image-strategy-input-builder.ts',
    'DesignEcho-Agent/src/shared/main-image-white-background-export-contract.ts',
    'DesignEcho-Agent/src/shared/main-image-project-style-strategy.ts',
    'DesignEcho-Agent/src/shared/main-image-design-standards.ts',
    'DesignEcho-Agent/src/shared/main-image-design-readiness-report.ts',
    'DesignEcho-Agent/src/shared/main-image-live-executor-request.ts',
    'DesignEcho-Agent/src/shared/main-image-live-executor-checkpoint.ts',
    'DesignEcho-Agent/src/shared/main-image-live-executor-runner.ts',
    'DesignEcho-Agent/src/shared/main-image-live-photoshop-adapter-contract.ts',
    'DesignEcho-Agent/src/shared/main-image-variant-placement-strategy.ts',
    'DesignEcho-Agent/src/shared/main-image-production-document-structure.ts',
    'DesignEcho-Agent/src/shared/main-image-production-execution-plan.ts',
    'DesignEcho-Agent/src/shared/main-image-production-executor-handoff.ts',
    'DesignEcho-Agent/src/shared/main-image-production-executor-bridge.ts',
    'DesignEcho-Agent/src/shared/main-image-production-executor-dry-run.ts',
    'DesignEcho-Agent/src/shared/project-asset-index.ts',
    'DesignEcho-Agent/src/shared/design-image-placement-core.ts',
    'DesignEcho-Agent/src/shared/project-visual-insight-cache-fill.ts',
    'DesignEcho-Agent/src/shared/eagle-candidate-visual-insight-request.ts',
    'DesignEcho-Agent/src/shared/agent-task-planning-contract.ts',
    'DesignEcho-Agent/src/shared/agent-user-visible-state.ts',
    'DesignEcho-Agent/src/shared/agent-performance-policy.ts',
    'DesignEcho-Agent/src/shared/business-skill-preflight-planner-context.ts',
    'DesignEcho-Agent/src/shared/business-skill-visual-observation-refresh-plan.ts',
    'DesignEcho-Agent/src/shared/business-skill-visual-context-preparation.ts',
    'DesignEcho-Agent/src/shared/business-skill-memory-strategy.ts',
    'DesignEcho-Agent/src/shared/business-skill-readiness-contract.ts',
    'DesignEcho-Agent/src/shared/ecommerce-socks-strategy-checkpoint.ts',
    'DesignEcho-Agent/src/shared/ecommerce-socks-child-strategy-packets.ts',
    'DesignEcho-Agent/src/shared/ecommerce-socks-child-strategy-review-gate.ts',
    'DesignEcho-Agent/src/shared/ecommerce-socks-child-strategy-handoff.ts',
    'DesignEcho-Agent/src/shared/ecommerce-socks-child-strategy-consumer.ts',
    'DesignEcho-Agent/src/shared/business-skill-execution-intake.ts',
    'DesignEcho-Agent/src/shared/agent-diagnostic-record.ts',
    'DesignEcho-Agent/src/shared/agent-acceptance-contracts.ts',
    'DesignEcho-Agent/src/shared/design-planner.ts',
    'DesignEcho-Agent/src/shared/eagle-writeback-gate.ts',
    'DesignEcho-Agent/src/renderer/services/project-visual-insight-cache-fill.ts',
    'DesignEcho-Agent/src/main/services/resource-manager-service.ts',
    'DesignEcho-Agent/src/main/ipc-handlers/resource-handlers.ts',
    'DesignEcho-Agent/src/main/preload.ts',
    'DesignEcho-Agent/src/renderer/types.d.ts',
    'DesignEcho-Agent/src/renderer/services/skill-executors/business-skill-visual-context.ts',
    'DesignEcho-Agent/src/renderer/services/skill-executors/business-skill-visual-observation-runtime.ts',
    'DesignEcho-Agent/src/renderer/services/skill-executors/design-planner-context.ts',
    'DesignEcho-Agent/src/renderer/services/skill-executors/main-image.executor.ts',
    'DesignEcho-Agent/src/renderer/services/skill-executors/detail-page.executor.ts',
    'DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts',
    'DesignEcho-Agent/src/shared/sku-configured-execution-plan.ts',
    'DesignEcho-Agent/src/shared/sku-export-readback.ts',
    'DesignEcho-Agent/src/shared/sku-visual-review-intake.ts',
    'DesignEcho-Agent/src/shared/sku-color-card-retouch-strategy.ts',
    'DesignEcho-Agent/src/shared/sku-color-card-image-probes.ts',
    'DesignEcho-Agent/scripts/smoke-eagle-writeback-gate.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-blueprint-groups.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-match-validation.cjs',
    'DesignEcho-Agent/scripts/smoke-layout-replication-text-placement.cjs',
    'DesignEcho-Agent/scripts/smoke-layout-replication-canvas-policy.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-overlay-live.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-overlay-live-contract.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-fex-text-layout-case.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-fex-text-placement-live.cjs',
    'DesignEcho-Agent/scripts/validate-reference-replication-benchmarks.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-benchmark-validator.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-benchmark-scope.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-benchmark-coverage.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-readiness-report.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-record-result.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-capture-plan.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-live-capture-guard.cjs',
    'DesignEcho-Agent/scripts/report-reference-live-capture-readiness.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-live-capture-readiness.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-result-evidence.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-result-evidence-validator.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-evidence-pipeline.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-real-case-intake.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-quality-claim-gate.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-quality-gate-consistency.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-replication-status.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-neutral-text-layout-case.cjs',
    'DesignEcho-Agent/scripts/smoke-reference-neutral-text-pixel-bounds.cjs',
    'DesignEcho-Agent/scripts/smoke-chat-ui-reference-replication-neutral.cjs',
    'DesignEcho-Agent/scripts/smoke-chat-ui-reference-replication-live.cjs',
    'DesignEcho-Agent/scripts/lib/reference-benchmark-categories.cjs',
    'DesignEcho-Agent/benchmarks/reference-replication/case-template.json',
    'DesignEcho-Agent/benchmarks/reference-replication/cases.manifest.json',
    'DesignEcho-Agent/benchmarks/reference-replication/cases/rr-001-fex-certificate-text-layout.json',
    'DesignEcho-Agent/benchmarks/photoshop-tool-semantics/text-tool-cases.json',
    'DesignEcho-Agent/docs/repository-maintenance-hygiene.md',
    'DesignEcho-Agent/docs/repository-change-boundary-report.md',
    'DesignEcho-Agent/docs/project-sustainability-cockpit.md',
    'DesignEcho-Agent/docs/project-master-plan.md',
    'DesignEcho-Agent/docs/agent-capability-map.md',
    'DesignEcho-Agent/docs/agent-development-methodology.md',
    'DesignEcho-Agent/docs/image-placement-core-mvp.md',
    'DesignEcho-Agent/project-memory/README.md',
    'DesignEcho-Agent/project-memory/Prompt.md',
    'DesignEcho-Agent/project-memory/CurrentTask.md',
    'DesignEcho-Agent/project-memory/Intake.md',
    'DesignEcho-Agent/project-memory/Plan.md',
    'DesignEcho-Agent/project-memory/Implement.md',
    'DesignEcho-Agent/project-memory/Backlog.md',
    'DesignEcho-Agent/project-memory/Status.md',
    'DesignEcho-Agent/project-memory/Risks.md',
    'DesignEcho-Agent/project-memory/Decisions.md',
    'DesignEcho-Agent/project-memory/project-state.json'
  ], { cwd: root });

  assertNoMojibake(root);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'package.json parses, package script targets exist, npm run references exist, and project-state.json has required shape',
      'maintenance scripts pass node --check',
      'repo hygiene check passes',
      'change boundary report passes without uncategorized groups',
      'change boundary focused entries, paths, and validation exports pass',
      'project cockpit and agent architecture json exports pass',
      'planning alignment check passes',
      'retired architecture drafts and duplicate project-memory archives stay absent',
      'git diff --check passes for maintenance files',
      'mojibake scan passes for source, scripts, docs, UXP source, and project-memory files'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
