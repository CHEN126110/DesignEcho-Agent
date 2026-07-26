'use strict';

/**
 * smoke: v5 视觉观察契约层（VisualObservationSet + 缓存有效性 + 结构校验，按 GPT 决策 + 加固，2026-06-24）
 *
 * 守护：可信缓存键失效规则（文件哈希/prompt/schema/素材集任一变化即失效）、sha256:<64hex> 精确格式、
 * VisualObservationSet 结构与数值边界校验、以及"真实视觉观察经门禁放行"的端到端联动。
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const RT = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const {
    isVisualObservationCacheValid,
    isSha256Ref,
    validateVisualObservationSet,
    visualObservationSetToGateEntries,
    VISUAL_OBSERVATION_PROMPT_VERSION,
    VISUAL_OBSERVATION_SCHEMA_VERSION
} = require(path.join(RT, 'visual-observation.ts'));
const { evaluateVisualObservationGate } = require(path.join(RT, 'visual-observation-gate.ts'));

let passed = 0;
function check(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const FILE_HASH = 'sha256:' + 'f'.repeat(64);
const SET_HASH = 'sha256:' + 'e'.repeat(64);

function validAsset(overrides) {
    return Object.assign({
        assetId: 'a1',
        fileHash: FILE_HASH,
        mimeType: 'image/jpeg',
        width: 800,
        height: 800,
        role: 'product',
        observations: [{ observationId: 'o1', statement: '白色过膝长袜平铺', confidence: 0.9, observationBasis: 'direct_visual' }],
        qualityWarnings: [],
        recommendedUses: ['主图']
    }, overrides || {});
}

function validSet(overrides) {
    return Object.assign({
        schemaVersion: VISUAL_OBSERVATION_SCHEMA_VERSION,
        observationSetId: 'ob1',
        projectId: 'p1',
        sourceRevision: 1,
        assetSetHash: SET_HASH,
        producer: { modelProfile: 'vision.reference', capabilityStatus: 'real', promptVersion: VISUAL_OBSERVATION_PROMPT_VERSION, modelName: 'google-gemini-3-flash' },
        overview: { productCandidates: [{ category: '袜子', confidence: 0.9, supportingAssetIds: ['a1'] }], dominantColors: ['白'], assetRolesPresent: ['product'], assetRolesMissing: [] },
        assets: [validAsset()],
        limitations: [],
        createdAt: '2026-06-24T00:00:00.000Z',
        contentHash: ''
    }, overrides || {});
}

function cacheInput(overrides) {
    const base = {
        cached: {
            provenance: {
                fileSha256: 'sha256:' + 'a'.repeat(64),
                promptVersion: VISUAL_OBSERVATION_PROMPT_VERSION,
                analysisSchemaVersion: VISUAL_OBSERVATION_SCHEMA_VERSION,
                capabilityStatus: 'real'
            },
            assetSetHash: SET_HASH
        },
        current: {
            promptVersion: VISUAL_OBSERVATION_PROMPT_VERSION,
            analysisSchemaVersion: VISUAL_OBSERVATION_SCHEMA_VERSION,
            assetSetHash: SET_HASH
        }
    };
    return Object.assign(base, overrides || {});
}

console.log('v5 视觉观察契约层 smoke');

//  ---- sha256 格式 ----
check('isSha256Ref：仅接受 sha256:<64hex>', () => {
    assert.strictEqual(isSha256Ref('sha256:' + 'a'.repeat(64)), true);
    assert.strictEqual(isSha256Ref('a'.repeat(64)), false);
    assert.strictEqual(isSha256Ref('sha256:' + 'A'.repeat(64)), false); //  大写不接受
    assert.strictEqual(isSha256Ref('sha256:abc'), false);
});

//  ---- 缓存有效性 ----
check('可信缓存：real + 版本匹配 + 素材集匹配 → 有效', () => {
    assert.strictEqual(isVisualObservationCacheValid(cacheInput()), true);
});
check('GPT#4 文件/素材集哈希变化 → 缓存失效', () => {
    const input = cacheInput();
    input.current.assetSetHash = 'sha256:' + '1'.repeat(64);
    assert.strictEqual(isVisualObservationCacheValid(input), false);
});
check('GPT#13 promptVersion 变化 → 缓存失效', () => {
    const input = cacheInput();
    input.current.promptVersion = 'visual-observation/v2';
    assert.strictEqual(isVisualObservationCacheValid(input), false);
});
check('GPT#13 analysisSchemaVersion 变化 → 缓存失效', () => {
    const input = cacheInput();
    input.current.analysisSchemaVersion = 'visual-observation-set/2.0.0';
    assert.strictEqual(isVisualObservationCacheValid(input), false);
});
check('capabilityStatus≠real → 缓存不可信', () => {
    const input = cacheInput();
    input.cached.provenance.capabilityStatus = 'fallback';
    assert.strictEqual(isVisualObservationCacheValid(input), false);
});
check('GPT#27 fileSha256 非 sha256:<64hex> → 缓存不可信', () => {
    const input = cacheInput();
    input.cached.provenance.fileSha256 = 'a'.repeat(64); //  缺前缀
    assert.strictEqual(isVisualObservationCacheValid(input), false);
});
check('无 provenance → 缓存不可信', () => {
    const input = cacheInput();
    input.cached.provenance = null;
    assert.strictEqual(isVisualObservationCacheValid(input), false);
});

//  ---- 结构校验 ----
check('合法 VisualObservationSet 通过校验', () => {
    const r = validateVisualObservationSet(validSet());
    assert.strictEqual(r.valid, true, r.errors.join('; '));
});
check('assetSetHash 非 sha256 格式 → 校验失败', () => {
    const r = validateVisualObservationSet(validSet({ assetSetHash: 'set-hash' }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('assetSetHash')));
});
check('fileHash 非 sha256 格式 → 校验失败', () => {
    const r = validateVisualObservationSet(validSet({ assets: [validAsset({ fileHash: 'xyz' })] }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('fileHash')));
});
check('confidence 超出 [0,1] → 校验失败', () => {
    const r = validateVisualObservationSet(validSet({ assets: [validAsset({ observations: [{ observationId: 'o', statement: 's', confidence: 1.5, observationBasis: 'direct_visual' }] })] }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('confidence')));
});
check('width 为 NaN/Infinity → 校验失败', () => {
    const r = validateVisualObservationSet(validSet({ assets: [validAsset({ width: Infinity })] }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('width')));
});
check('非法 role → 校验失败', () => {
    const r = validateVisualObservationSet(validSet({ assets: [validAsset({ role: 'banner' })] }));
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes('role')));
});
check('producer.capabilityStatus 非法 → 校验失败', () => {
    const set = validSet();
    set.producer.capabilityStatus = 'maybe';
    const r = validateVisualObservationSet(set);
    assert.strictEqual(r.valid, false);
});

//  ---- 与门禁端到端联动 ----
check('放行：真实视觉观察 + 素材集匹配 → 门禁 verified_visual → full', () => {
    const set = validSet();
    const entries = visualObservationSetToGateEntries(set);
    assert.ok(entries.length > 0);
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries }, freshAnalysis: true, currentAssetSetHash: set.assetSetHash });
    assert.strictEqual(d.level, 'verified_visual');
    assert.strictEqual(d.planningMode, 'full');
});
check('素材集指纹不匹配当前 → 门禁不放行', () => {
    const set = validSet();
    const entries = visualObservationSetToGateEntries(set);
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries }, freshAnalysis: true, currentAssetSetHash: 'sha256:' + '9'.repeat(64) });
    assert.strictEqual(d.planningMode, 'blocked');
});
check('fallback 视觉观察 → 不产出可信条目 → 门禁不放行', () => {
    const set = validSet();
    set.producer.capabilityStatus = 'fallback';
    const entries = visualObservationSetToGateEntries(set);
    assert.strictEqual(entries.length, 0);
    const d = evaluateVisualObservationGate({ visualInsightCache: { entries }, currentAssetSetHash: set.assetSetHash });
    assert.strictEqual(d.planningMode, 'blocked');
});

console.log(`\nvisual-observation 契约层 smoke 全部通过：${passed} 项`);
