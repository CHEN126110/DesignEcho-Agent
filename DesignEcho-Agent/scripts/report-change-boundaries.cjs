#!/usr/bin/env node

const { execFileSync } = require('child_process');

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

const INDEX_CLEANUP_PREFIXES = [
  'DesignEcho-Agent/node_modules',
  'DesignEcho-Agent/dist',
  'DesignEcho-Agent/tmp',
  'DesignEcho-UXP/node_modules',
  'DesignEcho-UXP/dist'
];

const BOUNDARIES = [
  {
    id: 'maintenance-index-cleanup',
    title: '维护：生成目录移出 Git 索引',
    validation: ['npm run maintenance:repo-hygiene:check'],
    match: (entry) => entry.status[0] === 'D' && INDEX_CLEANUP_PREFIXES.some((prefix) => entry.filePath === prefix || entry.filePath.startsWith(`${prefix}/`))
  },
  {
    id: 'maintenance-residual-cleanup',
    title: '维护：历史 scratch/tmp 残留清理',
    validation: ['npm run maintenance:repo-hygiene:check'],
    match: (entry) => entry.status[0] === 'D' && (
      /^_/.test(entry.filePath) ||
      /^tmp[_-]/.test(entry.filePath) ||
      /\.corrupted\./.test(entry.filePath)
    )
  },
  {
    id: 'maintenance-tooling',
    title: '维护：仓库巡检与提交边界工具',
    validation: [
      'node --check scripts/report-repo-hygiene.cjs',
      'node --check scripts/report-change-boundaries.cjs',
      'node --check scripts/check-planning-alignment.cjs',
      'npm run smoke:execution-fast-lane',
      'npm run smoke:agent:acceptance:desktop',
      'npm run maintenance:planning-check',
      'npm run maintenance:repo-hygiene:check',
      'npm run maintenance:change-boundaries'
    ],
    match: (entry) => [
      '.gitignore',
      '.gitattributes',
      'DesignEcho-Agent/docs/repository-maintenance-hygiene.md',
      'DesignEcho-Agent/docs/repository-change-boundary-report.md',
      'DesignEcho-Agent/docs/project-sustainability-cockpit.md',
      'DesignEcho-Agent/scripts/report-repo-hygiene.cjs',
      'DesignEcho-Agent/scripts/report-change-boundaries.cjs',
      'DesignEcho-Agent/scripts/report-project-cockpit.cjs',
      'DesignEcho-Agent/scripts/report-project-cleanup-candidates.cjs',
      'DesignEcho-Agent/scripts/report-agent-architecture.cjs',
      'DesignEcho-Agent/scripts/audit-agent-history-risks.cjs',
      'DesignEcho-Agent/scripts/check-planning-alignment.cjs',
      'DesignEcho-Agent/scripts/run-execution-fast-lane.cjs',
      'DesignEcho-Agent/scripts/run-validation-tier.cjs',
      'DesignEcho-Agent/scripts/launch-chat-ui-debug-window.cjs',
      'DesignEcho-Agent/scripts/validate-maintenance-hygiene.cjs'
    ].includes(entry.filePath)
  },
  {
    id: 'project-memory',
    title: '项目记忆与长期状态',
    validation: ['node -e "JSON.parse(require(\'fs\').readFileSync(\'project-memory/project-state.json\',\'utf8\'))"'],
    match: (entry) => entry.filePath.includes('/project-memory/') || entry.filePath === 'DesignEcho-Agent/AGENTS.md' || entry.filePath === 'docs/long-horizon/Collaboration.md'
  },
  {
    id: 'reference-replication',
    title: '参考图复刻主线',
    validation: [
      'npm run build:main',
      'npm run build:typecheck:renderer',
      'npm run smoke:reference:blueprint-groups',
      'npm run smoke:layout-replication:completion',
      'npm run smoke:reference:output-intent',
      'npm run smoke:agent:task-completion-contract',
      'npm run smoke:reference:match-validation',
      'npm run smoke:reference:style-recipes',
      'npm run smoke:reference:visual-qa',
      'npm run smoke:reference:screenshot-pixel-probe',
      'npm run smoke:layout-replication:text-placement',
      'npm run smoke:layout-replication:canvas-policy',
      'npm run smoke:chat-ui:reference-replication',
      'npm run smoke:chat-ui:reference-replication-live (default skipped; set DESIGNECHO_LIVE_REFERENCE_REPLICATION_UI=1 for real-model UI path)',
      'npm run smoke:reference:fex-text-placement-live (manual live, requires Photoshop + UXP)',
      'Reload UXP plugin, then npm run smoke:reference:overlay-live',
      'npm run benchmark:reference-replication:validate',
      'npm run smoke:reference:benchmark-validator',
      'npm run smoke:reference:benchmark-scope',
      'npm run smoke:reference:benchmark-coverage',
      'npm run smoke:reference:live-readiness',
      'npm run smoke:reference:live-evidence-pipeline',
      'npm run smoke:reference:live-result-evidence-adapter',
      'npm run smoke:reference:neutral-text-layout-case',
      'npm run smoke:chat-ui:reference-replication:neutral'
    ],
    match: (entry) => /reference-replication|reference-result-evidence|reference-live-result-evidence|reference-live-evidence|reference-evidence-pipeline|reference-real-case-intake|reference-quality-claim|reference-live-capture|quality-claim-gate|layout-replication|useReferenceReplication|smoke-reference-|smoke-chat-ui-reference-replication|reference-screenshot-pixel-probe|reference-benchmark-categories|benchmarks\/reference-replication/.test(entry.filePath)
      || entry.filePath.startsWith('DesignEcho-Agent/scripts/lib/reference-')
  },
  {
    id: 'acceptance-infrastructure',
    title: 'Photoshop 验收与调试记录基础设施',
    validation: [
      'npm run build:main',
      'npm run build:typecheck:renderer',
      'npm run smoke:acceptance:snapshot-diff',
      'npm run smoke:acceptance:tool-evidence',
      'npm run smoke:photoshop-tool-semantics',
      'npm run smoke:photoshop-text-tool-benchmarks',
      'npm run smoke:photoshop-simple-ops:live (manual live, requires Photoshop + UXP)',
      'npm run smoke:photoshop-text-tools:live (manual live, requires Photoshop + UXP)',
      'npm run smoke:photoshop-text-font-replace:live (manual live, requires Photoshop + UXP)',
      'npm run smoke:photoshop-layer-writes:live (manual live, requires Photoshop + UXP)',
      'npm run smoke:photoshop-acceptance:write-live:contract',
      'npm run smoke:debug-bridge:redaction',
      'npm run smoke:tool-result:redaction',
      'npm run smoke:chat-ui:execution-chain',
      'npm run smoke:electron:startup-window',
      'DesignEcho-UXP npm run build'
    ],
    match: (entry) => /acceptance|photoshop-tool-semantics|smoke-acceptance|smoke-photoshop-acceptance|smoke-photoshop-simple-operations-live|smoke-photoshop-layer-write-failures-live|smoke-photoshop-save-export-live|smoke-photoshop-document-save-close-live|smoke-photoshop-tool-semantics|smoke-photoshop-text-tool-benchmarks|smoke-photoshop-text-tools-live|smoke-photoshop-text-font-replace-live|smoke-debug-bridge-redaction|smoke-tool-result-redaction|smoke-chat-ui-execution-chain|smoke-chat-ui-electron-bridge|smoke-electron-startup-window|src\/renderer\/testing|chat-panel-test-bridge|debug-bridge-service|ToolResultBlock|components\/message\/parser|tool-logger/.test(entry.filePath) ||
      entry.filePath === 'DesignEcho-Agent/benchmarks/'
  },
  {
    id: 'smart-scaling-placement',
    title: '智能缩放与 placement',
    validation: ['npm run build:main', 'npm run build:typecheck:renderer', 'DesignEcho-UXP npm run build'],
    match: (entry) => /design-smart-scaling-policy|smart-scaling|detail-page-asset-ranker|detail-page\.types|detail-page-filler|audit-detail-page-placement|template-tool/.test(entry.filePath)
  },
  {
    id: 'inpainting-volcengine',
    title: '局部重绘 / 即梦 / 火山服务',
    validation: ['npm run build:main', 'DesignEcho-UXP npm run build', 'Photoshop manual validation required'],
    match: (entry) => /inpainting|volcengine|jimeng|tos-upload|image-to-image|public\/webview\/index\.html/.test(entry.filePath)
  },
  {
    id: 'image-generation-providers',
    title: '图片生成 Provider 与网络代理',
    validation: ['npm run build:main'],
    match: (entry) => /src\/main\/services\/(gptsapi-gemini-image-service|openrouter-gemini-image-service|network-proxy)\.ts/.test(entry.filePath)
  },
  {
    id: 'agent-public-plan-confirmation',
    title: 'Agent 公开计划确认交接',
    validation: [
      'npm run smoke:agent:planning-contract',
      'npm run smoke:agent:public-plan-photoshop-adapter',
      'npm run smoke:chat-ui:execution-chain',
      'npm run build:main',
      'npm run build:typecheck:renderer'
    ],
    match: (entry) => /agent-task-public-plan-(approval-record|controlled-runner)|public-plan-photoshop-adapter|smoke-public-plan-photoshop-adapter/.test(entry.filePath)
  },
  {
    id: 'design-learning-cadence-scheduler',
    title: '设计学习每日调度与触发入口',
    validation: [
      'npm run smoke:design-learning:experience',
      'npm run smoke:design-learning:cadence-scheduler',
      'npm run smoke:design-learning:runtime-trigger',
      'npm run smoke:design-learning:runtime-trigger-service',
      'npm run smoke:design-learning:runtime-entry',
      'npm run smoke:design-learning:runtime-runner',
      'npm run smoke:design-learning:eagle-runtime-provider',
      'npm run smoke:design-learning:runtime-orchestrator',
      'npm run smoke:design-learning:memory-review-queue',
      'npm run smoke:design-learning:review-settings-entry',
      'npm run smoke:design-learning:runtime-settings-entry',
      'npm run build:main'
    ],
    match: (entry) => /design-learning-experience|design-learning-cadence-scheduler|design-learning-runtime-trigger|design-learning-runtime-trigger.service|design-learning-runtime-entry.service|design-learning-runtime-runner|design-learning-runtime-orchestrator.service|eagle-design-learning-runtime-provider|design-learning-memory-review-queue|DesignLearningReviewSettingsPanel|DesignLearningRuntimeSettingsPanel|smoke-design-learning-experience|smoke-design-learning-cadence-scheduler|smoke-design-learning-memory-review-queue|smoke-design-learning-review-settings-entry|smoke-design-learning-runtime-settings-entry|smoke-design-learning-memory-persistence|smoke-design-learning-runtime-trigger|smoke-design-learning-runtime-entry-service|smoke-design-learning-runtime-runner|smoke-design-learning-eagle-runtime-provider|smoke-design-learning-runtime-orchestrator-service/.test(entry.filePath)
  },
  {
    id: 'agent-routing-models',
    title: 'Agent 路由 / 模型 / skill 边界',
    validation: ['npm run build:main', 'npm run build:typecheck:renderer', 'npm run smoke:agent:intent-engine', 'npm run smoke:agent:planning-contract', 'npm run smoke:agent:user-visible-state', 'npm run smoke:agent:intent-boundary-matrix', 'npm run smoke:agent:resumable-task-contract', 'npm run smoke:agent:resume-readonly-runtime', 'npm run smoke:agent:intent-decision-intake', 'npm run smoke:agent:intent-deliberation-gate', 'npm run smoke:agent:visible-activity', 'npm run smoke:agent:worker-identity', 'npm run smoke:agent:acceptance-runtime-mode', 'npm run smoke:agent:observation-channels', 'npm run smoke:agent:provider-observation-capabilities', 'npm run smoke:provider-native:tools', 'npm run smoke:design-knowledge:xiaomi-web-search-runtime', 'npm run smoke:agent:execution-lifecycle', 'npm run smoke:agent:execution-lifecycle-acceptance', 'npm run smoke:detail-page:document-preflight-routing', 'npm run smoke:detail-page:skill-readiness', 'npm run smoke:detail-page:readiness-wiring', 'npm run smoke:detail-page:dpi-readonly-evidence', 'npm run smoke:agent:diagnostic-record', 'npm run smoke:agent:design-execution-preflight', 'npm run smoke:sku:design-preflight', 'npm run smoke:business-skill:implementation-checkpoint', 'npm run smoke:business-skill:readiness-contract', 'npm run smoke:business-skill:execution-preflight-gate', 'npm run smoke:business-skill:execution-preflight-wiring', 'npm run smoke:business-skill:memory-context', 'npm run smoke:business-skill:memory-strategy', 'npm run smoke:business-skill:preflight-planner-context', 'npm run smoke:business-skill:visual-evidence-refresh-plan', 'npm run smoke:business-skill:visual-evidence-refresh-runner', 'npm run smoke:business-skill:visual-evidence-refresh-runtime', 'npm run smoke:business-skill:visual-evidence-pre-execution-gate', 'npm run smoke:business-skill:visual-evidence-refresh-executor-wiring', 'npm run smoke:business-skill:execution-intake', 'npm run smoke:project-asset-understanding:intake', 'npm run smoke:business-skill:image-placement-verification-intake', 'npm run smoke:business-skill:execution-plan-intake', 'npm run smoke:business-skill:visual-evidence-diagnostic', 'npm run smoke:agent:acceptance-diagnostic-control', 'npm run smoke:agent:acceptance-diagnostic-export', 'npm run smoke:agent:acceptance-business-skill-evidence', 'npm run smoke:live-photoshop:acceptance-evidence-intake', 'npm run smoke:agent:acceptance-triage', 'npm run smoke:agent:acceptance-triage-report', 'npm run maintenance:acceptance-triage-report', 'npm run smoke:agent:acceptance-verification-matrix', 'npm run maintenance:acceptance-verification-matrix', 'npm run smoke:agent:acceptance-execution-suite', 'npm run maintenance:acceptance-suite', 'npm run smoke:agent:acceptance-control-plane', 'npm run smoke:agent:performance-policy', 'npm run smoke:agent:tool-decision-contract', 'npm run smoke:agent:tool-execution-preflight', 'npm run smoke:agent:tool-stream', 'npm run smoke:document-management:skill', 'npm run smoke:layer-management:skill', 'npm run smoke:find-smart:observability', 'npm run smoke:model-selection:routing', 'npm run smoke:model-routing:live-quality', 'npm run smoke:agent:runtime-guard', 'npm run smoke:agent:step-events', 'npm run smoke:agent:task-completion-contract', 'npm run smoke:tool-dependencies:param-targets', 'npm run smoke:design-team:coordinator', 'npm run smoke:design-intelligence:plan', 'npm run smoke:design-planner:mvp', 'npm run smoke:design-planner:executor-evidence', 'npm run smoke:project-asset-index', 'npm run smoke:project-visual-sampling', 'npm run smoke:project-visual-insight-cache', 'npm run smoke:project-visual-insight-cache-fill', 'npm run smoke:design-knowledge:eagle-candidate-visual-insight-request', 'npm run smoke:business-skill:visual-evidence-gate', 'npm run smoke:business-skill:visual-evidence-feedback', 'npm run smoke:business-skill:design-governance', 'npm run smoke:image-placement:core', 'npm run smoke:image-placement:readiness', 'npm run smoke:chat-ui:business-visual-feedback', 'npm run smoke:project-context-runtime', 'npm run smoke:main-image:asset-selection', 'npm run smoke:main-image:visual-loop', 'npm run smoke:main-image:vision-preflight', 'npm run smoke:main-image:candidate-preflight', 'npm run smoke:main-image:execution-alignment', 'npm run smoke:main-image:screenshot-qa', 'npm run smoke:main-image:screenshot-probe-readiness', 'npm run smoke:main-image:pixel-probe-adapter', 'npm run smoke:main-image:qa-report', 'npm run smoke:main-image:controlled-product-qa-gate', 'npm run smoke:main-image:controlled-product-qa-bridge', 'npm run smoke:main-image:agent-draft-plan', 'npm run smoke:main-image:strategy-contract', 'npm run smoke:main-image:strategy-input-builder', 'npm run smoke:main-image:dpi-readonly-evidence', 'npm run smoke:sku:dpi-readonly-evidence', 'npm run smoke:main-image:asset-hero-strategy', 'npm run smoke:main-image:design-standards', 'npm run smoke:main-image:design-readiness', 'npm run smoke:main-image:live-executor-checkpoint', 'npm run smoke:main-image:live-photoshop-adapter-contract', 'npm run smoke:design-knowledge:search', 'npm run smoke:design-knowledge:searxng', 'npm run smoke:design-knowledge:settings-entry', 'npm run smoke:design-knowledge:runtime-capability', 'npm run smoke:design-knowledge:eagle-readonly', 'npm run smoke:design-knowledge:eagle-case-index', 'npm run smoke:knowledge:eagle-writeback-gate', 'npm run smoke:design-placement:intelligence', 'npm run smoke:design-placement:candidate-ranking', 'npm run smoke:design-learning:experience', 'npm run smoke:design-learning:memory-review', 'npm run smoke:design-learning:memory-persistence', 'npm run smoke:design-learning:runtime-runner', 'npm run smoke:model-provider:xiaomi', 'npm run smoke:model-provider:deepseek', 'npm run smoke:provider-stream:policy', 'npm run smoke:stream-chat-service:errors', 'npm run smoke:chat-error:summary', 'npm run smoke:chat:response-cleaner'],
    match: (entry) => entry.filePath === 'DesignEcho-Agent/docs/model-settings-configuration.md'
      || /agent-acceptance-verification-matrix|acceptance-business-skill-verification|report-agent-acceptance-verification-matrix/.test(entry.filePath)
      || /agent-runtime|agent-orchestration|agent-visible-feedback|agent-tool-stream|agent-user-visible-state|agent-tool-decision-contract|agent-tool-execution-preflight|agent-capability-gate|agent-request-lifecycle|agent-task-planning-contract|agent-task-public-plan-(readonly-context|execution-request)|agent-resumable-task-contract|agent-resume-execution-policy|agent-resume-execution-gate|agent-resume-controlled-execution|agent-resume-context-pipeline|resume-readonly-handlers|agent-resume-planning|agent-execution-lifecycle|agent-route-boundary-policy|agent-observation-channels|agent-provider-observation-capabilities|provider-native-tools|searxng-design-knowledge|eagle-readonly-knowledge|eagle-visual-case-index|eagle-candidate-visual-insight-request|eagle-writeback-gate|eagle-knowledge-handlers|design-knowledge-settings|design-knowledge-runtime-capability|design-knowledge-handlers|agent-intent-(control-plane|decision-intake|deliberation-gate)|agent-(preference-feedback|response-knowledge)|agent-diagnostic-record|agent-design-execution-preflight|agent-acceptance-contracts|agent-acceptance-export|agent-acceptance-triage|agent-acceptance-control-plane|agent-acceptance-evidence-matrix|agent-acceptance-execution-suite|agent-acceptance-runtime-mode|live-photoshop-acceptance-evidence-intake|run-agent-acceptance-suite|design-agent|agent-performance-policy|design-intelligence-plan|design-placement-intelligence|design-learning-(experience|memory-review|memory-persistence|runtime-runner|daily-workflow)|design-planner|detail-page-skill-readiness|business-skill-(memory-(evidence|strategy)|visual-evidence-(gate|feedback|refresh-plan|refresh-runner|pre-execution-gate|control-decision|diagnostic|runtime)|design-governance|implementation-checkpoint|readiness-contract|execution-preflight-gate|preflight-planner-context|execution-intake|image-placement-verification-intake|execution-plan-intake)|project-asset-understanding|design-image-placement-core|image-placement-core-mvp|report-image-placement-core-readiness|project-asset-index|project-visual-sampling|project-visual-insight-cache|project-context-snapshot-service|project-context-runtime|ecommerce-project-handlers|main-image-(agent-draft-plan|strategy-contract|strategy-input-builder|asset-hero-strategy|design-standards-evidence|design-readiness-report|live-executor-request|live-executor-(checkpoint|runner)|controlled-product-qa-gate|controlled-product-qa-bridge|live-photoshop-adapter-contract|asset-selection|visual-loop|vision-preflight|execution-alignment|screenshot-qa|screenshot-probe-readiness|qa-report|memory-evidence|white-background-export-contract)|resource-manager-service|resource-handlers|preload\.ts|types\.d\.ts|design-teams|design-team|design-domain-knowledge|design-knowledge-search|design-memory-knowledge|memory\.service|design-grid-dsl|model-selection|skill-routing|skill-declarations|tool-dependencies|models\.config|model-service|task-orchestrator|stream-chat\.service|chat-response-cleaner|conversational-unavailable-message|shared\/prompts\/(agent-prompt|enhanced-agent-prompt|visual-understanding)|document-management\.executor|layer-management\.executor|find-edit-element\.executor|smoke-agent-(intent-engine|planning-contract|user-visible-state|intent-boundary-matrix|resumable-task-contract|resume-readonly-runtime-wiring|intent-decision-intake|intent-deliberation-gate|visible-activity|worker-identity|acceptance-runtime-mode|observation-channels|provider-observation-capabilities|execution-lifecycle|diagnostic-record|design-execution-preflight|acceptance-diagnostic-(control|export)|acceptance-business-skill-evidence|acceptance-triage|acceptance-evidence-matrix|acceptance-execution-suite|acceptance-control-plane|performance-policy|tool-decision-contract|tool-execution-preflight|tool-stream|runtime-guard|step-events|task-completion-contract|preference-feedback|response-knowledge)|smoke-agent-tool-decision-contract|smoke-chat-response-cleaner|smoke-detail-page-(document-preflight-routing|skill-readiness|readiness-wiring|dpi-readonly-evidence)|smoke-provider-native-tools|smoke-searxng-design-knowledge|smoke-design-knowledge-settings-entry|smoke-design-knowledge-runtime-capability|smoke-design-knowledge-eagle-readonly|smoke-design-knowledge-eagle-case-index|smoke-eagle-writeback-gate|smoke-design-learning-(experience|memory-review|memory-persistence|runtime-runner|daily-workflow|reference-analyzer)|smoke-design-placement-(intelligence|candidate-ranking)|smoke-xiaomi-web-search-runtime-wiring|smoke-live-photoshop-acceptance-evidence-intake|report-agent-acceptance-evidence-matrix|smoke-business-skill-(implementation-checkpoint|readiness-contract|execution-preflight-gate|execution-preflight-wiring|preflight-planner-context|execution-intake|image-placement-verification-intake|execution-plan-intake|memory-(evidence|strategy)|visual-evidence-refresh-(plan|runner|runtime|executor-wiring)|visual-evidence-pre-execution-gate|visual-evidence-(control-decision|diagnostic|gate|feedback)|design-governance)|smoke-project-asset-understanding-intake|smoke-project-asset-index|smoke-project-visual-sampling|smoke-project-visual-insight-cache|smoke-image-placement-(core|readiness)|smoke-chat-ui-business-visual-feedback|smoke-project-context-runtime|smoke-main-image-(agent-draft-plan|strategy-contract|strategy-input-builder|dpi-readonly-evidence|asset-hero-strategy|design-standards-evidence|design-readiness-report|live-executor-request|live-executor-checkpoint|live-photoshop-adapter-contract|live-tool-adapter-disposable|asset-selection|visual-loop|vision-preflight|candidate-preflight|execution-alignment|screenshot-qa|screenshot-probe-readiness|pixel-probe-adapter|controlled-product-qa-gate|controlled-product-qa-bridge|qa-report|memory-evidence|white-bg-sku-material-contract)|smoke-sku-(design-preflight|dpi-readonly-evidence)|report-main-image-screenshot-probe-readiness|smoke-design-knowledge-search|smoke-design-memory-knowledge|smoke-preferences-(service-contract|settings-entry)|smoke-provider-stream-policy|smoke-stream-chat-service-errors|smoke-chat-error-summary|smoke-model-selection-routing|smoke-model-routing-live-quality|smoke-tool-dependencies-param-targets|smoke-skill-boundaries|smoke-document-management-skill|smoke-layer-management-skill|smoke-find-smart-observability|smoke-design-team-coordinator|smoke-design-grid-dsl|smoke-model-provider-(deepseek|xiaomi)/.test(entry.filePath)
  },
  {
    id: 'shape-morphing-tools',
    title: '形态工具相关',
    validation: ['Confirm tool-only boundary; do not expose as current Agent mainline'],
    match: (entry) => /shape-morphing|sock-morphing|sock-shape|morphing/.test(entry.filePath)
  },
  {
    id: 'main-process-infra',
    title: '主进程基础设施',
    validation: ['npm run build:main', 'npm run smoke:stream-adapter:http-errors', 'npm run smoke:chat-ui:electron-bridge'],
    match: (entry) => /src\/main\/(index|preload)\.ts|src\/main\/config\/network-ports\.ts|src\/main\/ipc-handlers\/(config-handlers|index|websocket-handlers|stream-handlers)\.ts|src\/main\/testing\/|provider-adapters|stream-adapter|smoke-stream-adapter-http-errors/.test(entry.filePath)
  },
  {
    id: 'uxp-bridge-core',
    title: 'UXP 桥接与 Photoshop 工具核心',
    validation: ['npm run build:main', 'DesignEcho-UXP npm run build', 'npm run smoke:photoshop-bridge-health', 'npm run smoke:photoshop:controlled-script-execution', 'npm run smoke:photoshop:controlled-text-style-execution', 'npm run smoke:photoshop:controlled-export-execution', 'npm run smoke:photoshop:controlled-image-placement-execution', 'npm run smoke:photoshop:controlled-image-placement-execution-live (manual live, requires Photoshop + UXP)', 'npm run smoke:photoshop:rasterize-popup-guard-live (manual live, requires Photoshop + UXP)', 'npm run smoke:uxp:layer-hierarchy-tools', 'npm run smoke:uxp:group-export-tool', 'npm run smoke:uxp-agent:connection-recovery'],
    match: (entry) => /mcp-host-service|check-photoshop-bridge-health|photoshop-controlled-(script|text-style|export|image-placement)-execution|smoke-photoshop-controlled-(script|text-style|export|image-placement)-execution|smoke-photoshop-rasterize-popup-guard-live|src\/main\/websocket\/server\.ts|smoke-uxp-agent-connection-recovery|smoke-photoshop-mcp|smoke-uxp-group-export-tool|uxp-handlers\/index\.ts|uxp-handlers\/types|uxp-handlers\/template-library-handlers|binary-protocol|websocket-client|DesignEcho-UXP\/scripts\/smoke-(create-shape-execution-guard|image-generation-error-helpers|image-generation-options|image-to-image-selection|template-library-core|template-library-state-coordinator|webview-panel-layout|webview-message-core|image-safety|inpainting-image-safety|layer-property-effect-execution-guard|layer-selection-layout-guard|modal-behavior-execution-guard|place-event-image-safety-guard|place-image-execution-guard|reorder-layer-execution-guard|save-export-execution-guard|smart-object-content-execution-guard|tool-error-normalizer|transform-layer-execution-guard|write-tool-failure-normalizer|sock-layout-config|sku-layout-combos-validation|sku-auto-layout-plan|sku-auto-layout-post-qa|sku-layout-auto-planner-integration|main-image-white-bg-from-sku-tool)\.cjs|DesignEcho-UXP\/src\/index\.ts|DesignEcho-UXP\/src\/core\/(base64|canvas-refresh|friendly-progress|image-generation-errors|image-generation-options|image-to-image-selection|image-generation-stage-labels|template-library-core|template-library-state-coordinator|webview-panel-layout|webview-message-core|jsx-bridge|message-handler|mcp-protocol|image-safety|tool-error-normalizer)\.ts|DesignEcho-UXP\/src\/tools\/registry\.ts|DesignEcho-UXP\/src\/tools\/sku\/|DesignEcho-UXP\/src\/tools\/text\/|DesignEcho-UXP\/src\/tools\/layer\/(layer-properties|layer-effects|replace-content|smart-object-tools|transform-layer)|DesignEcho-UXP\/src\/tools\/canvas\/(close-document|create-shape|save-document)|DesignEcho-UXP\/src\/tools\/layout\/(align-layers|align-to-reference|distribute-layers|move-layer|focus-layer|select-layer|smart-layout-engine)|DesignEcho-UXP\/src\/tools\/image\/(export-group|inpainting|place-image|white-bg-from-sku-material)|screen-snapshot|optimized-image-transfer|export-layer|get-subject-bounds|remove-background|clipping-mask|rename-layer|reorder-layer|sku-layout-tool|visual-analysis/.test(entry.filePath)
  },
  {
    id: 'app-branding-icons',
    title: '应用图标与品牌资源',
    validation: ['manual icon review', 'npm run build:renderer', 'DesignEcho-UXP npm run build'],
    match: (entry) => /DesignEcho-Agent\/resources\/(icon|logo)|DesignEcho-Agent\/scripts\/generate-app-icons|DesignEcho-Agent\/scripts\/generate-uxp-icons|DesignEcho-UXP\/icons\/|DesignEcho-UXP\/scripts\/generate.*icons/.test(entry.filePath)
  },
  {
    id: 'renderer-ui-shell',
    title: 'Renderer UI 与应用状态',
    validation: ['npm run build:typecheck:renderer', 'npm run smoke:settings-modal-tabs-layout', 'npm run smoke:ui:workbench-information-architecture', 'npm run smoke:ui:user-facing-language-boundary', 'npm run smoke:ui:agent-process-inspector', 'npm run smoke:ui:human-review-intake', 'npm run smoke:ui:human-review-record-persistence', 'npm run smoke:ui:asset-gallery-polish', 'npm run smoke:ui:eagle-asset-candidates', 'npm run smoke:ui:design-result-review-panel'],
    match: (entry) => /src\/renderer\/(App|types)\.(tsx?|d\.ts)$|src\/renderer\/index\.html|src\/renderer\/styles\/index\.css|components\/Header\.tsx|components\/((DesignAgentWorkbench|WorkflowBoard|WorkflowCanvasNodePreview|ProjectManager|WorkspaceTabBar|ThinkingModeControl)\.(tsx|css)|EagleAssetCandidatesPanel\.tsx|AssetGallery\.tsx|asset-gallery-view-model\.ts|workflow-graph-persistence\.ts)|ChatPanel|SettingsModal|ThinkingProcess|ExecutionStatus|hooks\/(index|useChatActions|useExecution)\.ts|app\.store|components\/message\/MessageRenderer\.(tsx|css)|components\/message\/blocks\/(ThinkingBlock|ToolResultBlock)|components\/message\/parser\.ts|services\/tool-display-info\.ts|services\/(agent-visible-feedback|tool-display-info|memory|eagle-asset-candidates)\.service\.ts|src\/shared\/agent-process-inspector\.ts|src\/shared\/design-result-review-panel\.ts|src\/shared\/eagle-asset-candidates-panel\.ts|src\/shared\/eagle-candidate-visual-handoff\.ts|src\/shared\/human-review-(intake|record)\.ts|src\/shared\/ui-action-tool-params\.ts|smoke-settings-modal-tabs-layout|smoke-ui-(workbench-information-architecture|user-facing-language-boundary|agent-process-inspector|human-review-intake|asset-gallery-polish|eagle-asset-candidates|design-result-review-panel|sock-layout-panel-entry)|smoke-chat-ui-(electron-bridge|execution-chain|running-window)|inspect-chat-ui-running-window|smoke-human-review-record-persistence|public\/webview\/design-library\.js/.test(entry.filePath)
  },
  {
    id: 'design-skill-execution-core',
    title: '设计 skill 与执行核心',
    validation: ['npm run build:main', 'npm run build:typecheck:renderer', 'npm run smoke:agent:intent-engine', 'npm run smoke:ecommerce-socks-design:entry', 'npm run smoke:ecommerce-socks-design:strategy-checkpoint', 'npm run smoke:ecommerce-socks-design:child-strategy-packets', 'npm run smoke:ecommerce-socks-design:child-strategy-review-gate', 'npm run smoke:ecommerce-socks-design:child-strategy-handoff', 'npm run smoke:ecommerce-socks-design:child-strategy-consumption', 'npm run smoke:ecommerce-socks-design:dispatch-checkpoint', 'npm run smoke:ecommerce-socks-design:dispatch-lifecycle', 'npm run smoke:ecommerce-socks-design:dispatch-orchestration', 'npm run smoke:ecommerce-socks-design:dispatch-authorization', 'npm run smoke:ecommerce-socks-design:child-dispatch-runner', 'npm run smoke:ecommerce-socks-design:child-report-aggregation', 'npm run smoke:main-image:design-skill', 'npm run smoke:main-image:strategy-contract', 'npm run smoke:main-image:strategy-input-builder', 'npm run smoke:main-image:asset-hero-strategy', 'npm run smoke:main-image:project-style-strategy', 'npm run smoke:main-image:design-standards', 'npm run smoke:main-image:design-readiness', 'npm run smoke:main-image:live-executor-checkpoint', 'npm run smoke:main-image:live-photoshop-adapter-contract', 'npm run smoke:main-image:live-adapter-handoff', 'npm run smoke:main-image:disposable-product-e2e:self-test', 'npm run smoke:main-image:disposable-product-e2e', 'npm run smoke:main-image:executor-controlled-product-branch', 'npm run smoke:main-image:controlled-product-qa-gate', 'npm run smoke:main-image:controlled-product-qa-bridge', 'npm run smoke:uxp:layer-hierarchy-tools', 'npm run smoke:uxp:group-export-tool', 'npm run smoke:main-image:photoshop-tool-capability-matrix', 'npm run smoke:main-image:group-hierarchy-contract', 'npm run smoke:main-image:variant-placement-strategy', 'npm run smoke:main-image:production-structure', 'npm run smoke:main-image:production-execution-plan', 'npm run smoke:main-image:production-executor-handoff', 'npm run smoke:main-image:production-executor-bridge', 'npm run smoke:main-image:production-executor-dry-run', 'npm run smoke:text-font-replace:skill', 'npm run smoke:detail-page:mcp', 'npm run smoke:detail-page:template-parser-policy', 'npm run smoke:sku:self-select-note-policy', 'npm run smoke:sku:contrast-pair-policy', 'npm run smoke:sku:execution-manifest', 'npm run smoke:sku:configured-execution-plan', 'npm run smoke:sku:no-placeholder-live-acceptance:self-test', 'npm run smoke:sku:no-placeholder-live-acceptance', 'npm run smoke:sku:export-readback', 'npm run smoke:sku:visual-review-intake', 'npm run smoke:sku:color-card-retouch-strategy', 'npm run smoke:sku:color-card-image-probes', 'npm run smoke:sku:c1163-live-readiness:self-test', 'npm run smoke:sku:c1163-live-readiness', 'npm run smoke:matte-product:skill', 'npm run smoke:template-project:observability', 'npm run smoke:analysis-reference:observability', 'npm run smoke:find-smart:observability', 'npm run smoke:copywriting:framework'],
    match: (entry) => /ecommerce-socks-design|ecommerce-socks-strategy-checkpoint|ecommerce-socks-child-strategy-packets|ecommerce-socks-child-strategy-review-gate|ecommerce-socks-child-strategy-handoff|ecommerce-socks-child-strategy-consumer|detail-page\.executor|detail-page-parser|detail-page-screen-plan|smoke-detail-page-(template-(parser-policy|live-case|export-policy)|agent-decision-boundary)|detail-page-design\.skill|main-image-design\.skill|main-image-(strategy-contract|asset-hero-strategy|project-style-strategy|design-standards-evidence|design-readiness-report|live-executor-request|live-executor-(checkpoint|runner)|controlled-product-qa-gate|controlled-product-qa-bridge|live-photoshop-adapter-contract|live-adapter-handoff|live-photoshop-tool-adapter|photoshop-tool-capability-matrix|group-hierarchy-contract|variant-placement-strategy|production-document-structure|production-execution-plan|production-executor-handoff|production-executor-bridge|production-executor-dry-run|copy-strategy|design-concept-plan|design-core|white-background-export-contract)|main-image\.executor|sku-batch\.executor|sku-delivery-summary|sku-export-readback|sku-configured-execution-plan|sku-layout-execution-batches|sku-auto-layout-executor-policy|sku-visual-review-intake|sku-color-card-retouch-strategy|sku-color-card-image-probes|text-font-replace\.executor|matte-product\.executor|template-save\.executor|project-image-analysis(\.executor|-intent)|agent-panel-bridge\.executor|design-reference-search\.executor|visual-analysis\.executor|find-edit-element\.executor|smart-layout\.executor|skill-step-events|sku-self-select-note-policy|sku-intent-params|knowledge\/socks-categories|agent-system-prompt|smoke-sku-(self-select-note-policy|contrast-pair-policy|intent-params|result-status|project-source-policy|execution-manifest|configured-execution-plan|auto-layout-executor-policy|no-placeholder-live-acceptance|export-readback|visual-review-intake|color-card-retouch-strategy|color-card-image-probes|c1163-live-acceptance)|smoke-main-image-(design-skill|strategy-contract|strategy-input-builder|dpi-readonly-evidence|asset-hero-strategy|project-style-strategy|design-standards-evidence|design-readiness-report|live-executor-request|live-executor-(checkpoint|runner)|controlled-product-qa-gate|controlled-product-qa-bridge|live-photoshop-adapter-contract|live-adapter-handoff|live-photoshop-tool-adapter|disposable-product-e2e|executor-controlled-product-branch|uxp-toolchain-live|photoshop-tool-capability-matrix|group-hierarchy-contract|variant-placement-strategy|production-structure|production-execution-plan|production-executor-handoff|production-executor-bridge|production-executor-dry-run|copy-strategy|design-concept-plan|design-core|white-bg-sku-material-contract)|smoke-uxp-layer-hierarchy-tools|smoke-uxp-group-export-tool|smoke-text-font-replace-skill|smoke-matte-product-skill|smoke-template-project-observability|smoke-analysis-reference-observability|smoke-find-smart-observability|smoke-text-optimization-contract|smoke-copywriting-framework|design-copywriting-framework|uxp-handlers\/text-handlers|matting-service|resource-manager-service|autonomous-agent\.executor|skill-executors\/index\.ts|skill-executors\/types\.ts|tool-executor\.service|template-knowledge\.service|reference-analysis|skill-param-defaults|types\.d\.ts|types\/skill\.types/.test(entry.filePath)
  },
  {
    id: 'package-and-deps',
    title: '包配置、依赖与构建配置',
    validation: ['npm install consistency check if dependency versions changed', 'npm run build'],
    match: (entry) => /package(-lock)?\.json$/.test(entry.filePath) || entry.filePath.endsWith('webpack.config.js')
  },
  {
    id: 'engineering-plans',
    title: '工程规划文档',
    validation: ['manual review'],
    match: (entry) => /REFACTOR-PLAN\.md|project-master-plan|documentation-governance|design-agent-operating-system|design-agent-os-implementation-tree|design-knowledge-web-search-plan|ecommerce-socks-design-skill-plan|layout-grid-design-knowledge|agent-foundation-completion-plan|agent-capability-map|agent-development-methodology|agent-architecture(\.md|-system-review\.md)|design-agent-(execution-plan|research-and-roadmap|development-knowledge-base)|design-planner-mvp-plan/.test(entry.filePath)
  },
  {
    id: 'other-source',
    title: '其他源码改动',
    validation: ['npm run build:main', 'npm run build:typecheck:renderer'],
    match: (entry) => entry.filePath.includes('/src/')
  },
  {
    id: 'other-docs',
    title: '其他文档',
    validation: ['manual review'],
    match: (entry) => entry.filePath.includes('/docs/') || entry.filePath.startsWith('docs/')
  },
  {
    id: 'other',
    title: '其他未归类改动',
    validation: ['manual review'],
    match: () => true
  }
];

function classify(entry) {
  if (/DesignEcho-Agent\/scripts\/smoke-agent-thinking-tool-boundary\.cjs$/.test(entry.filePath)) {
    return findBoundary('agent-routing-models');
  }

  return BOUNDARIES.find((boundary) => boundary.match(entry));
}

function getStatusEntries(root) {
  const statusOutput = runGit(['status', '--porcelain=v1', '--untracked-files=all'], root);
  return statusOutput ? statusOutput.split(/\r?\n/).filter(Boolean).map(parseStatusLine) : [];
}

function buildReport() {
  const root = getRepoRoot();
  const entries = getStatusEntries(root);
  const groups = new Map(BOUNDARIES.map((boundary) => [boundary.id, {
    title: boundary.title,
    count: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    examples: [],
    validation: boundary.validation
  }]));

  for (const entry of entries) {
    const boundary = classify(entry);
    const group = groups.get(boundary.id);
    group.count += 1;
    if (entry.status[0] !== ' ' && entry.status !== '??') group.staged += 1;
    if (entry.status[1] !== ' ' || entry.status === '??') group.unstaged += 1;
    if (entry.status === '??') group.untracked += 1;
    if (group.examples.length < 10) group.examples.push(`${entry.status} ${entry.filePath}`);
  }

  return {
    repoRoot: root,
    pendingChangeCount: entries.length,
    // Backward-compatible alias for older local notes/scripts.
    total: entries.length,
    groups: Object.fromEntries([...groups.entries()].filter(([, group]) => group.count > 0)),
    recommendation: [
      'Commit maintenance cleanup separately from feature work.',
      'Do not mix reference replication, smart scaling, inpainting, routing, and morphing changes in one commit.',
      'Run the validation commands listed for each group before claiming the group is complete.'
    ]
  };
}

function formatSummary(report) {
  const lines = [`repoRoot: ${report.repoRoot}`, `pendingChangeCount: ${report.pendingChangeCount}`, '', 'change boundaries:'];
  for (const [id, group] of Object.entries(report.groups)) {
    lines.push(`- ${id}: ${group.count} (staged ${group.staged}, unstaged ${group.unstaged}, untracked ${group.untracked}) - ${group.title}`);
  }
  return lines.join('\n');
}

function findBoundary(id) {
  return BOUNDARIES.find((boundary) => boundary.id === id);
}

function entriesForBoundary(root, boundaryId) {
  const boundary = findBoundary(boundaryId);
  if (!boundary) {
    throw new Error(`Unknown boundary: ${boundaryId}`);
  }

  return getStatusEntries(root).filter((entry) => classify(entry).id === boundaryId);
}

function formatBoundaryEntries(entries) {
  return entries.map((entry) => `${entry.status} ${entry.filePath}`).join('\n');
}

function formatBoundaryPaths(entries) {
  return entries.map((entry) => entry.filePath).join('\n');
}

function formatBoundaryValidation(boundaryId) {
  const boundary = findBoundary(boundaryId);
  if (!boundary) {
    throw new Error(`Unknown boundary: ${boundaryId}`);
  }

  return [
    `${boundary.id}: ${boundary.title}`,
    '',
    'validation:',
    ...boundary.validation.map((command) => `- ${command}`)
  ].join('\n');
}

function getUncategorizedGroupIds(report) {
  return ['other', 'other-source', 'other-docs'].filter((id) => report.groups[id]?.count > 0);
}

function main() {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const root = getRepoRoot();
  const optionValue = (optionName) => {
    const index = rawArgs.indexOf(optionName);
    return index >= 0 ? rawArgs[index + 1] : null;
  };
  const requireOptionValue = (optionName) => {
    const value = optionValue(optionName);
    if (!value || value.startsWith('--')) {
      throw new Error(`${optionName} requires a boundary id`);
    }
    return value;
  };

  if (args.has('--paths')) {
    const pathsBoundary = requireOptionValue('--paths');
    console.log(formatBoundaryPaths(entriesForBoundary(root, pathsBoundary)));
    return;
  }

  if (args.has('--entries')) {
    const entriesBoundary = requireOptionValue('--entries');
    console.log(formatBoundaryEntries(entriesForBoundary(root, entriesBoundary)));
    return;
  }

  if (args.has('--validation')) {
    const validationBoundary = requireOptionValue('--validation');
    console.log(formatBoundaryValidation(validationBoundary));
    return;
  }

  const report = buildReport();
  if (args.has('--summary')) {
    console.log(formatSummary(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (args.has('--fail-on-uncategorized')) {
    const uncategorized = getUncategorizedGroupIds(report);
    if (uncategorized.length > 0) {
      console.error(`Uncategorized change boundaries found: ${uncategorized.join(', ')}`);
      process.exitCode = 2;
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
