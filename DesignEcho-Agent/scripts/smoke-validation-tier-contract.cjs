#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const runnerSource = fs.readFileSync(
  path.resolve(process.cwd(), "scripts", "run-validation-tier.cjs"),
  "utf8"
);
assert(
  runnerSource.includes("spawnSync(process.execPath, [npmCliPath, ...args.slice(1)]"),
  "validation runner must launch npm through the current Node runtime instead of a shell shim"
);
assert(
  runnerSource.includes("shell: false"),
  "validation runner npm path must bypass shell shim resolution"
);

function listTier(tier, group) {
  const args = ["scripts/run-validation-tier.cjs", "--tier", tier, "--list"];
  if (group) {
    args.push("--group", group);
  }
  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "");
}

const runningWindowList = listTier("ui-running-window");
assert(
  runningWindowList.includes("smoke:chat-ui:running-window:default-mcp-required"),
  "ui-running-window tier must use the strict default-MCP running-window gate"
);
assert(
  !runningWindowList.includes("--allow-unavailable-skip"),
  "ui-running-window tier must not accept unavailable model/window skips"
);

const uiList = listTier("ui");
assert(
  !uiList.includes("--allow-unavailable-skip"),
  "ui tier should not hide running-window failures through unavailable skips"
);
assert(
  uiList.includes("smoke:ui:knowledge-library"),
  "ui tier must include the Knowledge Library ownership and readonly-source gate"
);

const agentFastList = listTier("agent-fast");
assert(
  agentFastList.includes("audit:artifact-alias-governance -- --source-only"),
  "agent-fast tier must not inspect an arbitrary stale renderer dist"
);
for (const requiredCommand of [
  "audit:tools",
  "audit:capability-resolver",
  "smoke:agent:artifact-repository",
  "smoke:agent:artifact-publication-policy",
  "smoke:design-project-state",
  "smoke:v5:runtime-contract-bundle",
  "smoke:v5:tool-capability-bridge",
  "smoke:agent:capability-resolver",
  "smoke:agent:capability-reference-resolution",
  "smoke:agent:evaluation-profiles",
  "smoke:agent:evaluation-result-adapters",
  "smoke:agent:scoped-change-records",
  "smoke:detail-page:content-verification",
  "smoke:design-project-fact-provenance",
  "smoke:design-project-rule-governance",
  "smoke:design-knowledge-governance",
  "smoke:design-knowledge:disposition-lifecycle",
  "smoke:sku:human-review-writeback",
  "smoke:agent:capability-metadata",
  "smoke:agent:capability-provider-probe",
  "smoke:agent:no-redo-provider-probe",
  "smoke:agent:model-transport-protocol",
  "smoke:agent:hitl-continuation",
  "smoke:agent:interactive-continuation-ledger",
  "smoke:agent:interactive-card-confirmation-gate",
  "smoke:agent:runtime-stage-state",
  "smoke:agent:runtime-task-snapshot",
  "smoke:agent:task-plan-presentation",
  "smoke:agent:operating-context-snapshot",
  "smoke:agent:knowledge-selection-context",
    "smoke:agent:runtime-stage-trace",
    "smoke:agent:runtime-delivery-receipt",
    "smoke:agent:runtime-design-brief",
    "smoke:agent:runtime-design-brief-skill-consumer",
    "smoke:agent:business-skill-live-e2e-readiness",
    "smoke:agent:business-skill-system-path",
    "smoke:agent:runtime-harness-control-repair",
    "smoke:agent:runtime-stage-tool-visibility",
    "smoke:project-product-understanding",
    "smoke:agent:runtime-design-strategy",
  "smoke:agent:runtime-action-plan",
  "smoke:agent:runtime-action-plan-reconciliation",
  "smoke:agent:runtime-action-plan-resume-freshness",
  "smoke:agent:runtime-action-plan-no-redo-shadow",
  "smoke:design-quality:visual-observation",
  "smoke:design-quality:vlm-history-binding",
  "smoke:reference:output-intent",
  "smoke:agent:task-completion-contract"
]) {
  assert(
    agentFastList.includes(requiredCommand),
    `agent-fast tier must include ${requiredCommand}`
  );
}

const artifactAliasIndex = agentFastList.indexOf("audit:artifact-alias-governance -- --source-only");
const artifactRepositoryIndex = agentFastList.indexOf("smoke:agent:artifact-repository");
const artifactPublicationPolicyIndex = agentFastList.indexOf("smoke:agent:artifact-publication-policy");
const designProjectStateIndex = agentFastList.indexOf("smoke:design-project-state");
const runtimeContractBundleIndex = agentFastList.indexOf("smoke:v5:runtime-contract-bundle");
assert(
  artifactAliasIndex >= 0
    && artifactRepositoryIndex > artifactAliasIndex
    && artifactPublicationPolicyIndex > artifactRepositoryIndex
    && designProjectStateIndex > artifactPublicationPolicyIndex
    && runtimeContractBundleIndex > designProjectStateIndex,
  "agent-fast must validate publication policy and Repository-owned Project State refs before the v5 runtime bundle"
);

const buildList = listTier("build");
const productionBuildIndex = buildList.indexOf("build:warning-boundary");
const artifactAuditIndex = buildList.indexOf("audit:artifact-alias-governance");
assert(
  productionBuildIndex >= 0 && artifactAuditIndex > productionBuildIndex,
  "build tier must audit renderer artifacts only after a fresh production build"
);

const skuRiskList = listTier("risk", "sku");
assert(
  skuRiskList.includes("smoke:sku:combo-confirmation-flow"),
  "SKU risk tier must include the executable confirmation-to-layout behavior gate"
);
assert(
  skuRiskList.includes("smoke:agent:interactive-continuation-ledger"),
  "SKU risk tier must include the persistent at-most-once continuation ledger gate"
);

console.log("smoke-validation-tier-contract passed");
