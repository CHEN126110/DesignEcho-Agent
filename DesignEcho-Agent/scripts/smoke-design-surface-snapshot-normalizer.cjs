// 画面快照归一化器守护：工具结果→DesignSurfaceSnapshot 的字段映射、kind 映射、文本字号合并、
// subject 只按 hint 填、无画布尺寸返回 null、latest-success 提取、端到端可喂给测量提取器。纯逻辑。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildDesignSurfaceSnapshot,
  extractDesignSurfaceSnapshotFromToolResults,
  extractFreshDesignSurfaceSnapshotFromToolResults
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-surface-snapshot-normalizer.ts'));
const {
  extractDesignQualityMeasurements
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-quality-measurement.ts'));
const {
  readPhotoshopHistoryStateRef,
  samePhotoshopHistoryStateRef
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'photoshop-history-state-ref.ts'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const docInfo = { success: true, document: { width: 800, height: 1200 } };
const docInfoUnit = { success: true, document: { width: { _value: 800 }, height: { _value: 1200 } } };

const hierarchy = {
  success: true,
  flatList: [
    { id: 1, name: 'bg', kind: 'background', visible: true, bounds: { left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200 } },
    { id: 2, name: 'hero', kind: 'smartObject', visible: true, bounds: { left: 100, top: 100, right: 700, bottom: 700, width: 600, height: 600 } },
    { id: 3, name: 'title', kind: 'text', visible: true, bounds: { left: 100, top: 800, right: 700, bottom: 880, width: 600, height: 80 } },
    { id: 4, name: 'accent', kind: 'solidColor', visible: true, bounds: { left: 0, top: 1100, right: 800, bottom: 1200, width: 800, height: 100 } },
    { id: 5, name: 'adj', kind: 'adjustment', visible: true }
  ]
};

const textLayers = {
  success: true,
  layers: [
    { id: 3, bounds: { left: 100, top: 800, right: 700, bottom: 880, width: 600, height: 80 }, style: { fontSize: 48 } },
    { id: 6, bounds: { left: 100, top: 900, right: 500, bottom: 940, width: 400, height: 40 }, style: { fontSize: 24 } }
  ]
};

// 1) 完整映射
{
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: hierarchy, textLayers });
  check('full → not null', !!snap);
  check('full → canvas mapped', snap.canvas.width === 800 && snap.canvas.height === 1200);
  // 5 层级层 + 1 个只在文本工具里的层(id6)
  check('full → layer count = 6', snap.layers.length === 6, `got ${snap.layers.length}`);
  const byId = Object.fromEntries(snap.layers.filter((l) => l.id).map((l) => [l.id, l]));
  check('kind: background', byId['1'].kind === 'background');
  check('kind: smartObject→image', byId['2'].kind === 'image', `got ${byId['2'].kind}`);
  check('kind: text', byId['3'].kind === 'text');
  check('kind: solidColor→shape', byId['4'].kind === 'shape', `got ${byId['4'].kind}`);
  check('kind: adjustment→other', byId['5'].kind === 'other', `got ${byId['5'].kind}`);
  check('bounds mapped x=left,y=top', byId['2'].bounds.x === 100 && byId['2'].bounds.y === 100 && byId['2'].bounds.width === 600);
  check('text fontSize merged from text tool', byId['3'].fontSize === 48, `got ${byId['3'].fontSize}`);
  check('text-only layer (id6) merged', !!byId['6'] && byId['6'].kind === 'text' && byId['6'].fontSize === 24);
  check('adjustment layer has no bounds (none provided)', byId['5'].bounds === undefined);
}

// 2) 单位对象 width/height
{
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfoUnit, layerHierarchy: hierarchy });
  check('unit-object canvas mapped', !!snap && snap.canvas.width === 800 && snap.canvas.height === 1200);
}

// 3) 无画布尺寸 → null（诚实，不可测量）
{
  check('no width/height → null', buildDesignSurfaceSnapshot({ documentInfo: { document: {} }, layerHierarchy: hierarchy }) === null);
  check('no documentInfo at all → null', buildDesignSurfaceSnapshot({ layerHierarchy: hierarchy }) === null);
}

// 4) subject 只按 hint 填（不猜）
{
  const noHint = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: hierarchy });
  check('no subject hint → no isSubject', noHint.layers.every((l) => l.isSubject === undefined));
  const withHint = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: hierarchy, subjectLayerIds: [2] });
  const hero = withHint.layers.find((l) => l.id === '2');
  check('subject hint → isSubject on matching layer', hero.isSubject === true);
  check('subject hint → others not subject', withHint.layers.filter((l) => l.id !== '2').every((l) => l.isSubject === undefined));
}

// 5) hierarchy 树形（无 flatList）也能展平
{
  const tree = { success: true, hierarchy: [
    { id: 10, kind: 'group', visible: true, children: [
      { id: 11, kind: 'text', visible: true, bounds: { left: 0, top: 0, width: 100, height: 20 } }
    ] }
  ] };
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: tree });
  check('tree flatten → group + child', snap.layers.length === 2 && snap.layers.some((l) => l.id === '11'));
}

// 6) extract 取最近成功，跳过失败
{
  const toolResults = [
    { name: 'getDocumentInfo', result: { success: false, error: 'no doc' } },
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: { success: false } },
    { name: 'getLayerHierarchy', result: hierarchy },
    { name: 'getAllTextLayers', result: textLayers }
  ];
  const snap = extractDesignSurfaceSnapshotFromToolResults(toolResults);
  check('extract picks latest success', !!snap && snap.canvas.width === 800 && snap.layers.length === 6);
  check('extract: empty log → null', extractDesignSurfaceSnapshotFromToolResults([]) === null);
}

// 7) 端到端：snapshot → 测量提取（确认快照可被下游消费、产出确定性测量）
{
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: hierarchy, textLayers, subjectLayerIds: [2] });
  const m = extractDesignQualityMeasurements(snap);
  check('measurements produced', m && typeof m === 'object');
  check('measurements: elementCount > 0', typeof m.elementCount === 'number' && m.elementCount > 0, `elementCount=${m.elementCount}`);
  check('measurements: subjectAreaRatio computed when subject hinted', typeof m.subjectAreaRatio === 'number', `subjectAreaRatio=${m.subjectAreaRatio}`);
}

// 8) extract: 调用方未显式给主体时，从 renderLayout 声明的 main-image 角色图层 id 兜底
{
  const renderLayout = { name: 'renderLayout', result: { success: true, createdLayerIds: [2, 3], subjectLayerIds: [2] } };
  const toolResults = [
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: hierarchy },
    renderLayout
  ];
  const snap = extractDesignSurfaceSnapshotFromToolResults(toolResults);
  const hero = snap && snap.layers.find((l) => l.id === '2');
  check('extract: renderLayout subjectLayerIds 兜底主体', !!hero && hero.isSubject === true);
  check('extract: 兜底主体 → 其它层非主体', !!snap && snap.layers.filter((l) => l.id !== '2').every((l) => l.isSubject === undefined));
  // 端到端：兜底主体也能让 subjectAreaRatio 可测
  const m = snap ? extractDesignQualityMeasurements(snap) : null;
  check('extract: 兜底主体 → subjectAreaRatio 可测', !!m && typeof m.subjectAreaRatio === 'number', `subjectAreaRatio=${m && m.subjectAreaRatio}`);

  // 显式 subjectLayerIds 优先于 renderLayout 兜底
  const snapExplicit = extractDesignSurfaceSnapshotFromToolResults(toolResults, { subjectLayerIds: [3] });
  const explicitSubject = snapExplicit && snapExplicit.layers.find((l) => l.id === '3');
  const heroNotSubject = snapExplicit && snapExplicit.layers.find((l) => l.id === '2');
  check('extract: 显式主体优先于 renderLayout 兜底', !!explicitSubject && explicitSubject.isSubject === true && (!heroNotSubject || heroNotSubject.isSubject === undefined));

  // renderLayout 无 subjectLayerIds（如纯文字阶段）→ 不臆造主体
  const noSubjectLog = [
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: hierarchy },
    { name: 'renderLayout', result: { success: true, createdLayerIds: [3] } }
  ];
  const snapNoSubject = extractDesignSurfaceSnapshotFromToolResults(noSubjectLog);
  check('extract: renderLayout 无主体声明 → 不臆造主体', !!snapNoSubject && snapNoSubject.layers.every((l) => l.isSubject === undefined));
}

// 9) extract: 多阶段（多次 renderLayout）→ 合并所有阶段主体，不只取最近一次（详情页多屏）
{
  const multiStageLog = [
    { name: 'renderLayout', result: { success: true, subjectLayerIds: [2] } },       // 早期阶段主体
    { name: 'renderLayout', result: { success: false, subjectLayerIds: [99] } },      // 失败阶段不计
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: hierarchy },
    { name: 'renderLayout', result: { success: true, subjectLayerIds: [4, 2] } }      // 最近阶段主体（含重复 2）
  ];
  const snap = extractDesignSurfaceSnapshotFromToolResults(multiStageLog);
  const s2 = snap && snap.layers.find((l) => l.id === '2');
  const s4 = snap && snap.layers.find((l) => l.id === '4');
  check('extract: 多阶段合并 → 早期阶段主体(2)也标记', !!s2 && s2.isSubject === true);
  check('extract: 多阶段合并 → 最近阶段主体(4)标记', !!s4 && s4.isSubject === true);
  check('extract: 多阶段合并 → 失败阶段主体(99)不计', !!snap && !snap.layers.some((l) => l.id === '99' && l.isSubject));
  check('extract: 多阶段合并 → 非主体层(1/3/5)不被误标', !!snap && snap.layers.filter((l) => ['1', '3', '5'].includes(l.id)).every((l) => l.isSubject === undefined));
}

// 10) 新鲜度只由真实画布写入失效；导出不改变像素/结构，不能抹掉最终读回
{
  const writeThenRead = [
    { name: 'renderLayout', result: { success: true, subjectLayerIds: [2] } },
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: hierarchy }
  ];
  check('fresh: 写入后的结构读回可用', !!extractFreshDesignSurfaceSnapshotFromToolResults(writeThenRead));
  check('fresh: 后续导出不使结构读回过期', !!extractFreshDesignSurfaceSnapshotFromToolResults([
    ...writeThenRead,
    { name: 'quickExport', result: { success: true, outputPath: 'C:/tmp/design.png' } }
  ]));
  check('fresh: 后续画布写入会使旧结构读回过期', extractFreshDesignSurfaceSnapshotFromToolResults([
    ...writeThenRead,
    { name: 'setTextContent', result: { success: true } }
  ]) === null);
}

// 11) Host 历史版本绑定：像素 Judge 指定版本后，三个结构读只能消费完全相同的 document/history 对
{
  const h1 = { documentId: 101, historyStateId: 1001 };
  const h2 = { documentId: 101, historyStateId: 1002 };
  const otherDocument = { documentId: 202, historyStateId: 1001 };
  const versionedLog = [
    { name: 'renderLayout', result: { success: true, subjectLayerIds: [2] } },
    { name: 'getDocumentInfo', result: { ...docInfo, historyStateRef: h1 } },
    { name: 'getLayerHierarchy', result: { ...hierarchy, historyStateRef: h1 } },
    { name: 'getAllTextLayers', result: { ...textLayers, historyStateRef: h1 } }
  ];
  check('revision: 同一 Host 版本的结构证据可测', !!extractFreshDesignSurfaceSnapshotFromToolResults(
    versionedLog,
    { requiredHistoryStateRef: h1 }
  ));
  check('revision: 图层层级版本不一致时 fail closed', extractFreshDesignSurfaceSnapshotFromToolResults([
    ...versionedLog.slice(0, 2),
    { name: 'getLayerHierarchy', result: { ...hierarchy, historyStateRef: h2 } },
    versionedLog[3]
  ], { requiredHistoryStateRef: h1 }) === null);
  check('revision: 图层层级缺 Host 引用时 fail closed', extractFreshDesignSurfaceSnapshotFromToolResults([
    ...versionedLog.slice(0, 2),
    { name: 'getLayerHierarchy', result: hierarchy }
  ], { requiredHistoryStateRef: h1 }) === null);
  check('revision: rootLayerId 局部层级不能冒充全画布结构', extractFreshDesignSurfaceSnapshotFromToolResults([
    versionedLog[0],
    versionedLog[1],
    {
      name: 'getLayerHierarchy',
      arguments: { rootLayerId: 2 },
      result: { ...hierarchy, rootLayerId: 2, historyStateRef: h1 }
    }
  ], { requiredHistoryStateRef: h1 }) === null);
  const mixedTextSnapshot = extractFreshDesignSurfaceSnapshotFromToolResults([
    versionedLog[0],
    versionedLog[1],
    versionedLog[2],
    { name: 'getAllTextLayers', result: { ...textLayers, historyStateRef: h2 } }
  ], { requiredHistoryStateRef: h1 });
  check('revision: 不把其他版本的文字结构拼入同一快照', !!mixedTextSnapshot
    && !mixedTextSnapshot.layers.some((layer) => layer.id === '6')
    && mixedTextSnapshot.layers.find((layer) => layer.id === '3')?.fontSize === undefined);
  check('revision: 相同 historyStateId 但不同 documentId 不能混用', extractFreshDesignSurfaceSnapshotFromToolResults([
    { name: 'getDocumentInfo', result: { ...docInfo, historyStateRef: otherDocument } },
    { name: 'getLayerHierarchy', result: { ...hierarchy, historyStateRef: otherDocument } }
  ], { requiredHistoryStateRef: h1 }) === null);
  const crossDocumentSubjectSnapshot = extractFreshDesignSurfaceSnapshotFromToolResults([
    {
      name: 'createDocument',
      result: { success: true, document: { id: 101, name: 'A.psd' } }
    },
    { name: 'renderLayout', result: { success: true, documentId: 101, subjectLayerIds: [2] } },
    {
      name: 'switchDocument',
      arguments: { documentId: 202 },
      result: { success: true, activeDocumentId: 202, activeDocumentName: 'B.psd' }
    },
    { name: 'renderLayout', result: { success: true, documentId: 202, subjectLayerIds: [4] } },
    {
      name: 'switchDocument',
      arguments: { documentId: 101 },
      result: { success: true, activeDocumentId: 101, activeDocumentName: 'A.psd' }
    },
    { name: 'getDocumentInfo', result: { ...docInfo, historyStateRef: h1 } },
    { name: 'getLayerHierarchy', result: { ...hierarchy, historyStateRef: h1 } }
  ], { requiredHistoryStateRef: h1 });
  check('revision: renderLayout 主体声明只合并当前 Host 文档', !!crossDocumentSubjectSnapshot
    && crossDocumentSubjectSnapshot.layers.find((layer) => layer.id === '2')?.isSubject === true
    && crossDocumentSubjectSnapshot.layers.find((layer) => layer.id === '4')?.isSubject !== true);
  check('revision parser: 支持稳定顶层引用', samePhotoshopHistoryStateRef(
    readPhotoshopHistoryStateRef({ historyStateRef: h1 }),
    h1
  ));
  check('revision parser: 支持 data 包装且不猜非法值', samePhotoshopHistoryStateRef(
    readPhotoshopHistoryStateRef({ data: { historyStateRef: h2 } }),
    h2
  ) && readPhotoshopHistoryStateRef({ historyStateRef: { documentId: 0, historyStateId: 'unknown' } }) === undefined);
}

if (failures > 0) {
  console.error(`[smoke-design-surface-snapshot-normalizer] FAILED (${failures})`);
  process.exit(1);
}
console.log('[smoke-design-surface-snapshot-normalizer] passed');
