'use strict';

/**
 * smoke: 设计任务类型（data-driven design task types）
 * 验证「详情页/主图」任务类型的解析、默认结构、阻塞问题过滤、入口和提示词生成，
 * 守护「技能知识数据化、不渗透进 Agent」的基座契约。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
    DESIGN_TASK_TYPE_REGISTRY,
    GENERIC_DESIGN_TASK_TYPE,
    resolveDesignTaskTypeSpec,
    getDesignTaskTypeSpec,
    getDesignTaskTypeSpecBySkillId,
    buildDesignTaskTypeIntake,
    buildDesignTaskTypePromptSection
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-task-types.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

console.log('smoke: design-task-types');

check('「帮我做详情页」解析为 ecommerce.detail_page.v1', () => {
    const spec = resolveDesignTaskTypeSpec('帮我做详情页');
    assert.ok(spec, '应解析出任务类型');
    assert.strictEqual(spec.id, 'ecommerce.detail_page.v1');
    assert.strictEqual(spec.skillId, 'detail-page-design');
});

check('详情页默认结构为 6-8 屏', () => {
    const spec = getDesignTaskTypeSpec('ecommerce.detail_page.v1');
    assert.ok(spec.defaultStructure.length >= 6 && spec.defaultStructure.length <= 8,
        `默认结构应为 6-8 屏，实际 ${spec.defaultStructure.length}`);
    assert.ok(spec.defaultStructure.every((item) => item.id && item.title && item.purpose),
        '每屏都要有 id/title/purpose');
});

check('「设计详情页 / 做一个详情页」都能解析', () => {
    assert.ok(resolveDesignTaskTypeSpec('设计详情页'));
    assert.ok(resolveDesignTaskTypeSpec('做一个详情页'));
});

check('「帮我做主图」解析为 ecommerce.main_image.v1（证明可泛化）', () => {
    const spec = resolveDesignTaskTypeSpec('帮我做主图');
    assert.ok(spec);
    assert.strictEqual(spec.id, 'ecommerce.main_image.v1');
});

check('「帮我设计SKU模板」解析为 ecommerce.sku_template.v1', () => {
    const spec = resolveDesignTaskTypeSpec('帮我设计SKU模板');
    assert.ok(spec, 'SKU 模板设计应解析出任务类型');
    assert.strictEqual(spec.id, 'ecommerce.sku_template.v1');
    assert.strictEqual(spec.skillId, 'sku-config');
});

check('SKU 色卡有独立任务类型，不再误归为 SKU 模板', () => {
    const spec = resolveDesignTaskTypeSpec('帮我制作 SKU 色卡');
    assert.ok(spec, 'SKU 色卡应解析出独立任务类型');
    assert.strictEqual(spec.id, 'ecommerce.sku_color_card.v1');
    assert.strictEqual(spec.skillId, 'sku-color-card');
    assert.strictEqual(spec.defaultCanvasWidth, 1500);
});

check('任务身份提供运行提示，但不把 generic 冒充某个业务品类', () => {
    const detail = getDesignTaskTypeSpec('ecommerce.detail_page.v1');
    const mainImage = getDesignTaskTypeSpecBySkillId('main-image-design');
    assert.deepStrictEqual(detail.runtimeHints, {
        scenario: 'detail-page',
        documentRole: 'detailPage'
    });
    assert.deepStrictEqual(mainImage.runtimeHints, {
        scenario: 'main-image',
        documentRole: 'mainImage'
    });
    assert.deepStrictEqual(GENERIC_DESIGN_TASK_TYPE.runtimeHints, {
        scenario: 'general-design',
        documentRole: 'unknown'
    });
    assert.strictEqual(getDesignTaskTypeSpecBySkillId('autonomous-agent'), undefined);
});

check('SKU 批量出图不解析为 SKU 模板设计任务类型', () => {
    assert.strictEqual(resolveDesignTaskTypeSpec('帮我批量出SKU组合图'), undefined,
        'SKU 批量生产应走 sku-batch，不进从零模板设计');
});

check('「看一下当前详情页结构 / 把模板填充导出」不解析为设计任务类型', () => {
    assert.strictEqual(resolveDesignTaskTypeSpec('看一下当前详情页结构'), undefined,
        '检查现成结构属于结构化路径，不应进入从零设计任务类型');
    assert.strictEqual(resolveDesignTaskTypeSpec('把这个详情页模板填充一下并导出'), undefined,
        '模板填充/导出属于结构化路径，不应进入从零设计任务类型');
});

check('非设计任务返回 undefined', () => {
    assert.strictEqual(resolveDesignTaskTypeSpec('你好'), undefined);
    assert.strictEqual(resolveDesignTaskTypeSpec('用 CSV 批量替换图标'), undefined);
    assert.strictEqual(resolveDesignTaskTypeSpec(''), undefined);
});

check('已有 Photoshop 文档时，素材来源不再是阻塞问题', () => {
    const spec = getDesignTaskTypeSpec('ecommerce.detail_page.v1');
    const withoutDoc = buildDesignTaskTypeIntake(spec, {});
    const withDoc = buildDesignTaskTypeIntake(spec, { hasPhotoshopDocument: true });
    assert.ok(withoutDoc.blockingQuestions.some((q) => q.key === 'asset_source'),
        '无素材来源时应把素材来源当阻塞问题');
    assert.ok(!withDoc.blockingQuestions.some((q) => q.key === 'asset_source'),
        '已有文档时不应重复追问素材来源');
});

check('阻塞问题不超过 3 个（不要一上来问一长串）', () => {
    for (const spec of DESIGN_TASK_TYPE_REGISTRY) {
        const intake = buildDesignTaskTypeIntake(spec, {});
        assert.ok(intake.blockingQuestions.length <= 3,
            `${spec.id} 阻塞问题应 ≤ 3，实际 ${intake.blockingQuestions.length}`);
    }
});

check('平台尺寸是带默认值的非阻塞问题（默认假设，不打断）', () => {
    const spec = getDesignTaskTypeSpec('ecommerce.detail_page.v1');
    const platform = spec.intakeQuestions.find((q) => q.key === 'platform_size');
    assert.ok(platform);
    assert.strictEqual(platform.blocking, false);
    assert.ok(platform.defaultNote && /750/.test(platform.defaultNote));
});

check('提示词段包含任务类型声明、入口、结构预览门禁，且不是死模板口吻', () => {
    const spec = getDesignTaskTypeSpec('ecommerce.detail_page.v1');
    const section = buildDesignTaskTypePromptSection(spec, {});
    assert.ok(section.includes('电商详情页'), '应声明任务类型');
    assert.ok(section.includes('detail-page-design'), '应指明参考技能知识');
    assert.ok(section.includes('结构预览') && section.includes('确认'), '应包含结构预览+确认门禁');
    assert.ok(/不修改 Photoshop|只规划/.test(section), '预览阶段不应修改 Photoshop');
    assert.ok(/可根据产品和素材调整|不是死模板/.test(section), '默认结构应表述为可调整起点，而非死模板');
    assert.ok(section.includes('首屏 KV'), '应包含默认结构内容');
});

check('每个任务类型都有 3 个素材入口', () => {
    for (const spec of DESIGN_TASK_TYPE_REGISTRY) {
        assert.strictEqual(spec.entryOptions.length, 3, `${spec.id} 应有 3 个素材入口`);
    }
});

console.log(`\n✅ design-task-types smoke 全部通过（${passed} 项）`);
