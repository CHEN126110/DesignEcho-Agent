// 工作流画布图数据的本地持久化：按项目身份存取 localStorage。
// 纯数据读写与校验，不触碰组件状态，WorkflowBoard 仍是图数据唯一 owner。

export interface PersistedWorkflowNode {
    id: string;
    kind: 'input' | 'model' | 'output' | 'action' | 'canvas';
    title: string;
    subtitle: string;
    typeLabel: string;
    position: { x: number; y: number };
}

export interface PersistedWorkflowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}

export interface WorkflowGraphSnapshot {
    documentId: string;
    nodes: PersistedWorkflowNode[];
    edges: PersistedWorkflowEdge[];
    nodeSequence: number;
    viewport: { x: number; y: number; zoom: number };
}

const STORAGE_SCHEMA_VERSION = 'workflow-graph/v1';
const STORAGE_KEY_PREFIX = 'designecho.workflow-graph.v1:';
const KNOWN_NODE_KINDS = new Set(['input', 'model', 'output', 'action', 'canvas']);
const VIEWPORT_MIN_ZOOM = 0.25;
const VIEWPORT_MAX_ZOOM = 2;

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function toStorageKey(persistenceKey: string): string {
    return `${STORAGE_KEY_PREFIX}${persistenceKey}`;
}

function sanitizeNodes(rawNodes: unknown): PersistedWorkflowNode[] | null {
    if (!Array.isArray(rawNodes)) return null;
    const seenIds = new Set<string>();
    const nodes: PersistedWorkflowNode[] = [];
    for (const raw of rawNodes) {
        if (!raw || typeof raw !== 'object') return null;
        const candidate = raw as Record<string, unknown>;
        const position = candidate.position as Record<string, unknown> | undefined;
        if (
            !isNonEmptyString(candidate.id)
            || seenIds.has(candidate.id)
            || !isNonEmptyString(candidate.kind)
            || !KNOWN_NODE_KINDS.has(candidate.kind)
            || typeof candidate.title !== 'string'
            || typeof candidate.subtitle !== 'string'
            || typeof candidate.typeLabel !== 'string'
            || !position
            || !isFiniteNumber(position.x)
            || !isFiniteNumber(position.y)
        ) {
            return null;
        }
        seenIds.add(candidate.id);
        nodes.push({
            id: candidate.id,
            kind: candidate.kind as PersistedWorkflowNode['kind'],
            title: candidate.title,
            subtitle: candidate.subtitle,
            typeLabel: candidate.typeLabel,
            position: { x: position.x as number, y: position.y as number }
        });
    }
    return nodes;
}

function sanitizeEdges(rawEdges: unknown, nodeIds: Set<string>): PersistedWorkflowEdge[] | null {
    if (!Array.isArray(rawEdges)) return null;
    const seenIds = new Set<string>();
    const edges: PersistedWorkflowEdge[] = [];
    for (const raw of rawEdges) {
        if (!raw || typeof raw !== 'object') return null;
        const candidate = raw as Record<string, unknown>;
        if (
            !isNonEmptyString(candidate.id)
            || seenIds.has(candidate.id)
            || !isNonEmptyString(candidate.source)
            || !isNonEmptyString(candidate.target)
            || candidate.source === candidate.target
        ) {
            return null;
        }
        // 指向已被删除节点的连线静默丢弃，不判定整份存档损坏。
        if (!nodeIds.has(candidate.source) || !nodeIds.has(candidate.target)) continue;
        seenIds.add(candidate.id);
        edges.push({
            id: candidate.id,
            source: candidate.source,
            target: candidate.target,
            ...(isNonEmptyString(candidate.sourceHandle) ? { sourceHandle: candidate.sourceHandle } : {}),
            ...(isNonEmptyString(candidate.targetHandle) ? { targetHandle: candidate.targetHandle } : {})
        });
    }
    return edges;
}

function sanitizeViewport(rawViewport: unknown): WorkflowGraphSnapshot['viewport'] | null {
    if (!rawViewport || typeof rawViewport !== 'object') return null;
    const candidate = rawViewport as Record<string, unknown>;
    if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y) || !isFiniteNumber(candidate.zoom)) {
        return null;
    }
    return {
        x: candidate.x,
        y: candidate.y,
        zoom: Math.min(VIEWPORT_MAX_ZOOM, Math.max(VIEWPORT_MIN_ZOOM, candidate.zoom))
    };
}

export function loadWorkflowGraphSnapshot(persistenceKey: string): WorkflowGraphSnapshot | null {
    let serialized: string | null = null;
    try {
        serialized = window.localStorage.getItem(toStorageKey(persistenceKey));
    } catch (error) {
        console.warn(`[workflow-graph-persistence] 读取工作流画布存档失败（key=${persistenceKey}）：localStorage 不可用。`, error);
        return null;
    }
    if (!serialized) return null;

    try {
        const parsed = JSON.parse(serialized) as Record<string, unknown>;
        if (parsed?.schemaVersion !== STORAGE_SCHEMA_VERSION) {
            console.warn(`[workflow-graph-persistence] 工作流画布存档版本不识别（key=${persistenceKey}），已回退默认拓扑。`);
            return null;
        }
        const nodes = sanitizeNodes(parsed.nodes);
        if (!nodes) {
            console.warn(`[workflow-graph-persistence] 工作流画布存档节点数据损坏（key=${persistenceKey}），已回退默认拓扑。`);
            return null;
        }
        const edges = sanitizeEdges(parsed.edges, new Set(nodes.map((node) => node.id)));
        if (!edges) {
            console.warn(`[workflow-graph-persistence] 工作流画布存档连线数据损坏（key=${persistenceKey}），已回退默认拓扑。`);
            return null;
        }
        return {
            documentId: isNonEmptyString(parsed.documentId) ? parsed.documentId : '',
            nodes,
            edges,
            nodeSequence: isFiniteNumber(parsed.nodeSequence) && parsed.nodeSequence > 0
                ? Math.floor(parsed.nodeSequence)
                : nodes.length + 1,
            viewport: sanitizeViewport(parsed.viewport) || { x: 40, y: 86, zoom: 1 }
        };
    } catch (error) {
        console.warn(`[workflow-graph-persistence] 工作流画布存档解析失败（key=${persistenceKey}），已回退默认拓扑。`, error);
        return null;
    }
}

export function persistWorkflowGraphSnapshot(
    persistenceKey: string,
    snapshot: WorkflowGraphSnapshot
): void {
    try {
        window.localStorage.setItem(toStorageKey(persistenceKey), JSON.stringify({
            schemaVersion: STORAGE_SCHEMA_VERSION,
            savedAt: new Date().toISOString(),
            ...snapshot
        }));
    } catch (error) {
        // 写失败（如配额）只告警不打断画布交互；下次变更会再次尝试。
        console.warn(`[workflow-graph-persistence] 保存工作流画布失败（key=${persistenceKey}）：本地存储写入被拒绝。`, error);
    }
}

export function serializeWorkflowGraphSnapshot(snapshot: WorkflowGraphSnapshot): string {
    return JSON.stringify(snapshot);
}
