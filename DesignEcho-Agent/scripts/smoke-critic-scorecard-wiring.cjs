// 审美断言体系接线守护（任务C + 对抗式评审修复 F2/F3）：
// C3 — 归一化器把 getAllTextLayers 的 style.textAlign 映射进画面快照文本节点，
//      枚举校验不过就不填（绝不默认 center）；缺对齐/缺 fillColor 时上游仍诚实判 uneval（语义不变）。
// C4 — 确定性评分卡经 mergeDeterministicScorecardIntoCriticVerdict 并进团队评审 verdict：
//      失败/待复核断言带 owner 并进 issues；全 uneval（无真实测量）时原样返回，不注水。
// F2 — 并轨分级口径（与 design-quality-verdict-bundle 一致）：仅 blocker 级失败强制 needs_fix
//      （不被模型散文 pass/unparseable 抵消）；major/minor 失败只进 issues，不翻转模型 pass。
// F3 — 测量新鲜度门禁：结构读（getDocumentInfo/getLayerHierarchy/getAllTextLayers）必须晚于
//      最后一次成功写操作才可用；renderLayout 的 subjectLayerIds 是身份声明不受此限；
//      写后无新鲜结构读 → 快照 null → 全 uneval → 不强制。
// 另含静态接线钉桩：coordinator critic 阶段真的接了评分卡且走新鲜度门禁提取、
// critic 白名单含 getDocumentInfo/getLayerHierarchy/getAllTextLayers（评审轮可自取新鲜结构证据）。
// 纯逻辑 + 源码钉桩，无需运行环境。

const fs = require('fs');
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
  evaluateDeterministicAssertions,
  scoreDesignAssertions
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-quality-assertion.ts'));
const {
  mergeDeterministicScorecardIntoCriticVerdict,
  parseCriticVerdict
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-team-verdict.ts'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures += 1; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const docInfo = { success: true, document: { width: 800, height: 1200 } };

// 排版及格线场景：主体图 + 两行居中文字，无 shape、无 background 层（画布默认白底）。
const baselineHierarchy = {
  success: true,
  flatList: [
    { id: 2, name: 'hero', kind: 'smartObject', visible: true, bounds: { left: 100, top: 100, right: 700, bottom: 700, width: 600, height: 600 } },
    { id: 3, name: 'title', kind: 'text', visible: true, bounds: { left: 100, top: 800, right: 700, bottom: 880, width: 600, height: 80 } },
    { id: 6, name: 'subtitle', kind: 'text', visible: true, bounds: { left: 100, top: 900, right: 500, bottom: 940, width: 400, height: 40 } }
  ]
};

function centeredTextLayers() {
  return {
    success: true,
    layers: [
      { id: 3, bounds: { left: 100, top: 800, right: 700, bottom: 880, width: 600, height: 80 }, style: { fontSize: 48, textAlign: 'center' } },
      { id: 6, bounds: { left: 100, top: 900, right: 500, bottom: 940, width: 400, height: 40 }, style: { fontSize: 24, textAlign: 'center' } }
    ]
  };
}

// ==================== C3：textAlign 进快照文本节点 ====================

{
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: baselineHierarchy, textLayers: centeredTextLayers() });
  const byId = Object.fromEntries(snap.layers.filter((l) => l.id).map((l) => [l.id, l]));
  check('C3: textAlign=center 映射进层级文本节点', byId['3'].textAlign === 'center', `got ${byId['3'].textAlign}`);
  check('C3: 第二个文本节点也带 textAlign', byId['6'].textAlign === 'center', `got ${byId['6'].textAlign}`);
}

{
  // 枚举校验：非法取值/非字符串 → 不填（绝不默认 center）
  const badAligns = {
    success: true,
    layers: [
      { id: 3, style: { fontSize: 48, textAlign: 'middle' } },
      { id: 6, style: { fontSize: 24, textAlign: 3 } },
      { id: 7, style: { fontSize: 20, textAlign: 'CENTER' } }
    ]
  };
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: baselineHierarchy, textLayers: badAligns });
  check('C3: 非法枚举一律不填 textAlign（不猜测不默认）',
    snap.layers.every((l) => l.textAlign === undefined),
    JSON.stringify(snap.layers.map((l) => l.textAlign)));
}

{
  // 只在文本工具里出现的文本层（层级未含）也带上 textAlign
  const extraText = {
    success: true,
    layers: [{ id: 99, bounds: { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }, style: { fontSize: 16, textAlign: 'left' } }]
  };
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: baselineHierarchy, textLayers: extraText });
  const merged = snap.layers.find((l) => l.id === '99');
  check('C3: 仅文本工具可见的文本层合并时保留 textAlign', !!merged && merged.textAlign === 'left');
}

// ==================== C3：测量语义不变（缺字段仍 uneval，补齐字段则 blocker 可击发） ====================

{
  // 有 textAlign 且全居中 + 无视觉化手段 + 默认白底 → layoutBaselineOnly=true → blocker 断言击发
  const snap = buildDesignSurfaceSnapshot({
    documentInfo: docInfo, layerHierarchy: baselineHierarchy, textLayers: centeredTextLayers(), subjectLayerIds: [2]
  });
  const m = extractDesignQualityMeasurements(snap);
  check('C3: 全居中+白底+无视觉化 → layoutBaselineOnly=true', m.layoutBaselineOnly === true, `got ${m.layoutBaselineOnly}`);

  const results = evaluateDeterministicAssertions(m);
  const baselineAssertion = results.find((r) => r.id === 'overall.above-baseline');
  check('C3: blocker 断言 overall.above-baseline 可击发（fail）',
    !!baselineAssertion && baselineAssertion.status === 'fail',
    `status=${baselineAssertion && baselineAssertion.status}`);
}

{
  // 缺 textAlign（UXP 读不到时的诚实缺省）→ layoutBaselineOnly=undefined → blocker 仍判 uneval（语义不变）
  const noAlign = {
    success: true,
    layers: [
      { id: 3, bounds: { left: 100, top: 800, right: 700, bottom: 880, width: 600, height: 80 }, style: { fontSize: 48 } },
      { id: 6, bounds: { left: 100, top: 900, right: 500, bottom: 940, width: 400, height: 40 }, style: { fontSize: 24 } }
    ]
  };
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: baselineHierarchy, textLayers: noAlign, subjectLayerIds: [2] });
  const m = extractDesignQualityMeasurements(snap);
  check('C3: 缺 textAlign → layoutBaselineOnly 不硬判（undefined）', m.layoutBaselineOnly === undefined, `got ${m.layoutBaselineOnly}`);
  const results = evaluateDeterministicAssertions(m);
  const baselineAssertion = results.find((r) => r.id === 'overall.above-baseline');
  check('C3: 缺测量 → blocker 判 uneval（绝不补默认）',
    !!baselineAssertion && baselineAssertion.status === 'uneval',
    `status=${baselineAssertion && baselineAssertion.status}`);
}

{
  // fillColor 不可得（C2 结论）：有 background 层且无填充信息 → backgroundIsPlainDefault=undefined → uneval
  const withBgSheet = {
    success: true,
    flatList: [
      { id: 1, name: '背景', kind: 'background', visible: true, bounds: { left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200 } },
      ...baselineHierarchy.flatList
    ]
  };
  const snap = buildDesignSurfaceSnapshot({ documentInfo: docInfo, layerHierarchy: withBgSheet, textLayers: centeredTextLayers() });
  const m = extractDesignQualityMeasurements(snap);
  check('C2/C3: 有背景层但 fillColor 不可得 → backgroundIsPlainDefault 保持 undefined（uneval）',
    m.backgroundIsPlainDefault === undefined, `got ${m.backgroundIsPlainDefault}`);
}

// ==================== C4：确定性评分卡并进 critic verdict ====================

function buildBaselineScorecard() {
  // 生产同路径：renderLayout（写 + 主体身份声明）在前、结构读在后 → F3 新鲜度门禁下的合法时序
  const toolResults = [
    { name: 'renderLayout', result: { success: true, subjectLayerIds: [2] } },
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: baselineHierarchy },
    { name: 'getAllTextLayers', result: centeredTextLayers() }
  ];
  const snapshot = extractFreshDesignSurfaceSnapshotFromToolResults(toolResults);
  const measurements = extractDesignQualityMeasurements(snapshot);
  return scoreDesignAssertions(evaluateDeterministicAssertions(measurements));
}

{
  const scorecard = buildBaselineScorecard();
  check('C4: 排版及格线场景评分卡 gate=failed（blocker 一票否决）', scorecard.gate === 'failed', `gate=${scorecard.gate}`);
  check('C4: 评分卡含 blocker', scorecard.blockers.length > 0, `blockers=${scorecard.blockers.length}`);

  // 模型散文说 pass → 确定性 blocker（红线）不允许被抵消，强制 needs_fix，且失败断言进 issues
  const passVerdict = parseCriticVerdict('画面很棒。\n{"verdict":"pass"}');
  const merged = mergeDeterministicScorecardIntoCriticVerdict(passVerdict, scorecard);
  check('C4: 模型 pass + 确定性 blocker → 强制 needs_fix', merged.status === 'needs_fix', `got ${merged.status}`);
  check('C4: 确定性失败断言并进 issues（含排版及格线红线）',
    merged.issues.some((i) => i.target.includes('overall.above-baseline')),
    JSON.stringify(merged.issues.map((i) => i.target)));
  check('C4: 确定性 issue 带 owner（可路由返工）',
    merged.issues.filter((i) => i.target.includes('overall.above-baseline')).every((i) => typeof i.owner === 'string' && i.owner.length > 0));
  check('C4: verdict 附确定性评分卡摘要',
    !!merged.deterministicScorecard
      && merged.deterministicScorecard.gate === 'failed'
      && typeof merged.deterministicScorecard.overallScore === 'number'
      && merged.deterministicScorecard.evaluated > 0
      && typeof merged.deterministicScorecard.summary === 'string');

  // 模型裁决不可机读 → 同样不能抵消确定性 blocker
  const unparseable = parseCriticVerdict('画面还行，但说不上来哪里差。');
  const mergedUnparseable = mergeDeterministicScorecardIntoCriticVerdict(unparseable, scorecard);
  check('C4: 模型 unparseable + 确定性 blocker → 强制 needs_fix', mergedUnparseable.status === 'needs_fix', `got ${mergedUnparseable.status}`);

  // 模型 needs_fix：并集合并，模型原 issues 一条不丢
  const modelNeedsFix = parseCriticVerdict('{"verdict":"needs_fix","issues":[{"owner":"copy","target":"主标题","problem":"卖点泛泛","suggestion":"改场景钩子"}]}');
  const mergedUnion = mergeDeterministicScorecardIntoCriticVerdict(modelNeedsFix, scorecard);
  check('C4: 并集合并保留模型原 issue', mergedUnion.issues.some((i) => i.target === '主标题'));
  check('C4: 并集合并追加确定性 issue', mergedUnion.issues.length > modelNeedsFix.issues.length);

  // 去重：同一 verdict 重复并轨不产生重复 issue
  const mergedTwice = mergeDeterministicScorecardIntoCriticVerdict(mergedUnion, scorecard);
  check('C4: 重复并轨按 target+problem 去重', mergedTwice.issues.length === mergedUnion.issues.length,
    `${mergedTwice.issues.length} vs ${mergedUnion.issues.length}`);
}

{
  // 全 uneval（无任何真实测量）→ 原样返回：不注水、不改 status、不附评分卡
  const emptyScorecard = scoreDesignAssertions(evaluateDeterministicAssertions({}));
  const passVerdict = parseCriticVerdict('{"verdict":"pass"}');
  const merged = mergeDeterministicScorecardIntoCriticVerdict(passVerdict, emptyScorecard);
  check('C4: 全 uneval → verdict 原样返回（status 不变）', merged.status === 'pass', `got ${merged.status}`);
  check('C4: 全 uneval → 不附评分卡、不加 issues',
    merged.deterministicScorecard === undefined && merged.issues.length === 0);
  // null/undefined 评分卡同样原样返回
  check('C4: scorecard=null → 原样返回', mergeDeterministicScorecardIntoCriticVerdict(passVerdict, null) === passVerdict);
}

// ==================== F2：分级口径——仅 blocker 硬翻转，major/minor 判软 ====================

{
  // 仅 minor 失败（craft.precision：1px 溢出类）：模型看图判 pass 不被翻转，issue 仍进清单可引用
  const minorOnly = scoreDesignAssertions(evaluateDeterministicAssertions({ hasOverflow: true }));
  check('F2: 仅 minor fail 的评分卡无 blocker', minorOnly.blockers.length === 0 && minorOnly.failedAssertions.length === 1);
  const mergedMinor = mergeDeterministicScorecardIntoCriticVerdict(
    parseCriticVerdict('画面达标。\n{"verdict":"pass"}'), minorOnly);
  check('F2: 仅 minor fail + 模型 pass → 保持 pass（不强制 needs_fix）',
    mergedMinor.status === 'pass', `got ${mergedMinor.status}`);
  check('F2: minor 失败仍并进 issues（评审可见、修订轮可引用）',
    mergedMinor.issues.some((i) => i.target.includes('craft.precision')),
    JSON.stringify(mergedMinor.issues.map((i) => i.target)));
  check('F2: minor 失败仍附确定性评分卡摘要', !!mergedMinor.deterministicScorecard);

  // 仅 major 失败（背景未设计）：梯度缺陷判软——与 design-quality-verdict-bundle 的
  // "blocker 硬 failed / 仅 major 软 needs_review"单一分级口径一致，不翻转模型 pass
  const majorOnly = scoreDesignAssertions(evaluateDeterministicAssertions({ backgroundIsPlainDefault: true }));
  check('F2: 仅 major fail 的评分卡无 blocker', majorOnly.blockers.length === 0 && majorOnly.failedAssertions.length === 1);
  const mergedMajor = mergeDeterministicScorecardIntoCriticVerdict(
    parseCriticVerdict('{"verdict":"pass"}'), majorOnly);
  check('F2: 仅 major fail + 模型 pass → 保持 pass（梯度判软）',
    mergedMajor.status === 'pass', `got ${mergedMajor.status}`);
  check('F2: major 失败并进 issues', mergedMajor.issues.some((i) => i.target.includes('color.background-designed')));
}

// ==================== F3：测量新鲜度门禁（结构读须晚于最后一次成功写操作） ====================

{
  // 写在读之后 → 之前的结构读全部过期 → 快照 null（测量记 null → 全 uneval → 不强制）
  const staleReadLog = [
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: baselineHierarchy },
    { name: 'getAllTextLayers', result: centeredTextLayers() },
    { name: 'setTextContent', result: { success: true } }
  ];
  check('F3: 写后无新鲜结构读 → 快照 null（不用执行前旧画面测量）',
    extractFreshDesignSurfaceSnapshotFromToolResults(staleReadLog) === null);

  // critic 阶段重新读取 → 用新读测量；renderLayout 的 subjectLayerIds 是身份声明不受新鲜度限制
  const freshReadLog = [
    { name: 'renderLayout', result: { success: true, subjectLayerIds: [2] } }, // 写 + 主体身份声明
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: baselineHierarchy },
    { name: 'getAllTextLayers', result: centeredTextLayers() }
  ];
  const freshSnap = extractFreshDesignSurfaceSnapshotFromToolResults(freshReadLog);
  check('F3: 写后有新鲜结构读 → 快照可测', !!freshSnap);
  const freshSubject = freshSnap && freshSnap.layers.find((l) => l.id === '2');
  check('F3: renderLayout 主体身份声明穿透新鲜度门禁', !!freshSubject && freshSubject.isSubject === true);

  // 只有新鲜 getDocumentInfo、没有新鲜 getLayerHierarchy → 不得用"空图层画布"假快照测量
  const docOnlyFreshLog = [
    { name: 'getLayerHierarchy', result: baselineHierarchy },
    { name: 'setTextContent', result: { success: true } },
    { name: 'getDocumentInfo', result: docInfo }
  ];
  check('F3: 无新鲜图层结构 → 快照 null（防空图层假测量）',
    extractFreshDesignSurfaceSnapshotFromToolResults(docOnlyFreshLog) === null);

  // 失败的写没有改画面 → 不作废之前的结构读
  const failedWriteLog = [
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: baselineHierarchy },
    { name: 'setTextContent', result: { success: false, error: 'no layer' } }
  ];
  check('F3: 失败写操作不作废结构读', !!extractFreshDesignSurfaceSnapshotFromToolResults(failedWriteLog));

  // 无任何写操作（纯分析流程）→ 已有读取天然新鲜
  const readOnlyLog = [
    { name: 'getDocumentInfo', result: docInfo },
    { name: 'getLayerHierarchy', result: baselineHierarchy }
  ];
  check('F3: 无写操作 → 读取天然新鲜可测', !!extractFreshDesignSurfaceSnapshotFromToolResults(readOnlyLog));
}

// ==================== 静态接线钉桩（防回退） ====================

{
  const coordinatorSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'coordinator.ts'), 'utf8');
  check('接线: coordinator critic 阶段调用 mergeDeterministicScorecardIntoCriticVerdict',
    coordinatorSource.includes('mergeDeterministicScorecardIntoCriticVerdict(verdict, deterministicScorecard)'));
  check('接线: coordinator 用流水线级 toolResultsSink 复用 toolCallLog（不新建采集管道）',
    coordinatorSource.includes('toolResultsSink: pipelineToolResults'));
  check('接线: coordinator 经新鲜度门禁的归一化管道取快照（F3）',
    coordinatorSource.includes('extractFreshDesignSurfaceSnapshotFromToolResults'));
}

{
  const { getDesignTeammateDefinition } = require(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'registry.ts'));
  const critic = getDesignTeammateDefinition('critic');
  check('接线: critic 白名单含 getAllTextLayers（评审时可取最新对齐证据）',
    critic.allowedTools.includes('getAllTextLayers'));
  check('接线: critic 白名单含 getDocumentInfo/getLayerHierarchy（评审轮有机制自取新鲜结构证据）',
    critic.allowedTools.includes('getDocumentInfo') && critic.allowedTools.includes('getLayerHierarchy'));
}

if (failures > 0) {
  console.error(`[smoke-critic-scorecard-wiring] FAILED (${failures})`);
  process.exit(1);
}
console.log('[smoke-critic-scorecard-wiring] passed');
