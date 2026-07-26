#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const VALID_TIERS = new Set([
  "agent-fast",
  "fast",
  "build",
  "live-preflight",
  "ui",
  "ui-running-window",
  "risk",
  "full"
]);
const VALID_GROUPS = new Set(["agent", "sku", "ui", "uxp", "learning"]);

const AGENT_FAST_COMMANDS = [
  "npm run maintenance:planning-check",
  "npm run maintenance:change-boundaries -- --summary",
  "npm run audit:tools",
  "npm run audit:executor-generic",
  "npm run audit:simplification-ratchet",
  "npm run audit:agent-business-boundaries",
  "npm run audit:skill-coupling",
  "npm run audit:capability-resolver",
  "npm run audit:skill-package-contract",
  "npm run audit:prompt-capability-governance",
  "npm run audit:artifact-alias-governance -- --source-only",
  "npm run smoke:agent:artifact-repository",
  "npm run smoke:agent:artifact-publication-policy",
  "npm run smoke:design-project-state",
  "npm run smoke:v5:runtime-contract-bundle",
  "npm run smoke:v5:tool-capability-bridge",
  "npm run smoke:v5:visual-observation",
  "npm run smoke:v5:visual-observation-gate",
  "npm run smoke:v5:visual-observation-card",
  "npm run smoke:visual-observation-strategy",
  "npm run smoke:design-intelligence:plan",
  "npm run smoke:project-visual-insight-cache",
  "npm run smoke:design-placement:intelligence",
  "npm run smoke:agent:capability-resolver",
  "npm run smoke:agent:capability-reference-resolution",
  "npm run smoke:agent:performance-policy",
  "npm run smoke:agent:performance-budget-enforcement",
  "npm run smoke:detail-page:document-preflight-routing",
  "npm run smoke:agent:evaluation-profiles",
  "npm run smoke:agent:evaluation-result-adapters",
  "npm run smoke:agent:scoped-change-records",
  "npm run smoke:detail-page:content-verification",
  "npm run smoke:design-project-fact-provenance",
  "npm run smoke:design-project-rule-governance",
  "npm run smoke:design-knowledge-governance",
  "npm run smoke:design-knowledge:disposition-lifecycle",
  "npm run smoke:sku:human-review-writeback",
  "npm run smoke:agent:capability-metadata",
  "npm run smoke:agent:capability-provider-probe",
  "npm run smoke:agent:no-redo-provider-probe",
  "npm run smoke:agent:model-transport-protocol",
  "npm run smoke:agent:hitl-continuation",
  "npm run smoke:agent:interactive-continuation-ledger",
  "npm run smoke:agent:interactive-card-confirmation-gate",
  "npm run smoke:agent:runtime-stage-state",
  "npm run smoke:agent:runtime-stage-trace",
  "npm run smoke:agent:runtime-session",
  "npm run smoke:agent:runtime-task-snapshot",
  "npm run smoke:agent:task-plan-presentation",
  "npm run smoke:agent:runtime-delivery-receipt",
  "npm run smoke:agent:runtime-planning-context",
  "npm run smoke:agent:runtime-reference-context",
  "npm run smoke:agent:runtime-context-compiler",
  "npm run smoke:agent:operating-context-snapshot",
  "npm run smoke:agent:knowledge-selection-context",
  "npm run smoke:agent:design-method-knowledge",
  "npm run smoke:agent:runtime-accounting",
  "npm run smoke:agent:reflexion-reentry-loop",
  "npm run smoke:agent:runtime-design-brief",
  "npm run smoke:agent:runtime-design-brief-skill-consumer",
  "npm run smoke:agent:business-skill-live-e2e-readiness",
  "npm run smoke:agent:business-skill-system-path",
  "npm run smoke:agent:runtime-selected-skill-handoff",
  "npm run smoke:agent:runtime-harness-control-repair",
  "npm run smoke:agent:runtime-stage-tool-visibility",
  "npm run smoke:agent:runtime-from-scratch-document-gate",
  "npm run smoke:agent:docstate-recovery",
  "npm run smoke:agent:r3-needs-input-recovery",
  "npm run smoke:project-product-understanding",
  "npm run smoke:agent:runtime-design-strategy",
  "npm run smoke:agent:runtime-action-plan",
  "npm run smoke:agent:runtime-action-plan-reconciliation",
  "npm run smoke:agent:runtime-action-plan-resume-freshness",
  "npm run smoke:agent:runtime-action-plan-no-redo-shadow",
  "npm run smoke:agent:runtime-action-plan-maturity",
  "npm run smoke:design-task-types",
  "npm run smoke:design-discipline-runtime",
  "npm run smoke:design-discipline-guard-golden",
  "npm run smoke:discipline-gate-exits",
  "npm run smoke:tool-safety-policy",
  "npm run smoke:pending-destructive-action-card",
  "npm run smoke:teammate-tool-safety",
  "npm run smoke:intent-declaration-foundation",
  "npm run smoke:intent-declaration-shadow",
  "npm run smoke:public-plan-routing-shadow",
  "npm run smoke:agent:public-plan-capability-envelope",
  "npm run smoke:public-plan-gate-scope",
  "npm run smoke:public-plan-card-semantics",
  "npm run smoke:agent:actionable-followup-continuation",
  "npm run smoke:completion-observation-gate",
  "npm run smoke:agent:reflexion-discipline-seed",
  "npm run smoke:photoshop-mcp:export-tool-kind",
  "npm run smoke:sku:exec-bug-fixes",
  "npm run smoke:sku:color-card-skill",
  "npm run smoke:sku:template-design-loop",
  "npm run smoke:sku:template-layout-plan",
  "npm run smoke:quality-loop-wiring",
  "npm run smoke:reference:output-intent",
  "npm run smoke:skill-route-guard-declaration",
  "npm run smoke:intent-predicate-freeze",
  "npm run smoke:skill-tool-display",
  "npm run smoke:design-quality:assertion",
  "npm run smoke:design-quality:measurement",
  "npm run smoke:design-quality:verdict-bundle",
  "npm run smoke:design-quality:surface-snapshot",
  "npm run smoke:design-quality:visual-observation",
  "npm run smoke:design-quality:vlm-wiring",
  "npm run smoke:design-quality:vlm-history-binding",
  "npm run smoke:design-learning:recall-wiring",
  "npm run smoke:design-learning:visual-case",
  "npm run smoke:design-learning:insights-visibility",
  "npm run smoke:design-learning:memory-prompt-section",
  "npm run smoke:agent:design-intent-signal",
  "npm run smoke:dynamic-model-registry",
  "npm run smoke:validation-tier-contract",
  "npm run smoke:agent:run-record",
  "npm run smoke:agent:harness-v1",
  "npm run smoke:layout:region-bridge",
  "npm run smoke:layout:layer-occlusion",
  "npm run smoke:knowledge:psd-design-source",
  "npm run smoke:layout:subject-fit",
  "npm run smoke:agent:resumable-task-contract",
  "npm run smoke:agent:diagnostic-record",
  "npm run smoke:agent:planning-contract",
  "npm run smoke:agent:intent-engine",
  "npm run smoke:agent:task-completion-contract",
  "npm run smoke:agent:preference-feedback",
  "npm run smoke:sku:intent-params",
  "npm run smoke:sku:self-select-note-policy",
  "npm run smoke:sku:project-source-policy",
  "npm run smoke:chat:response-cleaner"
];

const BUILD_COMMANDS = [
  "npm run build:warning-boundary",
  "npm run audit:artifact-alias-governance"
];

const LIVE_PREFLIGHT_COMMANDS = ["npm run dev:execution-fast-lane:live-preflight"];

const UI_COMMANDS = [
  "npm run smoke:chat-ui:execution-chain",
  "npm run smoke:ui:knowledge-library",
  "npm run smoke:eagle-library:direct-import",
  "npm run smoke:eagle-library:asset-ref",
  "npm run smoke:eagle-library:agent-reference",
  "npm run smoke:eagle-library:inspector-writeback",
  "npm run smoke:ui:user-facing-language-boundary",
  "npm run smoke:chat:response-cleaner"
];

const UI_RUNNING_WINDOW_COMMANDS = [
  "npm run smoke:chat-ui:running-window:default-mcp-required"
];

const RISK_GROUP_COMMANDS = {
  agent: [
    "npm run smoke:agent:thinking-tool-boundary",
    "npm run smoke:agent:user-visible-state",
    "npm run smoke:agent:runtime-guard",
    "npm run smoke:agent:execution-lifecycle",
    "npm run smoke:agent:performance-policy"
  ],
  sku: [
    "npm run smoke:sku:intent-params",
    "npm run smoke:sku:self-select-note-policy",
    "npm run smoke:sku:project-source-policy",
    "npm run smoke:sku:design-preflight",
    "npm run smoke:sku:execution-manifest",
    "npm run smoke:sku:configured-execution-plan",
    "npm run smoke:sku:auto-layout-executor-policy",
    "npm run smoke:sku:template-layout-plan",
    "npm run smoke:sku:combo-confirmation-flow",
    "npm run smoke:agent:interactive-continuation-ledger",
    "npm run smoke:sku:no-placeholder-live-acceptance:self-test",
    "npm run smoke:sku:export-readback",
    "npm run smoke:sku:dpi-readonly-evidence"
  ],
  ui: [
    "npm run smoke:ui:workbench-information-architecture",
    "npm run smoke:ui:user-facing-language-boundary",
    "npm run smoke:ui:agent-process-inspector",
    "npm run smoke:ui:human-review-intake",
    "npm run smoke:ui:sock-layout-panel-entry",
    "npm run smoke:chat-ui:running-window"
  ],
  uxp: [
    "npm run smoke:matting:application-contract",
    "npm --prefix ../DesignEcho-UXP run smoke:matting:binary-mask-store",
    "npm --prefix ../DesignEcho-UXP run smoke:matting:apply-fast-path",
    "npm run smoke:uxp-agent-connection-recovery",
    "npm run smoke:uxp:layer-hierarchy-tools",
    "npm run smoke:uxp:group-export-tool",
    "npm run smoke:main-image:uxp-toolchain-live:contract"
  ],
  learning: [
    "npm run smoke:design-learning:experience",
    "npm run smoke:design-learning:memory-review",
    "npm run smoke:design-learning:memory-review-queue",
    "npm run smoke:design-learning:runtime-settings-entry",
    "npm run smoke:design-learning:runtime-trigger",
    "npm run smoke:design-learning:runtime-runner"
  ]
};

const FULL_COMMANDS = ["npm run maintenance:preflight"];

function usage() {
  return [
    "Usage: node scripts/run-validation-tier.cjs --tier agent-fast|fast|build|live-preflight|ui-running-window|ui|risk|full [--group agent|sku|ui|uxp|learning] [--list]",
    "",
    "Examples:",
    "  node scripts/run-validation-tier.cjs --tier agent-fast",
    "  node scripts/run-validation-tier.cjs --tier build --list",
    "  node scripts/run-validation-tier.cjs --tier ui-running-window",
    "  node scripts/run-validation-tier.cjs --tier risk --group agent",
    "  node scripts/run-validation-tier.cjs --tier full"
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    tier: null,
    groups: [],
    listOnly: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--list") {
      parsed.listOnly = true;
      continue;
    }

    if (arg === "--tier") {
      parsed.tier = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--tier=")) {
      parsed.tier = arg.slice("--tier=".length);
      continue;
    }

    if (arg === "--group") {
      parsed.groups.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--group=")) {
      parsed.groups.push(arg.slice("--group=".length));
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.tier) {
    parsed.tier = "fast";
  }

  if (!VALID_TIERS.has(parsed.tier)) {
    throw new Error(`Invalid tier: ${parsed.tier}`);
  }

  for (const group of parsed.groups) {
    if (!VALID_GROUPS.has(group)) {
      throw new Error(`Invalid group: ${group}`);
    }
  }

  return parsed;
}

function commandsFor(parsed) {
  if (parsed.tier === "agent-fast" || parsed.tier === "fast") {
    if (parsed.groups.length > 0) {
      throw new Error("--group is only supported with --tier risk");
    }
    return AGENT_FAST_COMMANDS;
  }

  if (parsed.tier === "build") {
    if (parsed.groups.length > 0) {
      throw new Error("--group is only supported with --tier risk");
    }
    return BUILD_COMMANDS;
  }

  if (parsed.tier === "live-preflight") {
    if (parsed.groups.length > 0) {
      throw new Error("--group is only supported with --tier risk");
    }
    return LIVE_PREFLIGHT_COMMANDS;
  }

  if (parsed.tier === "ui") {
    if (parsed.groups.length > 0) {
      throw new Error("--group is only supported with --tier risk");
    }
    return UI_COMMANDS;
  }

  if (parsed.tier === "ui-running-window") {
    if (parsed.groups.length > 0) {
      throw new Error("--group is only supported with --tier risk");
    }
    return UI_RUNNING_WINDOW_COMMANDS;
  }

  if (parsed.tier === "full") {
    if (parsed.groups.length > 0) {
      throw new Error("--group is only supported with --tier risk");
    }
    return FULL_COMMANDS;
  }

  const groups = parsed.groups.length > 0 ? parsed.groups : Array.from(VALID_GROUPS);
  return groups.flatMap((group) => RISK_GROUP_COMMANDS[group]);
}

function printCommands(tier, commands) {
  console.log(`validation tier: ${tier}`);
  commands.forEach((command, index) => {
    console.log(`${index + 1}. ${command}`);
  });
}

function resolveNpmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function splitCommandArgs(command) {
  const args = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = pattern.exec(command)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

function spawnValidationCommand(command) {
  const args = splitCommandArgs(command);
  const npmCliPath = resolveNpmCliPath();
  if (args[0] === "npm" && npmCliPath) {
    return spawnSync(process.execPath, [npmCliPath, ...args.slice(1)], {
      cwd: process.cwd(),
      shell: false,
      stdio: "inherit"
    });
  }
  return spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    stdio: "inherit"
  });
}

function runCommands(commands) {
  for (const command of commands) {
    console.log(`\n> ${command}`);
    const result = spawnValidationCommand(command);

    if (result.error) {
      throw result.error;
    }

    if (result.signal) {
      console.error(`[validation-tier] FAIL: command terminated by signal: ${command}`);
      console.error(`[validation-tier] signal: ${result.signal}`);
      process.exit(1);
    }

    if (result.status !== 0) {
      console.error(`[validation-tier] FAIL: command failed: ${command}`);
      console.error(`[validation-tier] exit code: ${result.status}`);
      process.exit(result.status || 1);
    }
  }
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const commands = commandsFor(parsed);
  printCommands(parsed.tier, commands);

  if (parsed.listOnly) {
    return;
  }

  runCommands(commands);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exit(1);
}
