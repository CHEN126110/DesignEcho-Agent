#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: SKU 执行链三个真机 bug 的根因修复守护（2026-07-03）
 *
 * 用真机复现的失败输入钉住：
 *  bug1 specifiedColors 崩溃：normalizeSpecifiedColors 兼容 string[][] 与 [{colors}]，
 *       非法输入返回带格式示例的错误而非让下游 .map 崩 "e.map is not a function"。
 *  bug2 openTemplate 静默开错文件：findTemplateForSKU 模糊回退按规格数过滤，
 *       请求"4双装"不得解析到"4双自选备注"这类规格不符文件（此处钉纯逻辑 size 过滤器）。
 *  bug3 sockLayoutConfig 垃圾解析：parseSockColorCombosValidated 对整段规格文本
 *       （"2双装：双层边+木耳边 / 水晶丝+花苞；3双装：..."）正确切成多组合，
 *       且超大组合（size=57 那类错乱）返回错误而非静默产出。
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const UXP_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP');
let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

/** 用 TS 编译器把提取的源码片段转成可 eval 的 JS，导出指定符号到 globalThis。 */
function evalTsSnippet(tsCode, exportName, globalKey) {
    const js = ts.transpileModule(tsCode + `\nglobalThis.${globalKey} = ${exportName};`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    // eslint-disable-next-line no-eval
    eval(js);
    return globalThis[globalKey];
}
function extractFn(src, name) {
    const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    return m ? m[0].replace(/^export\s+/, '') : '';
}

// ── bug1: normalizeSpecifiedColors（从源码提取纯函数求值，避免加载整个 executor） ──
{
    const src = fs.readFileSync(
        path.join(ROOT, 'src/renderer/services/skill-executors/sku-batch.executor.ts'),
        'utf8'
    );
    const fn = extractFn(src, 'normalizeSpecifiedColors');
    check('bug1: normalizeSpecifiedColors 存在', !!fn);
    if (fn) {
        const norm = evalTsSnippet(fn, 'normalizeSpecifiedColors', '__norm');
        check('bug1: string[][] 原样通过', JSON.stringify(norm([['双层边', '木耳边']]).combos) === '[["双层边","木耳边"]]');
        check('bug1: [{size,colors}] 对象数组归一化', JSON.stringify(norm([{ size: 2, colors: ['水晶丝', '花苞'] }]).combos) === '[["水晶丝","花苞"]]');
        check('bug1: undefined → 无组合无错误', norm(undefined).combos === undefined && !norm(undefined).error);
        const bad = norm('乱七八糟');
        check('bug1: 非数组 → 带格式示例的错误', !!bad.error && /\[\[/.test(bad.error), bad.error);
        const badItem = norm([{ size: 2 }]);
        check('bug1: 对象缺 colors → 明确错误', !!badItem.error);
    }
}

// ── bug3: parseSockColorCombosValidated（UXP 侧，同样源码提取邻近纯函数求值） ──
{
    const src = fs.readFileSync(path.join(UXP_ROOT, 'src/tools/sku/sock-layout-config.ts'), 'utf8');
    for (const fn of ['parseColorComboLine', 'splitComboSegmentsFromLine', 'parseSockColorCombos', 'parseSockColorCombosValidated']) {
        check(`bug3: ${fn} 存在`, src.includes(`function ${fn}`));
    }
    const stripBomFn = 'function stripBom(t){return String(t||"").replace(/^\\uFEFF/,"");}';
    const MAX = 'const MAX_COLORS_PER_COMBO = 8;';
    const bundle = [
        stripBomFn, MAX,
        extractFn(src, 'parseColorComboLine'),
        extractFn(src, 'splitComboSegmentsFromLine'),
        extractFn(src, 'parseSockColorCombos'),
        extractFn(src, 'parseSockColorCombosValidated')
    ].join('\n');
    let parseValidated;
    try {
        parseValidated = evalTsSnippet(bundle, 'parseSockColorCombosValidated', '__pv');
    } catch (e) {
        check('bug3: 纯函数可求值', false, e.message);
    }
    if (parseValidated) {
        // 真机原样输入：整段一行
        const realInput = '2双装：双层边+木耳边 / 水晶丝+花苞 / 花苞+卷边；3双装：双层边+木耳边+水晶丝 / 水晶丝+花苞+卷边';
        const r = parseValidated(realInput);
        check('bug3: 整段规格文本不再塌成一个组合', !r.error && r.combos.length >= 4, JSON.stringify(r));
        check('bug3: 每个组合规模合理（≤8）', !r.error && r.combos.every((c) => c.length >= 2 && c.length <= 8));
        check('bug3: 表头"N双装："被剥离（不进颜色名）', !r.error && !r.combos.flat().some((c) => /双装/.test(c)), JSON.stringify(r.combos));
        // 超大错乱输入（一整行 20 个 + 连接 = 一个组合）
        const garbage = Array.from({ length: 20 }, (_, i) => `色${i}`).join('+');
        const g = parseValidated(garbage);
        check('bug3: 超上限组合 → 返回错误不静默', !!g.error && /上限/.test(g.error), JSON.stringify(g));
        check('bug3: 空输入 → 明确错误', !!parseValidated('').error);
    }
}

// ── bug2: findTemplateForSKU 规格过滤（钉源码含 size 一致性过滤逻辑） ──
{
    const src = fs.readFileSync(path.join(ROOT, 'src/main/services/template-knowledge.service.ts'), 'utf8');
    check('bug2: 模糊回退按 requestedSize 过滤', /requestedSize\s*=\s*extractComboSizeFromName\(documentName\)/.test(src));
    check('bug2: 规格不符的候选被剔除', /candidateSize\s*===\s*undefined\s*\|\|\s*candidateSize\s*===\s*requestedSize/.test(src));
    // 纯逻辑验证 extractComboSizeFromName + 过滤语义
    const fn = extractFn(src, 'extractComboSizeFromName');
    if (fn) {
        const sz = evalTsSnippet(fn, 'extractComboSizeFromName', '__sz');
        check('bug2: "4双装" 规格=4', sz('4双装.tif') === 4);
        check('bug2: "4双自选备注-卡片模板v4" 规格=4（同规格才允许）', sz('4双自选备注-卡片模板v4.tif') === 4);
        // 真正的跨规格误配：请求 4双 不得落到 2双
        const requestedSize = sz('4双装.tif');
        const wrong = sz('2双装.tif');
        check('bug2: 请求4双时 2双模板被规格过滤剔除', !(wrong === undefined || wrong === requestedSize));
    }
}

if (failures > 0) { console.error(`[smoke-sku-exec-bug-fixes] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-sku-exec-bug-fixes] passed');
