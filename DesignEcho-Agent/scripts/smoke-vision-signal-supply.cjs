#!/usr/bin/env node

/**
 * 视觉构图信号供给链路 smoke：
 * ① cache-fill 映射保留构图字段（含枚举归一化、非法值置 undefined、sanitize 写入/读出幸存、旧条目兼容）；
 * ② buildMainImageAssetVisionSignalFromCache 同口径映射后，主图候选打分确实变化；
 * ③ detail-page 供给 visionSignal 后 visionFit 不再恒 0.5（有信号时随信号变化，无信号保持中性）；
 * ④ 同一素材路径多条缓存条目时按「信号富度优先」择优（F1：旧 productType-only 条目在前不得遮蔽含构图字段条目）；
 * ⑤ detail-page 信号供给走轻量只读通道 ecommerce:readVisualInsightCache，不再触发全项目扫描（F4）。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(repoRoot, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const {
  normalizeProjectVisualInsightCompositionFields,
  pickPreferredProjectVisualInsightCacheEntry,
  projectVisualInsightEntryHasCompositionSignal
} = require(path.join(repoRoot, 'src', 'shared', 'project-visual-sampling.ts'));
const {
  mapAssetAnalysisToProjectVisualInsight,
  buildProjectVisualInsightCacheEntry
} = require(path.join(repoRoot, 'src', 'shared', 'project-visual-insight-cache-fill.ts'));
const {
  sanitizeProjectVisualInsightCacheEntries,
  buildProjectVisualInsightCacheReadResult
} = require(path.join(repoRoot, 'src', 'shared', 'project-visual-insight-cache.ts'));
const {
  selectMainImageAssetCandidate
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-asset-selection.ts'));
const {
  mapMainImageAssetAnalysisToVisionSignal
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-vision-preflight.ts'));
const {
  matchDetailPageContentPlans
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'detail-page-asset-ranker.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(value, needle, message) {
  assert(String(value || '').includes(needle), message || `Expected ${JSON.stringify(value)} to include ${needle}`);
}

function assertNoMojibake(text, label) {
  const signals = [
    '鍙',
    '鏈',
    '锛',
    '闈',
    '缁',
    '€',
    '�',
    '鐨',
    '涓',
    '闂',
    '绾',
    '鈥',
    '俙'
  ];
  for (const signal of signals) {
    assert(!String(text).includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

const cases = [];

function record(name, fn) {
  try {
    cases.push({ name, status: 'pass', details: fn() });
  } catch (error) {
    cases.push({ name, status: 'fail', error: error && error.message ? error.message : String(error) });
  }
}

const candidate = {
  assetId: 'asset-01',
  path: 'C:/project/产品图/商品袜子01.jpg',
  role: 'raw-product-still',
  priority: 10,
  score: 100,
  reason: 'test',
  cacheKey: 'project-visual:test01',
  cacheStatus: 'miss',
  shouldAnalyze: true,
  requiredObservations: [],
  selectionNotes: []
};

record('composition-normalizer-validates-enums-strictly', () => {
  const fields = normalizeProjectVisualInsightCompositionFields({
    assetNature: ' RAW_PHOTO ',
    visibleText: '  舒适透气  ',
    subjectCoverageRatio: 'Dominant',
    subjectPosition: 'CENTER',
    compositionFocus: ' 袜子/腿部 ',
    mainImageSuitability: ' Suitable ',
    mainImageSuitabilityReason: '主体占比大且居中'
  });
  assert(fields.assetNature === 'raw_photo', `assetNature 归一化失败：${fields.assetNature}`);
  assert(fields.visibleText === '舒适透气', `visibleText 裁剪失败：${fields.visibleText}`);
  assert(fields.subjectCoverageRatio === 'dominant', `subjectCoverageRatio 归一化失败：${fields.subjectCoverageRatio}`);
  assert(fields.subjectPosition === 'center', `subjectPosition 归一化失败：${fields.subjectPosition}`);
  assert(fields.compositionFocus === '袜子/腿部', `compositionFocus 裁剪失败：${fields.compositionFocus}`);
  assert(fields.mainImageSuitability === 'suitable', `mainImageSuitability 归一化失败：${fields.mainImageSuitability}`);

  const illegal = normalizeProjectVisualInsightCompositionFields({
    subjectCoverageRatio: 'huge',
    subjectPosition: 'middle-ish',
    mainImageSuitability: 'kinda-ok',
    assetNature: 'screenshot'
  });
  assert(illegal.subjectCoverageRatio === undefined, '非法 subjectCoverageRatio 必须置 undefined');
  assert(illegal.subjectPosition === undefined, '非法 subjectPosition 必须置 undefined');
  assert(illegal.mainImageSuitability === undefined, '非法 mainImageSuitability 必须置 undefined');
  assert(illegal.assetNature === undefined, '非法 assetNature 必须置 undefined');
  assert(Object.keys(normalizeProjectVisualInsightCompositionFields(null)).length === 0, 'null 输入必须返回空对象');
  return { normalized: fields, illegalDropped: true };
});

record('cache-fill-mapper-preserves-composition-fields', () => {
  const insight = mapAssetAnalysisToProjectVisualInsight({
    candidate,
    payload: {
      success: true,
      analysis: {
        description: '浅色堆堆袜脚模图',
        category: 'product_main',
        mainSubject: '堆堆袜',
        colors: ['#F2F0E8'],
        style: '清爽自然',
        assetNature: 'raw_photo',
        visibleText: '',
        subjectCoverageRatio: ' Dominant ',
        subjectPosition: 'center',
        compositionFocus: '袜子/腿部',
        mainImageSuitability: 'suitable',
        mainImageSuitabilityReason: '主体占比大且居中'
      }
    },
    modelId: 'test-vision-model',
    capturedAt: '2026-07-02T00:00:00.000Z'
  });
  assert(insight, 'cache-fill 映射应返回 insight');
  assert(insight.subjectCoverageRatio === 'dominant', `构图字段 subjectCoverageRatio 丢失：${insight.subjectCoverageRatio}`);
  assert(insight.subjectPosition === 'center', `构图字段 subjectPosition 丢失：${insight.subjectPosition}`);
  assert(insight.compositionFocus === '袜子/腿部', `构图字段 compositionFocus 丢失：${insight.compositionFocus}`);
  assert(insight.mainImageSuitability === 'suitable', `构图字段 mainImageSuitability 丢失：${insight.mainImageSuitability}`);
  assert(insight.mainImageSuitabilityReason === '主体占比大且居中', '构图字段 mainImageSuitabilityReason 丢失');
  assert(insight.assetNature === 'raw_photo', `assetNature 丢失：${insight.assetNature}`);
  assert(insight.visibleText === undefined, '空 visibleText 应保持 undefined');
  return {
    subjectCoverageRatio: insight.subjectCoverageRatio,
    mainImageSuitability: insight.mainImageSuitability
  };
});

record('cache-fill-mapper-drops-illegal-enum-values', () => {
  const insight = mapAssetAnalysisToProjectVisualInsight({
    candidate,
    payload: {
      success: true,
      analysis: {
        description: '模糊场景图',
        mainSubject: '袜子',
        subjectCoverageRatio: 'very-big',
        mainImageSuitability: 'perfect'
      }
    }
  });
  assert(insight, 'cache-fill 映射应返回 insight');
  assert(insight.subjectCoverageRatio === undefined, '非法 subjectCoverageRatio 不得写入缓存');
  assert(insight.mainImageSuitability === undefined, '非法 mainImageSuitability 不得写入缓存');
  return { illegalDropped: true };
});

record('composition-fields-survive-cache-sanitize-write-and-read', () => {
  const insight = mapAssetAnalysisToProjectVisualInsight({
    candidate,
    payload: {
      success: true,
      analysis: {
        description: '浅色堆堆袜脚模图',
        mainSubject: '堆堆袜',
        subjectCoverageRatio: 'dominant',
        subjectPosition: 'center',
        compositionFocus: '袜子/腿部',
        mainImageSuitability: 'suitable',
        mainImageSuitabilityReason: '主体占比大且居中'
      }
    }
  });
  const entry = buildProjectVisualInsightCacheEntry({ candidate, insight });
  const sanitized = sanitizeProjectVisualInsightCacheEntries([entry]);
  assert(sanitized.entries.length === 1, 'sanitize 应保留条目');
  const survived = sanitized.entries[0].insight;
  assert(survived.subjectCoverageRatio === 'dominant', 'sanitize 写入侧丢弃了 subjectCoverageRatio');
  assert(survived.mainImageSuitability === 'suitable', 'sanitize 写入侧丢弃了 mainImageSuitability');
  assert(survived.compositionFocus === '袜子/腿部', 'sanitize 写入侧丢弃了 compositionFocus');

  const readResult = buildProjectVisualInsightCacheReadResult({
    source: 'persisted-project-cache',
    exists: true,
    entries: [entry]
  });
  const readInsight = readResult.entries[0].insight;
  assert(readInsight.subjectCoverageRatio === 'dominant', '读出侧丢弃了 subjectCoverageRatio');
  assert(readInsight.mainImageSuitability === 'suitable', '读出侧丢弃了 mainImageSuitability');
  assert(readInsight.subjectPosition === 'center', '读出侧丢弃了 subjectPosition');
  return { writeSideOk: true, readSideOk: true };
});

record('legacy-cache-entries-without-composition-fields-pass-safely', () => {
  const legacyEntry = {
    cacheKey: 'project-visual:legacy01',
    assetId: 'legacy-asset',
    path: 'C:/project/产品图/旧缓存图.jpg',
    insight: {
      assetId: 'legacy-asset',
      path: 'C:/project/产品图/旧缓存图.jpg',
      summary: '旧版缓存条目，没有构图字段',
      productType: '中筒袜',
      scene: '床上摆拍'
    }
  };
  const readResult = buildProjectVisualInsightCacheReadResult({
    source: 'persisted-project-cache',
    exists: true,
    entries: [legacyEntry]
  });
  assert(readResult.entries.length === 1, '旧条目必须安全通过');
  const insight = readResult.entries[0].insight;
  assert(insight.productType === '中筒袜', '旧条目 productType 应保留');
  assert(insight.subjectCoverageRatio === undefined, '旧条目缺失字段必须保持 undefined');
  assert(insight.mainImageSuitability === undefined, '旧条目缺失字段必须保持 undefined');
  const fields = normalizeProjectVisualInsightCompositionFields(insight);
  assert(Object.keys(fields).length === 0, '旧条目归一化结果应为空对象');
  return { legacySafe: true };
});

record('composition-entry-wins-over-older-product-type-only-entry-for-same-path', () => {
  // 评审场景（F1）：同一素材路径同时存在两类缓存条目——
  // 旧的 project-image-analysis:*（仅 productType/summary，永远没有构图字段）在前，
  // 新的 project-visual:*（cache-fill 写入，含构图字段）在后。
  // 选条目必须「信号富度优先」，不得先到先得，否则构图信号被无声遮蔽（visionFit 恒 0.5）。
  const assetPath = 'C:/project/产品图/商品袜子01.jpg';
  const legacyAnalysisEntry = {
    cacheKey: 'project-image-analysis:abc123',
    assetId: assetPath,
    path: assetPath,
    updatedAt: '2026-07-01T00:00:00.000Z',
    insight: {
      assetId: assetPath,
      path: assetPath,
      summary: '分析项目图片写入的旧条目',
      productType: '中筒袜',
      capturedAt: '2026-07-01T00:00:00.000Z'
    }
  };
  const cacheFillEntry = {
    cacheKey: 'project-visual:def456',
    assetId: 'asset-01',
    path: assetPath,
    updatedAt: '2026-07-02T00:00:00.000Z',
    insight: {
      assetId: 'asset-01',
      path: assetPath,
      summary: 'cache-fill 写入的含构图字段条目',
      productType: '中筒袜',
      subjectCoverageRatio: 'dominant',
      subjectPosition: 'center',
      mainImageSuitability: 'suitable',
      capturedAt: '2026-07-02T00:00:00.000Z'
    }
  };
  assert(projectVisualInsightEntryHasCompositionSignal(cacheFillEntry) === true, '含构图字段条目必须判定为富信号');
  assert(projectVisualInsightEntryHasCompositionSignal(legacyAnalysisEntry) === false, 'productType-only 条目不得判定为富信号');

  // 两个消费方（buildDetailPageVisionSignalIndex / findProjectVisualInsightForAsset）都按数组顺序 reduce 择优。
  const reduceEntries = (entries) => entries.reduce(
    (current, entry) => pickPreferredProjectVisualInsightCacheEntry(current, entry),
    undefined
  );
  const winner = reduceEntries([legacyAnalysisEntry, cacheFillEntry]);
  assert(winner.cacheKey === 'project-visual:def456', `旧条目在前时必须选中含构图字段的条目：选中了 ${winner.cacheKey}`);
  const winnerReversed = reduceEntries([cacheFillEntry, legacyAnalysisEntry]);
  assert(winnerReversed.cacheKey === 'project-visual:def456', `含构图字段条目在前时也必须保住：选中了 ${winnerReversed.cacheKey}`);

  // 同富度：有时间戳取最新（后写入但时间更旧的条目不得反超）。
  const newerLegacy = {
    ...legacyAnalysisEntry,
    cacheKey: 'project-image-analysis:newer',
    updatedAt: '2026-07-03T00:00:00.000Z',
    insight: { ...legacyAnalysisEntry.insight, capturedAt: '2026-07-03T00:00:00.000Z' }
  };
  const timestampWinner = reduceEntries([newerLegacy, legacyAnalysisEntry]);
  assert(timestampWinner.cacheKey === 'project-image-analysis:newer', `同富度必须取时间戳最新：选中了 ${timestampWinner.cacheKey}`);

  // 同富度且无可解析时间戳：取后写入的。
  const untimedA = { cacheKey: 'untimed-a', path: assetPath, insight: { path: assetPath, productType: '短袜' } };
  const untimedB = { cacheKey: 'untimed-b', path: assetPath, insight: { path: assetPath, productType: '棉袜' } };
  const laterWrittenWinner = reduceEntries([untimedA, untimedB]);
  assert(laterWrittenWinner.cacheKey === 'untimed-b', `无时间戳时必须取后写入：选中了 ${laterWrittenWinner.cacheKey}`);
  return {
    shadowedScenarioWinner: winner.cacheKey,
    timestampWinner: timestampWinner.cacheKey,
    laterWrittenWinner: laterWrittenWinner.cacheKey
  };
});

record('main-image-scoring-changes-with-cache-composition-signal', () => {
  // 模拟缓存 insight 经 normalizeProjectVisualInsightCompositionFields 归一化后
  // 由 buildMainImageAssetVisionSignalFromCache（main-image.executor.ts）构造 visionSignal 的同一口径。
  const cachedInsight = {
    productType: '中筒袜',
    scene: '床上摆拍',
    subjectCoverageRatio: 'DOMINANT',
    mainImageSuitability: ' Suitable ',
    compositionFocus: '袜子/腿部'
  };
  const composition = normalizeProjectVisualInsightCompositionFields(cachedInsight);
  const visionSignal = {
    mainImageSuitability: composition.mainImageSuitability,
    subjectCoverageRatio: composition.subjectCoverageRatio,
    compositionFocus: composition.compositionFocus,
    productType: '中筒袜',
    source: 'project-visual-insight-cache'
  };

  const baseAsset = { path: 'C:/project/产品图/商品袜子01.jpg', name: '商品袜子01.jpg', role: 'project-image' };
  const baseline = selectMainImageAssetCandidate({
    userText: '帮我做一张袜子主图',
    projectAssets: [baseAsset]
  });
  const withSignal = selectMainImageAssetCandidate({
    userText: '帮我做一张袜子主图',
    projectAssets: [{ ...baseAsset, visionSignal }]
  });
  const baselineScore = baseline.selectedAsset.score;
  const signalScore = withSignal.selectedAsset.score;
  assert(signalScore === baselineScore + 23, `suitable+dominant 应加 23 分：baseline=${baselineScore}, withSignal=${signalScore}`);
  assert(withSignal.selectedAsset.visionSignalApplied === true, 'visionSignalApplied 标记缺失');

  const negativeSignal = { mainImageSuitability: 'unsuitable', subjectCoverageRatio: 'small' };
  const withNegative = selectMainImageAssetCandidate({
    userText: '帮我做一张袜子主图',
    projectAssets: [{ ...baseAsset, visionSignal: negativeSignal }]
  });
  assert(withNegative.selectedAsset.score === baselineScore - 28, `unsuitable+small 应减 28 分：得到 ${withNegative.selectedAsset.score}`);
  return { baselineScore, signalScore, negativeScore: withNegative.selectedAsset.score };
});

record('preflight-vision-signal-carries-composition-fields', () => {
  const signal = mapMainImageAssetAnalysisToVisionSignal({
    success: true,
    analysis: {
      description: '浅色堆堆袜脚模图',
      category: 'product_main',
      mainSubject: '堆堆袜',
      subjectCoverageRatio: 'moderate',
      subjectPosition: 'left',
      compositionFocus: '袜口纹理',
      mainImageSuitability: 'marginal',
      mainImageSuitabilityReason: '主体偏小偏左'
    }
  }, { path: 'C:/project/assets/sock.jpg', name: 'sock.jpg' });
  assert(signal, 'preflight 应返回 visionSignal');
  assert(signal.subjectCoverageRatio === 'moderate', `preflight 丢失 subjectCoverageRatio：${signal.subjectCoverageRatio}`);
  assert(signal.subjectPosition === 'left', `preflight 丢失 subjectPosition：${signal.subjectPosition}`);
  assert(signal.mainImageSuitability === 'marginal', `preflight 丢失 mainImageSuitability：${signal.mainImageSuitability}`);
  assert(signal.compositionFocus === '袜口纹理', 'preflight 丢失 compositionFocus');
  assert(signal.sourceNotes.some((item) => item.includes('mainImageSuitability=marginal')), 'preflight 来源说明缺少构图字段');

  const illegal = mapMainImageAssetAnalysisToVisionSignal({
    success: true,
    analysis: {
      mainSubject: '袜子',
      subjectCoverageRatio: 'gigantic',
      mainImageSuitability: 'perfect'
    }
  }, { path: 'C:/project/assets/sock.jpg', name: 'sock.jpg' });
  assert(illegal.subjectCoverageRatio === undefined, 'preflight 非法枚举必须置 undefined');
  assert(illegal.mainImageSuitability === undefined, 'preflight 非法枚举必须置 undefined');
  return { subjectCoverageRatio: signal.subjectCoverageRatio, mainImageSuitability: signal.mainImageSuitability };
});

async function runDetailPageCases() {
  const screen = {
    id: 1,
    name: '核心卖点',
    type: 'C_SELLING_POINT',
    bounds: { width: 800, height: 1000 },
    copyPlaceholders: [],
    imagePlaceholders: [{
      layerId: 101,
      layerName: '主图占位',
      bounds: { width: 750, height: 750 },
      aspectRatio: 1
    }]
  };
  const screenPlan = {
    screenId: 1,
    screenRole: 'selling-point',
    copyStrategy: 'headline',
    imageStrategy: 'hero',
    mainMessage: '突出商品主体',
    supportingPoints: [],
    requiresModelDecision: false,
    decisionSource: 'agent'
  };
  const makeAsset = (name, visionSignal) => ({
    name,
    path: `C:/project/产品图/${name}`,
    width: 2000,
    height: 2000,
    type: 'product',
    ...(visionSignal ? { visionSignal } : {})
  });

  // 无信号：visionFit 保持中性 0.5（旧行为不变）。
  const neutralResult = await matchDetailPageContentPlans({
    screens: [screen],
    projectAssets: { images: [makeAsset('商品袜子A.jpg'), makeAsset('商品袜子B.jpg')] },
    screenPlans: [screenPlan]
  });
  const neutralImage = neutralResult.plans[0].images[0];
  assertIncludes(neutralImage.selectionReason, 'vision:0.50', `无信号时 visionFit 应为 0.50：${neutralImage.selectionReason}`);

  // 有信号：suitable+dominant → 0.70；unsuitable+small → 0.30；suitable 素材应胜出。
  const signalResult = await matchDetailPageContentPlans({
    screens: [screen],
    projectAssets: {
      images: [
        makeAsset('商品袜子B.jpg', { mainImageSuitability: 'unsuitable', subjectCoverageRatio: 'small' }),
        makeAsset('商品袜子A.jpg', { mainImageSuitability: 'suitable', subjectCoverageRatio: 'dominant' })
      ]
    },
    screenPlans: [screenPlan]
  });
  const signalImage = signalResult.plans[0].images[0];
  assertIncludes(signalImage.imagePath, '商品袜子A.jpg', `suitable 素材应胜出：${signalImage.imagePath}`);
  assertIncludes(signalImage.selectionReason, 'vision:0.70', `有信号时 visionFit 应变化为 0.70：${signalImage.selectionReason}`);
  return {
    neutralVision: 'vision:0.50',
    signalVision: 'vision:0.70',
    winner: signalImage.imagePath
  };
}

record('supply-chain-wiring-is-present-in-executors', () => {
  const mainImageExecutor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/main-image.executor.ts'), 'utf8');
  const toolExecutor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
  const ranker = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/skill-executors/detail-page-asset-ranker.ts'), 'utf8');
  assertIncludes(mainImageExecutor, 'normalizeProjectVisualInsightCompositionFields', 'main-image executor 未接入构图字段归一化');
  assertIncludes(mainImageExecutor, 'composition.mainImageSuitability ? { mainImageSuitability', 'buildMainImageAssetVisionSignalFromCache 未映射 mainImageSuitability');
  assertIncludes(toolExecutor, 'buildDetailPageVisionSignalIndex', 'executeDetailPageContentMatch 未接入视觉信号供给');
  // F1：两个消费方必须共用共享择优函数，不得各写一套「先到先得」。
  assertIncludes(toolExecutor, 'pickPreferredProjectVisualInsightCacheEntry', 'detail-page 供给未使用共享缓存条目择优函数');
  assertIncludes(mainImageExecutor, 'pickPreferredProjectVisualInsightCacheEntry', 'main-image executor 未使用共享缓存条目择优函数');
  assertIncludes(ranker, 'export type DetailAssetVisionSignal', 'ranker 未导出 DetailAssetVisionSignal 供调用方复用');
  assert(!ranker.includes('尚未接入该字段的数据供给'), 'ranker 头注释仍声称数据供给未接线，应已更新');
  return { wired: true };
});

record('detail-page-supply-uses-lightweight-readonly-cache-channel', () => {
  // F4：详情页信号供给只为读一个 JSON 缓存文件，不得走 ecommerce:buildContextSnapshot
  // （会触发第二次全项目扫描 + CSV 解析 + 抽样计划）。读通道必须按仓库惯例登记三处。
  const toolExecutor = fs.readFileSync(path.join(repoRoot, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(repoRoot, 'src/main/preload.ts'), 'utf8');
  const handlers = fs.readFileSync(path.join(repoRoot, 'src/main/ipc-handlers/ecommerce-project-handlers.ts'), 'utf8');
  const types = fs.readFileSync(path.join(repoRoot, 'src/renderer/types.d.ts'), 'utf8');
  const snapshotService = fs.readFileSync(path.join(repoRoot, 'src/main/services/project-context-snapshot-service.ts'), 'utf8');
  assertIncludes(toolExecutor, 'readProjectVisualInsightCache', 'detail-page 供给未使用只读缓存通道 readProjectVisualInsightCache');
  assert(!toolExecutor.includes("'ecommerce:buildContextSnapshot'"), 'tool-executor 仍在为读缓存走重量级 buildContextSnapshot 通道');
  assertIncludes(handlers, "ipcMain.handle('ecommerce:readVisualInsightCache'", '主进程未注册 ecommerce:readVisualInsightCache handler');
  assertIncludes(handlers, 'readPersistedVisualInsightCache', 'handler 未调用轻量只读服务方法 readPersistedVisualInsightCache');
  assertIncludes(preload, "ipcRenderer.invoke('ecommerce:readVisualInsightCache'", 'preload 未暴露 readProjectVisualInsightCache');
  assertIncludes(types, 'readProjectVisualInsightCache?:', 'types.d.ts 未登记 readProjectVisualInsightCache 类型');
  assertIncludes(snapshotService, 'async readPersistedVisualInsightCache', 'snapshot service 缺少公开只读方法 readPersistedVisualInsightCache');
  return { readonlyChannel: 'ecommerce:readVisualInsightCache', registeredIn: ['handler', 'preload', 'types'] };
});

record('modified-sources-have-no-mojibake', () => {
  const files = [
    'src/shared/project-visual-sampling.ts',
    'src/shared/project-visual-insight-cache-fill.ts',
    'src/shared/project-visual-insight-cache.ts',
    'src/shared/main-image-visual-loop.ts',
    'src/shared/main-image-vision-preflight.ts',
    'src/renderer/services/skill-executors/main-image.executor.ts',
    'src/renderer/services/skill-executors/detail-page-asset-ranker.ts',
    'src/renderer/services/tool-executor.service.ts',
    'src/renderer/types.d.ts',
    'src/main/preload.ts',
    'src/main/ipc-handlers/ecommerce-project-handlers.ts',
    'src/main/services/project-context-snapshot-service.ts'
  ];
  for (const file of files) {
    assertNoMojibake(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file);
  }
  return { files: files.length };
});

(async () => {
  try {
    cases.push({ name: 'detail-page-vision-fit-varies-with-supplied-signal', status: 'pass', details: await runDetailPageCases() });
  } catch (error) {
    cases.push({
      name: 'detail-page-vision-fit-varies-with-supplied-signal',
      status: 'fail',
      error: error && error.message ? error.message : String(error)
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    success: cases.every((item) => item.status === 'pass'),
    cases
  };

  const jsonPath = path.join(tmpDir, 'vision-signal-supply-smoke.json');
  const mdPath = path.join(tmpDir, 'vision-signal-supply-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Vision Signal Supply Smoke',
    '',
    `success: ${report.success}`,
    '',
    ...cases.map((item) => `- ${item.name}: ${item.status}${item.error ? ` - ${item.error}` : ''}`)
  ].join('\n'), 'utf8');

  console.log(JSON.stringify({
    success: report.success,
    cases: cases.map(({ name, status, error }) => ({ name, status, error })),
    report: { json: jsonPath, md: mdPath }
  }, null, 2));

  process.exit(report.success ? 0 : 1);
})();
