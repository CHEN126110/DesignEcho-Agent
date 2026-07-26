import http from 'http';
import fs from 'fs';
import path from 'path';

export interface DebugBridgeMessage {
    id: string;
    timestamp: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    direction: 'inbound' | 'outbound' | 'event';
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
    trace?: Record<string, unknown>;
    toolCalls?: unknown[];
    errors?: unknown[];
    executionSummary?: DebugBridgeExecutionSummary;
}

export interface DebugBridgeSession {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
    messages: DebugBridgeMessage[];
}

export interface DebugBridgeCreateSessionInput {
    id?: string;
    title?: string;
    metadata?: Record<string, unknown>;
}

export interface DebugBridgeAppendMessageInput {
    role: string;
    direction: string;
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
    trace?: Record<string, unknown>;
    toolCalls?: unknown[];
    errors?: unknown[];
    executionSummary?: unknown;
}

export interface DebugBridgeExecutionSummary {
    status: string;
    stopReason?: string;
    iterations?: number;
    toolCallCount?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
    acceptanceVerified?: number;
    acceptanceFailed?: number;
    acceptanceNeedsReview?: number;
    noDocumentChangeRisks?: number;
    lastToolName?: string;
    lastError?: string;
    blockers?: string[];
    warnings?: string[];
    summaryText?: string;
}

export interface DebugBridgeExecutionSummaryPreview {
    status: string;
    stopReason?: string;
    iterations?: number;
    toolCallCount?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
    acceptanceVerified?: number;
    acceptanceFailed?: number;
    acceptanceNeedsReview?: number;
    noDocumentChangeRisks?: number;
    lastToolName?: string;
    blockerCount: number;
    warningCount: number;
    summaryText?: string;
}

export interface DebugBridgeChatSubmitInput {
    text: string;
    timeoutMs?: number;
    resetConversation?: boolean;
    publicPlanConfirmationSourceMessageId?: string;
    publicPlanDisposableLiveAdapter?: boolean;
}

export interface DebugBridgeMessageSummary {
    id: string;
    timestamp: string;
    role: DebugBridgeMessage['role'];
    direction: DebugBridgeMessage['direction'];
    contentPreview: string;
    agent?: string;
    hasMetadata: boolean;
    hasTrace: boolean;
    toolCallCount: number;
    errorCount: number;
    executionSummary?: DebugBridgeExecutionSummaryPreview;
}

export interface DebugBridgeSessionSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    metadataKeys: string[];
    roleCounts: Record<string, number>;
    risk: {
        redacted: true;
        hasMetadata: boolean;
        hasTrace: boolean;
        hasToolCalls: boolean;
        hasErrors: boolean;
    };
    messages?: DebugBridgeMessageSummary[];
}

export interface DebugBridgeReadOptions {
    includeFull?: boolean;
    debugToken?: string;
    messageLimit?: number;
}

interface DebugBridgeOptions {
    host: string;
    port: number;
    dataDir: string;
    onChatSubmit?: (input: DebugBridgeChatSubmitInput) => Promise<unknown>;
    onEvent?: (event: {
        type: 'session.created' | 'message.appended';
        sessionId: string;
        payload: DebugBridgeSession | DebugBridgeMessage;
    }) => void;
}

function safeJsonParse<T>(raw: string): T | null {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function getAllowedCorsOrigin(req: http.IncomingMessage, port: number): string | undefined {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return undefined;

    const configured = String(process.env.DESIGNECHO_DEBUG_BRIDGE_ORIGINS || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    const allowed = configured.length > 0
        ? configured
        : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

    return allowed.includes(origin) ? origin : undefined;
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown, req?: http.IncomingMessage, port = 0): void {
    const payload = JSON.stringify(body, null, 2);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-DesignEcho-Debug-Token',
        'Vary': 'Origin'
    };
    const allowedOrigin = req ? getAllowedCorsOrigin(req, port) : undefined;
    if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
    }
    res.writeHead(statusCode, headers);
    res.end(payload);
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sanitizeSessionId(input?: string): string {
    const normalized = String(input || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    return normalized || `session-${Date.now()}`;
}

function createMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncateText(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export class DebugBridgeService {
    private server: http.Server | null = null;
    private readonly host: string;
    private readonly port: number;
    private readonly dataDir: string;
    private readonly sessionsDir: string;
    private readonly onChatSubmit?: DebugBridgeOptions['onChatSubmit'];
    private readonly onEvent?: DebugBridgeOptions['onEvent'];

    constructor(options: DebugBridgeOptions) {
        this.host = options.host;
        this.port = options.port;
        this.dataDir = options.dataDir;
        this.sessionsDir = path.join(this.dataDir, 'sessions');
        this.onChatSubmit = options.onChatSubmit;
        this.onEvent = options.onEvent;
        fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    start(): void {
        if (this.server) return;

        this.server = http.createServer(async (req, res) => {
            if (!req.url) {
                sendJson(res, 400, { success: false, error: 'Missing URL' }, req, this.port);
                return;
            }

            if (req.method === 'OPTIONS') {
                if (req.headers.origin && !getAllowedCorsOrigin(req, this.port)) {
                    sendJson(res, 403, { success: false, error: 'Origin not allowed' }, req, this.port);
                    return;
                }
                sendJson(res, 200, { success: true }, req, this.port);
                return;
            }

            try {
                await this.handleRequest(req, res);
            } catch (error: any) {
                sendJson(res, 500, {
                    success: false,
                    error: error?.message || 'Debug bridge internal error'
                }, req, this.port);
            }
        });

        this.server.listen(this.port, this.host);
    }

    stop(): void {
        this.server?.close();
        this.server = null;
    }

    getBaseUrl(): string {
        return `http://${this.host}:${this.port}`;
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const method = String(req.method || 'GET').toUpperCase();
        const url = new URL(req.url || '/', this.getBaseUrl());
        const pathname = url.pathname;

        if (method === 'GET' && pathname === '/health') {
            sendJson(res, 200, {
                success: true,
                service: 'debug-bridge',
                host: this.host,
                port: this.port
            }, req, this.port);
            return;
        }

        if (method === 'GET' && pathname === '/sessions') {
            sendJson(res, 200, {
                success: true,
                sessions: this.listSessions()
            }, req, this.port);
            return;
        }

        if (method === 'POST' && pathname === '/sessions') {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req)) || {};
            const session = this.createSession({
                id: typeof body.id === 'string' ? body.id : undefined,
                title: typeof body.title === 'string' ? body.title : undefined,
                metadata: isRecord(body.metadata) ? body.metadata : undefined
            });
            sendJson(res, 201, { success: true, session: this.summarizeSession(session) }, req, this.port);
            return;
        }

        const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
        if (method === 'GET' && sessionMatch) {
            const session = this.readSession(sessionMatch[1]);
            if (!session) {
                sendJson(res, 404, { success: false, error: 'Session not found' }, req, this.port);
                return;
            }
            sendJson(res, 200, {
                success: true,
                session: this.readSessionForDebugOutput(session.id, {
                    includeFull: url.searchParams.get('include') === 'full',
                    debugToken: String(req.headers['x-designecho-debug-token'] || ''),
                    messageLimit: Number(url.searchParams.get('limit')) || undefined
                })
            }, req, this.port);
            return;
        }

        const messageMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
        if (method === 'POST' && messageMatch) {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' }, req, this.port);
                return;
            }

            const message = this.appendMessage(messageMatch[1], {
                role: typeof body.role === 'string' ? body.role : 'user',
                direction: typeof body.direction === 'string' ? body.direction : 'inbound',
                content: typeof body.content === 'string' ? body.content : '',
                agent: typeof body.agent === 'string' ? body.agent : undefined,
                metadata: isRecord(body.metadata) ? body.metadata : undefined,
                trace: isRecord(body.trace) ? body.trace : undefined,
                toolCalls: Array.isArray(body.toolCalls) ? body.toolCalls : undefined,
                errors: Array.isArray(body.errors) ? body.errors : undefined,
                executionSummary: body.executionSummary
            });

            sendJson(res, 201, { success: true, message: this.summarizeMessage(message) }, req, this.port);
            return;
        }

        if (method === 'POST' && pathname === '/message') {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' }, req, this.port);
                return;
            }

            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
            const session = sessionId ? (this.readSession(sessionId) || this.createSession({ id: sessionId })) : this.createSession({});
            const message = this.appendMessage(session.id, {
                role: typeof body.role === 'string' ? body.role : 'user',
                direction: typeof body.direction === 'string' ? body.direction : 'inbound',
                content: typeof body.content === 'string' ? body.content : '',
                agent: typeof body.agent === 'string' ? body.agent : undefined,
                metadata: isRecord(body.metadata) ? body.metadata : undefined,
                trace: isRecord(body.trace) ? body.trace : undefined,
                toolCalls: Array.isArray(body.toolCalls) ? body.toolCalls : undefined,
                errors: Array.isArray(body.errors) ? body.errors : undefined,
                executionSummary: body.executionSummary
            });

            sendJson(res, 201, { success: true, sessionId: session.id, message: this.summarizeMessage(message) }, req, this.port);
            return;
        }

        if (method === 'POST' && pathname === '/chat/submit') {
            if (!this.onChatSubmit) {
                sendJson(res, 503, { success: false, error: 'Chat submit bridge is unavailable' }, req, this.port);
                return;
            }

            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' }, req, this.port);
                return;
            }

            const text = typeof body.text === 'string' ? body.text.trim() : '';
            if (!text) {
                sendJson(res, 400, { success: false, error: 'text is required' }, req, this.port);
                return;
            }

            const result = await this.onChatSubmit({
                text,
                timeoutMs: Number(body.timeoutMs) || undefined,
                resetConversation: body.resetConversation === true,
                publicPlanConfirmationSourceMessageId: typeof body.publicPlanConfirmationSourceMessageId === 'string'
                    ? body.publicPlanConfirmationSourceMessageId
                    : undefined,
                publicPlanDisposableLiveAdapter: body.publicPlanDisposableLiveAdapter === true
            });
            sendJson(res, 200, { success: true, result }, req, this.port);
            return;
        }

        sendJson(res, 404, { success: false, error: `Not found: ${pathname}` }, req, this.port);
    }

    private sessionPath(sessionId: string): string {
        return path.join(this.sessionsDir, `${sanitizeSessionId(sessionId)}.json`);
    }

    public createSession(input: DebugBridgeCreateSessionInput): DebugBridgeSession {
        const now = new Date().toISOString();
        const id = sanitizeSessionId(input.id);
        const existing = this.readSession(id);
        if (existing) return existing;

        const session: DebugBridgeSession = {
            id,
            title: input.title?.trim() || `Debug Session ${id}`,
            createdAt: now,
            updatedAt: now,
            metadata: input.metadata,
            messages: []
        };

        this.writeSession(session);
        this.onEvent?.({ type: 'session.created', sessionId: id, payload: session });
        return session;
    }

    public appendMessage(sessionId: string, input: DebugBridgeAppendMessageInput): DebugBridgeMessage {
        const session = this.readSession(sessionId) || this.createSession({ id: sessionId });
        const message: DebugBridgeMessage = {
            id: createMessageId(),
            timestamp: new Date().toISOString(),
            role: normalizeRole(input.role),
            direction: normalizeDirection(input.direction),
            content: String(input.content || '').trim(),
            agent: input.agent,
            metadata: input.metadata,
            trace: input.trace,
            toolCalls: input.toolCalls,
            errors: input.errors,
            executionSummary: normalizeExecutionSummary(input.executionSummary)
        };

        session.messages.push(message);
        session.updatedAt = message.timestamp;
        this.writeSession(session);
        this.writeLatestPointers(session, message);
        this.onEvent?.({ type: 'message.appended', sessionId: session.id, payload: message });
        return message;
    }

    public listSessions(): Array<Pick<DebugBridgeSession, 'id' | 'title' | 'createdAt' | 'updatedAt'> & { messageCount: number }> {
        return fs.readdirSync(this.sessionsDir)
            .filter(name => name.endsWith('.json'))
            .map(name => this.readSession(name.replace(/\.json$/i, '')))
            .filter((session): session is DebugBridgeSession => !!session)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(session => ({
                id: session.id,
                title: session.title,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                messageCount: session.messages.length
            }));
    }

    public readSession(sessionId: string): DebugBridgeSession | null {
        const filePath = this.sessionPath(sessionId);
        if (!fs.existsSync(filePath)) return null;
        return safeJsonParse<DebugBridgeSession>(fs.readFileSync(filePath, 'utf8'));
    }

    public canReadFullDebugData(debugToken?: string): boolean {
        const expected = String(process.env.DESIGNECHO_DEBUG_TOKEN || '').trim();
        return !!expected && String(debugToken || '') === expected;
    }

    public readSessionForDebugOutput(sessionId: string, options: DebugBridgeReadOptions = {}): DebugBridgeSession | DebugBridgeSessionSummary | null {
        const session = this.readSession(sessionId);
        if (!session) return null;
        if (options.includeFull && this.canReadFullDebugData(options.debugToken)) {
            return session;
        }
        return this.summarizeSession(session, options);
    }

    public summarizeSession(session: DebugBridgeSession, options: { messageLimit?: number } = {}): DebugBridgeSessionSummary {
        const limit = Math.max(0, Math.min(100, Number(options.messageLimit ?? 20)));
        const messages = limit > 0 ? session.messages.slice(-limit).map(message => this.summarizeMessage(message)) : undefined;
        const roleCounts: Record<string, number> = {};
        for (const message of session.messages) {
            roleCounts[message.role] = (roleCounts[message.role] || 0) + 1;
        }

        return {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
            metadataKeys: session.metadata ? Object.keys(session.metadata).sort() : [],
            roleCounts,
            risk: {
                redacted: true,
                hasMetadata: !!session.metadata && Object.keys(session.metadata).length > 0,
                hasTrace: session.messages.some(message => !!message.trace),
                hasToolCalls: session.messages.some(message => Array.isArray(message.toolCalls) && message.toolCalls.length > 0),
                hasErrors: session.messages.some(message => Array.isArray(message.errors) && message.errors.length > 0)
            },
            ...(messages ? { messages } : {})
        };
    }

    public summarizeMessage(message: DebugBridgeMessage): DebugBridgeMessageSummary {
        return {
            id: message.id,
            timestamp: message.timestamp,
            role: message.role,
            direction: message.direction,
            contentPreview: truncateText(message.content, 500),
            agent: message.agent,
            hasMetadata: !!message.metadata && Object.keys(message.metadata).length > 0,
            hasTrace: !!message.trace && Object.keys(message.trace).length > 0,
            toolCallCount: Array.isArray(message.toolCalls) ? message.toolCalls.length : 0,
            errorCount: Array.isArray(message.errors) ? message.errors.length : 0,
            executionSummary: summarizeExecutionSummary(message.executionSummary)
        };
    }

    private writeSession(session: DebugBridgeSession): void {
        const filePath = this.sessionPath(session.id);
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
    }

    private writeLatestPointers(session: DebugBridgeSession, message: DebugBridgeMessage): void {
        fs.writeFileSync(
            path.join(this.dataDir, 'latest-session.json'),
            JSON.stringify(session, null, 2),
            'utf8'
        );
        fs.writeFileSync(
            path.join(this.dataDir, 'latest-message.json'),
            JSON.stringify({ sessionId: session.id, message }, null, 2),
            'utf8'
        );
    }
}

function optionalString(value: unknown, maxLength = 300): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? truncateText(trimmed, maxLength) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function optionalStringArray(value: unknown, maxItems = 20): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, maxItems)
        .map(item => truncateText(item.trim(), 300));
    return items.length > 0 ? items : undefined;
}

function normalizeExecutionSummary(value: unknown): DebugBridgeExecutionSummary | undefined {
    if (!isRecord(value)) return undefined;

    const status = optionalString(value.status, 40);
    if (!status) return undefined;

    return {
        status,
        stopReason: optionalString(value.stopReason, 80),
        iterations: optionalNumber(value.iterations),
        toolCallCount: optionalNumber(value.toolCallCount),
        successfulToolCalls: optionalNumber(value.successfulToolCalls),
        failedToolCalls: optionalNumber(value.failedToolCalls),
        acceptanceVerified: optionalNumber(value.acceptanceVerified),
        acceptanceFailed: optionalNumber(value.acceptanceFailed),
        acceptanceNeedsReview: optionalNumber(value.acceptanceNeedsReview),
        noDocumentChangeRisks: optionalNumber(value.noDocumentChangeRisks),
        lastToolName: optionalString(value.lastToolName, 120),
        lastError: optionalString(value.lastError, 500),
        blockers: optionalStringArray(value.blockers),
        warnings: optionalStringArray(value.warnings),
        summaryText: optionalString(value.summaryText, 1000)
    };
}

function summarizeExecutionSummary(summary?: DebugBridgeExecutionSummary): DebugBridgeExecutionSummaryPreview | undefined {
    if (!summary) return undefined;
    return {
        status: summary.status,
        stopReason: summary.stopReason,
        iterations: summary.iterations,
        toolCallCount: summary.toolCallCount,
        successfulToolCalls: summary.successfulToolCalls,
        failedToolCalls: summary.failedToolCalls,
        acceptanceVerified: summary.acceptanceVerified,
        acceptanceFailed: summary.acceptanceFailed,
        acceptanceNeedsReview: summary.acceptanceNeedsReview,
        noDocumentChangeRisks: summary.noDocumentChangeRisks,
        lastToolName: summary.lastToolName,
        blockerCount: summary.blockers?.length || 0,
        warningCount: summary.warnings?.length || 0,
        summaryText: summary.summaryText ? truncateText(summary.summaryText, 500) : undefined
    };
}

function normalizeRole(role: string): DebugBridgeMessage['role'] {
    if (role === 'assistant' || role === 'system' || role === 'tool') return role;
    return 'user';
}

function normalizeDirection(direction: string): DebugBridgeMessage['direction'] {
    if (direction === 'outbound' || direction === 'event') return direction;
    return 'inbound';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
