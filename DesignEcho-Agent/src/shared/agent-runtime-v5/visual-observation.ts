/**
 * v5 视觉观察契约（VisualObservationSet）—— R2 Context Intelligence 的视觉输入。
 *
 * 定位（按架构决策）：
 * - 它**不属于**已冻结的 6 个 Workflow Contract（ContextSnapshot/CreativeStrategy/DetailPagePlan/
 *   PreviewScene/ReviewReport/ApprovalRecord），而是 R2 的视觉输入，由 Main 侧视觉观察服务
 *   产出并持久化（权威 contentHash 由持久化层计算，本层只定义形状）。
 * - 真实视觉理解（识别产品/颜色/角度/场景/素材用途）由云端视觉模型完成；本地 ONNX 缺失只影响
 *   抠图/分割执行（标 blocked_external_dependency），不影响"看图"。
 *
 * 本模块是纯逻辑：只定义契约、缓存有效性规则与结构校验，不调模型、不读像素、不算权威哈希。
 */

/** 当前视觉分析 prompt 版本。prompt 变化必须 bump，使旧缓存失效。 */
export const VISUAL_OBSERVATION_PROMPT_VERSION = 'visual-observation/v1';
/** 当前视觉观察输出 schema 版本。schema 变化必须 bump，使旧缓存失效。 */
export const VISUAL_OBSERVATION_SCHEMA_VERSION = 'visual-observation-set/1.0.0';
/** 视觉能力档位标识。 */
export const VISUAL_OBSERVATION_MODEL_PROFILE = 'vision.reference';

/** 素材在电商语境下的视觉角色。 */
export const VISUAL_ASSET_ROLES = [
    'product',
    'variant',
    'detail',
    'model',
    'scene',
    'reference',
    'unknown'
] as const;
export type VisualAssetRole = (typeof VISUAL_ASSET_ROLES)[number];

/** 视觉能力状态：只有 real 可作为可靠视觉观察；fallback/blocked 不可用。 */
export type VisualCapabilityStatus = 'real' | 'fallback' | 'blocked_external_dependency';

/** 内容哈希引用的精确格式：sha256:<64 位小写十六进制>。比"长度≥N"严格，杜绝伪造短哈希。 */
export const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** 校验一个值是否为合法的 sha256:<64hex> 引用。 */
export function isSha256Ref(value: unknown): boolean {
    return typeof value === 'string' && SHA256_REF_PATTERN.test(value);
}

/**
 * 视觉观察来源信息（provenance）。可信缓存键的必备要素，缺一不可。
 * 这是判断"一条视觉缓存是否可信"的唯一依据；现有 ProjectVisualSamplingCacheEntry 不含本结构，
 * 故旧缓存一律 legacy_unverified。fileSha256 / assetSetHash 必须为 sha256:<64hex> 精确格式。
 */
export interface VisualObservationProvenance {
    /** 图片文件内容哈希（非路径哈希），sha256:<64hex>。文件内容变化必须导致缓存失效。 */
    fileSha256?: string;
    /** 分析时的素材集指纹，sha256:<64hex>。素材集变化必须导致缓存失效。 */
    assetSetHash?: string;
    /** 视觉能力档位标识（如 vision.reference）。 */
    modelProfile?: string;
    /** 实际供应商模型名（如 google-gemini-3-flash）。 */
    providerModel?: string;
    /** 视觉分析 prompt 版本。 */
    promptVersion?: string;
    /** 视觉分析输出 schema 版本。 */
    analysisSchemaVersion?: string;
    /** 能力状态。只有 real 才可信。 */
    capabilityStatus?: VisualCapabilityStatus;
    /** 参与本次分析的素材 id 列表（审计与素材集校验用）。 */
    sourceAssetIds?: string[];
    /** 观察产生时间。 */
    createdAt?: string;
}

/** 归一化矩形（0~1 比例坐标）。 */
export interface NormalizedBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 一条视觉观察（带置信度与观察依据，区分直接所见与推断）。 */
export interface VisualObservation {
    observationId: string;
    statement: string;
    confidence: number;
    observationBasis: 'direct_visual' | 'inferred_visual';
    normalizedBounds?: NormalizedBounds;
}

/** 单张素材的视觉观察结果。 */
export interface VisualAssetObservation {
    assetId: string;
    fileHash: string;
    mimeType: string;
    width: number;
    height: number;
    role: VisualAssetRole;
    observations: VisualObservation[];
    productColor?: string;
    viewAngle?: string;
    qualityWarnings: string[];
    recommendedUses: string[];
    /** 本张素材的来源凭证（让门禁可逐张判可信）。 */
    provenance?: VisualObservationProvenance;
}

/** 项目级视觉观察集合（一次视觉分析的产出）。 */
export interface VisualObservationSet {
    schemaVersion: string;
    observationSetId: string;
    projectId: string;
    /** 关联的 Project State 修订号（观察基于哪一版素材集产出）。 */
    sourceRevision: number;
    /** 当前素材集指纹（由参与分析的 fileSha256 列表确定性派生）。素材集变化即失效。 */
    assetSetHash: string;
    producer: {
        modelProfile: string;
        capabilityStatus: VisualCapabilityStatus;
        promptVersion: string;
        modelName?: string;
    };
    overview: {
        productCandidates: Array<{
            category: string;
            confidence: number;
            supportingAssetIds: string[];
        }>;
        dominantColors: string[];
        assetRolesPresent: string[];
        assetRolesMissing: string[];
    };
    assets: VisualAssetObservation[];
    limitations: string[];
    createdAt: string;
    /** 权威内容哈希，由持久化层计算（本层不计算，构造时可留空字符串）。 */
    contentHash: string;
}

/** 判断一个有限数（拒绝 NaN/Infinity）。 */
function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** 判断置信度合法（有限数且落在 [0,1]）。 */
function isValidConfidence(value: unknown): boolean {
    return isFiniteNumber(value) && value >= 0 && value <= 1;
}

/**
 * 缓存有效性判定（GPT 第 6 点）。可信缓存必须同时满足：
 * - capabilityStatus = real
 * - promptVersion / analysisSchemaVersion 与当前一致
 * - fileSha256 存在且足够长
 * - assetSetHash 与当前素材集一致（文件集未变）
 */
export interface VisualObservationCacheValidityInput {
    cached: {
        provenance?: VisualObservationProvenance | null;
        assetSetHash?: string;
    };
    current: {
        promptVersion: string;
        analysisSchemaVersion: string;
        assetSetHash: string;
    };
}

export function isVisualObservationCacheValid(input: VisualObservationCacheValidityInput): boolean {
    const p = input.cached.provenance;
    if (!p) return false;
    return (
        p.capabilityStatus === 'real' &&
        isSha256Ref(p.fileSha256) &&
        p.promptVersion === input.current.promptVersion &&
        p.analysisSchemaVersion === input.current.analysisSchemaVersion &&
        //  素材集指纹必须为合法 sha256 引用，且与当前素材集一致（由系统计算，不信任布尔）
        isSha256Ref(input.cached.assetSetHash) &&
        isSha256Ref(input.current.assetSetHash) &&
        input.cached.assetSetHash === input.current.assetSetHash
    );
}

/** 结构校验结果。 */
export interface VisualObservationValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * 校验一个 VisualObservationSet 的结构与数值边界（schema 级 + 业务级最小集）。
 * 失败信息指明具体字段与原因，便于诊断。
 */
export function validateVisualObservationSet(set: VisualObservationSet | null | undefined): VisualObservationValidationResult {
    const errors: string[] = [];
    if (!set || typeof set !== 'object') {
        return { valid: false, errors: ['VisualObservationSet 为空或非对象。'] };
    }
    if (!set.observationSetId) errors.push('缺少 observationSetId。');
    if (!set.projectId) errors.push('缺少 projectId。');
    if (!isSha256Ref(set.assetSetHash)) errors.push('assetSetHash 必须为 sha256:<64hex> 格式。');
    if (!set.producer || typeof set.producer !== 'object') {
        errors.push('缺少 producer。');
    } else {
        const status = set.producer.capabilityStatus;
        if (status !== 'real' && status !== 'fallback' && status !== 'blocked_external_dependency') {
            errors.push(`producer.capabilityStatus 非法：${String(status)}。`);
        }
        if (!set.producer.promptVersion) errors.push('缺少 producer.promptVersion。');
    }
    if (!Array.isArray(set.assets)) {
        errors.push('assets 必须为数组。');
    } else {
        set.assets.forEach((asset, index) => {
            const tag = `assets[${index}]`;
            if (!asset || typeof asset !== 'object') {
                errors.push(`${tag} 非对象。`);
                return;
            }
            if (!asset.assetId) errors.push(`${tag} 缺少 assetId。`);
            if (!isSha256Ref(asset.fileHash)) errors.push(`${tag}.fileHash 必须为 sha256:<64hex> 格式。`);
            if (!(VISUAL_ASSET_ROLES as readonly string[]).includes(asset.role)) {
                errors.push(`${tag}.role 非法：${String(asset.role)}。`);
            }
            if (!isFiniteNumber(asset.width) || asset.width <= 0) errors.push(`${tag}.width 必须为有限正数。`);
            if (!isFiniteNumber(asset.height) || asset.height <= 0) errors.push(`${tag}.height 必须为有限正数。`);
            if (!Array.isArray(asset.observations)) {
                errors.push(`${tag}.observations 必须为数组。`);
            } else {
                asset.observations.forEach((obs, oi) => {
                    if (!obs || !obs.observationId) errors.push(`${tag}.observations[${oi}] 缺少 observationId。`);
                    if (!obs || !obs.statement) errors.push(`${tag}.observations[${oi}] 缺少 statement。`);
                    if (!isValidConfidence(obs?.confidence)) errors.push(`${tag}.observations[${oi}].confidence 必须为 [0,1] 的有限数。`);
                    if (obs?.observationBasis !== 'direct_visual' && obs?.observationBasis !== 'inferred_visual') {
                        errors.push(`${tag}.observations[${oi}].observationBasis 非法。`);
                    }
                });
            }
        });
    }
    return { valid: errors.length === 0, errors };
}

/**
 * 把一个可靠的 VisualObservationSet 转成 R2 可读取的视觉条目。
 * 来源信息只能说明结果来自哪里；只有同时携带结构化 observations 的条目才会输出。
 */
export function visualObservationSetToGateEntries(
    set: VisualObservationSet
): Array<{ insight: { assetId: string; observations: VisualObservation[]; provenance: VisualObservationProvenance } }> {
    if (!set || set.producer?.capabilityStatus !== 'real' || !validateVisualObservationSet(set).valid) return [];
    return set.assets.filter((asset) => asset.observations.length > 0).map((asset) => ({
        insight: {
            assetId: asset.assetId,
            observations: asset.observations.slice(0, 24).map((observation) => ({
                ...observation,
                observationId: observation.observationId.trim().slice(0, 120),
                statement: observation.statement.trim().slice(0, 500)
            })),
            provenance: asset.provenance || {
                fileSha256: asset.fileHash,
                assetSetHash: set.assetSetHash,
                modelProfile: set.producer.modelProfile,
                providerModel: set.producer.modelName,
                promptVersion: set.producer.promptVersion,
                analysisSchemaVersion: set.schemaVersion,
                capabilityStatus: set.producer.capabilityStatus
            }
        }
    }));
}
