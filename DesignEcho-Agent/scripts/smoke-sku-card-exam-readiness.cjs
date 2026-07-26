#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  buildSkuCardExamReadiness
} = require('../src/shared/sku-card-exam-readiness.ts');
const {
  buildSkuCardSourcePreparationPlan
} = require('../src/shared/sku-card-source-preparation-plan.ts');
const {
  buildSkuCardTemplatePreparationPlan
} = require('../src/shared/sku-card-template-preparation-plan.ts');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

function asset(id, relativePath, role, folderRole = 'source') {
  return {
    id,
    path: `C:/fixture/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop(),
    extension: relativePath.includes('.') ? `.${relativePath.split('.').pop()}` : '',
    sizeBytes: 1000,
    folderRole,
    role,
    comboColors: [],
    isImage: /\.(jpg|jpeg|png|webp)$/i.test(relativePath),
    isDesignDocument: /\.(psd|psb|tif|tiff)$/i.test(relativePath),
    isOutput: false,
    needsVision: false,
    confidence: 0.8,
    reasons: [],
    classificationNotes: []
  };
}

function index(assets, skuConfigCount = 0) {
  return {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: assets.length,
      totalImages: assets.filter((item) => item.isImage).length,
      totalDesignDocuments: assets.filter((item) => item.isDesignDocument).length,
      roleCounts: {},
      folderRoleCounts: {},
      extensionCounts: {},
      colorNames: [],
      skuConfigCount
    },
    assets,
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  };
}

const readyCandidateReport = {
  version: 'sku-card-asset-candidates/v0',
  mode: 'card-style',
  status: 'ready_for_selection',
  candidateCount: 1,
  candidates: [{
    assetId: 'flat',
    path: 'C:/fixture/flat.jpg',
    relativePath: 'flat.jpg',
    role: 'raw-product-still',
    score: 120,
    recommendedUse: 'primary_sku_card',
    needsVisualConfirmation: false,
    visualObservationStatus: 'matched_insight',
    reasons: [],
    warnings: []
  }],
  blockers: [],
  warnings: [],
  limitations: [],
  sourceRecords: []
};

const needsVisualCandidateReport = {
  ...readyCandidateReport,
  status: 'needs_visual_confirmation',
  candidates: [{ ...readyCandidateReport.candidates[0], needsVisualConfirmation: true }]
};

const ready = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: readyCandidateReport,
  assetIndex: index([
    asset('sku-source', 'PSD/SKU.psb', 'psd', 'psd'),
    asset('tpl2', '模板文件/2双装.tif', 'template', 'template'),
    asset('tpl2n', '模板文件/2双自选备注.tif', 'template', 'template'),
    asset('tpl3', '模板文件/3双装.tif', 'template', 'template'),
    asset('tpl3n', '模板文件/3双自选备注.tif', 'template', 'template'),
    asset('tpl4', '模板文件/4双装.tif', 'template', 'template'),
    asset('tpl4n', '模板文件/4双自选备注.tif', 'template', 'template'),
    asset('csv', '配置文件/1.csv', 'config', 'config')
  ], 3),
  referenceAssetIndex: index([asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku')])
});
assert(ready.readyForExecution === true, 'complete project should be ready for execution', ready);
assert(ready.status === 'ready_for_execution', 'complete project should expose ready status', ready);
assert(!Object.prototype.hasOwnProperty.call(ready, 'sourceRecords'), 'readiness should not fabricate module self-records', ready);
assert(!JSON.stringify(ready).includes('"evidence"'), 'readiness must not expose a generic evidence field', ready);

const blocked = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: needsVisualCandidateReport,
  assetIndex: index([asset('flat', '6036/平铺/flat.jpg', 'raw-product-still')]),
  referenceAssetIndex: index([asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku')])
});
assert(blocked.readyForExecution === false, 'missing SKU execution assets should not be ready', blocked);
assert(blocked.status === 'blocked_missing_execution_assets', 'missing assets should block execution', blocked);
assert(blocked.blockers.some((item) => item.includes('视觉确认')), 'blocked readiness should mention visual confirmation', blocked);
assert(blocked.blockers.some((item) => item.includes('SKU 源文档')), 'blocked readiness should mention missing SKU source', blocked);
assert(blocked.blockers.some((item) => item.includes('模板')), 'blocked readiness should mention missing templates', blocked);
assert(blocked.blockers.some((item) => item.includes('配置文件')), 'blocked readiness should mention missing config', blocked);

const existingProjectSkuSourceReady = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: {
    version: 'sku-card-asset-candidates/v0',
    mode: 'card-style',
    status: 'blocked_no_candidates',
    candidateCount: 0,
    candidates: [],
    blockers: [],
    warnings: [],
    limitations: [],
    sourceRecords: []
  },
  assetIndex: index([
    asset('sku-source', 'PSD/SKU.psb', 'psd', 'psd')
  ]),
  referenceAssetIndex: index([asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku')]),
  runtimeTemplateReadiness: {
    source: 'configured-local-template-library',
    templateCount: 6,
    comboSizes: [2, 3, 4],
    noteSizes: [2, 3, 4]
  },
  allowDynamicSkuConfig: true
});
assert(
  existingProjectSkuSourceReady.readyForExecution === true,
  'existing project PSD/SKU.psb should satisfy SKU source readiness without requiring image candidate confirmation',
  existingProjectSkuSourceReady
);
assert(
  existingProjectSkuSourceReady.checks.find((item) => item.id === 'visual-selection')?.summary.includes('已有 SKU 源文档'),
  'visual selection check should explain that image candidate confirmation is not required when SKU.psb already exists',
  existingProjectSkuSourceReady
);

const sourcePrepPlan = buildSkuCardSourcePreparationPlan({
  projectPath: 'E:/fixture/project',
  skuCardAssetCandidateReport: readyCandidateReport
});
assert(sourcePrepPlan.status === 'ready_for_preparation', 'fixture source prep plan should be ready', sourcePrepPlan);

const blockedSourcePrepPlan = buildSkuCardSourcePreparationPlan({
  projectPath: 'E:/fixture/project',
  skuCardAssetCandidateReport: needsVisualCandidateReport
});
const blockedSourcePrepReadiness = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: needsVisualCandidateReport,
  assetIndex: index([asset('flat', '6036/平铺/flat.jpg', 'raw-product-still')]),
  skuCardSourcePreparationPlan: blockedSourcePrepPlan,
  allowDynamicSkuConfig: true
});
assert(
  !blockedSourcePrepReadiness.blockers.some((item) => item.includes('。。')),
  'source preparation blockers should not duplicate Chinese punctuation',
  blockedSourcePrepReadiness
);

const runtimeReady = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: readyCandidateReport,
  assetIndex: index([asset('flat', '6036/平铺/flat.jpg', 'raw-product-still')]),
  referenceAssetIndex: index([asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku')]),
  skuCardSourcePreparationPlan: sourcePrepPlan,
  runtimeTemplateReadiness: {
    source: 'configured-local-template-library',
    templateCount: 6,
    comboSizes: [2, 3, 4],
    noteSizes: [2, 3, 4]
  },
  allowDynamicSkuConfig: true
});
assert(runtimeReady.readyForExecution === true, 'runtime template library plus source prep plan should be execution-ready', runtimeReady);
assert(runtimeReady.status === 'ready_for_execution', 'runtime-ready route should expose ready status', runtimeReady);
assert(
  runtimeReady.checks.find((item) => item.id === 'sku-source-document')?.summary.includes('Agent'),
  'runtime-ready source check should explain Agent source preparation instead of claiming project PSD exists',
  runtimeReady
);
assert(
  runtimeReady.checks.find((item) => item.id === 'sku-templates')?.summary.includes('运行时'),
  'runtime-ready template check should explain runtime template coverage',
  runtimeReady
);
assert(
  runtimeReady.checks.find((item) => item.id === 'sku-config')?.summary.includes('动态'),
  'runtime-ready config check should explain dynamic combo generation',
  runtimeReady
);

const readySourceWithExtraUnconfirmedReport = {
  ...readyCandidateReport,
  status: 'needs_visual_confirmation',
  candidateCount: 5,
  candidates: [
    ...[1, 2, 3, 4].map((index) => ({
      ...readyCandidateReport.candidates[0],
      assetId: `confirmed-${index}`,
      path: `C:/fixture/confirmed-${index}.jpg`,
      relativePath: `confirmed-${index}.jpg`,
      needsVisualConfirmation: false
    })),
    {
      ...readyCandidateReport.candidates[0],
      assetId: 'extra-unconfirmed',
      path: 'C:/fixture/extra-unconfirmed.jpg',
      relativePath: 'extra-unconfirmed.jpg',
      needsVisualConfirmation: true
    }
  ]
};
const readySourceWithExtraUnconfirmedPlan = buildSkuCardSourcePreparationPlan({
  projectPath: 'E:/fixture/project',
  skuCardAssetCandidateReport: readySourceWithExtraUnconfirmedReport,
  minimumSourceCount: 4
});
assert(
  readySourceWithExtraUnconfirmedPlan.status === 'ready_for_preparation',
  'source preparation should be ready when enough confirmed sources exist even if extra candidates still need review',
  readySourceWithExtraUnconfirmedPlan
);
const readySourceWithExtraUnconfirmedReadiness = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: readySourceWithExtraUnconfirmedReport,
  assetIndex: index([asset('flat', '6036/平铺/flat.jpg', 'raw-product-still')]),
  referenceAssetIndex: index([asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku')]),
  skuCardSourcePreparationPlan: readySourceWithExtraUnconfirmedPlan,
  runtimeTemplateReadiness: {
    source: 'configured-local-template-library',
    templateCount: 6,
    comboSizes: [2, 3, 4],
    noteSizes: [2, 3, 4]
  },
  allowDynamicSkuConfig: true,
  requirePreparedSourceDocument: true
});
assert(
  readySourceWithExtraUnconfirmedReadiness.readyForExecution === true,
  'extra unconfirmed SKU candidates must not block execution once the source preparation plan has enough confirmed sources',
  readySourceWithExtraUnconfirmedReadiness
);
assert(
  readySourceWithExtraUnconfirmedReadiness.checks.find((item) => item.id === 'visual-selection')?.ready === true,
  'visual selection check should be ready when confirmed sources are sufficient for source preparation',
  readySourceWithExtraUnconfirmedReadiness
);

const templatePrepPlan = buildSkuCardTemplatePreparationPlan({
  projectPath: 'E:/fixture/project',
  requiredSizes: [2, 3, 4],
  notePlaceholderCount: 8
});
const templatePrepReady = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: readyCandidateReport,
  assetIndex: index([asset('flat', '6036/平铺/flat.jpg', 'raw-product-still')]),
  referenceAssetIndex: index([asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku')]),
  skuCardSourcePreparationPlan: sourcePrepPlan,
  skuCardTemplatePreparationPlan: templatePrepPlan,
  allowDynamicSkuConfig: true
});
assert(templatePrepReady.readyForExecution === true, 'template preparation plan should satisfy missing SKU template readiness', templatePrepReady);
assert(
  templatePrepReady.checks.find((item) => item.id === 'sku-templates')?.summary.includes('Agent'),
  'template-prep readiness should explain Agent template preparation instead of claiming templates already exist',
  templatePrepReady
);

const referenceTemplatesOnly = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: readyCandidateReport,
  assetIndex: index([asset('flat', '6036/平铺/flat.jpg', 'raw-product-still')]),
  referenceAssetIndex: index([
    asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku'),
    asset('ref-tpl2', '模板文件/2双装.tif', 'template', 'template'),
    asset('ref-tpl2n', '模板文件/2双自选备注.tif', 'template', 'template'),
    asset('ref-tpl3', '模板文件/3双装.tif', 'template', 'template'),
    asset('ref-tpl3n', '模板文件/3双自选备注.tif', 'template', 'template'),
    asset('ref-tpl4', '模板文件/4双装.tif', 'template', 'template'),
    asset('ref-tpl4n', '模板文件/4双自选备注.tif', 'template', 'template')
  ]),
  skuCardSourcePreparationPlan: sourcePrepPlan,
  allowDynamicSkuConfig: true
});
assert(referenceTemplatesOnly.readyForExecution === false, 'reference project templates must not satisfy execution readiness', referenceTemplatesOnly);
assert(
  referenceTemplatesOnly.blockers.some((item) => item.includes('模板')),
  'reference-only template availability should still block execution',
  referenceTemplatesOnly
);

const existingSkuButPreparedSourceRequired = buildSkuCardExamReadiness({
  skuCardAssetCandidateReport: readyCandidateReport,
  assetIndex: index([
    asset('sku-source', 'PSD/SKU.psb', 'psd', 'psd'),
    asset('csv', '配置文件/1.csv', 'config', 'config')
  ], 1),
  referenceAssetIndex: index([asset('ref-sku', 'SKU/2双装/1.jpg', 'sku-output', 'sku')]),
  skuCardSourcePreparationPlan: blockedSourcePrepPlan,
  runtimeTemplateReadiness: {
    source: 'configured-local-template-library',
    templateCount: 6,
    comboSizes: [2, 3, 4],
    noteSizes: [2, 3, 4]
  },
  requirePreparedSourceDocument: true
});
assert(
  existingSkuButPreparedSourceRequired.readyForExecution === false,
  'card-source-from-project-images readiness must not let an old project SKU.psb satisfy the source document check',
  existingSkuButPreparedSourceRequired
);
assert(
  existingSkuButPreparedSourceRequired.checks.find((item) => item.id === 'sku-source-document')?.ready === false,
  'required prepared source route should report source document not ready when the preparation plan is blocked',
  existingSkuButPreparedSourceRequired
);

const examRunnerSource = fs.readFileSync(path.resolve(__dirname, 'run-sku-card-exam.cjs'), 'utf8');
assert(
  examRunnerSource.includes('visual-insights-cache.json'),
  'SKU card exam runner should read persisted visual insight cache'
);
assert(
  examRunnerSource.includes('buildProjectVisualInsightCacheReadResult'),
  'SKU card exam runner should build a sanitized visual insight read result'
);
assert(
  examRunnerSource.includes('buildSkuCardSourcePreparationPlan'),
  'SKU card exam runner should include the Agent source preparation route in readiness only'
);
assert(
  examRunnerSource.includes('buildSkuCardTemplatePreparationPlan'),
  'SKU card exam runner should include the Agent template preparation route in readiness only'
);
assert(
  examRunnerSource.includes('--include-runtime-template-library'),
  'SKU card exam runner should offer an explicit runtime template library inspection flag'
);
assert(
  examRunnerSource.includes('runtimeTemplateReadiness'),
  'SKU card exam runner should pass runtime template coverage into readiness'
);
assert(
  examRunnerSource.includes('resolver-settings.json'),
  'SKU card exam runner should inspect the configured template resolver settings without copying templates'
);
assert(
  examRunnerSource.includes('visualInsightCache'),
  'SKU card exam runner should pass visualInsightCache into the candidate report'
);
assert(
  examRunnerSource.includes('buildSkuCardVisualConfirmationPlan')
    && examRunnerSource.includes('visualConfirmationPlan'),
  'SKU card exam runner should expose a bounded SKU candidate visual confirmation plan'
);
assert(
  !/\b(?:copyFileSync|cpSync|renameSync)\b/.test(examRunnerSource),
  'SKU card exam runner must not copy, move, or prepare project artifacts for the exam'
);
assert(
  !/writeProjectVisualInsightCache|createDocument|placeImage|saveDocument/.test(examRunnerSource),
  'SKU card exam runner must stay diagnostic-only and must not write Photoshop documents or visual cache'
);

const integrityProject = path.resolve(__dirname, '..', 'tmp', 'sku-card-exam-integrity-project');
const projectInternalOut = path.join(integrityProject, '.designecho', 'exam-report.json');
fs.rmSync(integrityProject, { recursive: true, force: true });
fs.mkdirSync(integrityProject, { recursive: true });
const integrityRun = spawnSync(
  process.execPath,
  [
    path.resolve(__dirname, 'run-sku-card-exam.cjs'),
    '--project',
    integrityProject,
    '--out',
    projectInternalOut,
    '--allow-not-ready'
  ],
  {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  }
);
assert(
  integrityRun.status !== 0,
  'SKU card exam runner should reject writing reports inside the examined project by default',
  {
    status: integrityRun.status,
    stdout: integrityRun.stdout,
    stderr: integrityRun.stderr
  }
);
assert(
  !fs.existsSync(projectInternalOut),
  'SKU card exam runner must not leave a project-internal report after integrity rejection'
);
fs.rmSync(integrityProject, { recursive: true, force: true });

const runtimeFixtureProject = path.resolve(__dirname, '..', 'tmp', 'sku-card-exam-runtime-project');
const runtimeTemplateDir = path.resolve(__dirname, '..', 'tmp', 'public-template-runtime-fixture');
const runtimeOut = path.resolve(__dirname, '..', 'tmp', 'sku-card-exam-runtime-template-report.json');
fs.rmSync(runtimeFixtureProject, { recursive: true, force: true });
fs.rmSync(runtimeTemplateDir, { recursive: true, force: true });
fs.mkdirSync(runtimeFixtureProject, { recursive: true });
fs.mkdirSync(runtimeTemplateDir, { recursive: true });
for (const name of ['2双装.psd', '2双自选备注.psd', '3双装.psd', '3双自选备注.psd', '4双装.psd', '4双自选备注.psd']) {
  fs.writeFileSync(path.join(runtimeTemplateDir, name), '');
}
const runtimeTemplateRun = spawnSync(
  process.execPath,
  [
    path.resolve(__dirname, 'run-sku-card-exam.cjs'),
    '--project',
    runtimeFixtureProject,
    '--template-library',
    runtimeTemplateDir,
    '--out',
    runtimeOut,
    '--allow-not-ready'
  ],
  {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  }
);
assert(
  runtimeTemplateRun.status === 0,
  'SKU card exam runner should inspect explicit runtime template libraries read-only',
  {
    status: runtimeTemplateRun.status,
    stdout: runtimeTemplateRun.stdout,
    stderr: runtimeTemplateRun.stderr
  }
);
const runtimeTemplateStdout = JSON.parse(runtimeTemplateRun.stdout);
assert(
  runtimeTemplateStdout.runtimeTemplateReadiness.comboSizes.join(',') === '2,3,4',
  'runtime template sizes should be inferred from file names, not numeric parent paths',
  runtimeTemplateStdout
);
assert(
  runtimeTemplateStdout.runtimeTemplateReadiness.noteSizes.join(',') === '2,3,4',
  'runtime note template sizes should be inferred from file names',
  runtimeTemplateStdout
);
fs.rmSync(runtimeFixtureProject, { recursive: true, force: true });
fs.rmSync(runtimeTemplateDir, { recursive: true, force: true });
if (fs.existsSync(runtimeOut)) fs.rmSync(runtimeOut, { force: true });

const existingSourceFixtureProject = path.resolve(__dirname, '..', 'tmp', 'sku-card-exam-existing-source-project');
const existingSourceTemplateDir = path.resolve(__dirname, '..', 'tmp', 'sku-card-exam-existing-source-templates');
const existingSourceOut = path.resolve(__dirname, '..', 'tmp', 'sku-card-exam-existing-source-report.json');
fs.rmSync(existingSourceFixtureProject, { recursive: true, force: true });
fs.rmSync(existingSourceTemplateDir, { recursive: true, force: true });
fs.mkdirSync(path.join(existingSourceFixtureProject, 'PSD'), { recursive: true });
fs.mkdirSync(existingSourceTemplateDir, { recursive: true });
fs.writeFileSync(path.join(existingSourceFixtureProject, 'PSD', 'SKU.psb'), '');
for (const name of ['2双装.psd', '2双自选备注.psd', '3双装.psd', '3双自选备注.psd', '4双装.psd', '4双自选备注.psd']) {
  fs.writeFileSync(path.join(existingSourceTemplateDir, name), '');
}
const existingSourceRun = spawnSync(
  process.execPath,
  [
    path.resolve(__dirname, 'run-sku-card-exam.cjs'),
    '--project',
    existingSourceFixtureProject,
    '--template-library',
    existingSourceTemplateDir,
    '--out',
    existingSourceOut
  ],
  {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  }
);
assert(
  existingSourceRun.status === 0,
  'SKU card exam runner should be ready when the project already has PSD/SKU.psb and runtime templates cover 2/3/4',
  {
    status: existingSourceRun.status,
    stdout: existingSourceRun.stdout,
    stderr: existingSourceRun.stderr
  }
);
const existingSourceStdout = JSON.parse(existingSourceRun.stdout);
assert(existingSourceStdout.ok === true, 'existing source exam should report ok=true', existingSourceStdout);
fs.rmSync(existingSourceFixtureProject, { recursive: true, force: true });
fs.rmSync(existingSourceTemplateDir, { recursive: true, force: true });
if (fs.existsSync(existingSourceOut)) fs.rmSync(existingSourceOut, { force: true });

console.log(JSON.stringify({
  ok: true,
  readyStatus: ready.status,
  blockedStatus: blocked.status,
  blockerCount: blocked.blockers.length
}, null, 2));
