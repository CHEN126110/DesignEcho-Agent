// 画面测量提取器守护：从画面快照结构确定性算出设计测量值，并端到端串通
// 快照 → 测量 → 确定性断言 → 评分卡。算不出的诚实留 undefined（判 uneval，不伪造）。
// baseline 快照（主体图+居中文字+白底、无视觉化手段）应触发排版及格线红线 → failed。
// F3b：layoutBaselineOnly 判 true 须所有文本层 textAlign 已知且为 center——PS 描述符可能
// 系统性省略默认左对齐，部分缺省时不下硬结论（undefined → uneval），与断言体系总语义一致。

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  extractDesignQualityMeasurements
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-quality-measurement.ts'));

const {
  evaluateDeterministicAssertions,
  scoreDesignAssertions
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-quality-assertion.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approx(a, b, eps, message) {
  assert(Math.abs(a - b) <= eps, `${message}（期望≈${b}，实际${a}）`);
}

// ---------- 1) 优质画面：对齐、主体占比合理、字号层级、背景设计过、有色块 ----------
const goodSnapshot = {
  canvas: { width: 1000, height: 1000 },
  layers: [
    { id: 'bg', kind: 'background', fillColor: { r: 30, g: 90, b: 200 } },        // 设计过的蓝底
    { id: 'subject', kind: 'image', isSubject: true, bounds: { x: 250, y: 250, width: 500, height: 500 } }, // 占比 25%? 面积 250000/1e6=0.25
    { id: 'title', kind: 'text', fontSize: 90, textAlign: 'left', bounds: { x: 100, y: 60, width: 600, height: 110 } },
    { id: 'subtitle', kind: 'text', fontSize: 50, textAlign: 'left', bounds: { x: 100, y: 180, width: 500, height: 60 } },
    { id: 'badge', kind: 'shape', fillColor: { r: 255, g: 80, b: 0 }, bounds: { x: 100, y: 800, width: 200, height: 80 } }
  ]
};
const goodM = extractDesignQualityMeasurements(goodSnapshot);
approx(goodM.subjectAreaRatio, 0.25, 0.001, '主体占比');
approx(goodM.titleToSubtitleScale, 1.8, 0.001, '标题/副标题字号比');
assert(goodM.hasOverflow === false, '无越界应为 false');
assert(goodM.backgroundIsPlainDefault === false, '设计过的蓝底应判 false');
assert(goodM.layoutBaselineOnly === false, '有色块+非白底应判非 baseline');
assert(goodM.elementCount === 4, `内容图层应为 4（不含 background），实际 ${goodM.elementCount}`);
assert(typeof goodM.alignmentScore === 'number' && goodM.alignmentScore > 0, '应算出对齐分');
assert(goodM.subjectBackgroundContrast === undefined, '对比度需像素，结构层应留 undefined');

// ---------- 2) baseline 红线：主体图 + 居中文字 + 白底、无形状/无非主体图 ----------
const baselineSnapshot = {
  canvas: { width: 1000, height: 1000 },
  layers: [
    { id: 'subject', kind: 'image', isSubject: true, bounds: { x: 300, y: 250, width: 400, height: 400 } },
    { id: 'title', kind: 'text', fontSize: 80, textAlign: 'center', bounds: { x: 200, y: 700, width: 600, height: 90 } },
    { id: 'subtitle', kind: 'text', fontSize: 44, textAlign: 'center', bounds: { x: 250, y: 800, width: 500, height: 50 } }
    // 无 background 图层 → 默认白底；无 shape；无非主体 image
  ]
};
const baselineM = extractDesignQualityMeasurements(baselineSnapshot);
assert(baselineM.backgroundIsPlainDefault === true, '无背景层应判默认白底 true');
assert(baselineM.layoutBaselineOnly === true, '图+居中文字+白底应判 baseline true');

// 端到端：baseline 测量 → 断言 → 评分应触发红线 failed
const baselineCard = scoreDesignAssertions(evaluateDeterministicAssertions(baselineM));
assert(baselineCard.gate === 'failed', `baseline 应触发红线 failed，实际 ${baselineCard.gate}`);
assert(baselineCard.blockers.some((b) => b.id === 'overall.above-baseline'), '应由 above-baseline 红线否决');

// ---------- 3) 近白填充背景也算默认白底 ----------
const whiteBgSnapshot = {
  canvas: { width: 800, height: 800 },
  layers: [
    { id: 'bg', kind: 'background', fillColor: { r: 252, g: 252, b: 252 } },
    { id: 'subject', kind: 'image', isSubject: true, bounds: { x: 200, y: 200, width: 400, height: 400 } },
    { id: 't', kind: 'text', fontSize: 60, textAlign: 'center', bounds: { x: 100, y: 650, width: 600, height: 70 } },
    { id: 't2', kind: 'text', fontSize: 36, textAlign: 'center', bounds: { x: 150, y: 730, width: 500, height: 40 } }
  ]
};
const whiteM = extractDesignQualityMeasurements(whiteBgSnapshot);
assert(whiteM.backgroundIsPlainDefault === true, '近白填充背景应判默认白底 true');
assert(whiteM.layoutBaselineOnly === true, '近白底+居中文字应判 baseline');

// ---------- 4) 信息不足：诚实留 undefined（不伪造） ----------
const sparseSnapshot = {
  canvas: { width: 0, height: 0 },   // 无画布尺寸
  layers: [{ id: 'x', kind: 'image' }] // 无 bounds、无 isSubject
};
const sparseM = extractDesignQualityMeasurements(sparseSnapshot);
assert(sparseM.subjectAreaRatio === undefined, '无画布/无主体不应算主体占比');
assert(sparseM.alignmentScore === undefined, '不足两个带 bounds 图层不应算对齐');
assert(sparseM.titleToSubtitleScale === undefined, '不足两个文本不应算字号比');
assert(sparseM.hasOverflow === undefined, '无画布尺寸不应判越界');

// 空输入不抛错
const emptyM = extractDesignQualityMeasurements(null);
assert(emptyM && Object.keys(emptyM).length === 0, '空输入应返回空测量对象');

// ---------- 5) 越界检测 ----------
const overflowSnapshot = {
  canvas: { width: 500, height: 500 },
  layers: [
    { id: 'a', kind: 'image', isSubject: true, bounds: { x: 100, y: 100, width: 200, height: 200 } },
    { id: 'b', kind: 'text', fontSize: 40, bounds: { x: 400, y: 100, width: 300, height: 60 } } // 右边 700 > 500 越界
  ]
};
const overflowM = extractDesignQualityMeasurements(overflowSnapshot);
assert(overflowM.hasOverflow === true, '应检测到越界');

// ---------- 6) 优质画面端到端不被红线否决（gate 非 failed-by-blocker） ----------
const goodCard = scoreDesignAssertions(evaluateDeterministicAssertions(goodM));
assert(goodCard.blockers.length === 0, '优质画面不应触发红线');

// ---------- 7) F3b：部分缺 textAlign 不下硬结论 ----------
// 评审给的失败输入：居中标题 + 缺省对齐正文（PS 描述符省略默认左对齐）。
// 旧行为把缺省层从 every 剔除后只剩居中层 → 误判 baseline=true 误击发 blocker；
// 修正后：任一文本层缺 textAlign → 该测量 undefined → blocker 判 uneval。
const partialAlignSnapshot = {
  canvas: { width: 1000, height: 1000 },
  layers: [
    { id: 'subject', kind: 'image', isSubject: true, bounds: { x: 300, y: 250, width: 400, height: 400 } },
    { id: 'title', kind: 'text', fontSize: 80, textAlign: 'center', bounds: { x: 200, y: 700, width: 600, height: 90 } },
    { id: 'body', kind: 'text', fontSize: 40, bounds: { x: 100, y: 810, width: 500, height: 50 } } // textAlign 缺省
  ]
};
const partialM = extractDesignQualityMeasurements(partialAlignSnapshot);
assert(partialM.layoutBaselineOnly === undefined,
  `任一文本缺 textAlign 不得判 baseline（应 undefined→uneval），实际 ${partialM.layoutBaselineOnly}`);
const partialCard = scoreDesignAssertions(evaluateDeterministicAssertions(partialM));
assert(!partialCard.blockers.some((b) => b.id === 'overall.above-baseline'), '缺对齐证据不得误击发排版及格线红线');
const partialBaselineResult = partialCard.results.find((r) => r.id === 'overall.above-baseline');
assert(partialBaselineResult && partialBaselineResult.status === 'uneval',
  `缺测量应判 uneval，实际 ${partialBaselineResult && partialBaselineResult.status}`);

// 对齐证据齐全且存在左对齐正文 → "居中标题+左对齐正文"的有意排版判非 baseline
const mixedAlignSnapshot = {
  ...partialAlignSnapshot,
  layers: partialAlignSnapshot.layers.map((l) => (l.id === 'body' ? { ...l, textAlign: 'left' } : l))
};
const mixedM = extractDesignQualityMeasurements(mixedAlignSnapshot);
assert(mixedM.layoutBaselineOnly === false, '居中标题+左对齐正文（对齐证据齐全）应判非 baseline');

// 判 false 的既有证据路径（有 shape 等视觉化手段）不受对齐缺省影响
const shapeNoAlignSnapshot = {
  canvas: { width: 1000, height: 1000 },
  layers: [
    { id: 'subject', kind: 'image', isSubject: true, bounds: { x: 300, y: 250, width: 400, height: 400 } },
    { id: 'badge', kind: 'shape', bounds: { x: 100, y: 850, width: 200, height: 80 } },
    { id: 'title', kind: 'text', fontSize: 80, bounds: { x: 200, y: 700, width: 600, height: 90 } } // 缺 textAlign
  ]
};
const shapeM = extractDesignQualityMeasurements(shapeNoAlignSnapshot);
assert(shapeM.layoutBaselineOnly === false, '有色块证据时缺对齐也应判 false（既有证据路径不变）');

// 无文本层：提前返回 undefined，不得经 every([])=true 误判 baseline
const noTextSnapshot = {
  canvas: { width: 1000, height: 1000 },
  layers: [
    { id: 'subject', kind: 'image', isSubject: true, bounds: { x: 300, y: 250, width: 400, height: 400 } }
  ]
};
const noTextM = extractDesignQualityMeasurements(noTextSnapshot);
assert(noTextM.layoutBaselineOnly === undefined, '无文本层不得误判 baseline（空集不走 every([])=true）');

console.log('[smoke-design-quality-measurement] passed');
