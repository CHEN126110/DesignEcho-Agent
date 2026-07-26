#!/usr/bin/env node
/**
 * 运行时 skillId 硬编码护栏（债务棘轮 / debt ratchet）—— skill 可插拔化的进度锁
 *
 * 不变量：运行时「决策层」不应硬编码具体业务 skillId（detail-page-design / main-image-design
 * / sku-batch）。一个「规范可插拔 skill」的标志是——加/删一个 skill 只动两处（声明 +
 * 执行器注册 index.ts），其余分类/路由/授权/读写语义全部从 SkillDeclaration 字段派生。
 *
 * 现状（2026-06-30 实测）：3 个 skillId 在 6 个运行时决策文件里散布 50 处硬编码字面量
 * （详情页 12 / 主图 17 / SKU 21）——这是它们「不可插拔」的根因。本守护不强制立刻清零，
 * 而是「棘轮」：只允许这些硬编码「变少」，不允许再「长大」。每把一处 Set/正则收敛为
 * 声明派生后，把对应 BASELINE 调到新的更低值即可锁定进度，最终目标全部归 0。
 *
 * 范围只含「决策层」6 个文件——不含 SkillDeclaration / design-task-types / skill-executors/index，
 * 那三处是契约允许的正当登记（声明本体、任务类型数据条目、执行器注册）。
 *
 * 纯文本扫描，不加载 TS，不依赖运行环境。报告写入 tmp/，超基线 exit 1。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// 运行时「决策层」文件：这些地方目前靠硬编码 skillId 的 Set / 正则分支做路由/分类/授权，
// 是「规范可插拔 skill」要消除的耦合面。声明本体/任务类型数据/执行器注册不在此列。
const TARGET_FILES = [
    'src/renderer/services/design-agent/engine.ts',
    'src/shared/agent-route-boundary-policy.ts',
    'src/shared/agent-tool-execution-preflight.ts',
    'src/renderer/services/agent-orchestration/routing.ts',
    'src/shared/agent-intent-control-plane.ts',
    'src/shared/skill-routing.ts'
].map((rel) => path.join(root, rel));

// 每个业务 skillId 的硬编码基线。收敛进度 = 把这些数字调小，最终 0。只能调小，不允许调大。
// 2026-06-30 初始实测：detail-page=12 / main-image=17 / sku-batch=21（合计 50）。
// 2026-06-30 第1次收敛 50→47：engine.ts BUSINESS_WORKFLOW_REACT_ENTRY_SKILLS 硬编码 Set
//   改为从 SkillDeclaration.routeClass==='business-workflow' 派生（isBusinessWorkflowRouteClassSkill），
//   3 个 skillId 字面量各减 1（detail-page 12→11 / main-image 17→16 / sku-batch 21→20）。
// 2026-06-30 第2次收敛 47→44：route-boundary BUSINESS_OR_OPEN_DESIGN_SKILLS 硬编码 Set 改为从
//   routeClass∈{business-workflow,open-design} 派生（新增 routeClass='open-design' 给 layout-replication
//   /project-image-analysis/autonomous-agent），3 个业务 skillId 各减 1（11→10 / 16→15 / 20→19）。
const PER_SKILL_BASELINE = {
    'detail-page-design': 10,
    // 2026-07-10 Agent/Capability 治理：executor 场景解析改从 task runtimeHints 派生，
    // 不再为 main-image-design / sku-batch 维护专属 scenario 分支，各下降 1。
    'main-image-design': 14,
    'sku-batch': 18
};
const TOTAL_BASELINE = Object.values(PER_SKILL_BASELINE).reduce((a, b) => a + b, 0);

function countQuotedLiteral(text, skillId) {
    // 统计带引号的 skillId 字面量（'x' 或 "x"），不含注释里裸写的 skill 名，避免误判。
    const escaped = skillId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`['"]${escaped}['"]`, 'g');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
}

function relPath(absPath) {
    return path.relative(root, absPath).split(path.sep).join('/');
}

function main() {
    const perSkillTotals = {};
    const perFileBreakdown = [];
    let missingFiles = [];

    for (const skillId of Object.keys(PER_SKILL_BASELINE)) {
        perSkillTotals[skillId] = 0;
    }

    for (const file of TARGET_FILES) {
        if (!fs.existsSync(file)) {
            missingFiles.push(relPath(file));
            continue;
        }
        const text = fs.readFileSync(file, 'utf8');
        for (const skillId of Object.keys(PER_SKILL_BASELINE)) {
            const count = countQuotedLiteral(text, skillId);
            if (count > 0) {
                perFileBreakdown.push({ file: relPath(file), skillId, count });
                perSkillTotals[skillId] += count;
            }
        }
    }

    const total = Object.values(perSkillTotals).reduce((a, b) => a + b, 0);

    const violations = [];
    for (const skillId of Object.keys(PER_SKILL_BASELINE)) {
        if (perSkillTotals[skillId] > PER_SKILL_BASELINE[skillId]) {
            violations.push(
                `${skillId} 硬编码增长：当前 ${perSkillTotals[skillId]} > 基线 ${PER_SKILL_BASELINE[skillId]}`
            );
        }
    }
    if (total > TOTAL_BASELINE) {
        violations.push(`总硬编码增长：当前 ${total} > 基线 ${TOTAL_BASELINE}`);
    }
    if (missingFiles.length > 0) {
        violations.push(`目标决策文件缺失（路径变动？请同步更新本 audit）：${missingFiles.join('、')}`);
    }

    const report = {
        version: 'audit-skill-runtime-coupling/v0',
        baseline: { perSkill: PER_SKILL_BASELINE, total: TOTAL_BASELINE },
        current: { perSkill: perSkillTotals, total },
        perFileBreakdown,
        missingFiles,
        violations,
        pass: violations.length === 0
    };

    const tmpDir = path.join(root, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
        path.join(tmpDir, 'audit-skill-runtime-coupling.json'),
        JSON.stringify(report, null, 2),
        'utf8'
    );

    console.log('运行时 skillId 硬编码棘轮（可插拔化进度锁）');
    for (const skillId of Object.keys(PER_SKILL_BASELINE)) {
        console.log(`  ${skillId}: ${perSkillTotals[skillId]} / 基线 ${PER_SKILL_BASELINE[skillId]}`);
    }
    console.log(`  合计: ${total} / 基线 ${TOTAL_BASELINE}`);

    if (violations.length > 0) {
        console.error('\n❌ 硬编码增长（违反只减不增）：');
        violations.forEach((v) => console.error('  - ' + v));
        console.error('\n收敛硬编码请把对应 skill 改为读 SkillDeclaration 字段；新增硬编码会被本守护拦下。');
        process.exit(1);
    }

    console.log('\n✅ 未超基线（硬编码只减不增）。收敛一处后，把对应 BASELINE 调小以锁定进度，目标 0。');
}

main();
