#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 二维区域布局 + v5 渲染桥（2026-07-06）
 *
 * 引擎 solveRegionLayout：归一化 0..1 → 像素换算；背景自动满画布；z 仍由 role 决定
 * （调用方不排层序）；越界夹回+告警；文字x文字重叠告警、图x文重叠不告警（正当叠压）；
 * 过小区域告警。
 * v5 渲染桥 buildRegionRenderSpecFromDetailPageScreen：9 个 v5 区域角色→渲染角色映射；
 * 文案按 copy 如实填充、缺内容跳过不臆造；图片槽位按角色亲和落位、缺素材出占位并告警；
 * 计划 zIndex 与角色层序矛盾时告警不服从。
 * 执行器/schema 接线钉：regions 模式进 solveRegionLayout；工具 schema 暴露 regions 且
 * blocks 不再强制。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const ROOT = path.resolve(__dirname, '..');
const { solveRegionLayout } = require(path.join(ROOT, 'src', 'shared', 'layout', 'layout-engine.ts'));
const { buildRegionRenderSpecFromDetailPageScreen, V5_REGION_ROLE_TO_RENDER_ROLE } = require(
    path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'render-bridge.ts')
);
const { normalizePhotoshopDocumentInfo } = require(
    path.join(ROOT, 'src', 'renderer', 'services', 'agent-orchestration', 'context.ts')
);

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}

// ── 引擎：二维区域模式 ──
{
    const result = solveRegionLayout({
        canvas: { width: 1000, height: 1000 },
        regions: [
            { id: 'bg', role: 'background', content: '#FFFFFF', bounds: { x: 0, y: 0, width: 0, height: 0 } },
            { id: 'img', role: 'main-image', content: 'C:/a/p.png', bounds: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } },
            { id: 'ttl', role: 'title', content: '左图右文', bounds: { x: 0.65, y: 0.25, width: 0.3, height: 0.12 } }
        ]
    });
    const img = result.blocks.find((b) => b.id === 'img');
    check('引擎: 归一化→像素换算正确', img && img.x === 100 && img.y === 200 && img.width === 500 && img.height === 400, JSON.stringify(img));
    const bg = result.blocks.find((b) => b.id === 'bg');
    check('引擎: background 自动满画布', bg && bg.x === 0 && bg.y === 0 && bg.width === 1000 && bg.height === 1000);
    check('引擎: z 由角色决定且升序排列', result.blocks[0].id === 'bg' && result.blocks[result.blocks.length - 1].role === 'title'
        && result.blocks.every((b, i, arr) => i === 0 || arr[i - 1].z <= b.z));
    check('引擎: 合法左右分栏无告警', result.warnings.length === 0, result.warnings.join('|'));

    const clamped = solveRegionLayout({
        canvas: { width: 1000, height: 1000 },
        regions: [{ id: 'over', role: 'main-image', bounds: { x: 0.8, y: 0.1, width: 0.5, height: 0.5 } }]
    });
    const over = clamped.blocks.find((b) => b.id === 'over');
    check('引擎: 越界夹回画布并告警', over && over.x + over.width <= 1000 && clamped.warnings.some((w) => w.includes('夹回')));

    const textOverlap = solveRegionLayout({
        canvas: { width: 1000, height: 1000 },
        regions: [
            { id: 't1', role: 'title', content: 'A', bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 } },
            { id: 't2', role: 'subtitle', content: 'B', bounds: { x: 0.3, y: 0.15, width: 0.5, height: 0.2 } }
        ]
    });
    check('引擎: 文字x文字重叠告警', textOverlap.warnings.some((w) => w.includes('重叠')));

    const imageTextOverlap = solveRegionLayout({
        canvas: { width: 1000, height: 1000 },
        regions: [
            { id: 'img', role: 'main-image', content: 'C:/a/p.png', bounds: { x: 0, y: 0, width: 1, height: 1 } },
            { id: 'ttl', role: 'title', content: '压图标题', bounds: { x: 0.1, y: 0.1, width: 0.6, height: 0.15 } }
        ]
    });
    check('引擎: 图x文叠压是正当用法不告警', !imageTextOverlap.warnings.some((w) => w.includes('重叠')), imageTextOverlap.warnings.join('|'));

    const tiny = solveRegionLayout({
        canvas: { width: 1000, height: 1000 },
        regions: [{ id: 'dot', role: 'tag', content: 'x', bounds: { x: 0.5, y: 0.5, width: 0.01, height: 0.01 } }]
    });
    check('引擎: 过小区域告警', tiny.warnings.some((w) => w.includes('过小')));
}

// ── v5 渲染桥 ──
function makeScreen(overrides) {
    return {
        screenId: 's1',
        order: 1,
        moduleType: 'hero_kv',
        intent: '首屏主视觉',
        priority: 'required',
        copy: { title: '云感袜 久站不累', subtitle: '实验室实测缓震 32%', body: '三层缓震结构，久站久走不闷脚', tags: ['缓震', '透气', '抗菌'] },
        images: [
            { slotId: 'slot-main', role: 'main_product', assetId: 'asset-1', placement: { fit: 'contain', anchor: 'center', scale: 1, rotation: 0 }, mask: 'none' }
        ],
        elements: [],
        layout: {
            compositionType: 'left_image_right_copy',
            normalizedRegions: [
                { regionId: 'r-visual', role: 'primary_visual', bounds: { x: 0, y: 0.1, width: 0.5, height: 0.8 }, zIndex: 1, alignment: { horizontal: 'center', vertical: 'center' }, overflow: 'clip' },
                { regionId: 'r-head', role: 'headline', bounds: { x: 0.55, y: 0.2, width: 0.4, height: 0.12 }, zIndex: 2, alignment: { horizontal: 'start', vertical: 'start' }, overflow: 'clip' },
                { regionId: 'r-copy', role: 'supporting_copy', bounds: { x: 0.55, y: 0.36, width: 0.4, height: 0.2 }, zIndex: 3, alignment: { horizontal: 'start', vertical: 'start' }, overflow: 'clip' },
                { regionId: 'r-tags', role: 'tag_cluster', bounds: { x: 0.55, y: 0.6, width: 0.4, height: 0.08 }, zIndex: 4, alignment: { horizontal: 'start', vertical: 'start' }, overflow: 'clip' }
            ],
            readingOrder: ['r-visual', 'r-head', 'r-copy', 'r-tags']
        },
        sourceRefs: [],
        constraints: [],
        missingInputs: [],
        ...overrides
    };
}

{
    check('桥: 9 个 v5 角色全部有渲染映射',
        ['primary_visual', 'secondary_visual', 'headline', 'supporting_copy', 'tag_cluster', 'feature_detail', 'parameters', 'brand', 'decoration']
            .every((role) => typeof V5_REGION_ROLE_TO_RENDER_ROLE[role] === 'string'));

    const spec = buildRegionRenderSpecFromDetailPageScreen({
        screen: makeScreen({}),
        assetPathsById: { 'asset-1': 'C:/项目/素材/主图.png' }
    });
    check('桥: 主视觉吃到 main_product 槽位素材', spec.regions.find((r) => r.id === 'r-visual')?.content === 'C:/项目/素材/主图.png');
    check('桥: headline 填 copy.title', spec.regions.find((r) => r.id === 'r-head')?.content === '云感袜 久站不累');
    check('桥: supporting_copy 优先 body', spec.regions.find((r) => r.id === 'r-copy')?.content === '三层缓震结构，久站久走不闷脚');
    check('桥: tag_cluster 拼接 tags', spec.regions.find((r) => r.id === 'r-tags')?.content === '缓震 · 透气 · 抗菌');
    check('桥: 渲染角色映射生效(primary_visual→main-image)', spec.regions.find((r) => r.id === 'r-visual')?.role === 'main-image');
    check('桥: 完整用例无跳过', spec.skippedRegionIds.length === 0, spec.skippedRegionIds.join(','));

    const noAsset = buildRegionRenderSpecFromDetailPageScreen({ screen: makeScreen({}), assetPathsById: {} });
    const visual = noAsset.regions.find((r) => r.id === 'r-visual');
    check('桥: 缺素材保留区域出占位并告警', !!visual && visual.content === undefined && noAsset.warnings.some((w) => w.includes('占位')));

    const noCopy = buildRegionRenderSpecFromDetailPageScreen({
        screen: makeScreen({ copy: { title: '', subtitle: '', body: '', tags: [] } }),
        assetPathsById: { 'asset-1': 'C:/a/p.png' }
    });
    check('桥: 缺文案跳过不臆造', noCopy.skippedRegionIds.includes('r-head') && noCopy.warnings.some((w) => w.includes('不臆造')));

    const paramScreen = makeScreen({});
    paramScreen.layout.normalizedRegions = [
        { regionId: 'r-param', role: 'parameters', bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 }, zIndex: 1, alignment: { horizontal: 'start', vertical: 'start' }, overflow: 'clip' }
    ];
    const paramSpec = buildRegionRenderSpecFromDetailPageScreen({ screen: paramScreen });
    check('桥: parameters/brand/decoration 无可靠来源如实跳过', paramSpec.skippedRegionIds.includes('r-param'));

    const zConflict = makeScreen({});
    zConflict.images.push({ slotId: 'slot-detail', role: 'detail', assetId: 'asset-2', placement: { fit: 'contain', anchor: 'center', scale: 1, rotation: 0 }, mask: 'none' });
    zConflict.layout.normalizedRegions = [
        { regionId: 'r-deco', role: 'secondary_visual', bounds: { x: 0, y: 0, width: 0.3, height: 0.3 }, zIndex: 1, alignment: { horizontal: 'center', vertical: 'center' }, overflow: 'clip' },
        { regionId: 'r-head', role: 'headline', bounds: { x: 0.4, y: 0.1, width: 0.5, height: 0.12 }, zIndex: 2, alignment: { horizontal: 'start', vertical: 'start' }, overflow: 'clip' }
    ];
    const zSpec = buildRegionRenderSpecFromDetailPageScreen({ screen: zConflict, assetPathsById: { 'asset-2': 'C:/a/d.png' } });
    check('桥: 计划 zIndex 与角色层序矛盾时告警不服从', zSpec.warnings.some((w) => w.includes('不按计划 zIndex')));

    const orphanSlot = makeScreen({});
    orphanSlot.images.push({ slotId: 'slot-extra', role: 'main_product', assetId: 'asset-9', placement: { fit: 'contain', anchor: 'center', scale: 1, rotation: 0 }, mask: 'none' });
    const orphanSpec = buildRegionRenderSpecFromDetailPageScreen({ screen: orphanSlot, assetPathsById: { 'asset-1': 'C:/a/p.png' } });
    check('桥: 落不下的图片槽位如实上报', orphanSpec.warnings.some((w) => w.includes('slot-extra')));
}

// ── 执行器与 schema 接线钉 ──
{
    const executorSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
    check('执行器: 引入 solveRegionLayout', executorSrc.includes('solveLayout, solveRegionLayout'));
    check('执行器: regions 模式选择求解器(屏内画布)', executorSrc.includes('? solveRegionLayout({ canvas: solveCanvas, regions: specBlocks })'));
    check('执行器: regions 缺 bounds 有明确报错', executorSrc.includes('缺少有效的归一化 bounds'));

    const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    const renderLayoutSection = schemaSrc.slice(schemaSrc.indexOf("name: 'renderLayout'"), schemaSrc.indexOf("name: 'createTextLayer'"));
    check('schema: renderLayout 暴露 regions 参数', renderLayoutSection.includes('regions:') && renderLayoutSection.includes('归一化区域 0..1'));
    check('schema: blocks 不再强制(required 只有 canvas)', renderLayoutSection.includes("}, ['canvas'])"));
    check('schema: 描述向模型说明两种模式取舍', renderLayoutSection.includes('二选一') && renderLayoutSection.includes('左右分栏'));
}

// ── 详情页逐屏图层管理（2026-07-06 用户实测三缺陷修复钉桩） ──
{
    const stagePlanMod = require(path.join(ROOT, 'src', 'shared', 'creative-stage-plan.ts'));
    const noIdPlan = {
        targetDocumentName: '详情页',
        productUnderstanding: '中筒棉袜，主打透气抗起球，适合通勤与日常穿搭场景。',
        currentStage: {
            title: '首屏KV',
            purpose: '首屏先建立产品印象并给出核心卖点。',
            sellingPoint: '云感面料 久站不累',
            imageIntent: '使用项目里的模特上身实拍图',
            layoutRoles: ['background', 'main-image', 'title'],
            observationFocus: '主体占比与标题可读性'
        }
    };
    const noIdValidation = stagePlanMod.validateCreativeStagePlan(noIdPlan, { expectedDocumentName: '详情页' });
    check('契约: currentStage.id 缺失是 blocker(分组的锚)', noIdValidation.valid === false
        && noIdValidation.blockers.some((b) => b.includes('currentStage.id') && b.includes('结构化命名')), JSON.stringify(noIdValidation.blockers));
    const withIdValidation = stagePlanMod.validateCreativeStagePlan(
        { ...noIdPlan, currentStage: { ...noIdPlan.currentStage, id: 'A-首屏KV' } },
        { expectedDocumentName: '详情页' }
    );
    check('契约: 补上结构化 id 后通过', withIdValidation.valid === true, JSON.stringify(withIdValidation.blockers));

    const promptSection = stagePlanMod.buildDetailPageCreativeStagePlanPromptSection();
    check('契约: 提示教「id·标题」建组与业务命名', promptSection.includes('id·标题') && promptSection.includes('卖点-透气'));
    check('契约: 提示教 screenRegion 逐屏推进', promptSection.includes('screenRegion') && promptSection.includes('互相覆盖'));
    // 分屏结构化（2026-07-07 用户规范）：屏组内固定 文案/图标/图片 三子组
    check('契约: 提示教「序号-屏用途」命名与三子组', promptSection.includes('2-产品首屏') && promptSection.includes('文案/图标/图片'));
    // 渐进规划（2026-07-07 用户反馈"规划糟糕不如不规划"）：骨架先行、逐屏细化，禁止提前编内容
    check('契约: 骨架先行禁止提前编各屏内容', promptSection.includes('骨架先行')
        && promptSection.includes('不要提前替没做到的屏编内容') && promptSection.includes('不写各屏的具体文案与选图'));
    check('契约: 来源约束禁万金油', promptSection.includes('来源约束') && promptSection.includes('万金油'));
    const frameworkMod = require(path.join(ROOT, 'src', 'shared', 'knowledge', 'detail-page-framework.ts'));
    const layoutKnowledge = frameworkMod.buildDetailPageFrameworkSummary('layout');
    check('知识: 方法论含图层组织规范（分屏结构化）', layoutKnowledge.includes('图层组织规范')
        && layoutKnowledge.includes('文案（该屏全部文字层）') && layoutKnowledge.includes('序号即阅读顺序'));
    const executorToolSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
    check('引擎: 屏组内自动建三子组并按桶分发', executorToolSrc.includes("'createStageSubgroup'")
        && executorToolSrc.includes("['图片', '图标', '文案'] as const")
        && executorToolSrc.includes('createdLayerBuckets'));
    check('引擎: 空桶不建组+子组失败退回屏组（增益不是门闸）', executorToolSrc.includes('空组会成为剪切蒙版的无效基底')
        && executorToolSrc.includes('该类图层将直接放在屏组内'));
    // 屏组归位（2026-07-07 真机病例：B 屏组嵌进 A 屏图标子组）：结构后置条件由引擎保证
    check('引擎: 屏组建后归位文档根级+排到上屏组之后', executorToolSrc.includes("{ layerId: groupId, targetGroupId: 0 }")
        && executorToolSrc.includes("'moveStageGroupToRoot'")
        && executorToolSrc.includes("'orderStageGroupAfterPrevious'"));
    check('引擎: 游离层检测（屏区间内图像层不在屏组即提醒收纳）', executorToolSrc.includes('游离层检测')
        && executorToolSrc.includes('收纳进该屏的「图片」子组'));
    const uxpMoveSrc = fs.readFileSync(path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'move-layer-to-group.ts'), 'utf8');
    check('UXP: moveLayerToGroup 支持 targetGroupId=0 归位文档根级', uxpMoveSrc.includes('targetGroupId === 0')
        && uxpMoveSrc.includes('document root'));

    // 快照污染治理（2026-07-07 真机病例：读取失败被编码成"没有文档"→ 引向新建）
    const failedSnapshot = normalizePhotoshopDocumentInfo({
        success: false,
        error: '没有打开的文档'
    });
    const explicitAbsentSnapshot = normalizePhotoshopDocumentInfo({
        success: false,
        documentState: 'absent',
        errorCode: 'no_active_document'
    });
    check('快照: 读取失败=未知而非无文档', failedSnapshot === undefined
        && explicitAbsentSnapshot?.hasDocument === false);
    const contractSrc = fs.readFileSync(path.join(ROOT, 'src/shared/agent-tool-decision-contract.ts'), 'utf8');
    check('契约: 无文档拦截指路 listDocuments 优先、新建垫底', contractSrc.includes('读取失败不代表没有文档')
        && contractSrc.includes('确认确实没有目标文档，再考虑 createDocument')
        && contractSrc.includes('修改类任务不要因为一次读取失败就新建文档'));
    check('执行器: 不再依赖误建后的空文档补偿提醒', !executorToolSrc.includes('openDocumentsNotice')
        && !executorToolSrc.includes('并删除刚新建的空文档'));

    // 用户模板保护（2026-07-07 真机病例：2×2 网格补槽盖掉 6.0 区域式设计构图）
    const uxpSkuConfigSrc = fs.readFileSync(path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'sku', 'sku-config-tools.ts'), 'utf8');
    check('UXP: createSkuPlaceholders 对已有参考区域模板默认拒绝补槽', uxpSkuConfigSrc.includes('confirmModifyTemplate !== true')
        && uxpSkuConfigSrc.includes('区域式设计') && uxpSkuConfigSrc.includes('existingRegionMarkers'));
    const uxpSkuLayoutSrc = fs.readFileSync(path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'sku-layout-tool.ts'), 'utf8');
    const legacyCapacityIndex = uxpSkuLayoutSrc.indexOf('出路① 区域容量计划');
    const legacyAdjustIndex = uxpSkuLayoutSrc.indexOf('出路② 调整现有区域');
    const legacyConvertIndex = uxpSkuLayoutSrc.indexOf('出路③ 换模板或转换方法');
    check('UXP: mismatch 出路按模板模式动态排序（显式容量→调整原区域→最后转换方法）',
        uxpSkuLayoutSrc.includes("mode === 'legacy_single_region' || mode === 'legacy_multi_regions'")
        && legacyCapacityIndex >= 0
        && legacyAdjustIndex > legacyCapacityIndex
        && legacyConvertIndex > legacyAdjustIndex
        && uxpSkuLayoutSrc.includes('regionCapacities')
        && uxpSkuLayoutSrc.includes('transformLayer')
        && uxpSkuLayoutSrc.includes('ordered_slots'));
    const agentSchemaSrc2 = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    check('schema: createSkuPlaceholders 教确认参数与"先问用户排布意图"', agentSchemaSrc2.includes('confirmModifyTemplate')
        && agentSchemaSrc2.includes('先向用户确认排布意图'));

    const executorSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
    check('执行器: 组名用业务可读名(id·标题)', executorSrc.includes('`${stageId}·${stageTitle}`'));
    check('执行器: 只替换当前 stageId 的屏组(逐屏保真)', executorSrc.includes('isCurrentStageDraftGroupName')
        && executorSrc.includes('name === `阶段草稿-${stageId}`')
        && executorSrc.includes('其他屏的组必须保留'));
    check('执行器: screenRegion 屏内求解并平移', executorSrc.includes('block.y + screenRegion.y')
        && executorSrc.includes('width: canvas.width, height: screenRegion.height'));
    check('执行器: screenRegion 越界明确报错', executorSrc.includes('screenRegion 超出文档'));

    const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    const renderLayoutSection = schemaSrc.slice(schemaSrc.indexOf("name: 'renderLayout'"), schemaSrc.indexOf("name: 'createTextLayer'"));
    check('schema: screenRegion 参数已暴露并教用法', renderLayoutSection.includes('screenRegion') && renderLayoutSection.includes('逐屏'));
    check('schema: blocks/regions 的 id 教业务命名', renderLayoutSection.includes('卖点-透气') && renderLayoutSection.includes('业务命名'));
}

// ── 观察区域化（2026-07-07 系统改造②：长文档区域观察一等参数） ──
{
    const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    const canvasSection = schemaSrc.slice(schemaSrc.indexOf("name: 'getCanvasSnapshot'"), schemaSrc.indexOf("name: 'diagnoseState'"));
    check('观察: getCanvasSnapshot 暴露 region 并教长文档用法', canvasSection.includes('region') && canvasSection.includes('长文档'));
    const annotatedSection = schemaSrc.slice(schemaSrc.indexOf("name: 'getAnnotatedSnapshot'"), schemaSrc.indexOf("name: 'getScreenSnapshots'"));
    check('观察: getAnnotatedSnapshot 暴露 region', annotatedSection.includes('region') && annotatedSection.includes('相交'));

    const uxpCanvasSrc = fs.readFileSync(path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'canvas', 'visual-analysis.ts'), 'utf8');
    check('观察: UXP 画布快照 sourceBounds 区域裁剪', uxpCanvasSrc.includes('sourceBounds') && uxpCanvasSrc.includes('区域截图失败'));
    const uxpAnnotatedSrc = fs.readFileSync(path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'canvas', 'get-annotated-snapshot.ts'), 'utf8');
    check('观察: UXP 标注快照区域裁剪+相交过滤+相对坐标', uxpAnnotatedSrc.includes('sourceBounds')
        && uxpAnnotatedSrc.includes('bounds.left - viewX') && uxpAnnotatedSrc.includes('只标注与区域相交的图层'));
}

// ── 查询式图层读取（2026-07-07：治"翻树找层"——真机 7 轮绕路病例） ──
{
    const { sanitizeToolOutputForModel } = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-result-sanitizer.ts'));
    // 图层树每层组占 2 级 JSON 深度：旧 MAX_DEPTH=6 剪到 3 层组嵌套（详情页>屏组>图片>层 必被剪）
    const deepTree = { hierarchy: [{ name: '详情页', children: [{ name: '12', children: [{ name: '图片', children: [{ name: '00 拷贝 9', kind: 'solidColor', bounds: { left: 734, top: 17978 } }] }] }] }] };
    const sanitized = sanitizeToolOutputForModel(deepTree);
    const deepLeaf = sanitized.hierarchy[0].children[0].children[0].children[0];
    check('观察: 4 层组嵌套的树可穿透（MAX_DEPTH 放宽）', deepLeaf && deepLeaf.name === '00 拷贝 9'
        && deepLeaf.bounds && deepLeaf.bounds.left === 734, JSON.stringify(deepLeaf));
    check('观察: 超长字符串截断保护仍在', String(sanitizeToolOutputForModel('x'.repeat(4000))).includes('已截断'));

    const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    check('查找: findLayers schema 定义并教一步命中', schemaSrc.includes("name: 'findLayers'") && schemaSrc.includes('一步命中'));
    check('查找: getLayerHierarchy 指路 findLayers', /getLayerHierarchy[\s\S]{0,300}findLayers/.test(schemaSrc));

    const { classifyAgentToolExecution } = require(path.join(ROOT, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
    check('查找: preflight 只读分类', classifyAgentToolExecution('findLayers') === 'read_only_observation');

    const uxpFindSrc = fs.readFileSync(path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'find-layers.ts'), 'utf8');
    check('查找: UXP 实现（条件必填/组内过滤/扁平+上限）', uxpFindSrc.includes('需要至少一个条件')
        && uxpFindSrc.includes('withinGroupId') && uxpFindSrc.includes('Math.min(50'));
    const uxpRegistrySrc = fs.readFileSync(path.join(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools', 'registry.ts'), 'utf8');
    check('查找: UXP registry 注册', uxpRegistrySrc.includes('new FindLayersTool()'));
}

if (failures > 0) { console.error(`[smoke-layout-region-bridge] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-layout-region-bridge] passed');
