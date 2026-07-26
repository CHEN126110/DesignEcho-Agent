#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildEcommerceSocksStrategyCheckpoint
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-strategy-checkpoint.ts'));
const {
  buildEcommerceSocksChildStrategyPacketSet
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-packets.ts'));
const {
  buildEcommerceSocksChildStrategyReviewGate
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-review-gate.ts'));
const {
  buildMainImageAgentDraftPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-agent-draft-plan.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} must not expose confidence fields`, value);
}

const requiredInputs = [
  'heroSubjectPolicy',
  'assetSelectionPolicy',
  'imagePlacementPolicy',
  'smartScalingPolicy',
  'copyRolePolicy',
  'exportAcceptancePolicy',
  'performanceBudget'
];

const parentStrategyInputs = {
  designStandards: true,
  knowledgeRecipeSource: true,
  assetUnderstanding: true,
  imagePlacementPlan: true,
  photoshopToolPlan: true,
  qaAcceptancePlan: true,
  performanceBudget: true
};

const readySizePlans = [{
  sizeKey: '800',
  targetSize: { width: 800, height: 800 },
  subjectSize: { width: 760, height: 820 },
  scale: 0.67,
  targetX: 118,
  targetY: 92,
  decisionReason: 'main image guideline scale 67%',
  layoutCandidateScore: 84,
  layoutCandidateReason: 'subject centered with copy safe area',
  smartLayoutPlanned: true,
  quickExportPlanned: true
}];

const readyContext = {
  userText: '帮我用这张袜子图做主图',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  selectedAsset: {
    id: 'asset-1',
    name: 'white-socks.jpg',
    path: 'C:/project/assets/white-socks.jpg',
    width: 1600,
    height: 1600,
    role: 'selected-project-image'
  },
  projectAssets: [
    { name: 'white-socks.jpg', path: 'C:/project/assets/white-socks.jpg', role: 'selected-project-image' },
    { name: 'detail-shot.jpg', path: 'C:/project/assets/detail-shot.jpg', role: 'project-image' }
  ],
  subjectBounds: { left: 170, top: 150, right: 930, bottom: 970, width: 760, height: 820 },
  sizePlans: readySizePlans,
  copyCandidates: ['轻薄透气，春夏出行更自在'],
  outputDir: 'C:/Exports',
  toolNames: ['getDocumentInfo', 'getLayerBounds', 'smartLayout[800]', 'quickExport[800]'],
  visionSignal: {
    source: 'vision-model',
    assetRef: { id: 'asset-1', path: 'C:/project/assets/white-socks.jpg', name: 'white-socks.jpg' },
    productType: '堆堆袜',
    subjectSummary: '白色袜子主体，适合白底主图',
    backgroundSummary: '简洁浅色背景',
    confidence: 0.72,
    sourceNotes: ['视觉模型返回商品类型与主体描述']
  }
};

function buildApprovedGate() {
  const checkpoint = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: true,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': parentStrategyInputs,
      'detail-page-design': parentStrategyInputs,
      'sku-batch': parentStrategyInputs
    }
  });
  const packetSet = buildEcommerceSocksChildStrategyPacketSet({ strategyCheckpoint: checkpoint });
  return buildEcommerceSocksChildStrategyReviewGate({
    packetSet,
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch']
  });
}

function assertAllInputsProvided(context) {
  for (const key of requiredInputs) {
    assert(Object.prototype.hasOwnProperty.call(context.strategyInputs, key), `missing ${key}`, context);
  }
  assert(context.missingInputs.length === 0, 'ready context should not miss strategy inputs', context);
}

function run() {
  const empty = buildMainImageStrategyInputs({ userText: '帮我做主图' });
  assert(empty.version === 'main-image-strategy-input-builder/v0', 'builder version mismatch', empty);
  assert(empty.noPhotoshopWrites === true, 'builder must be read-only', empty);
  assert(empty.mustNotExecutePhotoshop === true, 'builder must not execute Photoshop', empty);
  assert(empty.status === 'blocked_missing_strategy_inputs', 'empty context should be blocked by missing context', empty);
  assert(empty.missingInputs.includes('assetSelectionPolicy'), 'empty context should miss asset selection policy', empty);
  assert(empty.missingInputs.includes('heroSubjectPolicy'), 'empty context should miss hero subject policy', empty);
  assert(empty.missingInputs.includes('smartScalingPolicy'), 'empty context should miss smart scaling policy', empty);
  assertNoRawPayload(empty, 'empty strategy input bundle');

  const ready = buildMainImageStrategyInputs({
    ...readyContext,
    userText: 'raw-image-payload 帮我用这张袜子图做主图 data:image/png;base64,abc'
  });
  assert(ready.status === 'ready_for_strategy_contract', 'ready context should be ready for strategy contract', ready);
  assertAllInputsProvided(ready);
  assert(ready.canClaimDesignComplete === false, 'strategy inputs cannot claim design complete', ready);
  assert(ready.canClaimOutputQuality === false, 'strategy inputs cannot claim quality', ready);
  assertNoRawPayload(ready, 'ready strategy input bundle');

  const readyWithKnowledge = buildMainImageStrategyInputs({
    ...readyContext,
    knowledgeResults: [
      {
        id: 'web:main-image-reference',
        title: '袜子主图参考',
        intent: 'reference',
        sourceType: 'web_page',
        summary: '浅色袜子主图常用干净背景、主体放大和短标题。',
        sourceNotes: ['Source URL: https://example.com/socks-main-image', 'Boundary: external web knowledge only.'],
        tags: ['socks', 'main-image'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'external_snippet',
        sourceRank: 58,
        sourceUrl: 'https://example.com/socks-main-image',
        updatedAt: '2026-05-26T00:00:00.000Z'
      },
      {
        id: 'blocked:direct-action',
        title: '不应进入主图参考的动作结果',
        intent: 'reference',
        sourceType: 'web_page',
        summary: '这个结果用途不允许进入主图上下文。',
        sourceNotes: ['should be filtered'],
        tags: [],
        allowedUses: ['benchmark_seed'],
        sourceLevel: 'external_snippet',
        sourceRank: 100
      }
    ]
  });
  assert(
    readyWithKnowledge.projectStyleStrategy.referenceResearchPlan.referenceHintCount === 1,
    'knowledge results should map into main-image reference hints',
    readyWithKnowledge.projectStyleStrategy.referenceResearchPlan
  );
  assert(
    readyWithKnowledge.copyStrategy.productCopyContext.referenceNotes.some((note) => note.includes('袜子主图参考')),
    'mapped knowledge should reach copy context reference notes',
    readyWithKnowledge.copyStrategy.productCopyContext
  );
  assert(
    readyWithKnowledge.strategyInputs.copyRolePolicy.referenceCount === 1,
    'copy role policy should expose mapped reference count',
    readyWithKnowledge.strategyInputs.copyRolePolicy
  );
  assertNoRawPayload(readyWithKnowledge.projectStyleStrategy.referenceResearchPlan, 'mapped main-image references');
  assertNoConfidence(readyWithKnowledge.projectStyleStrategy.referenceResearchPlan, 'mapped main-image references');
  assertNoConfidence(readyWithKnowledge.strategyInputs.copyRolePolicy, 'mapped copy role policy');

  const withoutSubject = buildMainImageStrategyInputs({
    ...readyContext,
    subjectBounds: null
  });
  assert(withoutSubject.status === 'blocked_missing_strategy_inputs', 'missing subject bounds should block strategy inputs', withoutSubject);
  assert(withoutSubject.missingInputs.includes('heroSubjectPolicy'), 'missing subject should miss hero policy', withoutSubject);
  assert(withoutSubject.missingInputs.includes('imagePlacementPolicy'), 'missing subject should miss placement policy', withoutSubject);
  assert(withoutSubject.missingInputs.includes('smartScalingPolicy'), 'missing subject should miss smart scaling policy', withoutSubject);
  assert(Boolean(withoutSubject.strategyInputs.assetSelectionPolicy), 'asset policy should still be available when asset exists', withoutSubject);
  assertNoRawPayload(withoutSubject, 'subject-missing strategy input bundle');

  const draft = buildMainImageAgentDraftPlan({
    ...readyContext,
    strategyReviewGate: buildApprovedGate()
  });
  assert(draft.mainImageStrategyInputBundle, 'draft should expose generated strategy input bundle', draft);
  assert(draft.mainImageStrategyInputBundle.status === 'ready_for_strategy_contract', 'draft generated bundle should be ready', draft.mainImageStrategyInputBundle);
  assert(draft.mainImageStrategyContract.status === 'ready_for_main_image_strategy_design', 'draft should feed generated inputs into strategy contract', draft.mainImageStrategyContract);
  assert(draft.mainImageStrategyContract.missingInputs.length === 0, 'draft strategy contract should have no missing inputs', draft.mainImageStrategyContract);
  assertNoRawPayload(draft.mainImageStrategyInputBundle, 'draft strategy input bundle');

  const draftWithReferenceHints = buildMainImageAgentDraftPlan({
    ...readyContext,
    referenceHints: [{
      title: '人工收集的主图参考',
      source: 'manual-reference',
      url: 'https://example.com/manual-reference',
      note: '主体放大、浅背景、短标题。'
    }],
    strategyReviewGate: buildApprovedGate()
  });
  assert(
    draftWithReferenceHints.mainImageStrategyInputBundle.projectStyleStrategy.referenceResearchPlan.referenceHintCount === 1,
    'draft plan should pass reference hints into generated strategy inputs',
    draftWithReferenceHints.mainImageStrategyInputBundle.projectStyleStrategy.referenceResearchPlan
  );

  const draftWithoutSubject = buildMainImageAgentDraftPlan({
    ...readyContext,
    subjectBounds: null,
    strategyReviewGate: buildApprovedGate()
  });
  assert(draftWithoutSubject.mainImageStrategyInputBundle, 'draft without subject should still expose context object', draftWithoutSubject);
  assert(draftWithoutSubject.mainImageStrategyContract.status === 'blocked_missing_strategy_inputs', 'draft without subject should not pass strategy contract', draftWithoutSubject.mainImageStrategyContract);
  assert(draftWithoutSubject.mainImageStrategyContract.missingInputs.includes('heroSubjectPolicy'), 'draft without subject should miss hero policy', draftWithoutSubject.mainImageStrategyContract);
  assert(draftWithoutSubject.mainImageStrategyContract.missingInputs.includes('smartScalingPolicy'), 'draft without subject should miss smart scaling policy', draftWithoutSubject.mainImageStrategyContract);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'strategy input builder is read-only and cannot execute Photoshop',
      'missing context does not fabricate main-image strategy inputs',
      'ready context produces all strategy contract inputs',
      'knowledge results map into main-image reference context without confidence fields',
      'subject bounds are required for hero, placement and smart scaling policy',
      'main-image draft plan consumes generated strategy inputs when manual inputs are absent'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
