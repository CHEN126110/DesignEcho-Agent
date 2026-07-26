#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 图层结构性遮挡检测（2026-07-06）
 *
 * 用户实测场景：先 placeImage 的主图（组外底层）被屏组内背景矩形完全盖住，
 * 模型"后面才发现"。检测必须纯几何+层序确定性判出（不靠视觉模型），
 * renderLayout 写后即时回给模型并指路修复。
 * 保守边界：图叠图拼贴不报、半透明不报、部分重叠不报、隐藏层不报、剪贴层跳过。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const ROOT = path.resolve(__dirname, '..');
const { detectFullLayerOcclusions } = require(path.join(ROOT, 'src', 'shared', 'layer-occlusion.ts'));

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

function bounds(left, top, right, bottom) {
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// ── 用户实测场景复现：屏组(含背景shape) 在树前(顶)，主图智能对象在组外树后(底) ──
{
    const hierarchy = [
        {
            id: 100, name: 'A-首屏KV·奶油撞色蕾丝堆堆袜', kind: 'group', visible: true, opacity: 100,
            children: [
                { id: 101, name: 'KV-标题', kind: 'text', visible: true, opacity: 100, bounds: bounds(80, 200, 700, 280) },
                { id: 102, name: '背景', kind: 'shape', visible: true, opacity: 100, bounds: bounds(0, 0, 790, 1200) }
            ]
        },
        { id: 200, name: 'KV-主图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(120, 150, 640, 900) }
    ];
    const findings = detectFullLayerOcclusions(hierarchy);
    check('实测场景: 组内背景盖住组外主图被判出', findings.length === 1
        && findings[0].occludedLayerName === 'KV-主图' && findings[0].occluderLayerName === '背景', JSON.stringify(findings));
    check('实测场景: 告警指路修复(moveLayerToGroup/reorderLayer/main-image)', findings.length === 1
        && findings[0].message.includes('moveLayerToGroup') && findings[0].message.includes('reorderLayer') && findings[0].message.includes('main-image'));
}

// ── 保守边界 ──
{
    // 主图在背景之上（正常层序）→ 不报
    const normal = detectFullLayerOcclusions([
        { id: 1, name: 'KV-主图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(100, 100, 600, 800) },
        { id: 2, name: '背景', kind: 'shape', visible: true, opacity: 100, bounds: bounds(0, 0, 790, 1200) }
    ]);
    check('边界: 主图在背景上方不报', normal.length === 0, JSON.stringify(normal));

    // 部分重叠（非完全包含）→ 不报
    const partial = detectFullLayerOcclusions([
        { id: 1, name: '色块', kind: 'shape', visible: true, opacity: 100, bounds: bounds(0, 0, 400, 400) },
        { id: 2, name: '产品图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(200, 200, 700, 700) }
    ]);
    check('边界: 部分重叠不报', partial.length === 0);

    // 半透明色块 → 不报（下层仍可见）
    const translucent = detectFullLayerOcclusions([
        { id: 1, name: '蒙层', kind: 'shape', visible: true, opacity: 50, bounds: bounds(0, 0, 790, 1200) },
        { id: 2, name: '产品图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(100, 100, 600, 800) }
    ]);
    check('边界: 半透明不报', translucent.length === 0);

    // 遮挡者隐藏 → 不报
    const hidden = detectFullLayerOcclusions([
        { id: 1, name: '背景', kind: 'shape', visible: false, opacity: 100, bounds: bounds(0, 0, 790, 1200) },
        { id: 2, name: '产品图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(100, 100, 600, 800) }
    ]);
    check('边界: 隐藏遮挡者不报', hidden.length === 0);

    // 图叠图拼贴（上层是普通智能对象、非背景语义）→ 不报（正当用法）
    const collage = detectFullLayerOcclusions([
        { id: 1, name: '氛围图-大', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(0, 0, 790, 1200) },
        { id: 2, name: '产品图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(100, 100, 600, 800) }
    ]);
    check('边界: 图叠图拼贴不报(保守)', collage.length === 0);

    // 上层是名字明示背景的像素层 → 报（背景语义优先于 kind）
    const namedBg = detectFullLayerOcclusions([
        { id: 1, name: '底图-米白', kind: 'pixel', visible: true, opacity: 100, bounds: bounds(0, 0, 790, 1200) },
        { id: 2, name: '产品图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(100, 100, 600, 800) }
    ]);
    check('边界: 名字明示背景的像素层作遮挡者可报', namedBg.length === 1);

    // 剪贴层跳过
    const clipped = detectFullLayerOcclusions([
        { id: 1, name: '填充', kind: 'shape', visible: true, opacity: 100, isClipped: true, bounds: bounds(0, 0, 790, 1200) },
        { id: 2, name: '产品图', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(100, 100, 600, 800) }
    ]);
    check('边界: 剪贴层不作遮挡者', clipped.length === 0);

    // 多受害者各报最近遮挡者一次
    const multi = detectFullLayerOcclusions([
        { id: 1, name: '背景', kind: 'shape', visible: true, opacity: 100, bounds: bounds(0, 0, 790, 2400) },
        { id: 2, name: '图A', kind: 'smartObject', visible: true, opacity: 100, bounds: bounds(50, 50, 400, 400) },
        { id: 3, name: '图B', kind: 'pixel', visible: true, opacity: 100, bounds: bounds(50, 500, 400, 900) }
    ]);
    check('边界: 多个被盖内容层各报一次', multi.length === 2);

    // 空/无 bounds 数据静默
    check('边界: 空输入静默', detectFullLayerOcclusions([]).length === 0 && detectFullLayerOcclusions(undefined).length === 0);
    check('边界: 缺 bounds 静默', detectFullLayerOcclusions([
        { id: 1, name: '背景', kind: 'shape', visible: true, opacity: 100 },
        { id: 2, name: '产品图', kind: 'smartObject', visible: true, opacity: 100 }
    ]).length === 0);
}

// ── 执行点接线钉 ──
{
    const executorSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
    check('接线: renderLayout 写后遮挡自检', executorSrc.includes('detectFullLayerOcclusions')
        && executorSrc.includes("executeToolCall('getLayerHierarchy', { includeBounds: true }, options)"));
    check('接线: 自检告警进 warnings 与 occlusionFindings 字段', executorSrc.includes('occlusionFindings: occlusionFindings.length > 0'));
    check('接线: 自检失败不阻塞(增益不是门闸)', executorSrc.includes('检测失败不阻塞'));

    const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    check('知识: placeImage 教「先置图后排版会被盖」时序陷阱', schemaSrc.includes('先 placeImage 后 renderLayout') && schemaSrc.includes('被完全盖住'));
}

if (failures > 0) { console.error(`[smoke-layer-occlusion] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-layer-occlusion] passed');
