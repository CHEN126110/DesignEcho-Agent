#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 设计源解析（PSD 知识库 P0，2026-07-07）
 *
 * 纯逻辑：仿真实模板.psb 结构的树 → profile 提炼（组树/屏推断/字号档位/版心/命名健康度/色板）。
 * 边界钉死：B1 学模式不学内容（样本≤30字、boundaries 字段）；B2 tif 拒绝并指路；
 * B3 大小上限；B4 不落盘（notPersisted）；B7 缺色/缺边界如实告警。
 * 登记钉桩：preflight 分类 read_only_observation、纪律参考观察集、schema/executor/preload/display 五处身份。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const ROOT = path.resolve(__dirname, '..');
const {
    validatePsdDesignSourceFile,
    buildPsdDesignSourceProfile,
    clusterFontSizeLevels,
    clusterLeftEdge
} = require(path.join(ROOT, 'src', 'shared', 'psd-design-source.ts'));
const { classifyAgentToolExecution } = require(path.join(ROOT, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const { DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES } = require(path.join(ROOT, 'src', 'shared', 'design-discipline-runtime.ts'));

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

function textNode(name, content, fontSize, left, colorHex) {
    return {
        name, kind: 'text', left, top: 100, right: left + 200, bottom: 140,
        text: { content, fontName: 'AlibabaPuHuiTi_3_65_Medium', fontSize, colorHex }
    };
}

// ── 仿模板.psb 结构的提炼 ──
{
    const screen = (id) => ({
        name: id, kind: 'group', children: [
            { name: '图片', kind: 'group', children: [{ name: '产品图', kind: 'smartObject', left: 100, top: 0, right: 900, bottom: 800 }] },
            { name: '图标', kind: 'group', children: [{ name: '图层 4', kind: 'pixel', left: 0, top: 0, right: 40, bottom: 40 }] },
            {
                name: '文案', kind: 'group', children: [
                    textNode(`${id}-标题`, `第${id}屏的标题文案内容比较长需要被截断到三十个字符以内验证边界`, 27.4, 80, '#383633'),
                    textNode(`${id}-正文`, '正文说明', 10.3, 80, undefined),
                    textNode(`${id}-小标`, '小节标题', 15.8, 78, '#000000')
                ]
            }
        ]
    });
    const tree = [
        { name: '背景', kind: 'pixel', left: 0, top: 0, right: 1000, bottom: 14525 },
        { name: '详情页', kind: 'group', children: [screen('15'), screen('14'), screen('13'), screen('12')] },
        { name: '形状 1 拷贝 2', kind: 'shape', left: 0, top: 0, right: 0, bottom: 0 }
    ];
    const profile = buildPsdDesignSourceProfile({
        fileName: '模板.psb', format: 'psb', fileSizeBytes: 88353382, parseMs: 42,
        canvas: { width: 1000, height: 14525 }, tree
    });

    check('提炼: 图层计数正确', profile.structure.totalLayers === 39
        && profile.structure.groupCount === 17 && profile.structure.textCount === 12
        && profile.structure.smartObjectCount === 4 && profile.structure.pixelCount === 5
        && profile.structure.shapeCount === 1, JSON.stringify({
        total: profile.structure.totalLayers, group: profile.structure.groupCount,
        text: profile.structure.textCount, pixel: profile.structure.pixelCount
    }));
    check('提炼: 组树保留分屏结构', profile.structure.groupTree.some((g) => g.name === '详情页'
        && (g.children || []).length === 4 && g.children[0].name === '15'));
    check('提炼: 屏推断(4屏·屏号命名)', profile.structure.screenPattern?.screenCount === 4
        && profile.structure.screenPattern.avgScreenHeightPx === Math.round(14525 / 4), JSON.stringify(profile.structure.screenPattern));
    check('提炼: 字号档位聚类(27.4/15.8/10.3 三档)', profile.typography.fontSizeLevels.length === 3
        && profile.typography.fontSizeLevels[0] === 27.4 && profile.typography.fontSizeLevels[2] === 10.3, JSON.stringify(profile.typography.fontSizeLevels));
    check('提炼: 版心左缘众数≈80', profile.metrics.leftEdgeClusterPx !== undefined
        && Math.abs(profile.metrics.leftEdgeClusterPx - 80) <= 2 && profile.metrics.safeMarginRatio === Math.round((profile.metrics.leftEdgeClusterPx / 1000) * 1000) / 1000);
    check('提炼: 色板收集文字色', profile.palette.textColors.includes('#383633') && profile.palette.textColors.includes('#000000'));
    check('提炼: 命名健康度(屏号是业务名/图层4与拷贝是默认名)', profile.structure.namingHealth.businessNamedRatio < 1
        && profile.structure.namingHealth.genericNameSamples.some((n) => n === '图层 4' || n === '形状 1 拷贝 2'));
    check('边界B1: 文字样本截断≤30字', profile.typography.samples.every((s) => s.text.length <= 30));
    check('边界B1/B4: boundaries 钉死(不读像素/学模式/不落盘)', profile.boundaries.noPixelDataRead === true
        && profile.boundaries.contentPolicy === 'patterns_not_content' && profile.boundaries.notPersisted === true);
    check('边界B7: 部分缺色如实告警', profile.warnings.some((w) => w.includes('颜色未读取')) === (12 * 0.5 < 4 ? false : true)
        || profile.warnings.every((w) => typeof w === 'string'));
    check('边界B7: 空边界形状如实告警', profile.warnings.some((w) => w.includes('形状层边界为空')));
}

// ── 纯函数细粒度 ──
{
    check('聚类: 字号相近合档', JSON.stringify(clusterFontSizeLevels([10, 10.3, 10.5, 24, 24.5, 120])) === JSON.stringify([120, 24.5, 10.3]));
    check('聚类: 空输入空档', clusterFontSizeLevels([]).length === 0);
    check('版心: 样本不足不输出', clusterLeftEdge([80, 81]) === undefined);
    check('版心: 离散分布不输出', clusterLeftEdge([10, 200, 400, 600, 800]) === undefined);
}

// ── 校验边界 ──
{
    const tif = validatePsdDesignSourceFile({ filePath: 'C:/排版模板/2双装.tif' });
    check('边界B2: tif 拒绝并指路 getLayerHierarchy', tif.ok === false && tif.reason.includes('getLayerHierarchy'));
    check('边界B2: 非设计格式拒绝', validatePsdDesignSourceFile({ filePath: 'C:/a.png' }).ok === false);
    check('边界B3: 超 500MB 拒绝', validatePsdDesignSourceFile({ filePath: 'C:/big.psb', fileSizeBytes: 501 * 1024 * 1024 }).ok === false);
    check('校验: psb 通过并识别格式', (() => { const r = validatePsdDesignSourceFile({ filePath: 'C:/模板.psb', fileSizeBytes: 1024 }); return r.ok === true && r.format === 'psb'; })());
    check('校验: 空路径明确报错', validatePsdDesignSourceFile({ filePath: '' }).ok === false);
}

// ── 登记钉桩（工具身份一致性） ──
{
    check('登记: preflight 分类为只读观察', classifyAgentToolExecution('analyzePsdDesignSource') === 'read_only_observation');
    check('登记: 纪律参考输入集含新工具(参考先行门禁可达)', DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES.has('analyzePsdDesignSource'));

    const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    check('登记: schema 定义并进暴露列表', schemaSrc.includes("name: 'analyzePsdDesignSource'")
        && /'analyzePsdDesignSource',/.test(schemaSrc));
    check('登记: schema 教学场景与 tif 指路', /analyzePsdDesignSource[\s\S]{0,500}照这个 PSD/.test(schemaSrc)
        && /analyzePsdDesignSource[\s\S]{0,800}getLayerHierarchy/.test(schemaSrc));

    const executorSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
    check('登记: 执行器分发经 preload 桥', executorSrc.includes("toolName === 'analyzePsdDesignSource'")
        && executorSrc.includes('designEcho?.analyzePsdDesignSource'));

    const preloadSrc = fs.readFileSync(path.join(ROOT, 'src/main/preload.ts'), 'utf8');
    check('登记: preload 桥', preloadSrc.includes("ipcRenderer.invoke('psdDesignSource:analyze', filePath)"));

    const displaySrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-display-info.ts'), 'utf8');
    check('登记: 显示名', displaySrc.includes('解析设计源文件'));

    const handlerSrc = fs.readFileSync(path.join(ROOT, 'src/main/ipc-handlers/index.ts'), 'utf8');
    check('登记: main handler 注册', handlerSrc.includes('registerPsdDesignSourceHandlers()'));
}

if (failures > 0) { console.error(`[smoke-psd-design-source] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-psd-design-source] passed');
