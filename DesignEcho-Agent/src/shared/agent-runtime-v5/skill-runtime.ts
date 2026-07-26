/**
 * Skill Runtime（§6.2）
 *
 * Skill = 任务能力定义（manifest），不是代码页面、不是脚本。
 * R0 通过 task_type 找到 manifest，按 manifest.runtime_stages 驱动工作流。
 * 新增一个 skill = 新增一个 manifest，不改 Orchestrator 核心。
 */

import type {
    RuntimeDesignWorkMode,
    SkillRuntimeManifest,
    SkillRuntimeWorkModeContract
} from './contracts';
import { DETAIL_PAGE_MANIFEST } from './manifests/detail-page.manifest';
import { GENERAL_DESIGN_MANIFEST } from './manifests/general-design.manifest';
import { MAIN_IMAGE_MANIFEST } from './manifests/main-image.manifest';
import { REFERENCE_REPLICATION_MANIFEST } from './manifests/reference-replication.manifest';
import { SKU_COLOR_CARD_MANIFEST } from './manifests/sku-color-card.manifest';
import { SKU_BATCH_MANIFEST } from './manifests/sku-batch.manifest';

const SKILL_MANIFEST_REGISTRY: readonly SkillRuntimeManifest[] = Object.freeze([
    GENERAL_DESIGN_MANIFEST,
    DETAIL_PAGE_MANIFEST,
    MAIN_IMAGE_MANIFEST,
    REFERENCE_REPLICATION_MANIFEST,
    SKU_COLOR_CARD_MANIFEST,
    SKU_BATCH_MANIFEST
    // 新增 skill 在此追加 manifest，无需改核心代码
]);

const RUNTIME_DESIGN_WORK_MODES: readonly RuntimeDesignWorkMode[] = Object.freeze([
    'create_new',
    'redesign',
    'template_fill',
    'edit_existing',
    'analyze_only',
    'export_only'
]);

function normalizeKey(value: unknown): string {
    return String(value || '').trim();
}

function buildUniqueManifestIndex(
    label: string,
    entries: Array<{ key: string; manifest: SkillRuntimeManifest }>
): ReadonlyMap<string, SkillRuntimeManifest> {
    const index = new Map<string, SkillRuntimeManifest>();
    entries.forEach(({ key, manifest }) => {
        const normalized = normalizeKey(key);
        if (!normalized) return;
        const existing = index.get(normalized);
        if (existing && existing.skill_id !== manifest.skill_id) {
            throw new Error(
                `Skill manifest ${label} 重复: ${normalized} 同时属于 ${existing.skill_id} 与 ${manifest.skill_id}`
            );
        }
        index.set(normalized, manifest);
    });
    return index;
}

const MANIFEST_BY_SKILL_ID = buildUniqueManifestIndex(
    'skill_id',
    SKILL_MANIFEST_REGISTRY.map((manifest) => ({ key: manifest.skill_id, manifest }))
);

const MANIFEST_BY_TASK_TYPE = buildUniqueManifestIndex(
    'task_type',
    SKILL_MANIFEST_REGISTRY.map((manifest) => ({ key: manifest.task_type, manifest }))
);

const MANIFEST_BY_LEGACY_SKILL_ID = buildUniqueManifestIndex(
    'legacy_skill_id',
    SKILL_MANIFEST_REGISTRY.flatMap((manifest) => (
        (manifest.legacy_skill_ids || []).map((key) => ({ key, manifest }))
    ))
);

export interface ResolveSkillRuntimeManifestSelectionInput {
    skillId?: string;
    taskType?: string;
}

export type SkillRuntimeManifestSelectionStatus =
    | 'none'
    | 'resolved'
    | 'unresolved_task_type'
    | 'conflict';

/**
 * R0 的统一 Manifest 身份解析结果。
 *
 * - artifact-owner 决定交付物身份；
 * - method 只叠加方法输入、来源引用和检查项；
 * - 两个不同 artifact-owner 不允许按调用方各自的优先级静默拆开消费。
 */
export interface SkillRuntimeManifestSelection {
    status: SkillRuntimeManifestSelectionStatus;
    skillManifest?: SkillRuntimeManifest;
    taskTypeManifest?: SkillRuntimeManifest;
    artifactManifest?: SkillRuntimeManifest;
    methodManifests: SkillRuntimeManifest[];
    manifests: SkillRuntimeManifest[];
    conflictReason?: 'artifact_manifest_conflict';
    unresolvedTaskType?: string;
}

export interface SkillRuntimeEffectiveContract extends SkillRuntimeWorkModeContract {
    source: 'manifest-default' | 'work-mode-contract';
    workMode?: RuntimeDesignWorkMode;
}

function isMethodManifest(manifest: SkillRuntimeManifest): boolean {
    return manifest.planning_role === 'method';
}

function uniqueManifests(manifests: Array<SkillRuntimeManifest | undefined>): SkillRuntimeManifest[] {
    const uniqueById = new Map<string, SkillRuntimeManifest>();
    manifests.forEach((manifest) => {
        if (manifest) uniqueById.set(manifest.skill_id, manifest);
    });
    return Array.from(uniqueById.values());
}

export function normalizeRuntimeDesignWorkMode(value: unknown): RuntimeDesignWorkMode | undefined {
    const normalized = normalizeKey(value) as RuntimeDesignWorkMode;
    return RUNTIME_DESIGN_WORK_MODES.includes(normalized) ? normalized : undefined;
}

export function listSkillManifests(): readonly SkillRuntimeManifest[] {
    return SKILL_MANIFEST_REGISTRY;
}

export function getManifestBySkillId(skillId?: string): SkillRuntimeManifest | undefined {
    return MANIFEST_BY_SKILL_ID.get(normalizeKey(skillId));
}

export function getManifestByTaskType(taskType?: string): SkillRuntimeManifest | undefined {
    return MANIFEST_BY_TASK_TYPE.get(normalizeKey(taskType));
}

export function getManifestByLegacySkillId(skillId?: string): SkillRuntimeManifest | undefined {
    return MANIFEST_BY_LEGACY_SKILL_ID.get(normalizeKey(skillId));
}

export function resolveSkillRuntimeManifestSelection(
    input: ResolveSkillRuntimeManifestSelectionInput
): SkillRuntimeManifestSelection {
    const skillId = normalizeKey(input.skillId);
    const taskType = normalizeKey(input.taskType);
    const skillManifest = getManifestBySkillId(skillId) || getManifestByLegacySkillId(skillId);
    const taskTypeManifest = getManifestByTaskType(taskType);

    // 结构化 taskType 一旦出现就是权威身份；未知值不能回退到另一个 Skill 猜测。
    if (taskType && !taskTypeManifest) {
        return {
            status: 'unresolved_task_type',
            skillManifest,
            methodManifests: [],
            manifests: [],
            unresolvedTaskType: taskType
        };
    }

    const candidates = uniqueManifests([skillManifest, taskTypeManifest]);
    if (candidates.length === 0) {
        return {
            status: 'none',
            methodManifests: [],
            manifests: []
        };
    }

    const artifactManifests = candidates.filter((manifest) => !isMethodManifest(manifest));
    const methodManifests = candidates.filter(isMethodManifest);
    if (artifactManifests.length > 1) {
        return {
            status: 'conflict',
            skillManifest,
            taskTypeManifest,
            methodManifests,
            manifests: candidates,
            conflictReason: 'artifact_manifest_conflict'
        };
    }
    return {
        status: 'resolved',
        skillManifest,
        taskTypeManifest,
        artifactManifest: artifactManifests[0],
        methodManifests,
        manifests: uniqueManifests([artifactManifests[0], ...methodManifests])
    };
}

export function resolveSkillRuntimeEffectiveContract(
    manifest: SkillRuntimeManifest,
    workMode?: unknown
): SkillRuntimeEffectiveContract {
    const normalizedWorkMode = normalizeRuntimeDesignWorkMode(workMode);
    const modeContract = normalizedWorkMode
        ? manifest.work_mode_contracts?.[normalizedWorkMode]
        : undefined;
    if (modeContract && normalizedWorkMode) {
        return {
            source: 'work-mode-contract',
            workMode: normalizedWorkMode,
            required_inputs: [...modeContract.required_inputs],
            optional_inputs: [...modeContract.optional_inputs],
            delivery_outputs: [...modeContract.delivery_outputs],
            exit_criteria: [...modeContract.exit_criteria],
            ...(modeContract.review_rubric_ref
                ? { review_rubric_ref: modeContract.review_rubric_ref }
                : {}),
            ...(modeContract.performance_profile
                ? { performance_profile: modeContract.performance_profile }
                : {})
        };
    }
    return {
        source: 'manifest-default',
        required_inputs: [...manifest.required_inputs],
        optional_inputs: [...(manifest.optional_inputs || [])],
        delivery_outputs: [...(manifest.delivery_outputs || [])],
        exit_criteria: [...manifest.exit_criteria],
        ...(manifest.review_rubric_ref ? { review_rubric_ref: manifest.review_rubric_ref } : {})
    };
}

export function listSkillRuntimeWorkModeInputKeys(manifest: SkillRuntimeManifest): string[] {
    return Array.from(new Set([
        ...manifest.required_inputs,
        ...(manifest.optional_inputs || []),
        ...Object.values(manifest.work_mode_contracts || {}).flatMap((contract) => (
            contract ? [...contract.required_inputs, ...contract.optional_inputs] : []
        ))
    ].map((value) => normalizeKey(value)).filter(Boolean)));
}
