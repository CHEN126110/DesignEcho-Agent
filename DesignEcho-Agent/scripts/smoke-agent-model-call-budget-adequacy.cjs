/**
 * 模型调用预算充足性 smoke（治理"Agent 做复杂了却做不完"的系统根因）：
 *
 * 背景：ReAct 循环每一轮≈1 次模型调用。此前所有业务 manifest 的 max_model_calls 只有 8-10，
 * 而全局顶只有 12——远低于 max_iterations(35-70) 与 soft_time_budget(≥240s)，
 * 导致 model_calls 永远先触顶，完整 v5 纪律流程（R0→E2 + 声明 + 执行 + 复核）
 * 还没到执行就被这个人为低顶饿死（真机 SKU 病例：8 次调用全耗在声明、0 次写入）。
 *
 * 本 smoke 锁住不变量：走完整 R0→E2 流程的业务技能，模型调用预算必须够（≥ 2×阶段数、≥16），
 * 且不得超过全局顶；全局顶本身必须能容纳完整流程。防止再回退到 8。
 */
const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node', esModuleInterop: true }
});

const root = path.resolve(__dirname, '..');
const { listSkillManifests } = require(path.join(root, 'src', 'shared', 'agent-runtime-v5', 'skill-runtime.ts'));
const { AGENT_GLOBAL_SKILL_BUDGET_LIMITS } = require(path.join(root, 'src', 'shared', 'agent-performance-policy.ts'));

const cases = [];
function check(name, run) {
    try {
        run();
        cases.push({ name, status: 'pass' });
    } catch (error) {
        cases.push({ name, status: 'fail', details: String((error && error.stack) || error) });
    }
}

// 每阶段至少给 2 次模型调用的余量（声明可能校验失败重试 + 执行编排 + 复核）
const MODEL_CALLS_PER_STAGE = 2;
const ABSOLUTE_FLOOR = 16;

function requiredModelCalls(manifest) {
    const stageCount = Array.isArray(manifest.runtime_stages) ? manifest.runtime_stages.length : 0;
    return Math.max(ABSOLUTE_FLOOR, stageCount * MODEL_CALLS_PER_STAGE);
}

const manifests = listSkillManifests();

check('global-ceiling-can-hold-a-full-pipeline', () => {
    // 全局顶必须容得下一个完整 R0→E2（8 阶段）流程，否则任何技能都被钳死
    assert.ok(
        AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls >= ABSOLUTE_FLOOR,
        `全局模型调用顶 ${AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls} 不足以容纳完整纪律流程（需≥${ABSOLUTE_FLOOR}）`
    );
});

check('every-business-manifest-has-adequate-model-call-budget', () => {
    assert.ok(manifests.length >= 5, `应发现多个业务 manifest，实际 ${manifests.length}`);
    for (const manifest of manifests) {
        const profile = manifest.performance_profile;
        assert.ok(profile, `${manifest.skill_id} 缺 performance_profile`);
        const budget = profile.budget.max_model_calls;
        const required = requiredModelCalls(manifest);
        assert.ok(
            budget >= required,
            `${manifest.skill_id} 的 max_model_calls=${budget} 不足（runtime_stages=${manifest.runtime_stages.length}，需≥${required}）——会饿死在声明阶段`
        );
        assert.ok(
            budget <= AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls,
            `${manifest.skill_id} 的 max_model_calls=${budget} 超过全局顶 ${AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls}`
        );
        // 模型调用不应远小于迭代预算：否则 iterations 形同虚设、model_calls 永远先触顶
        assert.ok(
            budget * 2 >= profile.budget.max_iterations || budget >= ABSOLUTE_FLOOR,
            `${manifest.skill_id} model_calls(${budget}) 相对 iterations(${profile.budget.max_iterations}) 过低`
        );
    }
});

check('work-mode-sub-profiles-also-adequate', () => {
    for (const manifest of manifests) {
        const contracts = manifest.work_mode_contracts || {};
        for (const [mode, contract] of Object.entries(contracts)) {
            const profile = contract && contract.performance_profile;
            if (!profile) continue;
            const budget = profile.budget.max_model_calls;
            // 子档流程更短，floor 放宽到 12，但仍不能是原来的 6
            assert.ok(
                budget >= 12,
                `${manifest.skill_id}#${mode} 子档 max_model_calls=${budget} 过低（需≥12）`
            );
            assert.ok(
                budget <= AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls,
                `${manifest.skill_id}#${mode} 子档 max_model_calls=${budget} 超过全局顶`
            );
        }
    }
});

check('sku-batch-guides-combo-card-first-and-early-stage', () => {
    const sku = manifests.find((manifest) => manifest.skill_id === 'ecommerce.sku_batch');
    assert.ok(sku, '应存在 ecommerce.sku_batch manifest');
    assert.equal(sku.performance_profile.budget.max_model_calls, 26);
    const { listDesignMethodKnowledgeDefinitions } = require(path.join(
        root, 'src', 'shared', 'agent-runtime-v5', 'design-method-knowledge.ts'
    ));
    const overlay = listDesignMethodKnowledgeDefinitions().find(
        (def) => def.applicableSkillIds && def.applicableSkillIds.includes('ecommerce.sku_batch')
    );
    assert.ok(overlay, '应有 SKU 方法 overlay');
    // 组合卡优先的引导必须在早期阶段(R1)就注入，且方法里写明"先发卡片收集组合、不反复声明 brief/strategy"
    assert.ok(overlay.applicableStages.includes('R1'), 'SKU 方法应在 R1 就注入组合卡优先引导');
    const methodText = overlay.method.join(' ');
    assert.ok(methodText.includes('交互卡片') && methodText.includes('组合'), '方法应指示先用交互卡片收集组合');
    assert.ok(methodText.includes('brief') || methodText.includes('策略'), '方法应说明不为 SKU 反复声明 brief/strategy');
});

const failed = cases.filter((entry) => entry.status !== 'pass');
console.log(JSON.stringify({ suite: 'agent-model-call-budget-adequacy', cases }, null, 2));
if (failed.length > 0) process.exitCode = 1;
