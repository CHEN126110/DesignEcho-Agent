'use strict';

/**
 * smoke: v5 视觉观察门禁（P0 热修核心纯逻辑，按 GPT 决策 + 加固，2026-06-24）
 *
 * 守护"没有可靠视觉观察不得进入完整详情页规划"这一硬约束，覆盖 GPT 列的 P0 smoke 中
 * 可由纯逻辑验证的条目，含加固项：fileSha256/assetSetHash 必须为精确 sha256:<64hex>，
 * 素材集匹配由系统比对当前真实指纹（不信任调用方布尔）。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const {
    resolveVisualObservationLevel,
    resolvePlanningMode,
    evaluateVisualObservationGate,
    buildVisualObservationRequiredBlocker,
    STRUCTURE_ONLY_CONSTRAINTS
} = require(path.join(RT, 'visual-observation-gate.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const CURRENT_SET = 'sha256:' + 'b'.repeat(64);

/** 带可信 provenance 的缓存项（fileSha256/assetSetHash 为精确 sha256:<64hex>）。 */
function trustedEntry(assetSetHash) {
    return {
        insight: {
            assetId: 'asset-1',
            observations: [{
                observationId: 'obs-1',
                statement: '画面中可见一双白色袜子。',
                confidence: 0.98,
                observationBasis: 'direct_visual'
            }],
            provenance: {
                fileSha256: 'sha256:' + 'a'.repeat(64),
                assetSetHash: assetSetHash || CURRENT_SET,
                modelProfile: 'vision.reference',
                providerModel: 'google-gemini-3-flash',
                promptVersion: 'visual-observation/v1',
                analysisSchemaVersion: 'visual-observation-set/1.0.0',
                capabilityStatus: 'real'
            }
        }
    };
}

/** 现有 legacy 缓存项（只有 insight 文本，无 provenance）。 */
function legacyEntry() {
    return { insight: { summary: '白色长袜平铺图', productType: '袜子', modelId: 'analyzeAssetContent' } };
}

console.log('v5 视觉观察门禁 smoke');

//  ---- 等级 → 规划模式映射 ----
check('resolvePlanningMode: verified_visual → full', () => {
    assert.strictEqual(resolvePlanningMode('verified_visual'), 'full');
});
check('resolvePlanningMode: cached_visual_valid → full', () => {
    assert.strictEqual(resolvePlanningMode('cached_visual_valid'), 'full');
});
check('resolvePlanningMode: structure_only 仅由 fallbackMode 触发，不由观察等级自动触发', () => {
    assert.strictEqual(resolvePlanningMode('user_confirmed'), 'blocked'); //  无 fallback 不再自动 structure_only
    assert.strictEqual(resolvePlanningMode('missing', 'structure_only'), 'structure_only');
    assert.strictEqual(resolvePlanningMode('verified_visual', 'structure_only'), 'full'); //  full 优先于 fallback
});
check('resolvePlanningMode: 无 fallback 时 legacy/metadata/filename/missing/user_confirmed → blocked', () => {
    for (const level of ['legacy_unverified', 'metadata_only', 'filename_only', 'missing', 'user_confirmed']) {
        assert.strictEqual(resolvePlanningMode(level), 'blocked', `${level} 无 fallback 应阻断`);
    }
});

//  ---- GPT P0 smoke 1-4：阻断项 ----
check('GPT#1 missing 不能进入详情页规划', () => {
    const d = evaluateVisualObservationGate({});
    assert.strictEqual(d.level, 'missing');
    assert.strictEqual(d.planningMode, 'blocked');
    assert.ok(d.blocker);
});
check('GPT#2 filename_only 不能进入详情页规划', () => {
    const d = evaluateVisualObservationGate({ hasFilenames: true });
    assert.strictEqual(d.level, 'filename_only');
    assert.strictEqual(d.planningMode, 'blocked');
});
check('GPT#3 metadata_only 不能进入详情页规划', () => {
    const d = evaluateVisualObservationGate({ hasAssetMetadata: true, hasFilenames: true });
    assert.strictEqual(d.level, 'metadata_only');
    assert.strictEqual(d.planningMode, 'blocked');
});
check('GPT#4 legacy_unverified 缓存不能通过门禁', () => {
    const d = evaluateVisualObservationGate({
        visualInsightCache: { entries: [legacyEntry(), legacyEntry()] },
        hasAssetMetadata: true,
        hasFilenames: true
    });
    assert.strictEqual(d.level, 'legacy_unverified');
    assert.strictEqual(d.planningMode, 'blocked');
});

//  ---- GPT P0 smoke 5-6：放行项（要求 currentAssetSetHash 匹配）----
check('GPT#5 verified_visual 可以进入完整规划', () => {
    const d = evaluateVisualObservationGate({
        visualInsightCache: { entries: [trustedEntry()] },
        freshAnalysis: true,
        currentAssetSetHash: CURRENT_SET
    });
    assert.strictEqual(d.level, 'verified_visual');
    assert.strictEqual(d.planningMode, 'full');
    assert.strictEqual(d.blocker, undefined);
    assert.strictEqual(d.constraints, undefined);
});
check('GPT#6 cached_visual_valid 可以进入完整规划', () => {
    const d = evaluateVisualObservationGate({
        visualInsightCache: { entries: [trustedEntry()] },
        freshAnalysis: false,
        currentAssetSetHash: CURRENT_SET
    });
    assert.strictEqual(d.level, 'cached_visual_valid');
    assert.strictEqual(d.planningMode, 'full');
});

//  ---- GPT 决策：structure_only 仅由用户主动 fallbackMode 触发，blocked 不自动转 ----
check('blocked 不自动变 structure_only：缺少视觉观察 + 无 fallback → blocked', () => {
    const d = evaluateVisualObservationGate({ hasFilenames: true });
    assert.strictEqual(d.planningMode, 'blocked');
    assert.strictEqual(d.constraints, undefined);
});
check('user_confirmed 不再自动 structure_only（无 fallback → blocked）', () => {
    const d = evaluateVisualObservationGate({ userConfirmedProduct: true });
    assert.strictEqual(d.level, 'user_confirmed');
    assert.strictEqual(d.planningMode, 'blocked');
});
check('GPT#7 用户主动选 fallbackMode=structure_only → structure_only', () => {
    const d = evaluateVisualObservationGate({ hasFilenames: true, fallbackMode: 'structure_only' });
    assert.strictEqual(d.planningMode, 'structure_only');
    assert.ok(d.constraints);
});
check('GPT#8 structure_only 禁止产品事实推断', () => {
    const d = evaluateVisualObservationGate({ fallbackMode: 'structure_only' });
    assert.strictEqual(d.constraints.visualClaimsAllowed, false);
    assert.strictEqual(d.constraints.productClaimsAllowed, false);
    assert.strictEqual(d.constraints.capabilityStatus, 'fallback');
});
check('GPT#9 structure_only 只描述内容范围，不携带 Photoshop 执行权限', () => {
    const d = evaluateVisualObservationGate({ fallbackMode: 'structure_only' });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(d.constraints, 'photoshopExecutionAllowed'), false);
    assert.strictEqual(d.constraints.qualityGateEligible, false);
});
check('verified_visual 即使带 fallbackMode 仍优先 full', () => {
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries: [trustedEntry()] }, freshAnalysis: true, currentAssetSetHash: CURRENT_SET, fallbackMode: 'structure_only' });
    assert.strictEqual(d.planningMode, 'full');
});

//  ---- GPT P0 smoke 12：素材集失配（当前指纹不匹配缓存）→ 可信缓存失效 ----
check('GPT#12 素材集指纹不匹配 → 可信缓存失效，不得进入完整规划', () => {
    const d = evaluateVisualObservationGate({
        visualInsightCache: { entries: [trustedEntry()] },
        freshAnalysis: false,
        currentAssetSetHash: 'sha256:' + 'c'.repeat(64) //  与缓存的 assetSetHash 不同
    });
    assert.strictEqual(d.level, 'legacy_unverified');
    assert.strictEqual(d.planningMode, 'blocked');
});

//  ---- GPT P0 smoke 15：旧缓存不会被静默升级为可信 ----
check('GPT#15 伪 provenance（capabilityStatus≠real）不被升级为可信', () => {
    const fake = { insight: { provenance: {
        fileSha256: 'sha256:' + 'd'.repeat(64),
        assetSetHash: CURRENT_SET,
        promptVersion: 'visual-observation/v1',
        analysisSchemaVersion: 'visual-observation-set/1.0.0',
        capabilityStatus: 'fallback'
    } } };
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries: [fake] }, currentAssetSetHash: CURRENT_SET });
    assert.strictEqual(d.level, 'legacy_unverified');
    assert.strictEqual(d.planningMode, 'blocked');
});
check('只有 provenance、没有结构化视觉观察时不能进入完整规划', () => {
    const provenanceOnly = trustedEntry();
    delete provenanceOnly.insight.assetId;
    delete provenanceOnly.insight.observations;
    const d = evaluateVisualObservationGate({
        visualInsightCache: { entries: [provenanceOnly] },
        currentAssetSetHash: CURRENT_SET
    });
    assert.strictEqual(d.level, 'legacy_unverified');
    assert.strictEqual(d.planningMode, 'blocked');
});

//  ---- GPT P0 smoke 27：fileSha256 非 sha256:64hex 不能成为可信缓存 ----
check('GPT#27 fileSha256 非 sha256:<64hex> 不可信', () => {
    const bad = { insight: { provenance: {
        fileSha256: 'a'.repeat(64), //  缺 sha256: 前缀
        assetSetHash: CURRENT_SET,
        promptVersion: 'visual-observation/v1',
        analysisSchemaVersion: 'visual-observation-set/1.0.0',
        capabilityStatus: 'real'
    } } };
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries: [bad] }, currentAssetSetHash: CURRENT_SET });
    assert.strictEqual(d.level, 'legacy_unverified');
});
check('assetSetHash 缺失 → 不可信', () => {
    const noSet = { insight: { provenance: {
        fileSha256: 'sha256:' + 'a'.repeat(64),
        promptVersion: 'visual-observation/v1',
        analysisSchemaVersion: 'visual-observation-set/1.0.0',
        capabilityStatus: 'real'
    } } };
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries: [noSet] }, currentAssetSetHash: CURRENT_SET });
    assert.strictEqual(d.level, 'legacy_unverified');
});

//  ---- GPT P0 smoke 28：素材集匹配由系统比对，不接受调用方伪造布尔 ----
check('GPT#28 未提供 currentAssetSetHash → 无法确认匹配，可信项不予采信', () => {
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries: [trustedEntry()] }, freshAnalysis: true });
    assert.strictEqual(d.level, 'legacy_unverified');
    assert.strictEqual(d.planningMode, 'blocked');
});
check('GPT#28 传入伪造的 assetSetMatches 布尔无效（接口已无此入参）', () => {
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries: [trustedEntry()] }, assetSetMatches: true });
    assert.strictEqual(d.planningMode, 'blocked'); //  布尔被忽略，仍因无 currentAssetSetHash 阻断
});

//  ---- 优先级与结构正确性 ----
check('可信缓存优先于 user_confirmed（同时具备时取 verified/cached）', () => {
    const d = evaluateVisualObservationGate({
        visualInsightCache: { entries: [trustedEntry()] },
        userConfirmedProduct: true,
        freshAnalysis: true,
        currentAssetSetHash: CURRENT_SET
    });
    assert.strictEqual(d.level, 'verified_visual');
});
check('blocker 结构：code/severity/owner/4 个恢复动作', () => {
    const b = buildVisualObservationRequiredBlocker();
    assert.strictEqual(b.code, 'VISUAL_OBSERVATION_REQUIRED');
    assert.strictEqual(b.severity, 'blocking');
    assert.strictEqual(b.owner, 'R2');
    assert.deepStrictEqual(b.recoveryActions, [
        'RUN_PROJECT_VISUAL_ANALYSIS',
        'SELECT_PRODUCT_IMAGES',
        'CONFIRM_PRODUCT_CATEGORY',
        'CONTINUE_AS_STRUCTURE_ONLY'
    ]);
});
check('STRUCTURE_ONLY_CONSTRAINTS 为冻结常量且全部收紧', () => {
    assert.ok(Object.isFrozen(STRUCTURE_ONLY_CONSTRAINTS));
    assert.strictEqual(STRUCTURE_ONLY_CONSTRAINTS.visualClaimsAllowed, false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(STRUCTURE_ONLY_CONSTRAINTS, 'photoshopExecutionAllowed'), false);
});

console.log(`\nvisual-observation-gate smoke 全部通过：${passed} 项`);
