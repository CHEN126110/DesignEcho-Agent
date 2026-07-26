import http from 'http';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
    DEBUG_BRIDGE_PORT,
    WEBVIEW_SERVER_PORT,
    WS_PORT
} from '../config/network-ports';
import {
    DebugBridgeAppendMessageInput,
    DebugBridgeCreateSessionInput,
    DebugBridgeService
} from './debug-bridge-service';
import { WebSocketServer } from '../websocket/server';
import {
    analyzeDetailPlaceholderAnchors,
    computeDetailRectOverlapRatio,
    normalizeDetailRect
} from '../../shared/detail-page-anchor-diagnostics';
import { auditDetailCopyLayoutForScreens } from '../../shared/detail-page-copy-layout-audit';
import {
    buildDetailRectKey,
    reconstructDetailPlacementsFromHierarchy
} from '../../shared/detail-page-live-placement';
import { inferDetailScreenPlans } from '../../shared/detail-page-screen-plan';
import {
    auditDetailSegmentationMerge,
    buildDetailScreenVisualSummaries,
    buildDetailVisualModules,
    buildDetailVisualScreenBoundaries,
    captureDetailVisualContextBundle,
    type DetailSegmentationMergeAudit,
    type DetailVisualModule,
    type DetailVisualScreenBoundary
} from '../../shared/detail-page-visual-segmentation';
import { buildSelectedDesignContext } from '../../shared/design-selected-design-context';
import { buildSelectedElementContext } from '../../shared/design-selected-element-context';
import { buildSelectedModuleContext } from '../../shared/design-selected-module-context';
import { classifyPhotoshopToolSkillExecution } from '../../shared/photoshop-tool-skill';
import type { SelectedDesignContext } from '../../shared/types/design-context.types';
import { ResourceManagerService } from './resource-manager-service';
import { ModelService } from './model-service';
import { TaskOrchestrator } from './task-orchestrator';
import {
    normalizeDesignKnowledgeSettings,
    toSearxngConnectorConfig,
    type DesignKnowledgeRuntimeSettings
} from '../../shared/design-knowledge-settings';
import type {
    DesignKnowledgeIntent,
    DesignKnowledgeSourceType
} from '../../shared/design-knowledge-search';
import { DesignKnowledgeSearchService } from './design-knowledge-search-service';
import {
    buildMainImageFrameworkSummary,
    MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES
} from '../../shared/knowledge/main-image-framework';
import {
    buildDetailPageFrameworkSummary,
    DETAIL_PAGE_FRAMEWORK_FOCUS_VALUES
} from '../../shared/knowledge/detail-page-framework';
import type { DesignProjectStatePatch } from '../../shared/types/design-project-state.types';
import { designProjectStateCoordinator } from './design-project-state-coordinator';

type JsonRpcId = string | number | null;

const DESIGN_KNOWLEDGE_INTENTS: readonly DesignKnowledgeIntent[] = [
    'trend',
    'reference',
    'rule',
    'recipe',
    'brand',
    'platform_spec',
    'copywriting'
];

const DESIGN_KNOWLEDGE_SOURCE_TYPES: readonly DesignKnowledgeSourceType[] = [
    'local_recipe',
    'manual_rule',
    'design_crawler',
    'web_page',
    'mimo_web_search',
    'local_case',
    'eagle_library'
];

function normalizeDesignKnowledgeIntents(value: unknown): DesignKnowledgeIntent[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const filtered = value
        .map((item) => String(item || '').trim())
        .filter((item): item is DesignKnowledgeIntent =>
            DESIGN_KNOWLEDGE_INTENTS.includes(item as DesignKnowledgeIntent));
    return filtered.length ? Array.from(new Set(filtered)) : undefined;
}

function normalizeDesignKnowledgeSourceTypes(value: unknown): DesignKnowledgeSourceType[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const filtered = value
        .map((item) => String(item || '').trim())
        .filter((item): item is DesignKnowledgeSourceType =>
            DESIGN_KNOWLEDGE_SOURCE_TYPES.includes(item as DesignKnowledgeSourceType));
    return filtered.length ? Array.from(new Set(filtered)) : undefined;
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: JsonRpcId;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

interface MCPToolSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
}

interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: MCPToolSchema;
}

interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

interface MCPPrompt {
    name: string;
    description: string;
    arguments?: Array<{
        name: string;
        description: string;
        required?: boolean;
    }>;
}

interface MCPHostServiceOptions {
    host: string;
    port: number;
    wsServer: WebSocketServer;
    debugBridge: DebugBridgeService;
    resourceManagerService?: ResourceManagerService | null;
    modelService?: ModelService | null;
    taskOrchestrator?: TaskOrchestrator | null;
    onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

interface PhotoshopBatchCallItem {
    name: string;
    arguments?: Record<string, unknown>;
}

interface DetailVisualSegmentationContext {
    success: true;
    templateGraph: Record<string, unknown>;
    screens: any[];
    screenPlans: any[];
    hierarchySummary: unknown;
    flatLayers: Array<Record<string, unknown>>;
    documentBounds: ReturnType<typeof normalizeDetailRect>;
    visualScreens: DetailVisualScreenBoundary[];
    visualModules: DetailVisualModule[];
    mergeAudit: DetailSegmentationMergeAudit;
}

async function isReadableImageFile(filePath: string): Promise<boolean> {
    if (!fs.existsSync(filePath)) {
        return false;
    }
    try {
        const metadata = await sharp(filePath).metadata();
        return typeof metadata.width === 'number' && metadata.width > 0 &&
            typeof metadata.height === 'number' && metadata.height > 0;
    } catch {
        return false;
    }
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_SERVER_INFO = {
    name: 'designecho-agent-host',
    version: '1.0.0',
    description: 'DesignEcho Agent MCP Host Server'
};

const SAFE_BATCH_TOOLS = new Set([
    'diagnoseState',
    'getDocumentInfo',
    'listDocuments'
]);

const BLOCKED_BATCH_TOOLS = new Map<string, string>([
    ['getCanvasSnapshot', 'Visual snapshot path is too heavy for unattended bulk calls.'],
    ['getDocumentSnapshot', 'Document snapshot path is too heavy for unattended bulk calls.'],
    ['getHistoryInfo', 'History inspection has timed out or destabilized audits before.'],
    ['getScreenSnapshots', 'Requires parsed screen context and image rendering.'],
    ['getScreenSnapshotsWithOverlay', 'Requires parsed screen context and overlay rendering.'],
    ['getSelectionBounds', 'Selection-dependent call.'],
    ['getSelectionMask', 'Selection-dependent imaging call.']
]);

const POSSIBLE_DIALOG_TOOLS = new Set([
    'addDropShadow',
    'addGlow',
    'addGradientOverlay',
    'addStroke',
    'batchExport',
    'clearLayerEffects',
    'createDocument',
    'createEllipse',
    'createGroup',
    'createRectangle',
    'createTextLayer',
    'getSelectionBounds',
    'getSelectionMask',
    'replaceImagePlaceholder',
    'setLayerFill'
]);

const TEXT_DOC_ONLY_TOOLS = new Set([
    'createTextLayer',
    'getAllTextLayers'
]);

const TEXT_LAYER_TOOLS = new Set([
    'auditTextReplacement',
    'getTextContent',
    'getTextStyle',
    'setTextContent',
    'setTextStyle'
]);

const LAYER_TARGET_OPTIONAL_TOOLS = new Set([
    'addDropShadow',
    'addGlow',
    'addGradientOverlay',
    'addStroke',
    'clearLayerEffects',
    'deleteLayer',
    'duplicateLayer',
    'getClippingMaskInfo',
    'getLayerBounds',
    'getLayerProperties',
    'focusLayer',
    'lockLayer',
    'moveLayer',
    'moveLayerToGroup',
    'renameLayer',
    'reorderLayer',
    'replaceLayerContent',
    'selectLayer',
    'setBlendMode',
    'warpLayer',
    'setLayerFill',
    'setLayerOpacity'
]);

const DOCUMENT_SCOPE_LAYOUT_TOOLS = new Set([
    'analyzeLayout',
    'detectLayerIssues',
    'getAllClippingMasks',
    'getElementMapping',
    'getLayerHierarchy',
    'getTemplateStructure',
    'parseDetailPageTemplate'
]);

const EFFECT_STYLE_TOOLS = new Set([
    'addDropShadow',
    'addGlow',
    'addGradientOverlay',
    'addStroke',
    'clearLayerEffects'
]);

const EFFECT_PARAMETER_TOOLS = new Set([
    ...Array.from(EFFECT_STYLE_TOOLS),
    'setLayerFill'
]);

const HEAVY_IMAGE_READ_TOOLS = new Set([
    'getMattingImage',
    'getOptimizedImage',
    'getSubjectBounds'
]);

const CREATE_DOCUMENT_TOOLS = new Set([
    'createDocument'
]);

const CREATE_LAYER_TOOLS = new Set([
    'createRectangle',
    'createEllipse',
    'createTextLayer',
    'createGroup'
]);

function asRecord(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return input as Record<string, unknown>;
}

function hasRgbColor(input: unknown): input is { r: number; g: number; b: number } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    const color = input as Record<string, unknown>;
    return [color.r, color.g, color.b].every(value => typeof value === 'number' && Number.isFinite(value));
}

function isPercent(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isNonNegativeNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNumeric(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isHexColor(value: unknown): boolean {
    return typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value.trim());
}

function isAlignmentValue(value: unknown): boolean {
    return typeof value === 'string' && ['left', 'center', 'right'].includes(value);
}

function isStringArrayOfNumbers(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function describeLayerKind(kind: unknown): string {
    return String(kind || '').trim().toLowerCase();
}

function isLikelyShapeLayer(kind: string): boolean {
    return kind.includes('shape') || kind.includes('solid') || kind.includes('fill');
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(body, null, 2));
}

function isCancellationErrorMessage(value: unknown): boolean {
    return /取消|cancelled|canceled|aborted|abort/i.test(String(value || ''));
}

function createErrorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
    return {
        jsonrpc: '2.0',
        id,
        error: {
            code,
            message,
            data
        }
    };
}

function toToolResult(payload: unknown, isError: boolean = false): { content: Array<{ type: 'text'; text: string }>; isError: boolean } {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    return {
        content: [{ type: 'text', text }],
        isError
    };
}

export class MCPHostService {
    private readonly host: string;
    private readonly port: number;
    private readonly wsServer: WebSocketServer;
    private readonly debugBridge: DebugBridgeService;
    private readonly resourceManagerService: ResourceManagerService | null;
    private readonly modelService: ModelService | null;
    private readonly taskOrchestrator: TaskOrchestrator | null;
    private readonly onLog?: MCPHostServiceOptions['onLog'];
    private server: http.Server | null = null;

    constructor(options: MCPHostServiceOptions) {
        this.host = options.host;
        this.port = options.port;
        this.wsServer = options.wsServer;
        this.debugBridge = options.debugBridge;
        this.resourceManagerService = options.resourceManagerService || null;
        this.modelService = options.modelService || null;
        this.taskOrchestrator = options.taskOrchestrator || null;
        this.onLog = options.onLog;
    }

    start(): void {
        if (this.server) return;

        this.server = http.createServer(async (req, res) => {
            if (!req.url) {
                sendJson(res, 400, { success: false, error: 'Missing URL' });
                return;
            }

            if (req.method === 'OPTIONS') {
                sendJson(res, 200, { success: true });
                return;
            }

            try {
                await this.handleRequest(req, res);
            } catch (error: any) {
                this.log('error', `[MCPHost] Internal error: ${error?.message || String(error)}`);
                sendJson(res, 500, {
                    success: false,
                    error: error?.message || 'MCP host internal error'
                });
            }
        });

        this.server.listen(this.port, this.host);
        this.log('info', `[MCPHost] Started at ${this.getBaseUrl()}/mcp`);
    }

    stop(): void {
        this.server?.close();
        this.server = null;
    }

    getBaseUrl(): string {
        return `http://${this.host}:${this.port}`;
    }

    private resolveHttpAbortRequestKey(request: JsonRpcRequest): string {
        if (request.method !== 'tools/call') return '';
        const params = asRecord(request.params);
        const toolName = String(params.name || '').trim();
        if (toolName !== 'photoshop.tools.call' && toolName !== 'photoshop.tools.batch_call') return '';

        const args = asRecord(params.arguments);
        const existing = String(args.requestKey || params.requestKey || '').trim();
        if (existing) return existing;

        const requestId = request.id === null || request.id === undefined
            ? `${Date.now()}`
            : String(request.id);
        return `mcp-http:${requestId}:${Date.now()}`;
    }

    private attachHttpAbortRequestKey(request: JsonRpcRequest, requestKey: string): JsonRpcRequest {
        if (!requestKey || request.method !== 'tools/call') return request;
        const params = asRecord(request.params);
        const args = asRecord(params.arguments);
        if (String(args.requestKey || '').trim()) return request;
        return {
            ...request,
            params: {
                ...params,
                arguments: {
                    ...args,
                    requestKey
                }
            }
        };
    }

    private log(level: 'info' | 'warn' | 'error', message: string): void {
        this.onLog?.(level, message);
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const method = String(req.method || 'GET').toUpperCase();
        const url = new URL(req.url || '/', this.getBaseUrl());

        if (method === 'GET' && url.pathname === '/health') {
            sendJson(res, 200, {
                success: true,
                service: 'mcp-host',
                host: this.host,
                port: this.port
            });
            return;
        }

        if (method === 'GET' && url.pathname === '/mcp') {
            sendJson(res, 200, {
                success: true,
                service: 'mcp-host',
                endpoint: `${this.getBaseUrl()}/mcp`,
                protocol: MCP_PROTOCOL_VERSION
            });
            return;
        }

        if (method === 'POST' && url.pathname === '/mcp') {
            const raw = await readBody(req);
            let request: JsonRpcRequest | null = null;
            try {
                request = JSON.parse(raw) as JsonRpcRequest;
            } catch {
                sendJson(res, 400, createErrorResponse(null, -32700, 'Parse error'));
                return;
            }

            const abortRequestKey = this.resolveHttpAbortRequestKey(request);
            const requestForExecution = abortRequestKey
                ? this.attachHttpAbortRequestKey(request, abortRequestKey)
                : request;
            let responseReady = false;
            const onResponseClosed = () => {
                if (!responseReady && abortRequestKey) {
                    const cancelled = this.wsServer.cancelRequestByKey(abortRequestKey, 'mcp_http_client_closed');
                    if (cancelled) {
                        this.log('warn', `[MCPHost] Cancelled Photoshop MCP request after HTTP client closed: ${abortRequestKey}`);
                    }
                }
            };
            if (abortRequestKey) {
                res.once('close', onResponseClosed);
            }
            const response = await this.handleRpcRequest(requestForExecution);
            responseReady = true;
            if (abortRequestKey) {
                res.off('close', onResponseClosed);
            }
            sendJson(res, 200, response);
            return;
        }

        sendJson(res, 404, {
            success: false,
            error: `Not found: ${url.pathname}`
        });
    }

    private async handleRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        if (!request || request.jsonrpc !== '2.0' || !request.method) {
            return createErrorResponse(request?.id ?? null, -32600, 'Invalid Request');
        }

        const id = request.id ?? null;

        try {
            switch (request.method) {
                case 'initialize':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            protocolVersion: MCP_PROTOCOL_VERSION,
                            capabilities: {
                                tools: { listChanged: true },
                                resources: { listChanged: true },
                                prompts: { listChanged: false },
                                logging: {}
                            },
                            serverInfo: MCP_SERVER_INFO
                        }
                    };

                case 'tools/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { tools: this.getToolDefinitions() }
                    };

                case 'tools/call': {
                    const params = asRecord(request.params);
                    const toolName = String(params.name || '').trim();
                    const toolArgs = asRecord(params.arguments);
                    if (!toolName) {
                        return createErrorResponse(id, -32602, 'tools/call requires params.name');
                    }

                    const toolPayload = await this.callTool(toolName, toolArgs);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: toToolResult(toolPayload, false)
                    };
                }

                case 'resources/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { resources: this.getResources() }
                    };

                case 'resources/read': {
                    const params = asRecord(request.params);
                    const uri = String(params.uri || '').trim();
                    if (!uri) {
                        return createErrorResponse(id, -32602, 'resources/read requires params.uri');
                    }
                    const result = await this.readResource(uri);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result
                    };
                }

                case 'prompts/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { prompts: this.getPrompts() }
                    };

                case 'prompts/get': {
                    const params = asRecord(request.params);
                    const name = String(params.name || '').trim();
                    const args = asRecord(params.arguments);
                    if (!name) {
                        return createErrorResponse(id, -32602, 'prompts/get requires params.name');
                    }
                    const prompt = this.getPromptContent(name, args);
                    if (!prompt) {
                        return createErrorResponse(id, -32602, `Prompt not found: ${name}`);
                    }
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: prompt
                    };
                }

                case 'ping':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { status: 'pong' }
                    };

                default:
                    return createErrorResponse(id, -32601, `Method not found: ${request.method}`);
            }
        } catch (error: any) {
            return createErrorResponse(
                id,
                -32000,
                error?.message || 'Internal tool error'
            );
        }
    }

    private getToolDefinitions(): MCPToolDefinition[] {
        return [
            {
                name: 'debug.session_create',
                description: 'Create or get a debug session in DesignEcho desktop host.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        metadata: { type: 'object' }
                    }
                }
            },
            {
                name: 'debug.session_append',
                description: 'Append a message with trace data to a debug session.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sessionId: { type: 'string' },
                        role: { type: 'string' },
                        direction: { type: 'string' },
                        content: { type: 'string' },
                        agent: { type: 'string' },
                        metadata: { type: 'object' },
                        trace: { type: 'object' },
                        toolCalls: { type: 'array' },
                        errors: { type: 'array' },
                        executionSummary: { type: 'object' }
                    },
                    required: ['sessionId', 'content']
                }
            },
            {
                name: 'debug.session_list',
                description: 'List debug sessions with message counts.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'debug.session_get',
                description: 'Get a redacted debug session summary by id. Full data requires includeFull=true and a valid debugToken.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sessionId: { type: 'string' },
                        includeFull: { type: 'boolean' },
                        debugToken: { type: 'string' },
                        limit: { type: 'number' }
                    },
                    required: ['sessionId']
                }
            },
            {
                name: 'runtime.get_active_context',
                description: 'Get the current DesignEcho + Photoshop runtime context as structured JSON.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeLayerHierarchy: { type: 'boolean' },
                        includeTextLayers: { type: 'boolean' },
                        includeBounds: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'runtime.get_recent_task_trace',
                description: 'Get the most recent persisted debug trace, or a specific session by id.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sessionId: { type: 'string' },
                        includeMessages: { type: 'boolean' },
                        limit: { type: 'number' },
                        includeFull: { type: 'boolean' },
                        debugToken: { type: 'string' }
                    }
                }
            },
            {
                name: 'scene.get_selected_element_context',
                description: 'Read the currently selected Photoshop element as structured design context, including hierarchy, relations, clipping, and optional text/detail hints.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        layerId: { type: 'number' },
                        includeText: { type: 'boolean' },
                        includeDetailContext: { type: 'boolean' },
                        relationLimit: { type: 'number' }
                    }
                }
            },
            {
                name: 'scene.get_selected_module_context',
                description: 'Read the visual module that contains the current selected Photoshop element, including member layers and module/screen relations.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        layerId: { type: 'number' },
                        includeDetailContext: { type: 'boolean' },
                        relationLimit: { type: 'number' }
                    }
                }
            },
            {
                name: 'scene.get_selected_design_context',
                description: 'Read the currently selected Photoshop design context as element + module summary for planning design actions.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        layerId: { type: 'number' },
                        includeText: { type: 'boolean' },
                        includeDetailContext: { type: 'boolean' },
                        relationLimit: { type: 'number' }
                    }
                }
            },
            {
                name: 'photoshop.connection_status',
                description: 'Check whether desktop host is connected to Photoshop UXP plugin.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'photoshop.tools.list',
                description: 'List MCP tools exposed by the Photoshop UXP plugin.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'photoshop.tools.call',
                description: 'Call an MCP tool on the Photoshop UXP plugin.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        arguments: { type: 'object' },
                        requestKey: { type: 'string' }
                    },
                    required: ['name']
                }
            },
            {
                name: 'photoshop.tools.cancel',
                description: 'Cancel a pending Photoshop MCP tool call by requestKey.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        requestKey: { type: 'string' }
                    },
                    required: ['requestKey']
                }
            },
            {
                name: 'photoshop.batch_policy',
                description: 'Return batch safety policy and execution recommendations for Photoshop MCP tools.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        names: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    }
                }
            },
            {
                name: 'photoshop.tools.batch_call',
                description: 'Execute Photoshop MCP tools in a guarded serial batch with per-step policy checks.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        calls: {
                            type: 'array',
                            items: { type: 'object' }
                        },
                        continueOnError: { type: 'boolean' },
                        allowWrites: { type: 'boolean' },
                        allowRisky: { type: 'boolean' },
                        delayMs: { type: 'number' },
                        requestKey: { type: 'string' }
                    },
                    required: ['calls']
                }
            },
            {
                name: 'photoshop.acceptance_snapshot',
                description: 'Capture a lightweight Photoshop acceptance snapshot for task verification and debugging.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeHidden: { type: 'boolean' },
                        includeBounds: { type: 'boolean' },
                        includeText: { type: 'boolean' },
                        maxLayers: { type: 'number' }
                    }
                }
            },
            {
                name: 'text.audit_replacement',
                description: 'Inspect a Photoshop text layer before replacement and return formatting diagnostics.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        layerId: { type: 'number' },
                        proposedContent: { type: 'string' },
                        baselineContent: { type: 'string' }
                    }
                }
            },
            {
                name: 'detail.get_template_graph',
                description: 'Parse the current detail-page PSD and return screens, placeholders, layout graph, and layout assessment.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'detail.get_screen_plan',
                description: 'Infer screen roles and screen plans for the current detail-page PSD.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'detail.audit_placement',
                description: 'Run detail-page placement audit against parsed screens and provided placement records.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        screens: { type: 'array', items: { type: 'object' } },
                        placements: { type: 'array', items: { type: 'object' } }
                    },
                    required: ['placements']
                }
            },
            {
                name: 'detail.audit_copy_layout',
                description: 'Audit current detail-page text placeholders for layout pressure, duplicate copy, and screen-role mismatch risk.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' },
                        nearLimitThreshold: { type: 'number' },
                        overflowThreshold: { type: 'number' }
                    }
                }
            },
            {
                name: 'detail.validate_template_graph',
                description: 'Validate the active detail-page template graph, screen roles, missing groups, and placeholder-anchor risks.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'detail.inspect_live_placements',
                description: 'Reconstruct current live detail-page image placements from the active PSD without relying on fillDetailPage placement logs.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' },
                        includeHidden: { type: 'boolean' },
                        minOverlapRatio: { type: 'number' }
                    }
                }
            },
            {
                name: 'detail.inspect_visual_modules',
                description: 'Build geometry-first visual modules for the active detail-page PSD from layer bounds, clipping, and layout proximity.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' },
                        includeHidden: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'detail.inspect_screen_boundaries',
                description: 'Infer visual screen boundaries for the active detail-page PSD and compare them to parsed structure screens.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' },
                        includeHidden: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'detail.audit_segmentation_merge',
                description: 'Compare structure-derived screens and geometry-first visual segmentation for the active detail-page PSD.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' },
                        includeHidden: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'detail.capture_visual_context_bundle',
                description: 'Capture a detail-page visual context bundle with parsed screens, screen plans, visual screens, modules, and merge audit.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeStructure: { type: 'boolean' },
                        includeHidden: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'resource.get_project_root',
                description: 'Read the active DesignEcho project root from the resource manager.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'resource.list_project_resources',
                description: 'Scan project resources from the active project or a provided directory.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: { type: 'string' },
                        recursive: { type: 'boolean' },
                        includeDesignFiles: { type: 'boolean' },
                        maxDepth: { type: 'number' },
                        generateThumbnails: { type: 'boolean' }
                    }
                }
            },
            {
                name: 'resource.search_project_resources',
                description: 'Search project resources by query and optional type filter.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        directory: { type: 'string' },
                        type: { type: 'string', enum: ['image', 'design', 'all'] },
                        limit: { type: 'number' }
                    },
                    required: ['query']
                }
            },
            {
                name: 'resource.get_project_structure',
                description: 'Read a text summary of the project directory structure.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: { type: 'string' },
                        maxDepth: { type: 'number' }
                    }
                }
            },
            {
                name: 'resource.get_project_summary',
                description: 'Generate a compact project resource summary.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        directory: { type: 'string' }
                    }
                }
            },
            {
                name: 'resource.probe_image_file',
                description: 'Read safe metadata for one image file without returning raw image bytes.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        imagePath: { type: 'string' }
                    },
                    required: ['imagePath']
                }
            },
            {
                name: 'design_state.get',
                description: 'Read DesignEcho project state from <project>/.designecho/design-state.json.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        projectPath: { type: 'string' }
                    }
                }
            },
            {
                name: 'design_state.update',
                description: 'Update DesignEcho project state using the shared patch format. External Agent fact upserts remain unverified; this endpoint cannot submit fact review authority.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        projectPath: { type: 'string' },
                        patch: { type: 'object' }
                    },
                    required: ['patch']
                }
            },
            {
                name: 'knowledge.get_main_image_framework',
                description: 'Read the structured main-image design framework used as design knowledge.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        focus: { type: 'string' }
                    }
                }
            },
            {
                name: 'knowledge.get_detail_page_framework',
                description: 'Read the structured detail-page design framework used as design knowledge.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        focus: { type: 'string' }
                    }
                }
            },
            {
                name: 'knowledge.search_design',
                description: 'Search DesignEcho design knowledge and optional web-backed design references.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        intents: { type: 'array', items: { type: 'string' } },
                        sourceTypes: { type: 'array', items: { type: 'string' } },
                        limit: { type: 'number' },
                        settings: { type: 'object' }
                    },
                    required: ['query']
                }
            },
            {
                name: 'system.status',
                description: 'Get desktop host status and endpoint summary.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            }
        ];
    }

    private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        switch (name) {
            case 'debug.session_create': {
                const input: DebugBridgeCreateSessionInput = {
                    id: typeof args.id === 'string' ? args.id : undefined,
                    title: typeof args.title === 'string' ? args.title : undefined,
                    metadata: asRecord(args.metadata)
                };
                return {
                    success: true,
                    session: this.debugBridge.summarizeSession(this.debugBridge.createSession(input), { messageLimit: 0 })
                };
            }

            case 'debug.session_append': {
                const sessionId = String(args.sessionId || '').trim();
                if (!sessionId) throw new Error('debug.session_append requires sessionId');

                const input: DebugBridgeAppendMessageInput = {
                    role: typeof args.role === 'string' ? args.role : 'user',
                    direction: typeof args.direction === 'string' ? args.direction : 'inbound',
                    content: typeof args.content === 'string' ? args.content : '',
                    agent: typeof args.agent === 'string' ? args.agent : undefined,
                    metadata: asRecord(args.metadata),
                    trace: asRecord(args.trace),
                    toolCalls: Array.isArray(args.toolCalls) ? args.toolCalls : undefined,
                    errors: Array.isArray(args.errors) ? args.errors : undefined,
                    executionSummary: args.executionSummary
                };

                return {
                    success: true,
                    message: this.debugBridge.summarizeMessage(this.debugBridge.appendMessage(sessionId, input))
                };
            }

            case 'debug.session_list':
                return {
                    success: true,
                    sessions: this.debugBridge.listSessions()
                };

            case 'debug.session_get': {
                const sessionId = String(args.sessionId || '').trim();
                if (!sessionId) throw new Error('debug.session_get requires sessionId');
                const session = this.debugBridge.readSessionForDebugOutput(sessionId, {
                    includeFull: args.includeFull === true,
                    debugToken: typeof args.debugToken === 'string' ? args.debugToken : undefined,
                    messageLimit: Number(args.limit) || undefined
                });
                return {
                    success: !!session,
                    session
                };
            }

            case 'runtime.get_active_context':
                return await this.getActiveContext(args);

            case 'runtime.get_recent_task_trace':
                return this.getRecentTaskTrace(args);

            case 'scene.get_selected_element_context':
                return await this.getSelectedElementContext(args);

            case 'scene.get_selected_module_context':
                return await this.getSelectedModuleContext(args);

            case 'scene.get_selected_design_context':
                return await this.getSelectedDesignContext(args);

            case 'photoshop.connection_status':
                return {
                    success: true,
                    connected: this.wsServer.isPluginConnected(),
                    diagnostics: this.wsServer.getConnectionDiagnostics()
                };

            case 'photoshop.tools.list':
                return this.unwrapPhotoshopMcpPayload(await this.wsServer.getMCPTools());

            case 'photoshop.tools.call': {
                const toolName = String(args.name || '').trim();
                if (!toolName) throw new Error('photoshop.tools.call requires name');
                const toolArgs = asRecord(args.arguments);
                const requestKey = String(args.requestKey || '').trim();
                return this.unwrapPhotoshopMcpPayload(
                    await this.wsServer.callMCPTool(toolName, toolArgs, requestKey ? { requestKey } : {})
                );
            }

            case 'photoshop.tools.cancel': {
                const requestKey = String(args.requestKey || '').trim();
                if (!requestKey) throw new Error('photoshop.tools.cancel requires requestKey');
                const cancelled = this.wsServer.cancelRequestByKey(requestKey, 'mcp_tool_cancel');
                return {
                    success: true,
                    cancelled,
                    requestKey
                };
            }

            case 'photoshop.batch_policy': {
                const names = Array.isArray(args.names) ? args.names.map(item => String(item)) : [];
                return await this.getPhotoshopBatchPolicy(names);
            }

            case 'photoshop.tools.batch_call': {
                const calls = Array.isArray(args.calls) ? args.calls as PhotoshopBatchCallItem[] : [];
                if (!calls.length) throw new Error('photoshop.tools.batch_call requires calls');
                return await this.runPhotoshopBatch(calls, {
                    continueOnError: Boolean(args.continueOnError),
                    allowWrites: Boolean(args.allowWrites),
                    allowRisky: Boolean(args.allowRisky),
                    delayMs: typeof args.delayMs === 'number' ? Math.max(0, args.delayMs) : 150,
                    requestKey: typeof args.requestKey === 'string' ? args.requestKey : undefined
                });
            }

            case 'photoshop.acceptance_snapshot': {
                await this.ensurePhotoshopConnected();
                const normalizedArgs = {
                    includeHidden: typeof args.includeHidden === 'boolean' ? args.includeHidden : undefined,
                    includeBounds: typeof args.includeBounds === 'boolean' ? args.includeBounds : undefined,
                    includeText: typeof args.includeText === 'boolean' ? args.includeText : undefined,
                    maxLayers: typeof args.maxLayers === 'number' ? args.maxLayers : undefined
                };
                return this.unwrapPhotoshopMcpPayload(
                    await this.wsServer.callMCPTool('getAcceptanceSnapshot', normalizedArgs)
                );
            }

            case 'text.audit_replacement': {
                await this.ensurePhotoshopConnected();
                const normalizedArgs = {
                    layerId: typeof args.layerId === 'number' ? args.layerId : undefined,
                    proposedContent: typeof args.proposedContent === 'string' ? args.proposedContent : undefined,
                    baselineContent: typeof args.baselineContent === 'string' ? args.baselineContent : undefined
                };

                try {
                    return await this.wsServer.callMCPTool('auditTextReplacement', normalizedArgs);
                } catch (error: any) {
                    const message = String(error?.message || error || '');
                    if (!/Tool not found:\s*auditTextReplacement/i.test(message)) {
                        throw error;
                    }
                    return await this.fallbackAuditTextReplacement(normalizedArgs);
                }
            }

            case 'detail.get_template_graph':
                return await this.getDetailTemplateGraph(args);

            case 'detail.get_screen_plan':
                return await this.getDetailScreenPlan(args);

            case 'detail.audit_placement':
                return await this.auditDetailPlacement(args);

            case 'detail.audit_copy_layout':
                return await this.auditDetailCopyLayout(args);

            case 'detail.validate_template_graph':
                return await this.validateDetailTemplateGraph(args);

            case 'detail.inspect_live_placements':
                return await this.inspectDetailLivePlacements(args);

            case 'detail.inspect_visual_modules':
                return await this.inspectDetailVisualModules(args);

            case 'detail.inspect_screen_boundaries':
                return await this.inspectDetailScreenBoundaries(args);

            case 'detail.audit_segmentation_merge':
                return await this.auditDetailSegmentationMerge(args);

            case 'detail.capture_visual_context_bundle':
                return await this.captureDetailVisualContextBundle(args);

            case 'resource.get_project_root':
                return this.getResourceProjectRoot();

            case 'resource.list_project_resources':
                return await this.listProjectResources(args);

            case 'resource.search_project_resources':
                return await this.searchProjectResources(args);

            case 'resource.get_project_structure':
                return await this.getProjectResourceStructure(args);

            case 'resource.get_project_summary':
                return await this.getProjectResourceSummary(args);

            case 'resource.probe_image_file':
                return await this.probeProjectImageFile(args);

            case 'design_state.get':
                return await this.getDesignState(args);

            case 'design_state.update':
                return await this.updateDesignState(args);

            case 'knowledge.get_main_image_framework':
                return this.getMainImageFramework(args);

            case 'knowledge.get_detail_page_framework':
                return this.getDetailPageFramework(args);

            case 'knowledge.search_design':
                return await this.searchDesignKnowledge(args);

            case 'system.status':
                return await this.getSystemStatus();

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    private requireResourceManager(): ResourceManagerService {
        if (!this.resourceManagerService) {
            throw new Error('Resource manager service is not initialized.');
        }
        return this.resourceManagerService;
    }

    private getResourceProjectRoot(): unknown {
        const resourceManager = this.requireResourceManager();
        return {
            success: true,
            projectRoot: resourceManager.getProjectRoot() || null
        };
    }

    private async listProjectResources(args: Record<string, unknown>): Promise<unknown> {
        const resourceManager = this.requireResourceManager();
        const directory = typeof args.directory === 'string' && args.directory.trim()
            ? args.directory.trim()
            : undefined;
        return await resourceManager.scanDirectory(directory, {
            recursive: typeof args.recursive === 'boolean' ? args.recursive : undefined,
            includeDesignFiles: typeof args.includeDesignFiles === 'boolean' ? args.includeDesignFiles : undefined,
            maxDepth: typeof args.maxDepth === 'number' ? args.maxDepth : undefined,
            generateThumbnails: typeof args.generateThumbnails === 'boolean' ? args.generateThumbnails : undefined
        });
    }

    private async searchProjectResources(args: Record<string, unknown>): Promise<unknown> {
        const query = String(args.query || '').trim();
        if (!query) throw new Error('resource.search_project_resources requires query');
        const resourceManager = this.requireResourceManager();
        const type = typeof args.type === 'string' && ['image', 'design', 'all'].includes(args.type)
            ? args.type as 'image' | 'design' | 'all'
            : undefined;
        return await resourceManager.searchResources(query, {
            directory: typeof args.directory === 'string' && args.directory.trim() ? args.directory.trim() : undefined,
            type,
            limit: typeof args.limit === 'number' ? args.limit : undefined
        });
    }

    private async getProjectResourceStructure(args: Record<string, unknown>): Promise<unknown> {
        const resourceManager = this.requireResourceManager();
        return await resourceManager.getDirectoryStructure(
            typeof args.directory === 'string' && args.directory.trim() ? args.directory.trim() : undefined,
            typeof args.maxDepth === 'number' ? args.maxDepth : undefined
        );
    }

    private async getProjectResourceSummary(args: Record<string, unknown>): Promise<unknown> {
        const resourceManager = this.requireResourceManager();
        return await resourceManager.generateResourceSummary(
            typeof args.directory === 'string' && args.directory.trim() ? args.directory.trim() : undefined
        );
    }

    private async probeProjectImageFile(args: Record<string, unknown>): Promise<unknown> {
        const imagePath = String(args.imagePath || '').trim();
        if (!imagePath) throw new Error('resource.probe_image_file requires imagePath');
        const resourceManager = this.requireResourceManager();
        return await resourceManager.probeImageFile(imagePath);
    }

    private resolveProjectPath(args: Record<string, unknown>): string {
        const explicit = String(args.projectPath || '').trim();
        const fallback = this.resourceManagerService?.getProjectRoot?.() || '';
        const projectPath = explicit || fallback;
        if (!projectPath) {
            throw new Error('Project path is required. Provide projectPath or set an active project root.');
        }
        if (!fs.existsSync(projectPath)) {
            throw new Error(`Project path does not exist: ${projectPath}`);
        }
        return projectPath;
    }

    private async getDesignState(args: Record<string, unknown>): Promise<unknown> {
        const projectPath = this.resolveProjectPath(args);
        return {
            success: true,
            projectPath,
            state: await designProjectStateCoordinator.get(projectPath)
        };
    }

    private async updateDesignState(args: Record<string, unknown>): Promise<unknown> {
        const projectPath = this.resolveProjectPath(args);
        const patch = asRecord(args.patch) as DesignProjectStatePatch;
        if (!patch.set && !patch.upsertFacts && !patch.upsertRules && !patch.appendLearning && !patch.appendVersion) {
            throw new Error('design_state.update requires patch.set, patch.upsertFacts, patch.upsertRules, patch.appendLearning, or patch.appendVersion');
        }
        const next = await designProjectStateCoordinator.update(projectPath, {
            ...patch,
            reviewFacts: undefined,
            factWriteAuthority: 'agent_proposal',
            reviewRules: undefined,
            ruleWriteAuthority: 'agent_proposal'
        });
        return {
            success: true,
            projectPath,
            state: next
        };
    }

    private getMainImageFramework(args: Record<string, unknown>): unknown {
        const focus = MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES.includes(args.focus as any)
            ? args.focus as any
            : 'overview';
        return {
            success: true,
            focus,
            framework: buildMainImageFrameworkSummary(focus),
            availableFocus: MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES
        };
    }

    private getDetailPageFramework(args: Record<string, unknown>): unknown {
        const focus = DETAIL_PAGE_FRAMEWORK_FOCUS_VALUES.includes(args.focus as any)
            ? args.focus as any
            : 'overview';
        return {
            success: true,
            focus,
            framework: buildDetailPageFrameworkSummary(focus),
            availableFocus: DETAIL_PAGE_FRAMEWORK_FOCUS_VALUES
        };
    }

    private async searchDesignKnowledge(args: Record<string, unknown>): Promise<unknown> {
        const query = String(args.query || '').trim();
        if (!query) throw new Error('knowledge.search_design requires query');

        const settings = normalizeDesignKnowledgeSettings(asRecord(args.settings) as Partial<DesignKnowledgeRuntimeSettings>);
        const modelService = this.modelService;
        const result = await DesignKnowledgeSearchService.search({
            query,
            intents: normalizeDesignKnowledgeIntents(args.intents),
            sourceTypes: normalizeDesignKnowledgeSourceTypes(args.sourceTypes),
            limit: typeof args.limit === 'number' ? args.limit : undefined
        }, {
            searxng: toSearxngConnectorConfig(settings),
            xiaomiWebSearch: settings.xiaomiWebSearch.enabled && modelService
                ? async (q) => {
                    const response = await modelService.searchDesignWebViaXiaomi(q.query, {
                        limit: settings.xiaomiWebSearch.limit,
                        maxKeyword: settings.xiaomiWebSearch.maxKeyword,
                        forceSearch: settings.xiaomiWebSearch.forceSearch,
                        userLocation: settings.xiaomiWebSearch.userLocation
                    });
                    return {
                        available: response.available,
                        content: response.content,
                        citations: response.citations.map((citation) => ({
                            title: citation.title,
                            url: citation.url,
                            summary: citation.summary,
                            siteName: citation.siteName
                        })),
                        error: response.error
                    };
                }
                : undefined
        });

        return {
            success: true,
            resultCount: result.results.length,
            ...result
        };
    }

    private inferToolKind(toolName: string): 'read' | 'write' | 'export' {
        // V1-1（治理审计 2026-07-08）：读判定优先走权威分类源 photoshop-tool-skill，
        // 消除「靠工具名前缀猜只读」的漏判——非 get/list 前缀的只读工具
        // （extractShapePath / inspectDetailPageLivePlacements / sockLayoutConfig 等）此前落入
        // 默认 write 分支，被 runPhotoshopBatch 的 allowWrites 门禁误拦。read_only_observation 与
        // knowledge_search 都不写盘，一律判 read；读判定不再有第二套会漂移的名字规则。
        const skillKind = classifyPhotoshopToolSkillExecution(toolName);
        if (skillKind === 'read_only_observation' || skillKind === 'knowledge_search') return 'read';
        // skillKind==='unknown'（权威源未登记，如 findLayers）保留名字启发式兜底；
        // 写盘的 write/export 细分仍由下方规则决定（两者在 allowWrites 门禁下行为等价）。
        if (toolName === 'resolveFontName') return 'read';
        if (/^(get|list|analyze|diagnose|audit|parse|detect)/.test(toolName)) return 'read';
        if (/^export/.test(toolName)) {
            // 只读结果类 export*（如 exportLayerAsBase64 / exportColorConfig）不是写盘导出，
            // 不能被 runPhotoshopBatch 的 allowWrites 门禁误拦。以权威分类源 photoshop-tool-skill
            // 作为单一事实源判定，避免在此再维护一份会漂移的并行只读清单（治理审计 2026-07-08 V0-6）。
            if (classifyPhotoshopToolSkillExecution(toolName) === 'read_only_observation') return 'read';
            return 'export';
        }
        return 'write';
    }

    private inferPopupRisk(toolName: string): 'low' | 'modal-safe' | 'possible-dialog' {
        if (toolName === 'getSubjectBounds') return 'possible-dialog';
        if (HEAVY_IMAGE_READ_TOOLS.has(toolName)) return 'modal-safe';
        if (POSSIBLE_DIALOG_TOOLS.has(toolName)) return 'possible-dialog';
        const kind = this.inferToolKind(toolName);
        if (kind === 'read' && !BLOCKED_BATCH_TOOLS.has(toolName)) return 'low';
        return 'modal-safe';
    }

    private inferCategory(toolName: string): string {
        if (DOCUMENT_SCOPE_LAYOUT_TOOLS.has(toolName)) return 'layout';
        if (toolName === 'createDocument' || toolName === 'createRectangle' || toolName === 'createEllipse') return 'canvas';
        if (toolName === 'resolveFontName') return 'text';
        if (toolName === 'createTextLayer') return 'text';
        if (toolName === 'createGroup' || toolName === 'moveLayerToGroup' || toolName === 'exportGroup') return 'layout';
        if (toolName.includes('Text')) return 'text';
        if (toolName.includes('SmartObject')) return 'layer';
        if (toolName.startsWith('getDocument') || toolName.startsWith('listDocuments') || toolName === 'diagnoseState' || toolName.endsWith('Export') || toolName.includes('Snapshot')) return 'canvas';
        if (toolName.includes('Selection') || toolName.includes('Matting') || toolName.includes('Image') || toolName.includes('Background') || toolName.includes('harmonize') || toolName.includes('Subject')) return 'image';
        if (toolName === 'skuLayout' || toolName.includes('Sku') || toolName.includes('ColorConfig')) return 'sku';
    if (toolName === 'focusLayer') return 'layer';
    if (toolName.includes('Layer') || toolName.includes('ClippingMask')) return 'layer';
        if (toolName.includes('Shape') || toolName.includes('Morph') || toolName.includes('Warp') || toolName.includes('Displacement') || toolName.includes('Contour')) return 'morphing';
        if (toolName.includes('Template') || toolName.includes('DetailPage') || toolName.includes('Layout') || toolName.includes('align') || toolName.includes('group') || toolName.includes('rename') || toolName.includes('reorder') || toolName.includes('move') || toolName.includes('select')) return 'layout';
        return 'unknown';
    }

    private inferPreconditions(toolName: string, category: string): string {
        if (toolName === 'listDocuments') return 'None';
        if (toolName === 'createDocument') return 'Photoshop connected and valid width/height/resolution or a known preset';
        if (toolName === 'createRectangle') return 'Open document plus valid x/y/width/height and optional fill color';
        if (toolName === 'createEllipse') return 'Open document plus valid x/y/width/height and optional fill color';
        if (toolName === 'resolveFontName') return 'Photoshop connected; no open document required';
        if (toolName === 'createTextLayer') return 'Open document plus non-empty text content and valid x/y coordinates';
        if (toolName === 'createGroup') return 'Open document plus non-empty groupName and either layerIds, selected layers, or empty-group mode';
        if (toolName === 'moveLayerToGroup') return 'Open document plus source layerId and targetGroupId; targetGroupId must be a Photoshop group layer';
        if (toolName === 'exportGroup') return 'Open document plus groupPath or layerId and a full PNG outputPath';
        if (toolName === 'convertToSmartObject') {
            return 'Open document and either an active layer selection or explicit layerIds';
        }
        if (toolName === 'editSmartObjectContents') {
            return 'Open document and active Smart Object layer or explicit layerId';
        }
        if (toolName === 'replaceSmartObjectContents') {
            return 'Open document and active Smart Object layer or explicit layerId, plus a readable filePath';
        }
        if (toolName === 'updateSmartObject') {
            return 'Open document and active Smart Object layer or explicit layerId; optional filePath relinks contents';
        }
        if (toolName === 'replaceImagePlaceholder') {
            return 'Open document plus layerPath or explicit placeholderLayerId/targetLayerId, and imagePath or image payload';
        }
        if (toolName === 'batchExport') {
            return 'Open document plus outputDirectory and at least one preset with width or height greater than 0';
        }
        if (toolName === 'getSubjectBounds') {
            return 'Open document plus explicit layerId greater than 0; method must be alpha or smart; alpha scans alpha pixels and smart fails explicitly if subject selection cannot be created';
        }
        if (toolName === 'getMattingImage') {
            return 'Open document plus explicit layerId or active layer; maxSize must be greater than 0 and outputFormat must be jpeg or raw';
        }
        if (toolName === 'getOptimizedImage') {
            return 'Open document plus either explicit layerId, active layer, or document-wide/boundary mode; returns requestedBounds and actualBounds; validate maxSize, quality, includeAlpha, and boundary values';
        }
        if (toolName.includes('Selection')) return 'Open document and active selection';
        if (TEXT_DOC_ONLY_TOOLS.has(toolName)) return 'Open document';
        if (TEXT_LAYER_TOOLS.has(toolName)) {
            return 'Open document and active text layer or explicit text layer ID';
        }
        if (toolName.includes('Screen') || ['fillDetailPage', 'auditDetailPagePlacement', 'exportDetailPageSlices'].includes(toolName)) {
            return 'Open detail-page document and parsed screens from parseDetailPageTemplate';
        }
        if (toolName === 'getSmartObjectLayers') {
            return 'Open document and active Smart Object layer or explicit layerId; use autoOpen=false for disposable smoke';
        }
        if (toolName === 'duplicateSmartObject') {
            return 'Open document and active Smart Object layer or explicit layerId';
        }
        if (toolName === 'rasterizeSmartObject') {
            return 'Open document and active Smart Object layer or explicit layerId';
        }
        if (toolName.includes('SmartObject')) {
            return 'Open document and active Smart Object layer or explicit layer ID';
        }
        if (LAYER_TARGET_OPTIONAL_TOOLS.has(toolName)) {
            return 'Open document and active layer or explicit target layer ID';
        }
        if (DOCUMENT_SCOPE_LAYOUT_TOOLS.has(toolName)) {
            return 'Open document';
        }
        if (category === 'sku' || toolName === 'skuLayout') {
            return 'Open SKU/source document with expected placeholder or color-group structure';
        }
        if (category === 'layout') return 'Open document and valid target layer IDs or active layers';
        if (category === 'image') return 'Open document and valid image/layer context';
        if (category === 'layer') return 'Open document and valid target layer IDs or active layer';
        if (category === 'canvas') return 'Open document';
        if (category === 'morphing') return 'Open document and valid source/target shape or image layers';
        return 'Open document';
    }

    private inferAutoSmoke(toolName: string): 'safe' | 'conditional' | 'manual' | 'manual-risky' | 'blocked' {
        if (BLOCKED_BATCH_TOOLS.has(toolName)) return 'blocked';
        if (SAFE_BATCH_TOOLS.has(toolName)) return 'safe';
        if (HEAVY_IMAGE_READ_TOOLS.has(toolName)) return 'manual-risky';
        const kind = this.inferToolKind(toolName);
        const popupRisk = this.inferPopupRisk(toolName);
        if (kind !== 'read') {
            return popupRisk === 'possible-dialog' ? 'manual-risky' : 'manual';
        }
        return popupRisk === 'low' ? 'conditional' : 'manual-risky';
    }

    private inferExecutionLane(autoSmoke: 'safe' | 'conditional' | 'manual' | 'manual-risky' | 'blocked'): {
        lane: 'safe-read-batch' | 'conditional-read-batch' | 'isolated-write' | 'isolated-risky' | 'blocked';
        recommendedBatchSize: number;
        recommendedDelayMs: number;
    } {
        switch (autoSmoke) {
            case 'safe':
                return { lane: 'safe-read-batch', recommendedBatchSize: 3, recommendedDelayMs: 50 };
            case 'conditional':
                return { lane: 'conditional-read-batch', recommendedBatchSize: 2, recommendedDelayMs: 150 };
            case 'manual':
                return { lane: 'isolated-write', recommendedBatchSize: 1, recommendedDelayMs: 250 };
            case 'manual-risky':
                return { lane: 'isolated-risky', recommendedBatchSize: 1, recommendedDelayMs: 400 };
            case 'blocked':
            default:
                return { lane: 'blocked', recommendedBatchSize: 1, recommendedDelayMs: 500 };
        }
    }

    private inferManualValidationMode(toolName: string, autoSmoke: 'safe' | 'conditional' | 'manual' | 'manual-risky' | 'blocked'): 'not-required' | 'interactive-or-scripted' | 'disposable-smoke' | 'interactive-only' {
        if (autoSmoke === 'manual-risky') {
            if (['getSmartObjectInfo', 'getSmartObjectLayers'].includes(toolName)) {
                return 'disposable-smoke';
            }
            if (HEAVY_IMAGE_READ_TOOLS.has(toolName)) {
                return 'disposable-smoke';
            }
            if (['createDocument', 'createRectangle', 'createEllipse', 'createTextLayer', 'createGroup'].includes(toolName)) {
                return 'disposable-smoke';
            }
            if (['addDropShadow', 'addGlow', 'addGradientOverlay', 'addStroke', 'clearLayerEffects', 'setLayerFill'].includes(toolName)) {
                return 'disposable-smoke';
            }
            if (['replaceImagePlaceholder', 'batchExport'].includes(toolName)) {
                return 'disposable-smoke';
            }
            return 'interactive-only';
        }
        if (toolName === 'convertToSmartObject') {
            return 'disposable-smoke';
        }
        if (autoSmoke === 'manual') {
            return 'interactive-or-scripted';
        }
        return 'not-required';
    }

    private buildToolPolicy(toolName: string): Record<string, unknown> {
        const category = this.inferCategory(toolName);
        const autoSmoke = this.inferAutoSmoke(toolName);
        const executionLane = this.inferExecutionLane(autoSmoke);
        return {
            name: toolName,
            category,
            kind: this.inferToolKind(toolName),
            popupRisk: this.inferPopupRisk(toolName),
            autoSmoke,
            preconditions: this.inferPreconditions(toolName, category),
            blockedReason: BLOCKED_BATCH_TOOLS.get(toolName) || null,
            manualValidationMode: this.inferManualValidationMode(toolName, autoSmoke),
            executionLane
        };
    }

    private async getPhotoshopBatchPolicy(names: string[]): Promise<unknown> {
        const connected = this.wsServer.isPluginConnected();
        let runtimeNames: string[] = [];

        if (connected) {
            const runtime = this.unwrapPhotoshopMcpPayload(await this.wsServer.getMCPTools());
            const runtimeTools = Array.isArray(runtime?.tools) ? runtime.tools : [];
            runtimeNames = runtimeTools.map((tool: any) => String(tool.name));
        } else if (!names.length) {
            return {
                success: false,
                connected: false,
                error: 'Photoshop UXP plugin is not connected; provide tool names to compute static batch policy.'
            };
        }

        const targetNames = names.length ? names : runtimeNames;
        const policies = targetNames.map(name => this.buildToolPolicy(name));
        const summary = policies.reduce((acc: Record<string, number>, item: any) => {
            const key = String(item.autoSmoke);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        return {
            success: true,
            connected,
            source: connected ? 'runtime' : 'static-input',
            policies,
            summary,
            recommendations: {
                executeSerially: true,
                stopOnDisconnect: true,
                preflightBeforeEach: true,
                keepSafeReadBatchesSmall: 3,
                avoidMixingReadAndWrite: true
            }
        };
    }

    private async runPhotoshopBatch(
        calls: PhotoshopBatchCallItem[],
        options: { continueOnError: boolean; allowWrites: boolean; allowRisky: boolean; delayMs: number; requestKey?: string }
    ): Promise<unknown> {
        await this.ensurePhotoshopConnected();
        const results: any[] = [];
        const warnings: string[] = [];
        let sharedDiagnoseState: unknown | undefined;

        for (const call of calls) {
            const toolName = String(call?.name || '').trim();
            if (!toolName) {
                const message = 'Encountered batch item with empty tool name';
                if (!options.continueOnError) throw new Error(message);
                results.push({ name: toolName, success: false, error: message, stage: 'validation' });
                continue;
            }

            const policy = this.buildToolPolicy(toolName) as any;

            if (policy.autoSmoke === 'blocked') {
                const message = `Blocked from unattended batch execution: ${policy.blockedReason}`;
                if (!options.allowRisky) {
                    if (!options.continueOnError) throw new Error(`${toolName}: ${message}`);
                    results.push({ name: toolName, success: false, error: message, stage: 'policy', policy });
                    continue;
                }
                warnings.push(`${toolName}: ${message}`);
            }

            if ((policy.kind === 'write' || policy.kind === 'export') && !options.allowWrites) {
                const message = 'Write/export tool requires allowWrites=true';
                if (!options.continueOnError) throw new Error(`${toolName}: ${message}`);
                results.push({ name: toolName, success: false, error: message, stage: 'policy', policy });
                continue;
            }

            if (policy.autoSmoke === 'manual-risky' && !options.allowRisky) {
                const message = 'Tool is classified as manual-risky; rerun with allowRisky=true to include it';
                if (!options.continueOnError) throw new Error(`${toolName}: ${message}`);
                results.push({ name: toolName, success: false, error: message, stage: 'policy', policy });
                continue;
            }

            if (!this.wsServer.isPluginConnected()) {
                const message = 'Photoshop plugin disconnected before batch step';
                if (!options.continueOnError) throw new Error(`${toolName}: ${message}`);
                results.push({ name: toolName, success: false, error: message, stage: 'preflight', policy });
                break;
            }

            const toolArgs = asRecord(call.arguments);
            const canReuseDiagnoseState =
                policy.kind === 'read' &&
                policy.executionLane?.lane !== 'isolated-risky' &&
                !toolName.includes('Selection');
            const preflight = await this.evaluateBatchPreconditions(
                toolName,
                toolArgs,
                canReuseDiagnoseState ? sharedDiagnoseState : undefined
            );
            if (canReuseDiagnoseState && preflight.state !== undefined) {
                sharedDiagnoseState = {
                    success: true,
                    state: preflight.state
                };
            }
            if (!preflight.ok) {
                const message = preflight.messages.join(' | ') || 'Preflight checks failed';
                if (!options.continueOnError) throw new Error(`${toolName}: ${message}`);
                results.push({
                    name: toolName,
                    success: false,
                    error: message,
                    stage: 'preflight',
                    policy,
                    preflight
                });
                continue;
            }

            try {
                const payload = this.unwrapPhotoshopMcpPayload(
                    await this.wsServer.callMCPTool(toolName, toolArgs, options.requestKey ? { requestKey: options.requestKey } : {})
                );
                results.push({ name: toolName, success: true, result: payload, policy, preflight });
                if (policy.kind !== 'read') {
                    sharedDiagnoseState = undefined;
                }
            } catch (error: any) {
                const message = error?.message || String(error);
                results.push({ name: toolName, success: false, error: message, stage: 'execution', policy, preflight });
                if (policy.kind !== 'read') {
                    sharedDiagnoseState = undefined;
                }
                if (isCancellationErrorMessage(message)) {
                    throw error;
                }
                if (!options.continueOnError) break;
            }

            if (options.delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, options.delayMs));
            }
        }

        return {
            success: results.every(item => item.success),
            warnings,
            results,
            summary: {
                total: calls.length,
                succeeded: results.filter(item => item.success).length,
                failed: results.filter(item => !item.success).length
            }
        };
    }

    private async evaluateBatchPreconditions(
        toolName: string,
        toolArgs: Record<string, unknown>,
        diagnoseSnapshot?: unknown
    ): Promise<{ ok: boolean; messages: string[]; state?: unknown }> {
        const messages: string[] = [];

        if (toolName === 'listDocuments' || toolName === 'diagnoseState') {
            return { ok: true, messages: [] };
        }

        if (CREATE_DOCUMENT_TOOLS.has(toolName)) {
            if (toolArgs.width !== undefined && !isPositiveNumber(toolArgs.width)) {
                messages.push('createDocument width must be greater than 0');
            }
            if (toolArgs.height !== undefined && !isPositiveNumber(toolArgs.height)) {
                messages.push('createDocument height must be greater than 0');
            }
            if (toolArgs.resolution !== undefined && !isPositiveNumber(toolArgs.resolution)) {
                messages.push('createDocument resolution must be greater than 0');
            }
            if (toolArgs.name !== undefined && !isNonEmptyString(toolArgs.name)) {
                messages.push('createDocument name must be a non-empty string');
            }
            if (toolArgs.preset !== undefined && !isNonEmptyString(toolArgs.preset)) {
                messages.push('createDocument preset must be a non-empty string');
            }
            if (toolArgs.backgroundColor !== undefined && !['white', 'black', 'transparent'].includes(String(toolArgs.backgroundColor))) {
                messages.push('createDocument backgroundColor must be one of: white, black, transparent');
            }
            if (toolArgs.colorMode !== undefined && !['RGB', 'CMYK', 'Grayscale'].includes(String(toolArgs.colorMode))) {
                messages.push('createDocument colorMode must be one of: RGB, CMYK, Grayscale');
            }

            return {
                ok: messages.length === 0,
                messages
            };
        }

        const rawDiagnose = diagnoseSnapshot !== undefined
            ? diagnoseSnapshot
            : this.unwrapPhotoshopMcpPayload(
                await this.wsServer.callMCPTool('diagnoseState', { verbose: false })
            );

        const snapshotRecord = asRecord(rawDiagnose);
        const hasDiagnoseEnvelope = hasOwn(snapshotRecord, 'success') || hasOwn(snapshotRecord, 'state');
        const diagnose = hasDiagnoseEnvelope
            ? snapshotRecord
            : { success: true, state: snapshotRecord };

        if (diagnose.success !== true) {
            return {
                ok: false,
                messages: [String(diagnose.error || 'Unable to read Photoshop runtime state')],
                state: diagnoseSnapshot !== undefined ? snapshotRecord : diagnose
            };
        }

        const state = asRecord(diagnose.state);
        const hasDocument = state.hasDocument === true;
        const hasSelection = state.hasSelection === true;
        const selectedLayers = Array.isArray(state.selectedLayers) ? state.selectedLayers : [];
        const hasActiveLayer = selectedLayers.length > 0;
        const activeLayer = selectedLayers[0] && typeof selectedLayers[0] === 'object' ? asRecord(selectedLayers[0]) : {};
        const activeLayerKind = String(activeLayer.kind || '').toLowerCase();
        const selectedLayerById = (layerId: unknown): Record<string, unknown> => {
            if (typeof layerId !== 'number') return {};
            const matched = selectedLayers.find(layer => {
                const candidate = asRecord(layer);
                return candidate.id === layerId;
            });
            return matched && typeof matched === 'object' ? asRecord(matched) : {};
        };

        if (!hasDocument) {
            messages.push('No active Photoshop document');
        }

        if (toolName.includes('Selection') && !hasSelection) {
            messages.push('This tool requires an active selection');
        }

        const toolCategory = this.inferCategory(toolName);
        const explicitLayerId =
            hasOwn(toolArgs, 'layerId') ||
            hasOwn(toolArgs, 'targetLayerId') ||
            hasOwn(toolArgs, 'referenceLayerId') ||
            hasOwn(toolArgs, 'sourceLayerId') ||
            hasOwn(toolArgs, 'placeholderLayerId') ||
            hasOwn(toolArgs, 'textLayerId') ||
            hasOwn(toolArgs, 'smartObjectLayerId') ||
            hasOwn(toolArgs, 'layerIds') ||
            hasOwn(toolArgs, 'targetLayerIds');

        if (TEXT_LAYER_TOOLS.has(toolName) && !explicitLayerId) {
            if (!activeLayerKind.includes('text')) {
                messages.push('This text tool needs an active text layer or explicit layerId');
            }
        }

        if (LAYER_TARGET_OPTIONAL_TOOLS.has(toolName) && !explicitLayerId && !hasActiveLayer) {
            messages.push('This tool needs an active layer or explicit target layer ID');
        }

        if (toolName.includes('SmartObject') && !explicitLayerId) {
            if (!activeLayerKind.includes('smart')) {
                messages.push('This Smart Object tool needs an active Smart Object layer or explicit layerId');
            }
        }
        if (toolName === 'getSmartObjectInfo' || toolName === 'getSmartObjectLayers') {
            if (toolArgs.layerId !== undefined && !isPositiveNumber(toolArgs.layerId)) {
                messages.push(`${toolName} layerId must be greater than 0`);
            }
            if (toolName === 'getSmartObjectLayers' && toolArgs.autoOpen !== undefined && typeof toolArgs.autoOpen !== 'boolean') {
                messages.push('getSmartObjectLayers autoOpen must be a boolean');
            }
        }
        if (toolName === 'convertToSmartObject') {
            if (toolArgs.layerIds !== undefined && !isStringArrayOfNumbers(toolArgs.layerIds)) {
                messages.push('convertToSmartObject layerIds must be a non-empty array of numeric layer IDs');
            }
            if (toolArgs.name !== undefined && !isNonEmptyString(toolArgs.name)) {
                messages.push('convertToSmartObject name must be a non-empty string');
            }
            const validLayerIds = isStringArrayOfNumbers(toolArgs.layerIds);
            if (!validLayerIds && !hasActiveLayer) {
                messages.push('convertToSmartObject needs active layers or explicit layerIds');
            }
        }
        if (toolName === 'editSmartObjectContents' || toolName === 'duplicateSmartObject' || toolName === 'rasterizeSmartObject') {
            if (toolArgs.layerId !== undefined && !isPositiveNumber(toolArgs.layerId)) {
                messages.push(`${toolName} layerId must be greater than 0`);
            }
        }
        if (toolName === 'replaceSmartObjectContents') {
            if (toolArgs.layerId !== undefined && !isPositiveNumber(toolArgs.layerId)) {
                messages.push('replaceSmartObjectContents layerId must be greater than 0');
            }
            if (!isNonEmptyString(toolArgs.filePath)) {
                messages.push('replaceSmartObjectContents requires a non-empty filePath');
            } else if (!fs.existsSync(String(toolArgs.filePath))) {
                messages.push('replaceSmartObjectContents filePath must point to an existing file');
            }
        }
        if (toolName === 'updateSmartObject') {
            if (toolArgs.layerId !== undefined && !isPositiveNumber(toolArgs.layerId)) {
                messages.push('updateSmartObject layerId must be greater than 0');
            }
            if (toolArgs.filePath !== undefined && !isNonEmptyString(toolArgs.filePath)) {
                messages.push('updateSmartObject filePath must be a non-empty string');
            } else if (isNonEmptyString(toolArgs.filePath) && !fs.existsSync(String(toolArgs.filePath))) {
                messages.push('updateSmartObject filePath must point to an existing file');
            }
        }

        if (toolName === 'getSubjectBounds') {
            if (!isPositiveNumber(toolArgs.layerId)) {
                messages.push('getSubjectBounds requires layerId greater than 0');
            }
            if (toolArgs.method !== undefined && !['alpha', 'smart'].includes(String(toolArgs.method))) {
                messages.push('getSubjectBounds method must be one of: alpha, smart');
            }
        }

        if (toolName === 'getMattingImage') {
            if (toolArgs.layerId !== undefined && !isPositiveNumber(toolArgs.layerId)) {
                messages.push('getMattingImage layerId must be greater than 0');
            }
            if (toolArgs.maxSize !== undefined && !isPositiveNumber(toolArgs.maxSize)) {
                messages.push('getMattingImage maxSize must be greater than 0');
            }
            if (toolArgs.maxSize !== undefined && isPositiveNumber(toolArgs.maxSize) && Number(toolArgs.maxSize) > 4096) {
                messages.push('getMattingImage maxSize must be 4096 or smaller');
            }
            if (toolArgs.outputFormat !== undefined && !['jpeg', 'raw'].includes(String(toolArgs.outputFormat))) {
                messages.push('getMattingImage outputFormat must be one of: jpeg, raw');
            }
            if (toolArgs.layerId === undefined && !hasActiveLayer) {
                messages.push('getMattingImage requires an active layer or explicit layerId');
            }
        }

        if (toolName === 'getOptimizedImage') {
            if (toolArgs.documentId !== undefined && !isPositiveNumber(toolArgs.documentId)) {
                messages.push('getOptimizedImage documentId must be greater than 0');
            }
            if (toolArgs.layerId !== undefined && !isPositiveNumber(toolArgs.layerId)) {
                messages.push('getOptimizedImage layerId must be greater than 0');
            }
            if (toolArgs.maxSize !== undefined && !isPositiveNumber(toolArgs.maxSize)) {
                messages.push('getOptimizedImage maxSize must be greater than 0');
            }
            if (toolArgs.maxSize !== undefined && isPositiveNumber(toolArgs.maxSize) && Number(toolArgs.maxSize) > 4096) {
                messages.push('getOptimizedImage maxSize must be 4096 or smaller');
            }
            if (toolArgs.quality !== undefined && (!isPositiveNumber(toolArgs.quality) || Number(toolArgs.quality) > 100)) {
                messages.push('getOptimizedImage quality must be between 1 and 100');
            }
            if (toolArgs.includeAlpha !== undefined && typeof toolArgs.includeAlpha !== 'boolean') {
                messages.push('getOptimizedImage includeAlpha must be a boolean');
            }
            if (toolArgs.boundary !== undefined) {
                const boundary = asRecord(toolArgs.boundary);
                const left = boundary.left;
                const top = boundary.top;
                const right = boundary.right;
                const bottom = boundary.bottom;
                if (![left, top, right, bottom].every(isNumeric)) {
                    messages.push('getOptimizedImage boundary must define numeric left, top, right, and bottom');
                } else {
                    if (Number(right) <= Number(left)) {
                        messages.push('getOptimizedImage boundary right must be greater than left');
                    }
                    if (Number(bottom) <= Number(top)) {
                        messages.push('getOptimizedImage boundary bottom must be greater than top');
                    }
                }
            }
        }

        if (HEAVY_IMAGE_READ_TOOLS.has(toolName)) {
            return {
                ok: messages.length === 0,
                messages,
                state: diagnose
            };
        }

        if (toolCategory === 'image' && !toolName.includes('Selection')) {
            const hasImageContext =
                explicitLayerId ||
                hasActiveLayer ||
                typeof toolArgs.image === 'string' ||
                typeof toolArgs.imagePath === 'string' ||
                typeof toolArgs.imageBase64 === 'string';
            if (!hasImageContext) {
                messages.push('This image tool needs an active layer, explicit layer ID, or image input');
            }
        }

        if (['fillDetailPage', 'auditDetailPagePlacement', 'exportDetailPageSlices', 'getScreenSnapshots', 'getScreenSnapshotsWithOverlay'].includes(toolName)) {
            const hasScreens =
                (Array.isArray(toolArgs.screens) && toolArgs.screens.length > 0) ||
                (Array.isArray(toolArgs.screenBounds) && toolArgs.screenBounds.length > 0) ||
                (Array.isArray(toolArgs.screenRects) && toolArgs.screenRects.length > 0);

            if (!hasScreens) {
                messages.push('This detail-page tool requires parsed screen context');
            }
        }

        if (toolName === 'replaceImagePlaceholder') {
            const hasPlaceholder =
                isNonEmptyString(toolArgs.layerPath) ||
                typeof toolArgs.placeholderLayerId === 'number' ||
                typeof toolArgs.targetLayerId === 'number';
            const hasReplacementImage =
                typeof toolArgs.imagePath === 'string' ||
                typeof toolArgs.imageBase64 === 'string' ||
                typeof toolArgs.image === 'string';
            if (!hasPlaceholder) {
                messages.push('replaceImagePlaceholder requires layerPath, placeholderLayerId, or targetLayerId');
            }
            if (!hasReplacementImage) {
                messages.push('replaceImagePlaceholder requires an imagePath, imageBase64, or image payload');
            }
            if (toolArgs.layerPath !== undefined && !isNonEmptyString(toolArgs.layerPath)) {
                messages.push('replaceImagePlaceholder layerPath must be a non-empty string');
            }
            if (toolArgs.imagePath !== undefined && !isNonEmptyString(toolArgs.imagePath)) {
                messages.push('replaceImagePlaceholder imagePath must be a non-empty string');
            }
            if (isNonEmptyString(toolArgs.imagePath) && !(await isReadableImageFile(String(toolArgs.imagePath)))) {
                messages.push('replaceImagePlaceholder imagePath must point to a readable image file');
            }
            if (toolArgs.imageBase64 !== undefined && !isNonEmptyString(toolArgs.imageBase64)) {
                messages.push('replaceImagePlaceholder imageBase64 must be a non-empty string');
            }
            if (toolArgs.image !== undefined && !isNonEmptyString(toolArgs.image)) {
                messages.push('replaceImagePlaceholder image must be a non-empty string');
            }
            if (toolArgs.fit !== undefined && !['contain', 'cover', 'fill', 'none'].includes(String(toolArgs.fit))) {
                messages.push('replaceImagePlaceholder fit must be one of: contain, cover, fill, none');
            }
            if (toolArgs.align !== undefined && !['center', 'top', 'bottom', 'left', 'right'].includes(String(toolArgs.align))) {
                messages.push('replaceImagePlaceholder align must be one of: center, top, bottom, left, right');
            }
            if (toolArgs.targetBounds !== undefined) {
                const targetBounds = asRecord(toolArgs.targetBounds);
                const left = targetBounds.left;
                const top = targetBounds.top;
                const right = targetBounds.right;
                const bottom = targetBounds.bottom;
                if (![left, top, right, bottom].every(isNumeric)) {
                    messages.push('replaceImagePlaceholder targetBounds must define numeric left, top, right, and bottom');
                } else {
                    if (Number(right) <= Number(left)) {
                        messages.push('replaceImagePlaceholder targetBounds right must be greater than left');
                    }
                    if (Number(bottom) <= Number(top)) {
                        messages.push('replaceImagePlaceholder targetBounds bottom must be greater than top');
                    }
                }
            }
            if (toolArgs.placementTransform !== undefined) {
                const transform = asRecord(toolArgs.placementTransform);
                for (const boxName of ['destinationBox', 'visibleBox']) {
                    if (transform[boxName] === undefined) continue;
                    const box = asRecord(transform[boxName]);
                    const x = box.x;
                    const y = box.y;
                    const width = box.width;
                    const height = box.height;
                    if (![x, y, width, height].every(isNumeric)) {
                        messages.push(`replaceImagePlaceholder placementTransform.${boxName} must define numeric x, y, width, and height`);
                        continue;
                    }
                    if (Number(width) <= 0 || Number(height) <= 0) {
                        messages.push(`replaceImagePlaceholder placementTransform.${boxName} width and height must be greater than 0`);
                    }
                }
            }
            if (toolArgs.smartScalingDecision !== undefined) {
                const decision = asRecord(toolArgs.smartScalingDecision);
                if (decision.destinationBox !== undefined) {
                    const box = asRecord(decision.destinationBox);
                    const x = box.x;
                    const y = box.y;
                    const width = box.width;
                    const height = box.height;
                    if (![x, y, width, height].every(isNumeric)) {
                        messages.push('replaceImagePlaceholder smartScalingDecision.destinationBox must define numeric x, y, width, and height');
                    } else if (Number(width) <= 0 || Number(height) <= 0) {
                        messages.push('replaceImagePlaceholder smartScalingDecision.destinationBox width and height must be greater than 0');
                    }
                }
                if (decision.confidence !== undefined && !isNumeric(decision.confidence)) {
                    messages.push('replaceImagePlaceholder smartScalingDecision.confidence must be numeric when provided');
                }
            }
        }

        if (toolName === 'batchExport') {
            if (!isNonEmptyString(toolArgs.outputDirectory)) {
                messages.push('batchExport requires a non-empty outputDirectory');
            }
            if (toolArgs.format !== undefined && !['png', 'jpeg', 'jpg'].includes(String(toolArgs.format).toLowerCase())) {
                messages.push('batchExport format must be one of: png, jpeg, jpg');
            }
            if (toolArgs.quality !== undefined && !isPositiveNumber(toolArgs.quality)) {
                messages.push('batchExport quality must be greater than 0');
            }
            if (Array.isArray(toolArgs.presets)) {
                if (toolArgs.presets.length === 0) {
                    messages.push('batchExport requires at least one preset');
                }
                toolArgs.presets.forEach((preset, index) => {
                    const normalizedPreset = asRecord(preset);
                    const width = normalizedPreset.width;
                    const height = normalizedPreset.height;
                    if (width !== undefined && !isNonNegativeNumber(width)) {
                        messages.push(`batchExport preset[${index}] width must be a non-negative number`);
                    }
                    if (height !== undefined && !isNonNegativeNumber(height)) {
                        messages.push(`batchExport preset[${index}] height must be a non-negative number`);
                    }
                    const validWidth = typeof width === 'number' && Number.isFinite(width) && width > 0;
                    const validHeight = typeof height === 'number' && Number.isFinite(height) && height > 0;
                    if (!validWidth && !validHeight) {
                        messages.push(`batchExport preset[${index}] must define width or height greater than 0`);
                    }
                    if (!isNonEmptyString(normalizedPreset.suffix)) {
                        messages.push(`batchExport preset[${index}] requires a non-empty suffix`);
                    }
                });
            }
        }

        if (toolName === 'createRectangle' || toolName === 'createEllipse') {
            if (!isNumeric(toolArgs.x) || !isNumeric(toolArgs.y)) {
                messages.push(`${toolName} requires numeric x and y`);
            }
            if (!isPositiveNumber(toolArgs.width) || !isPositiveNumber(toolArgs.height)) {
                messages.push(`${toolName} requires width and height greater than 0`);
            }
            if (toolArgs.name !== undefined && !isNonEmptyString(toolArgs.name)) {
                messages.push(`${toolName} name must be a non-empty string`);
            }
            if (toolArgs.fillColorHex !== undefined && !isHexColor(toolArgs.fillColorHex)) {
                messages.push(`${toolName} fillColorHex must be a valid 6-digit hex color`);
            }
            if (toolArgs.color !== undefined && !hasRgbColor(toolArgs.color)) {
                messages.push(`${toolName} color must be a complete RGB object`);
            }
            if (toolName === 'createRectangle' && toolArgs.cornerRadius !== undefined && !isNonNegativeNumber(toolArgs.cornerRadius)) {
                messages.push('createRectangle cornerRadius must be a non-negative number');
            }
        }

        if (toolName === 'createTextLayer') {
            const content = toolArgs.content ?? toolArgs.text;
            if (!isNonEmptyString(content)) {
                messages.push('createTextLayer requires non-empty content or text');
            }
            if (!isNumeric(toolArgs.x) || !isNumeric(toolArgs.y)) {
                messages.push('createTextLayer requires numeric x and y');
            }
            if (toolArgs.name !== undefined && !isNonEmptyString(toolArgs.name)) {
                messages.push('createTextLayer name must be a non-empty string');
            }
            if (toolArgs.fontSize !== undefined && !isPositiveNumber(toolArgs.fontSize)) {
                messages.push('createTextLayer fontSize must be greater than 0');
            }
            if (toolArgs.fontName !== undefined && !isNonEmptyString(toolArgs.fontName)) {
                messages.push('createTextLayer fontName must be a non-empty string');
            }
            if (toolArgs.tracking !== undefined && !isNumeric(toolArgs.tracking)) {
                messages.push('createTextLayer tracking must be numeric');
            }
            if (toolArgs.leading !== undefined && !isPositiveNumber(toolArgs.leading)) {
                messages.push('createTextLayer leading must be greater than 0');
            }
            if (toolArgs.colorHex !== undefined && !isHexColor(toolArgs.colorHex)) {
                messages.push('createTextLayer colorHex must be a valid 6-digit hex color');
            }
            if (toolArgs.color !== undefined && !hasRgbColor(toolArgs.color)) {
                messages.push('createTextLayer color must be a complete RGB object');
            }
            if (toolArgs.alignment !== undefined && !isAlignmentValue(toolArgs.alignment)) {
                messages.push('createTextLayer alignment must be one of: left, center, right');
            }
        }

        if (toolName === 'createGroup') {
            const hasLayerIds = isStringArrayOfNumbers(toolArgs.layerIds);
            const fromSelected = toolArgs.fromSelected === true;
            if (!isNonEmptyString(toolArgs.groupName)) {
                messages.push('createGroup requires a non-empty groupName');
            }
            if (toolArgs.layerIds !== undefined && !hasLayerIds) {
                messages.push('createGroup layerIds must be a non-empty array of numeric layer IDs');
            }
            if (!hasLayerIds && fromSelected && !hasActiveLayer) {
                messages.push('createGroup with fromSelected=true requires selected layers');
            }
        }

        if (toolName === 'moveLayerToGroup') {
            if (!isPositiveNumber(toolArgs.layerId)) {
                messages.push('moveLayerToGroup requires layerId greater than 0');
            }
            if (!isPositiveNumber(toolArgs.targetGroupId)) {
                messages.push('moveLayerToGroup requires targetGroupId greater than 0');
            }
            if (toolArgs.position !== undefined && !['inside', 'inside-top', 'inside-bottom'].includes(String(toolArgs.position))) {
                messages.push('moveLayerToGroup position must be one of: inside, inside-top, inside-bottom');
            }
        }

        if (toolName === 'exportGroup') {
            const hasGroupPath = Array.isArray(toolArgs.groupPath)
                ? toolArgs.groupPath.some(isNonEmptyString)
                : isNonEmptyString(toolArgs.groupPath);
            if (!hasGroupPath && !isPositiveNumber(toolArgs.layerId)) {
                messages.push('exportGroup requires groupPath or layerId');
            }
            if (!isNonEmptyString(toolArgs.outputPath)) {
                messages.push('exportGroup requires a full outputPath');
            }
            if (toolArgs.format !== undefined && String(toolArgs.format) !== 'png') {
                messages.push('exportGroup format must be png');
            }
        }

        if (EFFECT_PARAMETER_TOOLS.has(toolName)) {
            const targetLayerId =
                typeof toolArgs.layerId === 'number' ? toolArgs.layerId :
                typeof toolArgs.targetLayerId === 'number' ? toolArgs.targetLayerId :
                undefined;
            const targetLayer = Object.keys(selectedLayerById(targetLayerId)).length > 0
                ? selectedLayerById(targetLayerId)
                : activeLayer;
            const targetLayerKind = describeLayerKind(targetLayer.kind);
            const locked = targetLayer.locked === true;

            if (!explicitLayerId && !hasActiveLayer) {
                messages.push(`${toolName} requires an active layer or explicit layerId`);
            }

            if ((explicitLayerId || hasActiveLayer) && locked) {
                messages.push(`Locked layers are not supported for ${toolName}`);
            }

            if (toolName === 'addDropShadow' || toolName === 'addGlow') {
                if (toolArgs.opacity !== undefined && !isPercent(toolArgs.opacity)) {
                    messages.push(`${toolName} opacity must be between 0 and 100`);
                }
                if (toolArgs.size !== undefined && !isNonNegativeNumber(toolArgs.size)) {
                    messages.push(`${toolName} size must be a non-negative number`);
                }
                if (toolArgs.distance !== undefined && !isNonNegativeNumber(toolArgs.distance)) {
                    messages.push(`${toolName} distance must be a non-negative number`);
                }
                if (toolArgs.spread !== undefined && !isPercent(toolArgs.spread)) {
                    messages.push(`${toolName} spread must be between 0 and 100`);
                }
                if (toolArgs.angle !== undefined && !isNumeric(toolArgs.angle)) {
                    messages.push(`${toolName} angle must be a number`);
                }
                if (toolArgs.color !== undefined && !hasRgbColor(toolArgs.color)) {
                    messages.push(`${toolName} color must be a complete RGB object`);
                }
            }

            if (toolName === 'addStroke') {
                if (toolArgs.size !== undefined && !(typeof toolArgs.size === 'number' && Number.isFinite(toolArgs.size) && toolArgs.size > 0)) {
                    messages.push('addStroke size must be greater than 0');
                }
                if (toolArgs.position !== undefined && !['outside', 'inside', 'center'].includes(String(toolArgs.position))) {
                    messages.push('addStroke position must be one of: outside, inside, center');
                }
                if (toolArgs.opacity !== undefined && !isPercent(toolArgs.opacity)) {
                    messages.push('addStroke opacity must be between 0 and 100');
                }
                if (toolArgs.color !== undefined && !hasRgbColor(toolArgs.color)) {
                    messages.push('addStroke color must be a complete RGB object');
                }
            }

            if (toolName === 'addGradientOverlay') {
                if (!hasRgbColor(toolArgs.startColor)) {
                    messages.push('addGradientOverlay requires a valid startColor RGB object');
                }
                if (!hasRgbColor(toolArgs.endColor)) {
                    messages.push('addGradientOverlay requires a valid endColor RGB object');
                }
                if (toolArgs.angle !== undefined && !isNumeric(toolArgs.angle)) {
                    messages.push('addGradientOverlay angle must be a number');
                }
                if (toolArgs.opacity !== undefined && !isPercent(toolArgs.opacity)) {
                    messages.push('addGradientOverlay opacity must be between 0 and 100');
                }
            }

            if (toolName === 'setLayerFill') {
                if (!hasRgbColor(toolArgs.color)) {
                    messages.push('setLayerFill requires a valid RGB color payload');
                }
                if ((explicitLayerId || hasActiveLayer) && targetLayerKind && !isLikelyShapeLayer(targetLayerKind)) {
                    messages.push('setLayerFill only supports shape or fill-capable layers');
                }
            }
        }

        return {
            ok: messages.length === 0,
            messages,
            state
        };
    }

    private async getDetailTemplateGraph(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.ensurePhotoshopConnected();

        const parseResult = this.unwrapPhotoshopMcpPayload(await this.wsServer.callMCPTool('parseDetailPageTemplate', {
            includeStructure: args.includeStructure !== false
        })) as Record<string, unknown>;

        if (parseResult?.success !== true) {
            return parseResult;
        }

        return {
            ...parseResult,
            success: true,
            screens: Array.isArray(parseResult.screens) ? parseResult.screens : [],
            issues: Array.isArray(parseResult.issues) ? parseResult.issues : [],
            crossScreenLayers: Array.isArray(parseResult.crossScreenLayers) ? parseResult.crossScreenLayers : []
        };
    }

    private async getDetailScreenPlan(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).screenPlans)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;

        return {
            success: true,
            screens: typedContext.screens,
            screenPlans: typedContext.screenPlans,
            screenRoles: typedContext.screenPlans.map((plan) => ({
                screenId: plan.screenId,
                screenName: plan.screenName,
                screenRole: plan.screenRole,
                decisionSource: plan.decisionSource,
                requiresModelDecision: plan.requiresModelDecision
            })),
            visualMergeStatus: typedContext.mergeAudit.status
        };
    }

    private async auditDetailPlacement(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.ensurePhotoshopConnected();

        const templateGraph = await this.getDetailTemplateGraph({ includeStructure: true });
        if (templateGraph?.success !== true) {
            return templateGraph;
        }

        const screens = Array.isArray(args.screens) && args.screens.length > 0
            ? args.screens
            : (Array.isArray(templateGraph.screens) ? templateGraph.screens : []);
        const placements = Array.isArray(args.placements) ? args.placements : [];
        if (placements.length === 0) {
            throw new Error('detail.audit_placement requires placements');
        }

        const auditResult = this.unwrapPhotoshopMcpPayload(await this.wsServer.callMCPTool('auditDetailPagePlacement', {
            screens,
            placements
        })) as Record<string, unknown>;

        const context = await this.buildDetailVisualSegmentationContext({ includeStructure: true });
        const screenPlans = context?.success === true && Array.isArray((context as DetailVisualSegmentationContext).screenPlans)
            ? (context as DetailVisualSegmentationContext).screenPlans.filter((plan) =>
                (screens as any[]).some((screen) => Number(screen?.id || 0) === Number(plan.screenId || 0)))
            : inferDetailScreenPlans(screens as any[]);

        return {
            ...auditResult,
            screens,
            screenPlans
        };
    }

    private async auditDetailCopyLayout(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).screenPlans)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;
        return auditDetailCopyLayoutForScreens({
            screens: typedContext.screens,
            screenPlans: typedContext.screenPlans,
            nearLimitThreshold: typeof args.nearLimitThreshold === 'number' ? args.nearLimitThreshold : undefined,
            overflowThreshold: typeof args.overflowThreshold === 'number' ? args.overflowThreshold : undefined
        }) as unknown as Record<string, unknown>;
    }

    private async validateDetailTemplateGraph(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).screenPlans)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;
        const templateGraph = typedContext.templateGraph;

        const screens = typedContext.screens;
        const issues = Array.isArray(templateGraph.issues) ? templateGraph.issues as any[] : [];
        const crossScreenLayers = Array.isArray(templateGraph.crossScreenLayers) ? templateGraph.crossScreenLayers as any[] : [];
        const screenPlans = typedContext.screenPlans;

        const structureAlerts = screens
            .map((screen) => {
                const missingGroups = Array.isArray(screen?.structure?.missingGroups)
                    ? screen.structure.missingGroups.map((item: unknown) => String(item))
                    : [];
                return {
                    screenId: Number(screen?.id || 0),
                    screenName: String(screen?.name || ''),
                    missingGroups
                };
            })
            .filter((item) => item.missingGroups.length > 0);

        const missingModelDecisionScreens = screenPlans
            .filter((plan) => Boolean(plan.requiresModelDecision))
            .map((plan) => ({
                screenId: plan.screenId,
                screenName: plan.screenName,
                screenRole: plan.screenRole,
                decisionSource: plan.decisionSource
            }));

        const placeholderAnchorWarnings = this.collectDetailPlaceholderAnchorWarnings(screens);
        const criticalIssueCount = issues.filter((issue) => String(issue?.severity || '') === 'critical').length;
        const warningIssueCount = issues.filter((issue) => String(issue?.severity || '') === 'warning').length;
        const status: 'ok' | 'watch' | 'risky' =
            criticalIssueCount > 0
                || placeholderAnchorWarnings.riskyScreenIds.length > 0
                || typedContext.mergeAudit.status === 'risky'
                ? 'risky'
                : (warningIssueCount > 0
                    || structureAlerts.length > 0
                    || crossScreenLayers.length > 0
                    || missingModelDecisionScreens.length > 0
                    || typedContext.mergeAudit.status === 'watch')
                    ? 'watch'
                    : 'ok';

        return {
            success: true,
            status,
            screens,
            screenPlans,
            visualMergeStatus: typedContext.mergeAudit.status,
            issues,
            crossScreenLayers,
            structureAlerts,
            placeholderAnchorDiagnostics: placeholderAnchorWarnings,
            missingModelDecisionScreens,
            summary: {
                screenCount: screens.length,
                issueCount: issues.length,
                criticalIssueCount,
                warningIssueCount,
                crossScreenLayerCount: crossScreenLayers.length,
                structureAlertCount: structureAlerts.length,
                missingModelDecisionScreenCount: missingModelDecisionScreens.length,
                riskyScreenCount: placeholderAnchorWarnings.riskyScreenIds.length
            }
        };
    }

    private async inspectDetailLivePlacements(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.ensurePhotoshopConnected();

        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).screenPlans)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;

        const screens = typedContext.screens;
        const screenPlans = typedContext.screenPlans;
        const hierarchyPayload = typedContext.hierarchySummary;
        const flatLayers = typedContext.flatLayers;
        const minOverlapRatio = typeof args.minOverlapRatio === 'number'
            ? Math.max(0.05, Math.min(0.95, args.minOverlapRatio))
            : 0.28;

        const placements = reconstructDetailPlacementsFromHierarchy(screens, flatLayers, minOverlapRatio);
        const auditResult = this.unwrapPhotoshopMcpPayload(await this.wsServer.callMCPTool('auditDetailPagePlacement', {
            screens,
            placements: placements.placements
        })) as Record<string, unknown>;

        return {
            success: true,
            screens,
            screenPlans,
            placements: placements.placements,
            unmatchedPlaceholders: placements.unmatchedPlaceholders,
            placementDiagnostics: placements.diagnostics,
            placementCount: placements.placements.length,
            hierarchySummary: hierarchyPayload,
            audit: auditResult
        };
    }

    private async buildDetailVisualSegmentationContext(args: Record<string, unknown>): Promise<DetailVisualSegmentationContext | Record<string, unknown>> {
        await this.ensurePhotoshopConnected();

        const templateGraph = await this.getDetailTemplateGraph({ includeStructure: args.includeStructure !== false });
        if (templateGraph?.success !== true) {
            return templateGraph;
        }

        const screens = Array.isArray(templateGraph.screens) ? templateGraph.screens as any[] : [];
        const hierarchyPayload = this.unwrapPhotoshopMcpPayload(
            await this.wsServer.callMCPTool('getLayerHierarchy', {
                includeHidden: args.includeHidden === true,
                includeBounds: true,
                flatList: true
            })
        ) as Record<string, unknown>;

        if (hierarchyPayload?.success !== true) {
            return hierarchyPayload;
        }

        const documentSize = asRecord(templateGraph.documentSize);
        const documentBounds = normalizeDetailRect({
            left: 0,
            top: 0,
            right: Number(documentSize?.width || 0),
            bottom: Number(documentSize?.height || 0)
        });
        const flatLayers = Array.isArray(hierarchyPayload.flatList) ? hierarchyPayload.flatList : [];
        const visualScreens = buildDetailVisualScreenBoundaries({
            screens,
            flatLayers,
            documentBounds
        });
        const visualModules = buildDetailVisualModules({
            screens,
            visualScreens,
            flatLayers,
            documentBounds
        });
        const screenModules = new Map<string, string[]>();
        for (const module of visualModules) {
            const sourceId = module.sourceScreenId ? String(module.sourceScreenId) : null;
            if (!sourceId) continue;
            const existing = screenModules.get(sourceId) || [];
            existing.push(module.id);
            screenModules.set(sourceId, existing);
        }
        const linkedVisualScreens = visualScreens.map((screen) => ({
            ...screen,
            moduleIds: screen.sourceScreenId ? (screenModules.get(String(screen.sourceScreenId)) || []) : []
        }));
        const mergeAudit = auditDetailSegmentationMerge({
            screens,
            visualScreens: linkedVisualScreens,
            visualModules
        });
        const visualSummaries = buildDetailScreenVisualSummaries({
            screens,
            visualScreens: linkedVisualScreens,
            visualModules,
            mergeAudit
        });
        const screenPlans = inferDetailScreenPlans(screens, undefined, { visualSummaries });

        return {
            success: true,
            templateGraph,
            screens,
            screenPlans,
            hierarchySummary: hierarchyPayload.summary || null,
            flatLayers,
            documentBounds,
            visualScreens: linkedVisualScreens,
            visualModules,
            mergeAudit
        };
    }

    private async inspectDetailVisualModules(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).visualModules)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;

        return {
            success: true,
            screens: typedContext.screens,
            screenPlans: typedContext.screenPlans,
            visualModules: typedContext.visualModules,
            summary: {
                screenCount: typedContext.screens.length,
                visualModuleCount: typedContext.visualModules.length,
                visualScreenCount: typedContext.visualScreens.length
            }
        };
    }

    private async inspectDetailScreenBoundaries(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).visualScreens)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;

        return {
            success: true,
            screens: typedContext.screens,
            screenPlans: typedContext.screenPlans,
            visualScreens: typedContext.visualScreens,
            summary: {
                parsedScreenCount: typedContext.screens.length,
                visualScreenCount: typedContext.visualScreens.length,
                mergeStatus: typedContext.mergeAudit.status
            }
        };
    }

    private async auditDetailSegmentationMerge(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).visualModules)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;

        return {
            success: true,
            screens: typedContext.screens,
            visualScreens: typedContext.visualScreens,
            visualModules: typedContext.visualModules,
            audit: typedContext.mergeAudit
        };
    }

    private async captureDetailVisualContextBundle(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const context = await this.buildDetailVisualSegmentationContext(args);
        if (context?.success !== true || !Array.isArray((context as DetailVisualSegmentationContext).visualModules)) {
            return context as Record<string, unknown>;
        }
        const typedContext = context as DetailVisualSegmentationContext;

        return captureDetailVisualContextBundle({
            screens: typedContext.screens,
            screenPlans: typedContext.screenPlans,
            visualScreens: typedContext.visualScreens,
            visualModules: typedContext.visualModules,
            mergeAudit: typedContext.mergeAudit
        }) as Record<string, unknown>;
    }

    private collectDetailPlaceholderAnchorWarnings(screens: any[]): {
        alerts: Array<{ screenId: number; screenName: string; severity: 'warning' | 'critical'; message: string; layerIds: number[] }>;
        riskyScreenIds: number[];
        riskyScreenNames: string[];
        warnings: string[];
    } {
        const alerts: Array<{ screenId: number; screenName: string; severity: 'warning' | 'critical'; message: string; layerIds: number[] }> = [];

        for (const screen of screens || []) {
            const screenId = Number(screen?.id || 0);
            const screenName = String(screen?.name || `Screen ${screenId}`);
            const images = Array.isArray(screen?.imagePlaceholders) ? screen.imagePlaceholders : [];
            const rectGroups = new Map<string, number[]>();
            const baseGroups = new Map<number, any[]>();

            for (const image of images) {
                const layerId = Number(image?.layerId || 0);
                const baseLayerId = Number(image?.baseLayerId || image?.clippingInfo?.baseLayerId || 0);
                if (image?.isClippingMask && !baseLayerId) {
                    alerts.push({
                        screenId,
                        screenName,
                        severity: 'critical',
                        message: `图片区「${String(image?.layerName || layerId)}」标记为剪切占位，但没有解析到基底层。`,
                        layerIds: [layerId]
                    });
                }

                const rectKey = buildDetailRectKey(normalizeDetailRect(image?.clippingInfo?.baseBounds || image?.bounds));
                if (rectKey) {
                    const existing = rectGroups.get(rectKey) || [];
                    existing.push(layerId);
                    rectGroups.set(rectKey, existing);
                }

                if (baseLayerId > 0) {
                    const existing = baseGroups.get(baseLayerId) || [];
                    existing.push(image);
                    baseGroups.set(baseLayerId, existing);
                }
            }

            for (const [rectKey, layerIds] of rectGroups.entries()) {
                if (layerIds.length > 1) {
                    alerts.push({
                        screenId,
                        screenName,
                        severity: 'critical',
                        message: `多个图片区共享同一个占位容器（${rectKey}），填图后容易叠在一起。`,
                        layerIds
                    });
                }
            }

            for (const [baseLayerId, groupedImages] of baseGroups.entries()) {
                if (groupedImages.length <= 1) continue;
                const distinctRects = new Set(
                    groupedImages
                        .map((image) => buildDetailRectKey(normalizeDetailRect(image?.clippingInfo?.baseBounds || image?.bounds)))
                        .filter(Boolean) as string[]
                );
                alerts.push({
                    screenId,
                    screenName,
                    severity: distinctRects.size <= 1 ? 'critical' : 'warning',
                    message: distinctRects.size <= 1
                        ? `多个图片区共用基底层 ${baseLayerId} 且占位容器相同。`
                        : `多个图片区共用基底层 ${baseLayerId}，需要确认模板是否刻意复用剪切基底。`,
                    layerIds: groupedImages.map((image) => Number(image?.layerId || 0)).filter((id) => id > 0)
                });
            }
        }

        const riskyScreenIds = Array.from(new Set(
            alerts.filter((alert) => alert.severity === 'critical').map((alert) => alert.screenId)
        ));
        const riskyScreenNames = Array.from(new Set(
            alerts.filter((alert) => alert.severity === 'critical').map((alert) => alert.screenName)
        ));

        return {
            alerts,
            riskyScreenIds,
            riskyScreenNames,
            warnings: alerts.map((alert) => `${alert.screenName}: ${alert.message}`)
        };
    }

    private getResources(): MCPResource[] {
        const base: MCPResource[] = [
            {
                uri: 'designecho://status',
                name: 'Host Status',
                description: 'Current status summary of MCP host, debug bridge and Photoshop bridge.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://debug/sessions',
                name: 'Debug Sessions',
                description: 'List of debug sessions persisted by desktop host.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://runtime/active-context',
                name: 'Runtime Active Context',
                description: 'Latest host + Photoshop runtime context snapshot.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://runtime/recent-task-trace',
                name: 'Recent Task Trace',
                description: 'Latest persisted debug trace captured by desktop host.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://scene/selected-element-context',
                name: 'Selected Element Context',
                description: 'Current selected Photoshop element context with hierarchy, relations, clipping, and optional detail-page hints.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://scene/selected-module-context',
                name: 'Selected Module Context',
                description: 'Visual module context for the currently selected Photoshop element, including module members and module-to-screen relations.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://scene/selected-design-context',
                name: 'Selected Design Context',
                description: 'Combined selected element and module context for the current Photoshop selection.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/template-graph',
                name: 'Detail Template Graph',
                description: 'Current detail-page template graph with screens, placeholders, and layout assessment.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/screen-plan',
                name: 'Detail Screen Plan',
                description: 'Current inferred screen roles and screen plans for the active detail-page PSD.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/template-validation',
                name: 'Detail Template Validation',
                description: 'Current detail-page template validation summary, including model-decision gaps and placeholder-anchor risks.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/live-placements',
                name: 'Detail Live Placements',
                description: 'Current live placement reconstruction for detail-page image regions in the active PSD.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/copy-layout-audit',
                name: 'Detail Copy Layout Audit',
                description: 'Current detail-page copy layout audit for text placeholders in the active PSD.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/visual-modules',
                name: 'Detail Visual Modules',
                description: 'Geometry-first visual modules inferred from the active detail-page PSD.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/screen-boundaries',
                name: 'Detail Visual Screen Boundaries',
                description: 'Visual screen boundaries inferred from the active detail-page PSD.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/segmentation-merge',
                name: 'Detail Segmentation Merge Audit',
                description: 'Comparison between structure-derived detail screens and visual segmentation.',
                mimeType: 'application/json'
            },
            {
                uri: 'designecho://detail/visual-context-bundle',
                name: 'Detail Visual Context Bundle',
                description: 'Combined detail-page structure, screen plans, visual screens, modules, and merge audit.',
                mimeType: 'application/json'
            }
        ];

        const sessionResources = this.debugBridge.listSessions().slice(0, 20).map(session => ({
            uri: `designecho://debug/sessions/${session.id}`,
            name: `Debug Session ${session.id}`,
            description: session.title,
            mimeType: 'application/json'
        }));

        return [...base, ...sessionResources];
    }

    private async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
        if (uri === 'designecho://status') {
            const status = await this.getSystemStatus();
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(status, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://debug/sessions') {
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(this.debugBridge.listSessions(), null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://runtime/active-context') {
            const context = await this.getActiveContext({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(context, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://runtime/recent-task-trace') {
            const trace = this.getRecentTaskTrace({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(trace, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://scene/selected-element-context') {
            const payload = await this.getSelectedElementContext({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://scene/selected-module-context') {
            const payload = await this.getSelectedModuleContext({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://scene/selected-design-context') {
            const payload = await this.getSelectedDesignContext({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/template-graph') {
            const graph = await this.getDetailTemplateGraph({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(graph, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/screen-plan') {
            const screenPlan = await this.getDetailScreenPlan({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(screenPlan, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/template-validation') {
            const validation = await this.validateDetailTemplateGraph({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(validation, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/live-placements') {
            const placements = await this.inspectDetailLivePlacements({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(placements, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/copy-layout-audit') {
            const audit = await this.auditDetailCopyLayout({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(audit, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/visual-modules') {
            const payload = await this.inspectDetailVisualModules({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/screen-boundaries') {
            const payload = await this.inspectDetailScreenBoundaries({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/segmentation-merge') {
            const payload = await this.auditDetailSegmentationMerge({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        }

        if (uri === 'designecho://detail/visual-context-bundle') {
            const payload = await this.captureDetailVisualContextBundle({});
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        }

        if (uri.startsWith('designecho://debug/sessions/')) {
            const sessionId = decodeURIComponent(uri.replace('designecho://debug/sessions/', ''));
            const session = this.debugBridge.readSessionForDebugOutput(sessionId, { messageLimit: 20 });
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(session || { error: 'Session not found', sessionId }, null, 2)
                    }
                ]
            };
        }

        throw new Error(`Unknown resource URI: ${uri}`);
    }

    private getPrompts(): MCPPrompt[] {
        return [
            {
                name: 'debug-session-triage',
                description: 'Create a concise triage message for debug session ingestion.',
                arguments: [
                    { name: 'goal', description: 'Current debugging goal', required: true },
                    { name: 'symptom', description: 'Observed symptom', required: true }
                ]
            },
            {
                name: 'photoshop-mcp-preflight',
                description: 'Checklist before invoking Photoshop MCP tools.',
                arguments: []
            },
            {
                name: 'text-replacement-audit',
                description: 'Workflow for diagnosing repeated text replacement drift.',
                arguments: [
                    { name: 'symptom', description: 'Observed text replacement symptom', required: false }
                ]
            },
            {
                name: 'selected-element-context-audit',
                description: 'Workflow for inspecting what the agent currently understands about the selected Photoshop element.',
                arguments: [
                    { name: 'goal', description: 'Why the selected element context is being inspected', required: false }
                ]
            },
            {
                name: 'selected-module-context-audit',
                description: 'Workflow for inspecting the visual module that contains the current selected Photoshop element.',
                arguments: [
                    { name: 'goal', description: 'Why the selected module context is being inspected', required: false }
                ]
            },
            {
                name: 'selected-design-context-audit',
                description: 'Workflow for inspecting the combined selected design context before planning design actions.',
                arguments: [
                    { name: 'goal', description: 'Why the selected design context is being inspected', required: false }
                ]
            },
            {
                name: 'detail-page-design-audit',
                description: 'Workflow for diagnosing detail-page structure, screen planning, and placement quality.',
                arguments: [
                    { name: 'symptom', description: 'Observed detail-page symptom', required: false }
                ]
            },
            {
                name: 'detail-page-live-placement-audit',
                description: 'Workflow for reconstructing live detail-page placements from the current PSD and auditing placement drift.',
                arguments: [
                    { name: 'symptom', description: 'Observed placement symptom', required: false }
                ]
            },
            {
                name: 'detail-page-copy-layout-audit',
                description: 'Workflow for auditing current detail-page text placeholders for layout pressure and copy-structure mismatch.',
                arguments: [
                    { name: 'symptom', description: 'Observed copy layout symptom', required: false }
                ]
            },
            {
                name: 'detail-page-visual-segmentation-audit',
                description: 'Workflow for diagnosing messy detail-page templates with visual modules and screen boundary inference.',
                arguments: [
                    { name: 'symptom', description: 'Observed visual segmentation symptom', required: false }
                ]
            }
        ];
    }

    private getPromptContent(name: string, args: Record<string, unknown>): { messages: Array<{ role: string; content: { type: 'text'; text: string } }> } | null {
        if (name === 'debug-session-triage') {
            const goal = String(args.goal || '').trim();
            const symptom = String(args.symptom || '').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Create a debug-session append payload.',
                                `Goal: ${goal || 'unknown'}`,
                                `Symptom: ${symptom || 'unknown'}`,
                                'Return a compact JSON object with role, direction, content, metadata, trace, toolCalls, errors and executionSummary when available.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'photoshop-mcp-preflight') {
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Before calling Photoshop MCP tools:',
                                '1) call photoshop.connection_status',
                                '2) call photoshop.tools.list',
                                '3) validate required tool arguments',
                                '4) then call photoshop.tools.call'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'text-replacement-audit') {
            const symptom = String(args.symptom || 'Repeated replacement changes size or target layer unexpectedly.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Diagnose a Photoshop text replacement issue in DesignEcho.',
                                `Symptom: ${symptom}`,
                                'Run, in order:',
                                '1) runtime.get_active_context',
                                '2) runtime.get_recent_task_trace',
                                '3) text.audit_replacement',
                                'Then explain whether the drift is caused by target-layer switching, text-layer formatting ranges, or replacement geometry.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'selected-element-context-audit') {
            const goal = String(args.goal || 'Understand the currently selected Photoshop element before planning design actions.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Inspect the currently selected Photoshop element in DesignEcho.',
                                `Goal: ${goal}`,
                                'Run, in order:',
                                '1) photoshop.connection_status',
                                '2) scene.get_selected_element_context',
                                '3) if needed, detail.inspect_visual_modules',
                                'Then explain what the selected element is, where it sits in the PSD hierarchy, what it is visually related to, and whether the current detail-page interpretation agrees with that.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'selected-module-context-audit') {
            const goal = String(args.goal || 'Understand the visual module that contains the current selected Photoshop element before planning design actions.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Inspect the current visual module in DesignEcho.',
                                `Goal: ${goal}`,
                                'Run, in order:',
                                '1) photoshop.connection_status',
                                '2) scene.get_selected_module_context',
                                '3) if needed, scene.get_selected_element_context',
                                'Then explain what module the selected element belongs to, which layers belong to the same module, how that module relates to the surrounding screen, and whether the current detail-page interpretation looks coherent.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'selected-design-context-audit') {
            const goal = String(args.goal || 'Understand the combined selected design context before planning design actions.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Inspect the combined selected design context in DesignEcho.',
                                `Goal: ${goal}`,
                                'Run, in order:',
                                '1) photoshop.connection_status',
                                '2) scene.get_selected_design_context',
                                '3) if needed, scene.get_selected_element_context',
                                '4) if needed, scene.get_selected_module_context',
                                'Then explain what the selected element is, which module it belongs to, how that module relates to the surrounding design, and what this implies for planning the next design action.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'detail-page-design-audit') {
            const symptom = String(args.symptom || 'Detail-page result is structurally or visually incorrect.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Diagnose a detail-page design/execution issue in DesignEcho.',
                                `Symptom: ${symptom}`,
                                'Run, in order:',
                                '1) detail.validate_template_graph',
                                '2) detail.get_screen_plan',
                                '3) runtime.get_recent_task_trace',
                                '4) detail.audit_placement (if placement records are available)',
                                'Then explain whether the issue is caused by template structure, screen-role planning, asset matching, placement execution, or Photoshop runtime behavior.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'detail-page-live-placement-audit') {
            const symptom = String(args.symptom || 'Detail-page images appear offset, stacked, or clipped incorrectly in the active PSD.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Diagnose a live detail-page placement issue in DesignEcho.',
                                `Symptom: ${symptom}`,
                                'Run, in order:',
                                '1) detail.get_template_graph',
                                '2) detail.inspect_live_placements',
                                '3) runtime.get_recent_task_trace',
                                'Then explain whether the issue comes from template anchors, runtime placement drift, clipping-base mismatch, or Photoshop layer state.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'detail-page-copy-layout-audit') {
            const symptom = String(args.symptom || 'Detail-page copy may overflow, repeat, or feel structurally wrong in the active PSD.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Diagnose a detail-page copy layout issue in DesignEcho.',
                                `Symptom: ${symptom}`,
                                'Run, in order:',
                                '1) detail.get_screen_plan',
                                '2) detail.audit_copy_layout',
                                '3) runtime.get_recent_task_trace',
                                'Then explain whether the issue comes from screen-role planning, copy strategy, text-frame capacity, repeated copy, or Photoshop text-layer state.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        if (name === 'detail-page-visual-segmentation-audit') {
            const symptom = String(args.symptom || 'The PSD structure is messy, but the visual grouping on the canvas is clear.').trim();
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                'Diagnose a messy detail-page template using structure parsing plus visual segmentation.',
                                `Symptom: ${symptom}`,
                                'Run, in order:',
                                '1) detail.validate_template_graph',
                                '2) detail.inspect_screen_boundaries',
                                '3) detail.inspect_visual_modules',
                                '4) detail.audit_segmentation_merge',
                                '5) detail.capture_visual_context_bundle',
                                'Then explain whether the failure mainly comes from wrong screen boundaries, wrong module ownership, weak screen-role inference, or runtime execution.'
                            ].join('\n')
                        }
                    }
                ]
            };
        }

        return null;
    }

    private async ensurePhotoshopConnected(): Promise<void> {
        if (!this.wsServer.isPluginConnected()) {
            throw new Error('Photoshop UXP plugin is not connected');
        }
    }

    private async getSelectedElementContext(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.ensurePhotoshopConnected();

        const includeText = args.includeText !== false;
        const includeDetailContext = args.includeDetailContext === true;
        const relationLimit = typeof args.relationLimit === 'number'
            ? Math.max(1, Math.min(12, Math.floor(args.relationLimit)))
            : 6;
        const explicitLayerId = typeof args.layerId === 'number' && Number.isFinite(args.layerId)
            ? Number(args.layerId)
            : null;

        const usedTools = ['diagnoseState', 'getDocumentInfo', 'getLayerHierarchy', 'getLayerProperties', 'getLayerBounds', 'getClippingMaskInfo'];
        const diagnoseState = this.unwrapPhotoshopMcpPayload(
            await this.wsServer.callMCPTool('diagnoseState', { verbose: false })
        ) as Record<string, unknown>;

        if (diagnoseState?.success !== true) {
            return diagnoseState;
        }

        const state = asRecord(diagnoseState.state);
        if (state.hasDocument !== true) {
            return {
                success: false,
                error: 'No active Photoshop document.'
            };
        }

        const selectedLayers = Array.isArray(state.selectedLayers) ? state.selectedLayers : [];
        const activeLayerId = selectedLayers.length > 0 && typeof (selectedLayers[0] as Record<string, unknown>).id === 'number'
            ? Number((selectedLayers[0] as Record<string, unknown>).id)
            : null;
        const layerId = explicitLayerId ?? activeLayerId;
        if (!layerId) {
            return {
                success: false,
                error: 'No active layer is selected, and no layerId was provided.'
            };
        }

        const [documentInfoPayload, hierarchyPayload] = await Promise.all([
            this.wsServer.callMCPTool('getDocumentInfo', {}),
            this.wsServer.callMCPTool('getLayerHierarchy', {
                includeHidden: false,
                includeBounds: true,
                flatList: true
            })
        ]);

        const documentInfo = this.unwrapPhotoshopMcpPayload(documentInfoPayload) as Record<string, unknown>;
        const hierarchy = this.unwrapPhotoshopMcpPayload(hierarchyPayload) as Record<string, unknown>;

        if (hierarchy?.success !== true) {
            return hierarchy;
        }

        const flatLayers = Array.isArray(hierarchy.flatList) ? hierarchy.flatList as Array<Record<string, unknown>> : [];
        const selectedNode = flatLayers.find((layer) => Number(layer.id || 0) === layerId) || null;
        if (!selectedNode) {
            return {
                success: false,
                error: explicitLayerId
                    ? `Layer ${layerId} was not found in the current hierarchy snapshot.`
                    : 'No active layer is available in the current hierarchy snapshot.'
            };
        }

        const [propertiesPayload, boundsPayload, clippingPayload] = await Promise.all([
            this.wsServer.callMCPTool('getLayerProperties', { layerId }),
            this.wsServer.callMCPTool('getLayerBounds', { layerId }),
            this.wsServer.callMCPTool('getClippingMaskInfo', { layerId })
        ]);

        const properties = this.unwrapPhotoshopMcpPayload(propertiesPayload) as Record<string, unknown>;
        const bounds = this.unwrapPhotoshopMcpPayload(boundsPayload) as Record<string, unknown>;
        const clipping = this.unwrapPhotoshopMcpPayload(clippingPayload) as Record<string, unknown>;

        if (properties?.success !== true) {
            return properties;
        }

        let textContentPayload: Record<string, unknown> | null = null;
        let textStylePayload: Record<string, unknown> | null = null;
        const propertiesRecord = asRecord(properties.properties);
        const rawKind = String(selectedNode.kind || propertiesRecord.kind || '');
        const isTextLayer = rawKind.toLowerCase().includes('text');

        if (includeText && isTextLayer) {
            usedTools.push('getTextContent', 'getTextStyle');
            const [textContentRaw, textStyleRaw] = await Promise.all([
                this.wsServer.callMCPTool('getTextContent', { layerId }),
                this.wsServer.callMCPTool('getTextStyle', { layerId })
            ]);
            textContentPayload = this.unwrapPhotoshopMcpPayload(textContentRaw) as Record<string, unknown>;
            textStylePayload = this.unwrapPhotoshopMcpPayload(textStyleRaw) as Record<string, unknown>;
        }

        let detailPayload: Record<string, unknown> | null = null;
        if (includeDetailContext) {
            usedTools.push('detail.capture_visual_context_bundle');
            const detailContext = await this.captureDetailVisualContextBundle({});
            if (detailContext?.success === true) {
                detailPayload = detailContext;
            }
        }

        const normalizedDocumentInfo = asRecord(documentInfo.document);
        const mergedSelectedNode = {
            ...selectedNode,
            bounds: bounds?.success === true ? (bounds.boundsNoEffects || bounds.bounds || selectedNode.bounds) : selectedNode.bounds,
            isClippingMask: clipping?.clippingMaskInfo && typeof clipping.clippingMaskInfo === 'object'
                ? Boolean((clipping.clippingMaskInfo as Record<string, unknown>).isClippingBase)
                : selectedNode.isClippingMask
        };

        return {
            success: true,
            context: buildSelectedElementContext({
                source: explicitLayerId !== null ? 'layer-id' : 'active-layer',
                documentInfo: {
                    ...(state.documentInfo && typeof state.documentInfo === 'object' ? state.documentInfo as Record<string, unknown> : {}),
                    ...normalizedDocumentInfo
                },
                selectedNode: mergedSelectedNode,
                flatLayers,
                propertiesPayload: properties,
                clippingPayload: clipping?.success === true ? clipping : null,
                textContentPayload: textContentPayload?.success === true ? textContentPayload : null,
                textStylePayload: textStylePayload?.success === true ? textStylePayload : null,
                detailPayload,
                includeText,
                includeDetailContext,
                relationLimit,
                usedTools
            })
        };
    }

    private async getSelectedModuleContext(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.ensurePhotoshopConnected();

        const includeDetailContext = args.includeDetailContext === true;
        const includeText = args.includeText !== false;
        const relationLimit = typeof args.relationLimit === 'number'
            ? Math.max(1, Math.min(12, Math.floor(args.relationLimit)))
            : 6;
        const elementPayload = await this.getSelectedElementContext({
            layerId: args.layerId,
            includeText,
            includeDetailContext,
            relationLimit
        });

        if (elementPayload?.success !== true) {
            return elementPayload;
        }

        const selectedElementContext = asRecord(elementPayload.context);
        let typedContext: DetailVisualSegmentationContext | null = null;
        if (includeDetailContext) {
            const detailContext = await this.buildDetailVisualSegmentationContext({});
            if (detailContext?.success !== true) {
                return detailContext as Record<string, unknown>;
            }
            typedContext = detailContext as DetailVisualSegmentationContext;
        }
        const moduleContext = buildSelectedModuleContext({
            selectedElementContext: elementPayload.context as any,
            visualModules: typedContext?.visualModules || [],
            visualScreens: typedContext?.visualScreens || [],
            relationLimit
        });

        return {
            success: true,
            context: moduleContext,
            selectedElementContext,
            summary: {
                moduleFound: moduleContext.diagnostics.moduleFound,
                moduleId: moduleContext.module?.id || null,
                screenModuleId: moduleContext.parentScreenModule?.id || null,
                memberLayerCount: moduleContext.memberLayers.length,
                relationCount: moduleContext.relations.length,
                inferenceMode: moduleContext.diagnostics.inferenceMode
            }
        };
    }

    private async getSelectedDesignContext(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.ensurePhotoshopConnected();

        const includeText = args.includeText !== false;
        const includeDetailContext = args.includeDetailContext === true;
        const relationLimit = typeof args.relationLimit === 'number'
            ? Math.max(1, Math.min(12, Math.floor(args.relationLimit)))
            : 6;
        const layerId = typeof args.layerId === 'number' && Number.isFinite(args.layerId)
            ? Number(args.layerId)
            : undefined;

        const elementPayload = await this.getSelectedElementContext({
            layerId,
            includeText,
            includeDetailContext,
            relationLimit
        });
        if (elementPayload?.success !== true) {
            return elementPayload;
        }

        let typedContext: DetailVisualSegmentationContext | null = null;
        if (includeDetailContext) {
            const detailContext = await this.buildDetailVisualSegmentationContext({});
            if (detailContext?.success !== true) {
                return detailContext as Record<string, unknown>;
            }
            typedContext = detailContext as DetailVisualSegmentationContext;
        }

        const selectedElementContext = elementPayload.context as any;
        const selectedModuleContext = buildSelectedModuleContext({
            selectedElementContext,
            visualModules: typedContext?.visualModules || [],
            visualScreens: typedContext?.visualScreens || [],
            relationLimit
        });
        const context: SelectedDesignContext = buildSelectedDesignContext({
            selectedElementContext,
            selectedModuleContext
        });

        return {
            success: true,
            context,
            scene: context.scene,
            selectedElementContext,
            selectedModuleContext,
            summary: context.summary
        };
    }

    private async getActiveContext(args: Record<string, unknown>): Promise<unknown> {
        const includeLayerHierarchy = args.includeLayerHierarchy === true;
        const includeTextLayers = args.includeTextLayers !== false;
        const includeBounds = args.includeBounds === true;
        const connected = this.wsServer.isPluginConnected();

        if (!connected) {
            return {
                success: false,
                connected: false,
                error: 'Photoshop UXP plugin is not connected'
            };
        }

        const diagnoseState = this.unwrapPhotoshopMcpPayload(
            await this.wsServer.callMCPTool('diagnoseState', { verbose: false })
        );
        const documentInfo = this.unwrapPhotoshopMcpPayload(
            await this.wsServer.callMCPTool('getDocumentInfo', {})
        );
        const textLayers = includeTextLayers
            ? this.unwrapPhotoshopMcpPayload(
                await this.wsServer.callMCPTool('getAllTextLayers', { includeHidden: false })
            )
            : null;
        const layerHierarchy = includeLayerHierarchy
            ? this.unwrapPhotoshopMcpPayload(
                await this.wsServer.callMCPTool('getLayerHierarchy', {
                    includeHidden: false,
                    includeBounds,
                    flatList: false
                })
            )
            : null;

        return {
            success: true,
            connected: true,
            system: await this.getSystemStatus(),
            photoshop: {
                diagnoseState,
                documentInfo,
                textLayers,
                layerHierarchy
            }
        };
    }

    private getRecentTaskTrace(args: Record<string, unknown>): unknown {
        const sessionId = String(args.sessionId || '').trim();
        const includeMessages = args.includeMessages !== false;
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const includeFull = args.includeFull === true;
        const debugToken = typeof args.debugToken === 'string' ? args.debugToken : undefined;

        const sessions = this.debugBridge.listSessions();
        const latestSessionMeta = sessionId
            ? sessions.find(session => session.id === sessionId)
            : sessions[0];

        if (!latestSessionMeta) {
            return {
                success: true,
                available: false,
                message: 'No persisted debug sessions found'
            };
        }

        const session = this.debugBridge.readSession(latestSessionMeta.id);
        if (!session) {
            return {
                success: true,
                available: false,
                message: `Debug session not found: ${latestSessionMeta.id}`
            };
        }

        const fullAllowed = includeFull && this.debugBridge.canReadFullDebugData(debugToken);
        const messages = includeMessages
            ? fullAllowed
                ? session.messages.slice(-limit)
                : this.debugBridge.summarizeSession(session, { messageLimit: limit }).messages || []
            : [];

        return {
            success: true,
            available: true,
            session: {
                id: session.id,
                title: session.title,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                messageCount: session.messages.length,
                redacted: !fullAllowed,
                metadataKeys: session.metadata ? Object.keys(session.metadata).sort() : []
            },
            messages
        };
    }

    private async getSystemStatus(): Promise<{
        service: string;
        mcpEndpoint: string;
        debugBridgeEndpoint: string;
        pluginConnected: boolean;
        pluginConnectionDiagnostics: ReturnType<WebSocketServer['getConnectionDiagnostics']>;
        ports: { ws: number; webview: number; debugBridge: number; mcp: number };
    }> {
        return {
            service: 'designecho-agent-host',
            mcpEndpoint: `${this.getBaseUrl()}/mcp`,
            debugBridgeEndpoint: this.debugBridge.getBaseUrl(),
            pluginConnected: this.wsServer.isPluginConnected(),
            pluginConnectionDiagnostics: this.wsServer.getConnectionDiagnostics(),
            ports: {
                ws: WS_PORT,
                webview: WEBVIEW_SERVER_PORT,
                debugBridge: DEBUG_BRIDGE_PORT,
                mcp: this.port
            }
        };
    }

    private async fallbackAuditTextReplacement(args: {
        layerId?: number;
        proposedContent?: string;
        baselineContent?: string;
    }): Promise<unknown> {
        const toolArgs = args.layerId ? { layerId: args.layerId } : {};
        const [contentRaw, styleRaw, boundsRaw] = await Promise.all([
            this.wsServer.callMCPTool('getTextContent', toolArgs),
            this.wsServer.callMCPTool('getTextStyle', toolArgs),
            this.wsServer.callMCPTool('getLayerBounds', toolArgs)
        ]);

        const content = this.unwrapPhotoshopMcpPayload(contentRaw);
        const style = this.unwrapPhotoshopMcpPayload(styleRaw);
        const bounds = this.unwrapPhotoshopMcpPayload(boundsRaw);

        if (!content?.success) {
            return {
                success: false,
                source: 'fallback',
                error: content?.error || 'Failed to read current text content'
            };
        }

        const currentContent = this.normalizeLineBreaks(String(content.content || ''));
        const proposedContent = this.normalizeLineBreaks(String(args.proposedContent || ''));
        const baselineContent = this.normalizeLineBreaks(String(args.baselineContent || ''));

        return {
            success: true,
            source: 'fallback',
            layerId: content.layerId ?? style?.layerId ?? bounds?.layerId ?? args.layerId ?? null,
            layerName: bounds?.layerName || null,
            currentContent,
            baselineContent: baselineContent || undefined,
            proposedContent: proposedContent || undefined,
            bounds: bounds?.success ? (bounds.boundsNoEffects || bounds.bounds || null) : null,
            style: style?.success ? (style.style || null) : null,
            descriptorSummary: {
                unavailable: true,
                reason: 'UXP runtime has not exposed auditTextReplacement; using composed fallback from text/content/style/bounds tools.'
            },
            comparison: proposedContent ? {
                currentLength: currentContent.replace(/[\r\n]/g, '').length,
                proposedLength: proposedContent.replace(/[\r\n]/g, '').length,
                lengthDelta: proposedContent.replace(/[\r\n]/g, '').length - currentContent.replace(/[\r\n]/g, '').length,
                currentLineCount: currentContent.length ? currentContent.split('\n').length : 0,
                proposedLineCount: proposedContent.length ? proposedContent.split('\n').length : 0,
                lineDelta: (proposedContent.length ? proposedContent.split('\n').length : 0) - (currentContent.length ? currentContent.split('\n').length : 0)
            } : undefined
        };
    }

    private unwrapPhotoshopMcpPayload(raw: unknown): any {
        const payload = asRecord(raw);
        const content = Array.isArray(payload.content) ? payload.content : [];
        const first = content[0];
        const text = typeof first?.text === 'string' ? first.text : '';

        if (!text) {
            return raw;
        }

        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') {
                const parsedRecord = asRecord(parsed);
                const nestedContent = Array.isArray(parsedRecord.content) ? parsedRecord.content : [];
                const nestedFirst = nestedContent[0];
                const nestedText = typeof nestedFirst?.text === 'string' ? nestedFirst.text : '';
                if (nestedText) {
                    try {
                        return JSON.parse(nestedText);
                    } catch {
                        return nestedText;
                    }
                }
            }
            return parsed;
        } catch {
            return { success: false, error: text };
        }
    }

    private normalizeLineBreaks(value: string): string {
        return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }
}
