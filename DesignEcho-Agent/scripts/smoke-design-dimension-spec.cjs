#!/usr/bin/env node
/**
 * 设计尺寸规范 smoke：预设合并、用户覆盖、宽度评估（含放大版倍率）、摘要输出。
 */
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
    DEFAULT_DESIGN_DIMENSION_SPEC,
    normalizeDesignDimensionSpec,
    evaluateDetailPageDocumentWidth,
    summarizeDesignDimensionSpecForAgent
} = require('../src/shared/design-dimension-spec.ts');

const cases = [];
function check(name, ok, detail) {
    cases.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `: ${detail}`}`);
}

// 1. 空输入 = 预设
const spec = normalizeDesignDimensionSpec();
check('空输入返回预设', spec.detailPage.baseWidth === 790 && spec.mainImage.width === 800, JSON.stringify(spec.detailPage));

// 2. 用户覆盖生效且其余字段保留预设
const custom = normalizeDesignDimensionSpec({ detailPage: { baseWidth: 750 } });
check('用户覆盖 baseWidth 生效', custom.detailPage.baseWidth === 750, String(custom.detailPage.baseWidth));
check('未覆盖字段保留预设', custom.mainImage.width === 800 && custom.exportDefaults.quality === 10, '');

// 3. 非法值夹取回退
const bad = normalizeDesignDimensionSpec({
    detailPage: { baseWidth: -5, acceptableWidths: ['x'] },
    exportDefaults: { quality: 99, format: 'gif' }
});
check('非法 baseWidth 回退', bad.detailPage.baseWidth === 100 || bad.detailPage.baseWidth === 790, String(bad.detailPage.baseWidth));
check('非法 acceptableWidths 回退预设', bad.detailPage.acceptableWidths.includes(790), JSON.stringify(bad.detailPage.acceptableWidths));
check('quality 夹取到 12', bad.exportDefaults.quality === 12, String(bad.exportDefaults.quality));
check('非法 format 回退 jpeg', bad.exportDefaults.format === 'jpeg', bad.exportDefaults.format);

// 4. 宽度评估：基准、变体、放大版、不符合
check('790 命中基准', evaluateDetailPageDocumentWidth(spec, 790).ok === true, '');
check('1200 命中变体', evaluateDetailPageDocumentWidth(spec, 1200).ok === true, '');
const scaled = evaluateDetailPageDocumentWidth(spec, 1580);
check('1580 命中 790 的 2 倍工作版', scaled.ok === true && scaled.scaleFactor === 2, JSON.stringify(scaled));
const off = evaluateDetailPageDocumentWidth(spec, 999);
check('999 不符合并给出可行动提示', off.ok === false && /设置中调整|确认文档/.test(off.hint), off.hint);
check('宽度 0 诚实失败', evaluateDetailPageDocumentWidth(spec, 0).ok === false, '');

// 5. 摘要中文且关键字段在场
const summary = summarizeDesignDimensionSpecForAgent(spec);
check('摘要含基准宽与主图', summary.includes('790') && summary.includes('800×800'), summary.slice(0, 80));
check('摘要说明用户可调整', summary.includes('设置中调整'), '');
// 优先级声明：用户本次明确尺寸压过预设（防"模型用预设800覆盖用户1440"回归）
check('摘要声明用户明确尺寸优先于预设',
    summary.includes('优先级') && summary.includes('以用户明确的尺寸为准') && summary.includes('不得用下列预设覆盖'),
    summary.slice(0, 120));

// 6. 预设对象不被 normalize 污染
normalizeDesignDimensionSpec({ detailPage: { baseWidth: 555 } });
check('预设常量未被污染', DEFAULT_DESIGN_DIMENSION_SPEC.detailPage.baseWidth === 790, String(DEFAULT_DESIGN_DIMENSION_SPEC.detailPage.baseWidth));

const passed = cases.filter((c) => c.ok).length;
console.log(`\ndesign-dimension-spec smoke: ${passed}/${cases.length} 通过`);
process.exit(passed === cases.length ? 0 : 1);
