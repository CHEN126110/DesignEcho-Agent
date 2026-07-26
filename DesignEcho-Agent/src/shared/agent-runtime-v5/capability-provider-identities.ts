/**
 * 非执行 Capability provider 的稳定身份。
 *
 * 这些 id 由真实实现模块共同引用，避免 Resolver 另抄一份“看起来存在”的
 * 字符串表。这里只登记 provider 身份与装载语义，不包含知识正文、Memory 数据、
 * Evaluation 结果或 Policy 规则，也不产生任何 Tool schema。
 */

import type {
    CapabilityKind,
    RuntimeCapabilityProviderIdentity
} from './contracts/capability-resolution';
import { listDesignMethodKnowledgeProviderIdentities } from './design-method-knowledge';

export const DESIGN_PROJECT_STATE_CAPABILITY_ID = 'design-project-state/v0' as const;
export const DESIGN_QUALITY_VERDICT_CAPABILITY_ID = 'design-quality-verdict/v0' as const;
export const AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID = 'agent-tool-decision-contract/v0' as const;
export const DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID = 'design-discipline-runtime/v0' as const;
export const TOOL_SAFETY_POLICY_CAPABILITY_ID = 'tool-safety-policy/v0' as const;
export const SKU_WORKFLOW_STAGES_CAPABILITY_ID = 'sku-workflow-stages/v0' as const;

interface BuiltinCapabilityProviderDefinition {
    capabilityId: string;
    kind: Extract<CapabilityKind, 'knowledge' | 'memory' | 'evaluation' | 'policy'>;
    exposure: RuntimeCapabilityProviderIdentity['exposure'];
}

const BUILTIN_PROVIDER_DEFINITIONS: readonly BuiltinCapabilityProviderDefinition[] = Object.freeze([
    {
        capabilityId: SKU_WORKFLOW_STAGES_CAPABILITY_ID,
        kind: 'knowledge',
        exposure: 'runtime_context'
    },
    {
        capabilityId: DESIGN_PROJECT_STATE_CAPABILITY_ID,
        kind: 'memory',
        exposure: 'runtime_context'
    },
    {
        capabilityId: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
        kind: 'evaluation',
        exposure: 'evaluation_gate'
    },
    {
        capabilityId: AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID,
        kind: 'policy',
        exposure: 'execution_policy'
    },
    {
        capabilityId: DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
        kind: 'policy',
        exposure: 'execution_policy'
    },
    {
        capabilityId: TOOL_SAFETY_POLICY_CAPABILITY_ID,
        kind: 'policy',
        exposure: 'execution_policy'
    }
]);

export function listBuiltinNonExecutableCapabilityProviders(): RuntimeCapabilityProviderIdentity[] {
    const builtinProviders: RuntimeCapabilityProviderIdentity[] = BUILTIN_PROVIDER_DEFINITIONS.map((definition) => ({
        capabilityId: definition.capabilityId,
        kind: definition.kind,
        providerId: `runtime:${definition.capabilityId}`,
        source: 'runtime_contract',
        exposure: definition.exposure,
        exposedAsToolSchema: false
    }));
    return [
        ...builtinProviders,
        ...listDesignMethodKnowledgeProviderIdentities()
    ];
}
