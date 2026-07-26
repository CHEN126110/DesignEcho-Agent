import type {
    AgentTaskPublicPlanControlledAsyncAdapter,
    AgentTaskPublicPlanControlledAdapterResult
} from '../../../shared/agent-task-public-plan-controlled-runner';
import type { AgentTaskPublicPlanControlledOperationRequest } from '../../../shared/agent-task-public-plan-execution-request';
import {
    formatDesignDocumentRole,
    inferDesignDocumentRoleFromName
} from '../../../shared/design-document-role';

export type PublicPlanPhotoshopAdapterStatus =
    | 'blocked_requires_explicit_live_approval'
    | 'blocked_non_disposable_scope'
    | 'blocked_missing_execute_tool'
    | 'ready_for_guarded_live_adapter';

export type PublicPlanPhotoshopExecuteTool = (
    toolName: string,
    params: Record<string, unknown>
) => Promise<unknown> | unknown;

export interface PublicPlanPhotoshopAdapterInput {
    executeTool?: PublicPlanPhotoshopExecuteTool | null;
    approvedLiveAdapterRun?: boolean;
    executionScope?: 'disposable-document' | 'explicit-project-document' | 'active-document' | 'project-document';
    projectPath?: string;
}

export interface PublicPlanPhotoshopAdapterBuildResult {
    version: 'public-plan-photoshop-adapter/v0';
    status: PublicPlanPhotoshopAdapterStatus;
    canWritePhotoshop: boolean;
    canRunProduction: false;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    adapter: AgentTaskPublicPlanControlledAsyncAdapter | null;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

interface AdapterState {
    lastLayerId?: number;
}

function readRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function readPositiveId(value: unknown): number | undefined {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) return undefined;
    return Math.round(normalized);
}

function extractLayerId(value: unknown): number | undefined {
    const record = readRecord(value);
    const data = readRecord(record.data);
    const layer = readRecord(record.layer);
    const candidates = [
        record.layerId,
        record.id,
        layer.id,
        data.layerId,
        data.id,
        readRecord(data.layer).id
    ];
    for (const candidate of candidates) {
        const id = readPositiveId(candidate);
        if (id !== undefined) return id;
    }
    return undefined;
}

function isToolSuccess(result: unknown): boolean {
    const record = readRecord(result);
    return record.success !== false;
}

function extractToolError(result: unknown): string | undefined {
    const record = readRecord(result);
    const error = String(record.error || record.message || '').trim();
    return error || undefined;
}

function normalizeParams(value: unknown): Record<string, unknown> {
    return { ...readRecord(value) };
}

function sanitizeFileNameSegment(value: unknown, fallback: string): string {
    const text = String(value || '').trim();
    const safe = text
        .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return safe || fallback;
}

function normalizeSaveFormat(value: unknown): string {
    const format = String(value || '').trim().toLowerCase();
    if (format === 'jpeg') return 'jpg';
    if (['png', 'jpg', 'psd', 'psb', 'tiff', 'pdf'].includes(format)) return format;
    return 'png';
}

function joinWindowsPath(...segments: string[]): string {
    return segments
        .map((segment, index) => {
            const text = String(segment || '').trim();
            if (index === 0) return text.replace(/[\\/]+$/g, '');
            return text.replace(/^[\\/]+|[\\/]+$/g, '');
        })
        .filter(Boolean)
        .join('\\');
}

function normalizeProjectSubdir(value: unknown): string {
    return String(value || '')
        .split(/[\\/]+/g)
        .map((segment) => sanitizeFileNameSegment(segment, ''))
        .filter((segment) => segment && segment !== '.' && segment !== '..')
        .join('\\');
}

function inferDesignDocumentRoleFromSaveParams(params: Record<string, unknown>): ReturnType<typeof inferDesignDocumentRoleFromName> {
    return inferDesignDocumentRoleFromName([
        params.projectSubdir,
        params.fileName,
        params.outputFileName,
        params.name,
        params.path
    ].filter(Boolean).join(' '));
}

function resolveDefaultSaveFileName(params: Record<string, unknown>): string {
    const role = inferDesignDocumentRoleFromSaveParams(params);
    if (role !== 'unknown') return formatDesignDocumentRole(role);
    return `设计稿-${Date.now()}`;
}

function normalizeSaveDocumentParams(
    params: Record<string, unknown>,
    projectPath?: string
): Record<string, unknown> {
    if (typeof params.path === 'string' && params.path.trim()) return params;
    const root = String(projectPath || '').trim();
    const projectSubdir = normalizeProjectSubdir(params.projectSubdir);
    if (!root || !projectSubdir) return params;

    const format = normalizeSaveFormat(params.format);
    const fileNameBase = sanitizeFileNameSegment(
        params.fileName || params.outputFileName || params.name,
        resolveDefaultSaveFileName(params)
    ).replace(/\.[^.]+$/u, '');
    const path = joinWindowsPath(root, projectSubdir, `${fileNameBase}.${format}`);
    const {
        projectSubdir: _projectSubdir,
        fileName: _fileName,
        outputFileName: _outputFileName,
        ...rest
    } = params;
    return {
        ...rest,
        format,
        path
    };
}

function normalizeExportQuality(value: unknown): number {
    const quality = Number(value);
    if (!Number.isFinite(quality) || quality <= 0) return 85;
    if (quality <= 12) return Math.max(1, Math.min(100, Math.round(quality / 12 * 100)));
    return Math.max(1, Math.min(100, Math.round(quality)));
}

function normalizeSaveDocumentInvocation(
    params: Record<string, unknown>,
    projectPath?: string
): { toolName: string; params: Record<string, unknown> } {
    const format = normalizeSaveFormat(params.format);
    const root = String(projectPath || '').trim();
    const projectSubdir = normalizeProjectSubdir(params.projectSubdir);
    if ((format === 'png' || format === 'jpg') && root && projectSubdir && !params.path) {
        const fileNameBase = sanitizeFileNameSegment(
            params.fileName || params.outputFileName || params.name,
            resolveDefaultSaveFileName(params)
        ).replace(/\.[^.]+$/u, '');
        return {
            toolName: 'quickExport',
            params: {
                format,
                outputPath: joinWindowsPath(root, projectSubdir),
                quality: normalizeExportQuality(params.quality),
                suffix: `-${fileNameBase}`
            }
        };
    }

    return {
        toolName: 'saveDocument',
        params: normalizeSaveDocumentParams(params, projectPath)
    };
}

function normalizeOperationInvocation(
    toolName: string,
    params: unknown,
    projectPath?: string
): { toolName: string; params: Record<string, unknown> } {
    const normalized = normalizeParams(params);
    if (toolName === 'saveDocument') {
        return normalizeSaveDocumentInvocation(normalized, projectPath);
    }
    return { toolName, params: normalized };
}

function updateStateFromWrite(state: AdapterState, result: unknown): void {
    const layerId = extractLayerId(result);
    if (layerId !== undefined) {
        state.lastLayerId = layerId;
    }
}

function buildToolResult(result: unknown): AgentTaskPublicPlanControlledAdapterResult {
    return {
        success: isToolSuccess(result),
        error: extractToolError(result),
        data: result
    };
}

function buildReadbackRequest(
    operation: AgentTaskPublicPlanControlledOperationRequest,
    target: string,
    state: AdapterState
): { toolName: string; params: Record<string, unknown> } | null {
    if (target === 'layer_hierarchy') {
        return {
            toolName: 'getLayerHierarchy',
            params: { includeHidden: true, includeBounds: true, flatList: true }
        };
    }
    if (target === 'acceptance_snapshot') {
        return {
            toolName: 'getAcceptanceSnapshot',
            params: { includeHidden: true, includeBounds: true, includeText: true, maxLayers: 260 }
        };
    }
    if (target === 'document_info') {
        return {
            toolName: 'getDocumentInfo',
            params: {}
        };
    }
    if (target === 'layer_properties') {
        const layerId = readPositiveId(readRecord(operation.params).layerId) || state.lastLayerId;
        return {
            toolName: 'getLayerProperties',
            params: layerId ? { layerId } : {}
        };
    }
    return null;
}

function inferStatus(input: PublicPlanPhotoshopAdapterInput): PublicPlanPhotoshopAdapterStatus {
    if (input.approvedLiveAdapterRun !== true) return 'blocked_requires_explicit_live_approval';
    if (input.executionScope !== 'disposable-document') return 'blocked_non_disposable_scope';
    if (!input.executeTool) return 'blocked_missing_execute_tool';
    return 'ready_for_guarded_live_adapter';
}

function blockersForStatus(status: PublicPlanPhotoshopAdapterStatus): string[] {
    if (status === 'blocked_requires_explicit_live_approval') return ['explicit_live_adapter_approval_required'];
    if (status === 'blocked_non_disposable_scope') return ['public_plan_adapter_requires_disposable_document_scope'];
    if (status === 'blocked_missing_execute_tool') return ['execute_tool_function_required'];
    return [];
}

export function createPublicPlanPhotoshopAdapter(
    input: PublicPlanPhotoshopAdapterInput
): PublicPlanPhotoshopAdapterBuildResult {
    const status = inferStatus(input);
    const canWritePhotoshop = status === 'ready_for_guarded_live_adapter';
    const state: AdapterState = {};
    const executeTool = input.executeTool;
    let adapter: AgentTaskPublicPlanControlledAsyncAdapter | null = null;

    if (canWritePhotoshop && executeTool) {
        adapter = {
            async runWriteOperation(operation) {
                const invocation = normalizeOperationInvocation(
                    operation.toolName,
                    operation.params,
                    input.projectPath
                );
                const result = await executeTool(
                    invocation.toolName,
                    invocation.params
                );
                if (isToolSuccess(result)) {
                    updateStateFromWrite(state, result);
                }
                return buildToolResult(result);
            },
            async readbackAfterOperation(operation, target) {
                if (target === 'layer_hierarchy') {
                    const hierarchy = await executeTool(
                        'getLayerHierarchy',
                        { includeHidden: true, includeBounds: true, includeText: true, flatList: true }
                    );
                    let textLayerReadback: unknown = null;
                    try {
                        textLayerReadback = await executeTool(
                            'getAllTextLayers',
                            { includeHidden: true, includeBounds: true }
                        );
                    } catch (error) {
                        textLayerReadback = {
                            success: false,
                            error: error instanceof Error ? error.message : String(error || 'text layer readback failed')
                        };
                    }
                    return {
                        success: isToolSuccess(hierarchy),
                        error: extractToolError(hierarchy),
                        data: {
                            hierarchy,
                            textLayerReadback
                        }
                    };
                }
                const readback = buildReadbackRequest(operation, target, state);
                if (!readback) {
                    return {
                        success: false,
                        error: `unsupported_readback_target:${target}`
                    };
                }
                const result = await executeTool(readback.toolName, readback.params);
                return buildToolResult(result);
            }
        };
    }

    return {
        version: 'public-plan-photoshop-adapter/v0',
        status,
        canWritePhotoshop,
        canRunProduction: false,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        adapter,
        blockers: blockersForStatus(status),
        warnings: [],
        limitations: [
            'This adapter only maps approved public-plan operations to the existing executeToolCall path.',
            'It only allows disposable-document scope and does not grant project-document writes.',
            'A successful adapter run only confirms tool execution and readback; screenshot QA, pixel probes and manual review are still required before any design-quality claim.'
        ]
    };
}
