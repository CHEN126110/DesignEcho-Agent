/**
 * 详情页 Skill 的结构 preset（白名单权威，属于详情页 Skill 而非通用 Runtime）。
 *
 * 按架构决策：通用 structure-only-plan.ts 不内置"详情页八屏"这类业务知识；八屏的
 * moduleType / order / intent 文本 / 占位符 / 必需输入槽全部在此预定义，并通过
 * registerStructureSkillPreset 自注册。intent 文本初始复用了原 design-task-types 的 purpose，
 * 但此处是冻结的预定义值，由通用 Claim Guard 精确核对——改动需走代码评审，不能被运行时数据污染。
 */

import {
    registerStructureSkillPreset,
    type StructureSkillPreset
} from '../structure-only-plan';

export const DETAIL_PAGE_STRUCTURE_PRESET: StructureSkillPreset = {
    presetId: 'ecommerce.detail_page.structure.v1',
    taskType: 'ecommerce.detail_page.v1',
    modules: [
        { moduleId: 'detail-01-kv', moduleType: 'hero_kv', order: 1, intent: { key: 'hero_kv', text: '第一眼建立产品认知与点击理由' }, requiredInputSlots: ['product_hero_image'], placeholders: ['[[PRODUCT_NAME]]', '[[PRIMARY_MESSAGE]]', '[[PRODUCT_IMAGE]]'] },
        { moduleId: 'detail-02-core-selling', moduleType: 'selling_points', order: 2, intent: { key: 'core_selling', text: '一句话讲清最能促成转化的核心卖点' }, requiredInputSlots: ['verified_selling_point'], placeholders: ['[[PRIMARY_MESSAGE]]'] },
        { moduleId: 'detail-03-pain-point', moduleType: 'pain_solution', order: 3, intent: { key: 'pain_solution', text: '回应目标用户最关心的疑虑' }, requiredInputSlots: ['pain_point_detail'], placeholders: ['[[PAIN_POINT]]', '[[PRIMARY_MESSAGE]]'] },
        { moduleId: 'detail-04-material', moduleType: 'material', order: 4, intent: { key: 'material', text: '用材质细节支撑核心卖点' }, requiredInputSlots: ['material_closeup'], placeholders: ['[[MATERIAL_DETAIL]]', '[[DETAIL_IMAGE]]'] },
        { moduleId: 'detail-05-detail', moduleType: 'details', order: 5, intent: { key: 'details', text: '放大关键工艺与结构细节' }, requiredInputSlots: ['detail_image'], placeholders: ['[[DETAIL_IMAGE]]'] },
        { moduleId: 'detail-06-color-style', moduleType: 'colors', order: 6, intent: { key: 'colors', text: '展示可选颜色与款式，辅助选择' }, requiredInputSlots: ['color_variant_images'], placeholders: ['[[COLOR_VARIANTS]]'] },
        { moduleId: 'detail-07-spec', moduleType: 'parameters', order: 7, intent: { key: 'parameters', text: '给出规格、尺码与使用说明' }, requiredInputSlots: ['spec_table'], placeholders: ['[[PRODUCT_NAME]]'] },
        { moduleId: 'detail-08-brand', moduleType: 'brand_trust', order: 8, intent: { key: 'brand_trust', text: '用品牌与售后服务建立信任' }, requiredInputSlots: ['brand_profile'], placeholders: ['[[PRODUCT_NAME]]'] }
    ]
};

//  自注册到通用 registry，使接入层可经 getStructureSkillPreset(taskType) 取到（import 本文件即生效）。
registerStructureSkillPreset(DETAIL_PAGE_STRUCTURE_PRESET);
