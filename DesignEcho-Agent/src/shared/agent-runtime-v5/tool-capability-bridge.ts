/**
 * Legacy tool capability bridge
 *
 * v5 Skill manifests declare namespaced tool capabilities. The current renderer
 * Agent still exposes legacy executable tool schema names. This file keeps that
 * mismatch explicit while the tool registry migrates.
 */

import type { SkillRuntimeManifest } from './contracts';

export interface LegacyToolCapabilityBridgeEntry {
    capability: string;
    executableTools: string[];
    status: 'mapped' | 'unmapped';
}

export interface LegacyToolCapabilityBridge {
    version: 'legacy-tool-capability-bridge/v0';
    skillId: string;
    taskType: string;
    entries: LegacyToolCapabilityBridgeEntry[];
    mappedCapabilities: string[];
    unmappedCapabilities: string[];
    executableTools: string[];
}

export interface BuildLegacyToolCapabilityBridgeInput {
    manifest: SkillRuntimeManifest;
    executableToolNames: readonly string[];
}

export const LEGACY_TOOL_CAPABILITY_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'agent.interaction.requestConfirmation': ['createInteractiveCard'],
    'agent.intent.declareDesignTask': ['declareDesignIntent'],
    'agent.team.collaborate': ['delegateToAgent', 'runDesignTeamPipeline'],
    'project.listResources': ['listProjectResources'],
    'project.searchResources': ['searchProjectResources'],
    'knowledge.read.designFoundation': [
        'getDesignPrinciples',
        'getMainImageDesignFramework',
        'getDetailPageDesignFramework',
        'searchDesignKnowledge',
        'analyzePsdDesignSource',
        'measureReferenceComposition'
    ],
    'memory.designProjectState': ['getDesignProjectState', 'updateDesignProjectState'],
    'preview.renderStoryboard': ['renderLayout'],
    'eagle.read.searchReferences': ['searchEagleReferences', 'searchDesignKnowledge'],
    'eagle.read.analyzeReference': ['analyzeEagleReference'],
    'eagle.read.observeAsset': ['observeEagleAsset'],
    'project.importEagleAsset': ['importEagleAssetToProject'],
    'photoshop.read.getDocumentSummary': [
        'getDocumentInfo',
        'listDocuments',
        'switchDocument',
        'getLayerHierarchy'
    ],
    'photoshop.read.inspectDetailPageTemplate': ['parseDetailPageTemplate', 'detectLayerIssues'],
    'photoshop.read.getVisualSnapshot': [
        'getAnnotatedSnapshot',
        'getDocumentSnapshot',
        'getAcceptanceSnapshot',
        'getCanvasSnapshot',
    ],
    'photoshop.read.inspectLayers': [
        'getLayerHierarchy',
        'findLayers',
        'getAllTextLayers',
        'getLayerProperties',
        'getClippingMaskInfo',
        'getAllClippingMasks',
        'getTextContent',
        'getTextStyle',
        'getSmartObjectInfo',
        'getSmartObjectLayers'
    ],
    'photoshop.read.getLayerBounds': ['getLayerBounds', 'getLayerProperties'],
    'photoshop.apply.fixDetailPageTemplate': ['fixLayerIssues'],
    'photoshop.apply.matchDetailPageContent': ['matchDetailPageContent'],
    'photoshop.apply.fillDetailPageTemplate': ['fillDetailPage'],
    'photoshop.sandbox.createDocument': ['createDocument'],
    'photoshop.sandbox.createScreenGroup': ['createDocument', 'renderLayout'],
    'photoshop.sandbox.createShape': ['createRectangle', 'createEllipse'],
    'photoshop.sandbox.manageLayers': ['createGroup', 'moveLayerToGroup', 'createClippingMask'],
    'photoshop.sandbox.editSmartObject': [
        'convertToSmartObject',
        'editSmartObjectContents',
        'getSmartObjectInfo',
        'closeDocument',
        'switchDocument'
    ],
    'photoshop.sandbox.placeImage': ['placeImage'],
    'photoshop.sandbox.transformLayer': ['transformLayer'],
    'photoshop.sandbox.writeText': ['createTextLayer', 'setTextContent', 'setTextStyle'],
    'delivery.exportSlices': ['exportDetailPageSlices', 'quickExport'],
    'delivery.exportAsset': ['exportGroup', 'quickExport'],
    'delivery.saveDocument': ['saveDocument']
});

export interface SelectPreferredLegacyToolsInput {
    capabilityIds: readonly string[];
    executableToolNames: readonly string[];
}

/**
 * 为阶段规划选择每个 Capability 的首选 provider Tool。
 * 这是 Capability→Tool 的通用映射收敛，不按任务品类或用户文本建立白名单。
 */
export function selectPreferredLegacyToolsForCapabilities(
    input: SelectPreferredLegacyToolsInput
): string[] {
    const executableSet = new Set(unique(input.executableToolNames));
    const selected: string[] = [];
    unique(input.capabilityIds).forEach((capabilityId) => {
        const preferred = (LEGACY_TOOL_CAPABILITY_MAP[capabilityId] || [])
            .find((toolName) => executableSet.has(toolName));
        if (preferred) selected.push(preferred);
    });
    return unique(selected);
}

function normalizeName(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(normalizeName).filter(Boolean)));
}

export function buildLegacyToolCapabilityBridge(
    input: BuildLegacyToolCapabilityBridgeInput
): LegacyToolCapabilityBridge {
    const executableNameSet = new Set(unique(input.executableToolNames));
    const entries = input.manifest.available_tools.map((capability) => {
        const candidates = LEGACY_TOOL_CAPABILITY_MAP[capability] || [];
        const executableTools = candidates.filter((toolName) => executableNameSet.has(toolName));
        return {
            capability,
            executableTools,
            status: executableTools.length > 0 ? 'mapped' : 'unmapped'
        } satisfies LegacyToolCapabilityBridgeEntry;
    });

    return {
        version: 'legacy-tool-capability-bridge/v0',
        skillId: input.manifest.skill_id,
        taskType: input.manifest.task_type,
        entries,
        mappedCapabilities: entries
            .filter((entry) => entry.status === 'mapped')
            .map((entry) => entry.capability),
        unmappedCapabilities: entries
            .filter((entry) => entry.status === 'unmapped')
            .map((entry) => entry.capability),
        executableTools: unique(entries.flatMap((entry) => entry.executableTools))
    };
}

export function summarizeLegacyToolCapabilityBridge(bridge: LegacyToolCapabilityBridge): string {
    const lines = [
        `Tool capability bridge: ${bridge.version}`,
        `Skill: ${bridge.skillId} (${bridge.taskType})`
    ];

    bridge.entries.forEach((entry) => {
        const target = entry.executableTools.length
            ? entry.executableTools.join(', ')
            : 'unmapped';
        lines.push(`${entry.capability} -> ${target}`);
    });

    if (bridge.unmappedCapabilities.length) {
        lines.push(`Unmapped capabilities: ${bridge.unmappedCapabilities.join(', ')}`);
    }

    return lines.join('\n');
}
