#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 自选备注颜色跨区域分配（2026-07-03）
 *
 * 真机法证：8色月子袜项目的 2双/3双自选备注模板只有 2 个参考区域，
 * 旧逻辑 slotCount(2) < colors(8) 且 slotCount!==1 → 直接报错，
 * 逼模型手工 createSkuPlaceholders 补 8 槽（十几步、撞门禁、最终触执行上限）。
 * 修复：distributeNoteColorsIntoRegions 把颜色均匀分到现有区域（下游已支持一区多色）。
 * 本 smoke 从源码提取纯函数求值，钉分配正确性 + 顺序守恒 + 总数守恒 + 边界。
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SRC = path.resolve(__dirname, '..', 'src', 'tools', 'layout', 'sku-layout-tool.ts');
let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

const src = fs.readFileSync(SRC, 'utf8');

// 两种占位符类型都必须被识别（图层组占位 + 矩形占位）——真机域事实：
// 用户模板有两类，一类占位符是图层组、一类是矩形。任一类漏识别都会退回"手工补槽"循环。
check('识别层同时认 图层组占位 与 矩形占位',
    /isSkuOrderedPlaceholderLayer[\s\S]*?isTemplateGroupLayer[\s\S]*?isSkuRectangleReplacementPlaceholderLayer/.test(src),
    'isSkuOrderedPlaceholderLayer 应同时判 group 与 rectangle 两类');
check('矩形占位靠 名称/shape类型/区域几何 识别',
    /isSkuRectangleReplacementPlaceholderLayer[\s\S]*?shape\|solidcolor/.test(src));
check('图层组占位容器靠 占位/placeholder 名识别',
    /isSkuPlaceholderContainerName[\s\S]*?占位组?/.test(src));

const m = src.match(/function distributeNoteColorsIntoRegions\([\s\S]*?\n\}/);
check('distributeNoteColorsIntoRegions 存在', !!m);
check('少于颜色数时不再直接报错（分配分支存在）', /sortedPlaceholders\.length >= 1[\s\S]*distributeNoteColorsIntoRegions/.test(src));
check('仅真正0槽才报 mismatch', /sortedPlaceholders\.length >= 1[\s\S]*else\s*\{[\s\S]*createSkuPlaceholderMismatchError/.test(src));

if (m) {
    const js = ts.transpileModule(m[0] + '\nglobalThis.__d = distributeNoteColorsIntoRegions;', {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    // eslint-disable-next-line no-eval
    eval(js);
    const d = globalThis.__d;
    const C8 = ['白','奶白','黄','绿','粉','肤','浅灰','黑'];

    const r2 = d(C8, 2);
    check('8色/2区 → 均匀 4+4', JSON.stringify(r2) === JSON.stringify([['白','奶白','黄','绿'], ['粉','肤','浅灰','黑']]), JSON.stringify(r2));
    check('8色/2区 顺序连续守恒', r2.flat().join('') === C8.join(''));

    const r1 = d(C8, 1);
    check('8色/1区 → 全进一区（等价旧单区域）', JSON.stringify(r1) === JSON.stringify([C8]));

    const r3 = d(C8, 3);
    check('8色/3区 → 3+3+2（前区多分、总数守恒）', JSON.stringify(r3) === JSON.stringify([['白','奶白','黄'], ['绿','粉','肤'], ['浅灰','黑']]), JSON.stringify(r3));
    check('8色/3区 总数守恒', r3.flat().length === 8);

    // 边界：区数≥颜色数时退化为一区一色（不会产出空区）
    const rMany = d(['a', 'b'], 5);
    check('区数超颜色数 → 每色一区不产空区', JSON.stringify(rMany) === JSON.stringify([['a'], ['b']]), JSON.stringify(rMany));

    // 顺序守恒通用断言
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const rk = d(C8, k);
        const flat = rk.flat();
        if (flat.join('') !== C8.join('') || rk.some((r) => r.length === 0)) {
            check(`8色/${k}区 顺序守恒且无空区`, false, JSON.stringify(rk));
        }
    }
    check('8色 任意区数(1..8)顺序守恒且无空区', true);
}

if (failures > 0) { console.error(`[smoke-sku-note-color-distribution] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-sku-note-color-distribution] passed');
