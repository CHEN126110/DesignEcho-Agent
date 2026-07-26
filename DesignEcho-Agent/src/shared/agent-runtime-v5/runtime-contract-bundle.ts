/**
 * Runtime contract bundle resolver
 *
 * 旧入口可以继续传 legacy skill id（例如 main-image-design / sku-batch），
 * 但这里先解析到 v5 SkillRuntimeManifest，再生成 ReAct/Reflexion loop contract
 * 和 legacy tool capability bridge。Skill、capability、executable tool 三层保持分离。
 */

import type { RuntimeDesignWorkMode, SkillRuntimeManifest } from './contracts';
import {
    getDesignEvaluationProfileById,
    type DesignEvaluationProfile
} from './design-evaluation-profiles';
import {
    buildReActReflexionLoopContract,
    validateManifestToolSkillBoundary,
    type ManifestToolSkillBoundaryResult,
    type ReActReflexionLoopContract
} from './reflexion-contract';
import {
    buildLegacyToolCapabilityBridge,
    type LegacyToolCapabilityBridge
} from './tool-capability-bridge';
import {
    normalizeRuntimeDesignWorkMode,
    resolveSkillRuntimeManifestSelection,
    type SkillRuntimeManifestSelection
} from './skill-runtime';
import {
    buildRuntimeStagePlan,
    type RuntimeStagePlan
} from './runtime-stage-plan';

export interface ResolveSkillRuntimeManifestInput {
    skillId?: string;
    taskType?: string;
    workMode?: RuntimeDesignWorkMode;
}

export interface BuildRuntimeContractBundleInput extends ResolveSkillRuntimeManifestInput {
    executableToolNames: readonly string[];
}

/**
 * 方法 Skill 的依赖投影。
 *
 * 这些字段不会进入 artifact 的 R1 required_inputs / work_mode_contracts，也不会
 * 选择最终交付物或评价 Profile。它们分别保留方法所需的输入、来源引用与画面观察，
 * 供 Runtime、诊断和后续治理读取。
 */
export interface RuntimeMethodManifestOverlay {
    manifestRefs: string[];
    requiredInputs: string[];
    sourceRefs: string[];
    requiredObservations: string[];
    knowledgeRefs: string[];
    memoryRefs: string[];
    evaluationRefs: string[];
    policyRefs: string[];
    capabilityIds: string[];
    forbiddenCapabilityIds: string[];
}

export interface AgentTaskRuntimeContractBundle {
    version: 'runtime-contract-bundle/v0';
    /** artifact-owned 身份与业务契约叠加 method 能力后的有效 Runtime 投影。 */
    manifest: SkillRuntimeManifest;
    /** 交付物、阶段、工作模式与最终评价的 owner；method-only 运行时不存在。 */
    artifactManifest?: SkillRuntimeManifest;
    /** 只描述实现方法，不拥有目标产物。 */
    methodManifests: SkillRuntimeManifest[];
    methodOverlay?: RuntimeMethodManifestOverlay;
    manifestBoundary: ManifestToolSkillBoundaryResult;
    stagePlan: RuntimeStagePlan;
    runtimeLoopContract: ReActReflexionLoopContract;
    toolCapabilityBridge: LegacyToolCapabilityBridge;
    /** manifest 明确选择的评价能力；无 Profile 时保留通用 DesignVerdict 行为。 */
    evaluationProfile?: DesignEvaluationProfile;
}

function normalize(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly (string | undefined)[]): string[] {
    return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

function uniqueOptional(values: readonly (string | undefined)[]): string[] | undefined {
    const result = unique(values);
    return result.length > 0 ? result : undefined;
}

function buildRuntimeMethodManifestOverlay(
    methodManifests: readonly SkillRuntimeManifest[]
): RuntimeMethodManifestOverlay | undefined {
    if (methodManifests.length === 0) return undefined;
    const requiresVisualObservation = methodManifests.some((manifest) => (
        manifest.performance_profile?.vision_policy === 'bounded'
        || (manifest.required_model_profiles || []).some((profile) => profile.startsWith('vision.'))
    ));
    const knowledgeRefs = unique(methodManifests.flatMap((manifest) => manifest.knowledge_refs || []));
    const memoryRefs = unique(methodManifests.flatMap((manifest) => manifest.memory_refs || []));
    const evaluationRefs = unique(methodManifests.flatMap((manifest) => manifest.evaluation_refs || []));
    const policyRefs = unique(methodManifests.flatMap((manifest) => manifest.policy_refs || []));

    return {
        manifestRefs: methodManifests.map((manifest) => `${manifest.skill_id}@${manifest.version}`),
        requiredInputs: unique(methodManifests.flatMap((manifest) => manifest.required_inputs)),
        sourceRefs: unique([
            ...knowledgeRefs.map((ref) => `knowledge:${ref}`),
            ...memoryRefs.map((ref) => `memory:${ref}`),
            ...evaluationRefs.map((ref) => `evaluation:${ref}`),
            ...policyRefs.map((ref) => `policy:${ref}`)
        ]),
        requiredObservations: requiresVisualObservation ? ['visual_observation'] : [],
        knowledgeRefs,
        memoryRefs,
        evaluationRefs,
        policyRefs,
        capabilityIds: unique(methodManifests.flatMap((manifest) => manifest.available_tools)),
        forbiddenCapabilityIds: unique(methodManifests.flatMap((manifest) => manifest.forbidden_tools))
    };
}

/**
 * 生成 Runtime 的有效 Manifest 投影。
 *
 * artifact 字段拥有任务身份、输入/工作模式、阶段、交付和最终评价；method 只能
 * 增补知识、模型、作用域和 Capability。forbidden_tools 在组合后始终优先。
 */
function projectRuntimeManifestSelection(
    selection: SkillRuntimeManifestSelection
): SkillRuntimeManifest | undefined {
    if (selection.status !== 'resolved') return undefined;
    const artifactManifest = selection.artifactManifest;
    const methodManifests = selection.methodManifests;
    if (!artifactManifest) return methodManifests[0];
    if (methodManifests.length === 0) return artifactManifest;

    const selectedManifests = [artifactManifest, ...methodManifests];
    const forbiddenTools = unique(selectedManifests.flatMap((manifest) => manifest.forbidden_tools));
    const forbiddenToolSet = new Set(forbiddenTools);
    const availableTools = unique(selectedManifests.flatMap((manifest) => manifest.available_tools))
        .filter((capabilityId) => !forbiddenToolSet.has(capabilityId));

    return {
        ...artifactManifest,
        // Artifact 继续拥有 required_inputs / optional_inputs / work_mode_contracts。
        // Method 的输入仅记录在 methodOverlay.requiredInputs，避免污染 edit/create 契约。
        required_model_profiles: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.required_model_profiles || []
        )),
        optional_model_profiles: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.optional_model_profiles || []
        )),
        read_scopes: unique(selectedManifests.flatMap((manifest) => manifest.read_scopes)),
        write_scopes: unique(selectedManifests.flatMap((manifest) => manifest.write_scopes)),
        tool_namespaces: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.tool_namespaces || []
        )),
        available_tools: availableTools,
        forbidden_tools: forbiddenTools,
        knowledge_refs: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.knowledge_refs || []
        )),
        memory_refs: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.memory_refs || []
        )),
        // evaluation_refs 是可用评价方法引用；最终 Profile 仍只由 artifact.review_rubric_ref 选择。
        evaluation_refs: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.evaluation_refs || []
        )),
        policy_refs: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.policy_refs || []
        )),
        template_families: uniqueOptional(selectedManifests.flatMap(
            (manifest) => manifest.template_families || []
        ))
    };
}

export function resolveSkillRuntimeManifestForAgentTask(
    input: ResolveSkillRuntimeManifestInput
): SkillRuntimeManifest | undefined {
    const workModeText = normalize(input.workMode);
    const expectedWorkMode = normalizeRuntimeDesignWorkMode(input.workMode);
    if (workModeText && !expectedWorkMode) return undefined;
    const selection = resolveSkillRuntimeManifestSelection(input);
    if (expectedWorkMode
        && !selection.artifactManifest?.work_mode_contracts?.[expectedWorkMode]) return undefined;
    return projectRuntimeManifestSelection(selection);
}

export function buildRuntimeContractBundleForAgentTask(
    input: BuildRuntimeContractBundleInput
): AgentTaskRuntimeContractBundle | undefined {
    const workModeText = normalize(input.workMode);
    const expectedWorkMode = normalizeRuntimeDesignWorkMode(input.workMode);
    if (workModeText && !expectedWorkMode) return undefined;
    const selection = resolveSkillRuntimeManifestSelection(input);
    if (expectedWorkMode
        && !selection.artifactManifest?.work_mode_contracts?.[expectedWorkMode]) return undefined;
    const manifest = projectRuntimeManifestSelection(selection);
    if (!manifest) return undefined;

    // 先校验每个真实 Manifest，再校验组合投影，防止非法 method 能力在合并时被掩盖。
    const selectedBoundariesValid = selection.manifests.every(
        (selectedManifest) => validateManifestToolSkillBoundary(selectedManifest).valid
    );
    if (!selectedBoundariesValid) return undefined;
    const manifestBoundary = validateManifestToolSkillBoundary(manifest);
    if (!manifestBoundary.valid) return undefined;
    const evaluationOwner = selection.artifactManifest || manifest;
    const evaluationRubricRef = expectedWorkMode
        ? selection.artifactManifest?.work_mode_contracts?.[expectedWorkMode]?.review_rubric_ref
            || manifest.review_rubric_ref
        : manifest.review_rubric_ref;
    const evaluationProfile = getDesignEvaluationProfileById(evaluationRubricRef);
    if (evaluationRubricRef?.startsWith('rubrics/') && !evaluationProfile) return undefined;
    if (evaluationProfile && (
        evaluationProfile.skillId !== evaluationOwner.skill_id
        || evaluationProfile.taskType !== evaluationOwner.task_type
    )) return undefined;
    const methodOverlay = selection.artifactManifest
        ? buildRuntimeMethodManifestOverlay(selection.methodManifests)
        : undefined;

    return {
        version: 'runtime-contract-bundle/v0',
        manifest,
        ...(selection.artifactManifest ? { artifactManifest: selection.artifactManifest } : {}),
        methodManifests: [...selection.methodManifests],
        ...(methodOverlay ? { methodOverlay } : {}),
        manifestBoundary,
        stagePlan: buildRuntimeStagePlan(manifest, expectedWorkMode),
        runtimeLoopContract: buildReActReflexionLoopContract(manifest),
        ...(evaluationProfile ? { evaluationProfile } : {}),
        toolCapabilityBridge: buildLegacyToolCapabilityBridge({
            manifest,
            executableToolNames: input.executableToolNames
        })
    };
}
