'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sourceOnly = process.argv.includes('--source-only');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const { validateArtifactAliasGovernance } = require(path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'artifact-alias-governance.ts'
));

function alias(aliasId, input) {
  return {
    aliasId,
    version: '1.0.0',
    authority: 'reference_only',
    adapterOnly: true,
    createsIndependentSchema: false,
    ownsRuntimeState: false,
    grantsToolPermission: false,
    executesTools: false,
    advancesRuntimeStage: false,
    declaresCompletion: false,
    ...input
  };
}

const declarations = [
  alias('TaskBrief', {
    canonicalArtifactId: 'runtime-design-brief-declaration/v0',
    canonicalOwner: 'runtime-design-brief-declaration',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-design-brief-declaration.ts',
    consumers: ['runtime-planning-context-seed', 'autonomous-agent-executor'],
    stages: ['R1'],
    persistenceOwner: 'runtime-session-current-generation'
  }),
  alias('CompletionContract', {
    canonicalArtifactId: 'task-completion-contract/current',
    canonicalOwner: 'agent-runtime-task-completion-contract',
    canonicalSource: 'src/renderer/services/agent-runtime/types.ts',
    consumers: ['design-quality-verdict-bundle', 'runtime-session'],
    stages: ['R5', 'E2'],
    persistenceOwner: 'runtime-session'
  }),
  alias('AssetManifest', {
    canonicalArtifactId: 'design-project-state/assets/v0',
    canonicalOwner: 'design-project-state',
    canonicalSource: 'src/shared/design-project-state.ts',
    consumers: ['runtime-design-brief', 'design-project-state-tools'],
    stages: ['R1', 'R2'],
    persistenceOwner: 'design-project-state'
  }),
  alias('BrandProfile', {
    canonicalArtifactId: 'design-project-rules/v0',
    canonicalOwner: 'design-project-rule-governance',
    canonicalSource: 'src/shared/design-project-rule-governance.ts',
    consumers: ['runtime-design-strategy', 'design-project-state'],
    stages: ['R2', 'R3'],
    persistenceOwner: 'design-project-state-and-reviewed-memory',
    authority: 'advisory_data'
  }),
  alias('ContentSpec', {
    canonicalArtifactId: 'runtime-design-strategy-declaration/v0',
    canonicalOwner: 'runtime-design-strategy-declaration',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-design-strategy-declaration.ts',
    consumers: ['runtime-action-plan-declaration'],
    stages: ['R3'],
    persistenceOwner: 'runtime-session-current-generation'
  }),
  alias('ArtDirection', {
    canonicalArtifactId: 'runtime-design-strategy-declaration/v0',
    canonicalOwner: 'runtime-design-strategy-declaration',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-design-strategy-declaration.ts',
    consumers: ['runtime-action-plan-declaration'],
    stages: ['R3'],
    persistenceOwner: 'runtime-session-current-generation'
  }),
  alias('LayoutSpec', {
    canonicalArtifactId: 'runtime-semantic-design-dsl/v0',
    canonicalOwner: 'runtime-action-plan-declaration',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-action-plan-declaration.ts',
    consumers: ['render-layout', 'runtime-action-plan-reconciliation'],
    stages: ['R4'],
    persistenceOwner: 'runtime-session-current-generation'
  }),
  alias('TaskGraph', {
    canonicalArtifactId: 'runtime-action-plan-declaration/v0',
    canonicalOwner: 'runtime-action-plan-declaration',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-action-plan-declaration.ts',
    consumers: ['runtime-action-plan-reconciliation', 'runtime-stage-trace'],
    stages: ['R4', 'E1'],
    persistenceOwner: 'runtime-session-current-generation'
  }),
  alias('PhotoshopExecutionPlan', {
    canonicalArtifactId: 'runtime-action-plan-declaration/v0',
    canonicalOwner: 'runtime-action-plan-and-tool-preflight',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-action-plan-declaration.ts',
    consumers: ['agent-tool-execution-preflight', 'runtime-action-plan-reconciliation'],
    stages: ['R4', 'E1'],
    persistenceOwner: 'runtime-session-current-generation'
  }),
  alias('DocumentSnapshot', {
    canonicalArtifactId: 'runtime-tool-observation/current',
    canonicalOwner: 'agent-runtime-tool-observation',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-action-plan-observation.ts',
    consumers: ['runtime-action-plan-reconciliation', 'design-evaluation-result-adapters'],
    stages: ['E1', 'R5'],
    persistenceOwner: 'bounded-run-observation'
  }),
  alias('ObservationReport', {
    canonicalArtifactId: 'runtime-action-plan-reconciliation/v0',
    canonicalOwner: 'runtime-action-plan-reconciliation',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-action-plan-reconciliation.ts',
    consumers: ['runtime-session', 'runtime-action-plan-resume-freshness'],
    stages: ['E1', 'R5'],
    persistenceOwner: 'runtime-session-and-run-record-digest'
  }),
  alias('QAReport', {
    canonicalArtifactId: 'design-evaluation-profile-result/v0',
    canonicalOwner: 'design-evaluation-profiles',
    canonicalSource: 'src/shared/agent-runtime-v5/design-evaluation-profiles.ts',
    consumers: ['design-quality-verdict-bundle', 'reflexion-contract'],
    stages: ['R5'],
    persistenceOwner: 'runtime-session-review-result'
  }),
  alias('RevisionPlan', {
    canonicalArtifactId: 'reflexion-handoff/current',
    canonicalOwner: 'reflexion-contract',
    canonicalSource: 'src/shared/agent-runtime-v5/reflexion-contract.ts',
    consumers: ['runtime-session-generation', 'autonomous-agent-executor'],
    stages: ['R5', 'R4'],
    persistenceOwner: 'runtime-session-lineage'
  }),
  alias('CompletionDecision', {
    canonicalArtifactId: 'runtime-session-e2-transition/current',
    canonicalOwner: 'runtime-session-stage-state',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-session.ts',
    consumers: ['agent-run-record', 'delivery-response'],
    stages: ['E2'],
    persistenceOwner: 'runtime-session-and-run-record'
  }),
  alias('MemoryCandidates', {
    canonicalArtifactId: 'design-learning-memory-review-queue/current',
    canonicalOwner: 'design-learning-memory-review-queue',
    canonicalSource: 'src/shared/design-learning-memory-review-queue.ts',
    consumers: ['design-learning-memory-review', 'memory-persistence'],
    stages: ['E2'],
    persistenceOwner: 'memory-review-queue',
    authority: 'advisory_data'
  }),
  alias('CompactTaskState', {
    canonicalArtifactId: 'compiled-runtime-context-and-run-record-digest/v0',
    canonicalOwner: 'runtime-context-compiler-and-run-record',
    canonicalSource: 'src/shared/agent-runtime-v5/runtime-context-compiler.ts',
    consumers: ['autonomous-agent-executor', 'agent-run-resume'],
    stages: ['R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'],
    persistenceOwner: 'run-record-digest',
    authority: 'advisory_data'
  })
];

const report = validateArtifactAliasGovernance({ declarations });
assert.strictEqual(report.status, 'valid');
assert.strictEqual(report.validCount, declarations.length);
assert.strictEqual(report.boundaries.createsRegistry, false);
assert.strictEqual(report.boundaries.createsSchema, false);
assert.strictEqual(report.boundaries.ownsRuntimeState, false);
declarations.forEach((declaration) => {
  assert(fs.existsSync(path.join(root, declaration.canonicalSource)), `${declaration.aliasId} canonicalSource 不存在`);
});

function listFilesRecursively(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

const implementationExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html']);
const implementationRoots = [
  path.join(root, 'src'),
  path.join(root, 'schemas'),
  path.resolve(root, '..', 'DesignEcho-UXP', 'src'),
  path.resolve(root, '..', 'DesignEcho-Browser-Extension')
];
const forbiddenImplementationTerm = /evidence|证据/i;
const implementationTerminologyLeaks = implementationRoots.flatMap((directory) => (
  listFilesRecursively(directory)
    .filter((filePath) => implementationExtensions.has(path.extname(filePath).toLowerCase()))
    .filter((filePath) => forbiddenImplementationTerm.test(path.basename(filePath))
      || forbiddenImplementationTerm.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(path.resolve(root, '..'), filePath))
));
assert.deepStrictEqual(
  implementationTerminologyLeaks,
  [],
  `开发验收术语进入了产品实现：${implementationTerminologyLeaks.join(', ')}`
);

const rendererAssets = path.join(root, 'dist', 'renderer', 'assets');
const distributedAcceptanceLeaks = sourceOnly
  ? []
  : listFilesRecursively(rendererAssets)
    .filter((filePath) => path.extname(filePath).toLowerCase() === '.js')
    .filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      return /chat-panel-test-bridge/i.test(path.basename(filePath))
        || content.includes('agent-acceptance/v0')
        || content.includes('installChatPanelTestBridge')
        || /designechoChatTest/i.test(content);
    })
    .map((filePath) => path.relative(root, filePath));
assert.deepStrictEqual(
  distributedAcceptanceLeaks,
  [],
  `开发验收桥进入了生产 renderer 产物：${distributedAcceptanceLeaks.join(', ')}`
);

const unsafe = validateArtifactAliasGovernance({
  declarations: [
    alias('UnsafeArtifact', {
      canonicalArtifactId: '',
      canonicalOwner: '',
      canonicalSource: '',
      consumers: [],
      stages: [],
      persistenceOwner: '',
      adapterOnly: false,
      createsIndependentSchema: true,
      ownsRuntimeState: true,
      grantsToolPermission: true,
      executesTools: true,
      advancesRuntimeStage: true,
      declaresCompletion: true
    })
  ]
});
const unsafeCodes = new Set(unsafe.issues.map((issue) => issue.code));
[
  'canonical_artifact_missing',
  'canonical_owner_missing',
  'canonical_source_missing',
  'consumer_missing',
  'stage_missing',
  'persistence_owner_missing',
  'adapter_boundary_missing',
  'independent_schema_forbidden',
  'runtime_state_ownership_forbidden',
  'tool_permission_forbidden',
  'tool_execution_forbidden',
  'stage_advancement_forbidden',
  'completion_declaration_forbidden'
].forEach((code) => assert(unsafeCodes.has(code), `缺少负向治理：${code}`));

const duplicate = validateArtifactAliasGovernance({
  declarations: [declarations[0], declarations[0]]
});
assert(duplicate.issues.some((issue) => issue.code === 'duplicate_alias_id'));

console.log(JSON.stringify({
  success: true,
  aliasCount: report.declarationCount,
  canonicalOwnerCount: new Set(declarations.map((item) => item.canonicalOwner)).size,
  negativeIssueCodes: Array.from(unsafeCodes).sort(),
  implementationTerminologyLeakCount: implementationTerminologyLeaks.length,
  distributedAcceptanceAudit: sourceOnly ? 'skipped_source_only' : 'checked_renderer_artifact',
  distributedAcceptanceLeakCount: distributedAcceptanceLeaks.length,
  boundaries: report.boundaries
}, null, 2));
