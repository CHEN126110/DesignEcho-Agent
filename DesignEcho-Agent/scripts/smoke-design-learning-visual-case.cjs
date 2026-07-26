#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 学习视觉案例纯逻辑（2026-07-03）
 * 用户方向：让 Agent 把学到的经验钉在真实图上、用真实分割标注主体。
 * 钉住蒙版→主体框、三分线、覆盖率、清洗边界——ONNX 抠图执行属真机，本 smoke 不碰。
 */

const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const vc = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-learning-visual-case.ts'));

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}
function approx(a, b, eps = 0.02) { return Math.abs(a - b) <= eps; }

// 构造 10x10 蒙版：中间 4x4 (x 3..6, y 3..6) 为前景 255，其余 0
const W = 10, H = 10;
const mask = new Uint8Array(W * H);
for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) mask[y * W + x] = 255;

const rect = vc.computeSubjectRectFromMask(mask, W, H);
check('蒙版→主体框存在', !!rect, JSON.stringify(rect));
if (rect) {
    // 前景 x∈[3,6],y∈[3,6] → 像素跨度 4，归一化 x=0.3 y=0.3 w=0.4 h=0.4
    check('主体框 x≈0.3', approx(rect.x, 0.3), rect.x);
    check('主体框 y≈0.3', approx(rect.y, 0.3), rect.y);
    check('主体框 w≈0.4', approx(rect.w, 0.4), rect.w);
    check('主体框 h≈0.4', approx(rect.h, 0.4), rect.h);
}

// 全背景蒙版 → 诚实返回 undefined（不给假框）
check('全背景蒙版→无框(不臆造)', vc.computeSubjectRectFromMask(new Uint8Array(W * H), W, H) === undefined);
// 尺寸不符/空 → undefined
check('空蒙版→undefined', vc.computeSubjectRectFromMask(null, W, H) === undefined);
check('长度不足→undefined', vc.computeSubjectRectFromMask(new Uint8Array(5), W, H) === undefined);

// 0..1 量纲兼容
const maskFloat = new Float32Array(W * H);
for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) maskFloat[y * W + x] = 1;
const rectF = vc.computeSubjectRectFromMask(maskFloat, W, H);
check('0..1 量纲蒙版同样出框', !!rectF && approx(rectF.w, 0.4), JSON.stringify(rectF));

// 覆盖率
check('覆盖率% = w*h*100 四舍五入', vc.subjectCoveragePercentFromRect({ x: 0.3, y: 0.3, w: 0.4, h: 0.5 }) === 20);
check('无框→覆盖率 undefined', vc.subjectCoveragePercentFromRect(undefined) === undefined);

// 归一化钳制（浮点，用 approx 比对，避免 1-0.8 的表示误差）
const clamped = vc.normalizeSubjectRect({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 });
check('越界矩形被钳进画面', !!clamped && approx(clamped.x, 0.8) && approx(clamped.y, 0.8) && approx(clamped.w, 0.2) && approx(clamped.h, 0.2), JSON.stringify(clamped));
check('零宽矩形→undefined', vc.normalizeSubjectRect({ x: 0.1, y: 0.1, w: 0, h: 0.2 }) === undefined);

// 三分线
const thirds = vc.buildCompositionThirdsLines();
check('三分线：2竖2横', thirds.verticals.length === 2 && thirds.horizontals.length === 2);
check('三分线交点(视觉重心)=4', thirds.powerPoints.length === 4);
check('竖线在 1/3,2/3', approx(thirds.verticals[0], 1 / 3) && approx(thirds.verticals[1], 2 / 3));

// 清洗
const clean = vc.sanitizeDesignLearningVisualCase({ previewDataUrl: 'data:image/png;base64,AAA', sourceKind: 'eagle_thumbnail', subjectRect: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, showCompositionGrid: true, caption: '  Eagle · 浅色袜品  ' });
check('清洗保留合法视觉案例', !!clean && clean.sourceKind === 'eagle_thumbnail' && !!clean.subjectRect && clean.showCompositionGrid === true);
check('清洗 caption trim', clean && clean.caption === 'Eagle · 浅色袜品');
check('无预览图→无视觉案例(框无从叠加)', vc.sanitizeDesignLearningVisualCase({ sourceKind: 'project_image', subjectRect: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } }) === undefined);
check('非 data: 预览被剔除', vc.sanitizeDesignLearningVisualCase({ previewDataUrl: 'http://evil/x.png', sourceKind: 'project_image' }) === undefined);
check('非法 sourceKind 归一为 project_image', (vc.sanitizeDesignLearningVisualCase({ previewDataUrl: 'data:x', sourceKind: 'weird' }) || {}).sourceKind === 'project_image');

if (failures > 0) { console.error(`[smoke-design-learning-visual-case] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-design-learning-visual-case] passed');
