#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

const sharp = require('sharp');
const { buildProjectAssetIndex } = require('../src/shared/project-asset-index.ts');
const { buildSkuCardAssetCandidateReport } = require('../src/shared/sku-card-asset-candidates.ts');
const { buildSkuCardExamReadiness } = require('../src/shared/sku-card-exam-readiness.ts');
const { buildSkuCardSourcePreparationPlan } = require('../src/shared/sku-card-source-preparation-plan.ts');
const { buildSkuCardTemplatePreparationPlan } = require('../src/shared/sku-card-template-preparation-plan.ts');
const { buildSkuCardVisualConfirmationPlan } = require('../src/shared/sku-card-visual-confirmation-plan.ts');
const { buildProjectVisualInsightCacheReadResult } = require('../src/shared/project-visual-insight-cache.ts');
const { buildProjectProductUnderstanding } = require('../src/shared/project-product-understanding.ts');

const RUNTIME_TEMPLATE_FILE_PATTERN = /\.(psd|psb|tif|tiff)$/i;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function normalizeForCompare(value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isPathInside(childPath, parentPath) {
  const child = normalizeForCompare(childPath);
  const parent = normalizeForCompare(parentPath);
  if (!child || !parent) return false;
  return child === parent || child.startsWith(`${parent}/`);
}

function assertProjectPath(value, label) {
  if (!value || !fs.existsSync(value)) {
    throw new Error(`${label} does not exist: ${value || '(empty)'}`);
  }
}

function assertExamOutputPath(outPath, projectRoot, allowProjectReportOutput) {
  if (allowProjectReportOutput) return;
  if (isPathInside(outPath, projectRoot)) {
    throw new Error(
      'Exam integrity violation: --out is inside the examined project. ' +
      'Write diagnostic reports outside the project, or pass --allow-project-report-output for an explicit non-exam diagnostic run.'
    );
  }
}

async function collectFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = fs.statSync(absolutePath);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      const item = {
        path: absolutePath.replace(/\\/g, '/'),
        relativePath,
        name: entry.name,
        extension: path.extname(entry.name),
        sizeBytes: stat.size
      };

      if (/\.(jpg|jpeg|png|webp|tif|tiff)$/i.test(entry.name)) {
        try {
          const metadata = await sharp(absolutePath).metadata();
          item.width = metadata.width;
          item.height = metadata.height;
        } catch {
          item.probeFailed = true;
        }
      }

      files.push(item);
    }
  }
  return files;
}

function summarizeReferenceAssetIndex(assetIndex) {
  if (!assetIndex) return null;
  const skuOutputs = assetIndex.assets
    .filter((asset) => asset.role === 'sku-output')
    .map((asset) => asset.relativePath)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .slice(0, 24);

  return {
    totals: {
      files: assetIndex.summary.totalFiles,
      images: assetIndex.summary.totalImages,
      designDocuments: assetIndex.summary.totalDesignDocuments
    },
    roleCounts: assetIndex.summary.roleCounts,
    folderRoleCounts: assetIndex.summary.folderRoleCounts,
    skuOutputs
  };
}

async function buildIndexForProject(projectRoot) {
  const files = await collectFiles(projectRoot);
  return buildProjectAssetIndex({
    projectPath: projectRoot.replace(/\\/g, '/'),
    projectName: path.basename(projectRoot),
    files
  });
}

function readProjectVisualInsightCache(projectRoot) {
  const cachePath = path.join(projectRoot, '.designecho', 'visual-insights-cache.json');
  if (!fs.existsSync(cachePath)) {
    return buildProjectVisualInsightCacheReadResult({
      source: 'missing',
      cachePath,
      exists: false,
      entries: []
    });
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return buildProjectVisualInsightCacheReadResult({
      source: 'persisted-project-cache',
      cachePath,
      exists: true,
      entries: Array.isArray(parsed?.entries) ? parsed.entries : []
    });
  } catch (error) {
    return buildProjectVisualInsightCacheReadResult({
      source: 'invalid',
      cachePath,
      exists: true,
      entries: [],
      warning: error instanceof Error ? error.message : String(error)
    });
  }
}

function readConfiguredTemplateLibraryDirs() {
  const appData = process.env.APPDATA || '';
  const settingsPath = appData
    ? path.join(appData, 'designecho-agent', 'template-knowledge', 'resolver-settings.json')
    : '';
  if (!settingsPath || !fs.existsSync(settingsPath)) {
    return {
      settingsPath,
      dirs: [],
      warnings: ['未找到 DesignEcho 模板库配置。']
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const fromDirs = Array.isArray(parsed?.localLibraryDirs) ? parsed.localLibraryDirs : [];
    const fromLibraries = Array.isArray(parsed?.libraries)
      ? parsed.libraries.map((item) => item?.dirPath).filter(Boolean)
      : [];
    return {
      settingsPath,
      dirs: Array.from(new Set([...fromDirs, ...fromLibraries].map((item) => String(item || '').trim()).filter(Boolean))),
      warnings: []
    };
  } catch (error) {
    return {
      settingsPath,
      dirs: [],
      warnings: [`模板库配置读取失败：${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

function inferTemplateSize(filePath) {
  const baseName = path.basename(String(filePath || ''), path.extname(String(filePath || '')));
  const match = baseName.match(/(\d+)/);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function collectRuntimeTemplateFiles(root, maxDepth = 5, maxCount = 300) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;

  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0 && files.length < maxCount) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          stack.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !RUNTIME_TEMPLATE_FILE_PATTERN.test(entry.name)) continue;
      files.push(fullPath);
      if (files.length >= maxCount) break;
    }
  }
  return files;
}

function buildRuntimeTemplateReadiness(options) {
  const includeConfigured = options.includeConfigured === true;
  const explicitDirs = Array.isArray(options.explicitDirs) ? options.explicitDirs : [];
  if (!includeConfigured && explicitDirs.length === 0) return null;

  const configured = includeConfigured
    ? readConfiguredTemplateLibraryDirs()
    : { settingsPath: '', dirs: [], warnings: [] };
  const dirs = Array.from(new Set([...configured.dirs, ...explicitDirs]
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  const warnings = [...configured.warnings];
  const comboSizes = new Set();
  const noteSizes = new Set();
  let templateCount = 0;

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      warnings.push(`模板库目录不存在：${dir}`);
      continue;
    }
    const files = collectRuntimeTemplateFiles(dir);
    templateCount += files.length;
    for (const filePath of files) {
      const size = inferTemplateSize(filePath);
      if (!size) continue;
      const text = path.basename(filePath, path.extname(filePath)).toLowerCase();
      if (text.includes('自选备注')) {
        noteSizes.add(size);
      } else {
        comboSizes.add(size);
      }
    }
  }

  return {
    source: includeConfigured ? 'configured-local-template-library' : 'explicit-runtime-template-library',
    settingsPath: configured.settingsPath,
    dirs,
    templateCount,
    comboSizes: Array.from(comboSizes).sort((a, b) => a - b),
    noteSizes: Array.from(noteSizes).sort((a, b) => a - b),
    warnings
  };
}

async function run() {
  const project = argValue('--project');
  const reference = argValue('--reference');
  const out = argValue('--out') || path.join(__dirname, '..', 'tmp', 'sku-card-exam-report.json');
  const allowNotReady = process.argv.includes('--allow-not-ready');
  const allowProjectReportOutput = process.argv.includes('--allow-project-report-output');
  const includeRuntimeTemplateLibrary = process.argv.includes('--include-runtime-template-library');
  const requirePreparedSourceDocument = process.argv.includes('--require-prepared-source-document');
  const runtimeTemplateLibraryDirs = argValues('--template-library');
  assertProjectPath(project, '--project');
  if (reference) assertProjectPath(reference, '--reference');
  assertExamOutputPath(out, project, allowProjectReportOutput);

  const assetIndex = await buildIndexForProject(project);
  const referenceAssetIndex = reference ? await buildIndexForProject(reference) : null;
  const visualInsightCache = readProjectVisualInsightCache(project);
  const runtimeTemplateReadiness = buildRuntimeTemplateReadiness({
    includeConfigured: includeRuntimeTemplateLibrary,
    explicitDirs: runtimeTemplateLibraryDirs
  });
  const skuCardAssetCandidateReport = buildSkuCardAssetCandidateReport({
    assetIndex,
    visualInsightCache,
    maxCandidates: 8
  });
  const requiredSizes = [2, 3, 4];
  const projectProductUnderstanding = buildProjectProductUnderstanding({
    assetIndex,
    visualInsightCache
  });
  const skuCardVisualConfirmationPlan = buildSkuCardVisualConfirmationPlan({
    skuCardAssetCandidateReport,
    maxCandidates: 8
  });
  const skuCardSourcePreparationPlan = buildSkuCardSourcePreparationPlan({
    projectPath: project,
    skuCardAssetCandidateReport,
    minimumSourceCount: Math.max(...requiredSizes),
    maxSources: 8
  });
  const skuCardTemplatePreparationPlan = buildSkuCardTemplatePreparationPlan({
    projectPath: project,
    requiredSizes,
    notePlaceholderCount: 8
  });
  const skuCardExamReadiness = buildSkuCardExamReadiness({
    skuCardAssetCandidateReport,
    assetIndex,
    referenceAssetIndex,
    skuCardSourcePreparationPlan,
    skuCardTemplatePreparationPlan,
    runtimeTemplateReadiness,
    requirePreparedSourceDocument,
    allowDynamicSkuConfig: true
  });

  const report = {
    ok: skuCardExamReadiness.readyForExecution,
    project,
    reference: reference || null,
    totals: {
      files: assetIndex.summary.totalFiles,
      images: assetIndex.summary.totalImages,
      designDocuments: assetIndex.summary.totalDesignDocuments
    },
    roleCounts: assetIndex.summary.roleCounts,
    folderRoleCounts: assetIndex.summary.folderRoleCounts,
    visualInsightCache: {
      source: visualInsightCache.source,
      exists: visualInsightCache.exists,
      totalEntries: visualInsightCache.summary.totalEntries,
      entriesWithInsight: visualInsightCache.summary.entriesWithInsight,
      warnings: visualInsightCache.warnings,
      limitations: visualInsightCache.limitations
    },
    integrity: {
      mode: 'diagnostic-only',
      readOnlyProject: true,
      writesProjectArtifacts: false,
      writesPhotoshopDocuments: false,
      writesVisualInsightCache: false,
      outputInsideProject: isPathInside(out, project),
      allowProjectReportOutput
    },
    projectProductUnderstanding,
    skuCardAssetCandidateReport,
    skuCardVisualConfirmationPlan,
    skuCardSourcePreparationPlan,
    skuCardTemplatePreparationPlan,
    runtimeTemplateReadiness,
    skuCardExamReadiness,
    referenceSummary: summarizeReferenceAssetIndex(referenceAssetIndex),
    warnings: [
      ...assetIndex.warnings,
      ...skuCardAssetCandidateReport.warnings,
      ...skuCardExamReadiness.warnings
    ],
    blockers: skuCardExamReadiness.blockers,
    limitations: [
      'This exam runner is diagnostic-only and must not prepare project artifacts for the Agent.',
      'This exam reads project metadata and image dimensions only.',
      'It does not write Photoshop files or claim final SKU visual quality.',
      'Runtime template library inspection is metadata-only and must not copy reference or template files.',
      'ok=true means the SKU card exam is ready to enter execution, not that final visual output is already accepted.'
    ]
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: report.ok,
    status: skuCardExamReadiness.status,
    out,
    images: report.totals.images,
    candidates: skuCardAssetCandidateReport.candidateCount,
    visualInsightCoverage: skuCardAssetCandidateReport.visualInsightCoverage,
    visualConfirmationPlan: {
      selectedCandidateCount: skuCardVisualConfirmationPlan.selectedCandidates.length,
      shouldAnalyze: skuCardVisualConfirmationPlan.cacheSummary.shouldAnalyze,
      skippedCandidateCount: skuCardVisualConfirmationPlan.skippedCandidateCount
    },
    sourcePreparationStatus: skuCardSourcePreparationPlan.status,
    templatePreparationStatus: skuCardTemplatePreparationPlan.status,
    runtimeTemplateReadiness: runtimeTemplateReadiness
      ? {
        source: runtimeTemplateReadiness.source,
        templateCount: runtimeTemplateReadiness.templateCount,
        comboSizes: runtimeTemplateReadiness.comboSizes,
        noteSizes: runtimeTemplateReadiness.noteSizes,
        warnings: runtimeTemplateReadiness.warnings
      }
      : null,
    blockers: skuCardExamReadiness.blockers,
    integrity: report.integrity,
    topCandidates: skuCardAssetCandidateReport.candidates.slice(0, 5).map((item) => ({
      relativePath: item.relativePath,
      score: item.score,
      recommendedUse: item.recommendedUse,
      visualObservationStatus: item.visualObservationStatus,
      needsVisualConfirmation: item.needsVisualConfirmation
    }))
  }, null, 2));
  if (!report.ok && !allowNotReady) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
