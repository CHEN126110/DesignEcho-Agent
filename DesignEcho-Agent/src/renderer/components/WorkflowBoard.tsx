import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import {
    Background,
    BackgroundVariant,
    Handle,
    MiniMap,
    Position,
    ReactFlow,
    SelectionMode,
    addEdge,
    reconnectEdge,
    useEdgesState,
    useNodesState
} from '@xyflow/react';
import type {
    Connection,
    DefaultEdgeOptions,
    Edge,
    Node,
    NodeProps,
    OnMove,
    OnReconnect,
    OnSelectionChangeParams,
    ReactFlowInstance,
    XYPosition
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';
import './WorkflowBoard.css';

import { WorkflowCanvasNodePreview } from './WorkflowCanvasNodePreview';
import {
    loadWorkflowGraphSnapshot,
    persistWorkflowGraphSnapshot,
    serializeWorkflowGraphSnapshot,
    type WorkflowGraphSnapshot
} from './workflow-graph-persistence';

export type WorkflowNodeKind = 'input' | 'model' | 'output' | 'action' | 'canvas';
export type WorkflowNodeId = string;

type WorkflowNodeStatus = 'idle' | 'running' | 'done';

export interface WorkflowPaletteItem extends Record<string, unknown> {
    kind: WorkflowNodeKind;
    title: string;
    subtitle: string;
    typeLabel: string;
}

interface WorkflowBoardProps {
    selectedNodeId: WorkflowNodeId | null;
    onSelectNode: (nodeId: WorkflowNodeId | null) => void;
    addNodeRequest?: WorkflowNodeAddRequest | null;
    onSelectionContextChange?: (context: WorkflowSelectionContext) => void;
    // 按项目身份持久化图数据；缺省时保持一次性草稿行为（如无项目上下文的场景）。
    persistenceKey?: string;
}

export interface WorkflowNodeAddRequest {
    paletteIndex: number;
    revision: number;
}

export interface WorkflowSelectedNodeContext {
    readonly id: WorkflowNodeId;
    readonly type: 'workflow';
    readonly position: Readonly<XYPosition>;
    readonly data: Readonly<WorkflowPaletteItem>;
}

export interface WorkflowSelectionContext {
    readonly schemaVersion: 'workflow-selection-context/v0';
    readonly workflowDocument: {
        readonly id: string;
        readonly state: 'ephemeral_draft' | 'saved_draft';
    };
    readonly graph: {
        readonly revision: string;
        readonly fingerprint: string;
    };
    readonly selectedNode: WorkflowSelectedNodeContext | null;
}

export function buildWorkflowSelectionContextKey(context: WorkflowSelectionContext): string {
    return JSON.stringify([
        context.workflowDocument.id,
        context.workflowDocument.state,
        context.graph.fingerprint,
        context.selectedNode?.id || null
    ]);
}

type WorkflowCanvasNode = Node<WorkflowPaletteItem, 'workflow'>;
type WorkflowCanvasEdge = Edge;

interface WorkflowNodeActionsContextValue {
    activeNodeId: WorkflowNodeId | null;
    statusByNodeId: Record<WorkflowNodeId, WorkflowNodeStatus>;
    updateNodeData: (nodeId: WorkflowNodeId, patch: Partial<WorkflowPaletteItem>) => void;
    duplicateNode: (nodeId: WorkflowNodeId) => void;
    deleteNode: (nodeId: WorkflowNodeId) => void;
}

const MODEL_CYCLE = ['DeepSeek V4 Pro', 'GPT-4o', 'Claude 3.7 Sonnet', 'MiMo V2.5'];
const NODE_WIDTH = 200;
const NODE_DROP_Y_OFFSET = 30;

export const WORKFLOW_PALETTE: WorkflowPaletteItem[] = [
    { kind: 'input', title: '用户需求', subtitle: '描述你的设计需求', typeLabel: 'INPUT' },
    { kind: 'model', title: 'AI 逻辑理解', subtitle: 'DeepSeek V4 Pro', typeLabel: 'MODEL' },
    { kind: 'model', title: '视觉分析', subtitle: 'MiMo V2.5', typeLabel: 'MODEL' },
    { kind: 'model', title: '文案撰写', subtitle: 'MiMo V2.5', typeLabel: 'MODEL' },
    { kind: 'output', title: '生成设计方案', subtitle: '多版本输出', typeLabel: 'OUTPUT' },
    { kind: 'action', title: '写入 Photoshop', subtitle: '导出图层', typeLabel: 'ACTION' },
    { kind: 'canvas', title: 'Photoshop 画布', subtitle: '查看当前画布内容', typeLabel: 'CANVAS' }
];

const INITIAL_NODES: WorkflowCanvasNode[] = [
    createCanvasNode('n1', WORKFLOW_PALETTE[0], { x: 60, y: 160 }),
    createCanvasNode('n2', WORKFLOW_PALETTE[1], { x: 360, y: 60 }),
    createCanvasNode('n3', WORKFLOW_PALETTE[2], { x: 360, y: 260 }),
    createCanvasNode('n4', { ...WORKFLOW_PALETTE[4], subtitle: '3 个版本' }, { x: 660, y: 160 }),
    createCanvasNode('n5', WORKFLOW_PALETTE[5], { x: 960, y: 160 })
];

const INITIAL_EDGES: WorkflowCanvasEdge[] = [
    createCanvasEdge('e-n1-n2', 'n1', 'n2'),
    createCanvasEdge('e-n1-n3', 'n1', 'n3'),
    createCanvasEdge('e-n2-n4', 'n2', 'n4'),
    createCanvasEdge('e-n3-n4', 'n3', 'n4'),
    createCanvasEdge('e-n4-n5', 'n4', 'n5')
];

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
    animated: true,
    className: 'workflow-edge',
    type: 'default'
};

const FIT_VIEW_OPTIONS = {
    duration: 180,
    maxZoom: 1,
    padding: 0.22
};

const INITIAL_VIEWPORT = {
    x: 40,
    y: 86,
    zoom: 1
};

const CONNECTION_LINE_STYLE: React.CSSProperties = {
    stroke: '#3b82f6',
    strokeWidth: 1.5
};

const MULTI_SELECTION_KEY_CODES = ['Control', 'Meta'];
const PAN_ON_DRAG_MOUSE_BUTTONS = [1];
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };

const WorkflowNodeActionsContext = createContext<WorkflowNodeActionsContextValue | null>(null);

function createCanvasNode(
    id: WorkflowNodeId,
    item: WorkflowPaletteItem,
    position: XYPosition
): WorkflowCanvasNode {
    return {
        id,
        type: 'workflow',
        position,
        data: { ...item },
        ariaLabel: `${item.title}节点`
    };
}

function createCanvasEdge(id: string, source: WorkflowNodeId, target: WorkflowNodeId): WorkflowCanvasEdge {
    return {
        id,
        source,
        target,
        animated: true,
        className: 'workflow-edge',
        type: 'default'
    };
}

function createEphemeralWorkflowDocumentId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `workflow-draft-${globalThis.crypto.randomUUID()}`;
    }
    return `workflow-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function canonicalizeGraphValue(value: unknown): unknown {
    if (value === null) return null;
    if (Array.isArray(value)) {
        return value.map((item) => canonicalizeGraphValue(item));
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const canonical: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            const item = record[key];
            if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
            canonical[key] = canonicalizeGraphValue(item);
        }
        return canonical;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    if (typeof value === 'bigint') return value.toString();
    return value;
}

function hashGraphValue(value: unknown): string {
    const serialized = JSON.stringify(canonicalizeGraphValue(value));
    let hash = 0x811c9dc5;
    for (let index = 0; index < serialized.length; index += 1) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildGraphFingerprint(
    nodes: WorkflowCanvasNode[],
    edges: WorkflowCanvasEdge[]
): string {
    const canonicalNodes = nodes
        .map((node) => ({
            id: node.id,
            type: node.type || 'workflow',
            parentId: node.parentId || null,
            position: {
                x: node.position.x,
                y: node.position.y
            },
            data: node.data
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
    const canonicalEdges = edges
        .map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle || null,
            targetHandle: edge.targetHandle || null,
            type: edge.type || null,
            data: edge.data || null
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
    return hashGraphValue({ nodes: canonicalNodes, edges: canonicalEdges });
}

function statusLabel(status: WorkflowNodeStatus): string {
    if (status === 'running') return '运行中';
    if (status === 'done') return '已完成';
    return '未执行';
}

function connectionCreatesCycle(
    connection: Connection | WorkflowCanvasEdge,
    currentEdges: WorkflowCanvasEdge[]
): boolean {
    const source = connection.source;
    const target = connection.target;
    if (!source || !target || source === target) return true;

    const outgoingByNode = new Map<WorkflowNodeId, WorkflowNodeId[]>();
    for (const edge of currentEdges) {
        const outgoing = outgoingByNode.get(edge.source) || [];
        outgoing.push(edge.target);
        outgoingByNode.set(edge.source, outgoing);
    }

    const pending = [target];
    const visited = new Set<WorkflowNodeId>();
    while (pending.length > 0) {
        const currentNodeId = pending.pop();
        if (!currentNodeId || visited.has(currentNodeId)) continue;
        if (currentNodeId === source) return true;
        visited.add(currentNodeId);
        pending.push(...(outgoingByNode.get(currentNodeId) || []));
    }
    return false;
}

function nextModelSubtitle(currentSubtitle: string): string {
    const currentIndex = MODEL_CYCLE.indexOf(currentSubtitle);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % MODEL_CYCLE.length : 0;
    return MODEL_CYCLE[nextIndex];
}

function paletteMenuLabel(item: WorkflowPaletteItem): string {
    switch (item.kind) {
        case 'input':
            return '输入节点';
        case 'model':
            return '模型节点';
        case 'output':
            return '输出节点';
        case 'action':
            return '动作节点';
        case 'canvas':
            return '画布节点';
    }
}

function miniMapNodeColor(node: WorkflowCanvasNode): string {
    switch (node.data.kind) {
        case 'input':
            return '#60a5fa';
        case 'model':
            return '#a78bfa';
        case 'output':
            return '#4ade80';
        case 'action':
            return '#fbbf24';
        case 'canvas':
            return '#22d3ee';
    }
}

function useWorkflowNodeActions(): WorkflowNodeActionsContextValue {
    const context = useContext(WorkflowNodeActionsContext);
    if (!context) throw new Error('WorkflowNodeCard 必须在 WorkflowNodeActionsContext 中渲染');
    return context;
}

function WorkflowNodeCard({
    id,
    data,
    selected,
    isConnectable
}: NodeProps<WorkflowCanvasNode>): React.ReactElement {
    const {
        activeNodeId,
        statusByNodeId,
        updateNodeData,
        duplicateNode,
        deleteNode
    } = useWorkflowNodeActions();
    const status = statusByNodeId[id] || 'idle';
    const canReceiveInput = data.kind !== 'input';
    const canProvideOutput = data.kind !== 'action';
    const isCanvasPreview = data.kind === 'canvas';
    const expanded = selected && activeNodeId === id;

    return (
        <div
            className={`workflow-node kind-${data.kind} status-${status} ${selected ? 'selected' : ''}`}
            data-testid={`workflow-node-${id}`}
        >
            {canReceiveInput && (
                <Handle
                    id="input"
                    type="target"
                    position={Position.Left}
                    isConnectable={isConnectable}
                    className="workflow-node-handle workflow-node-handle-target"
                    title="输入端口"
                />
            )}

            <span className="workflow-node-heading">
                <span className="workflow-node-dot" />
                <span className="workflow-node-title">{data.title}</span>
                <span className="workflow-node-type">{data.typeLabel}</span>
            </span>

            {!expanded && !isCanvasPreview && <span className="workflow-node-subtitle">{data.subtitle}</span>}

            {isCanvasPreview && <WorkflowCanvasNodePreview />}

            {expanded && (
                <span className="workflow-node-editor nodrag nowheel">
                    {data.kind === 'input' && (
                        <textarea
                            className="nodrag nowheel"
                            value={data.subtitle}
                            onChange={(event) => updateNodeData(id, { subtitle: event.target.value })}
                            aria-label="用户需求内容"
                        />
                    )}
                    {data.kind === 'model' && (
                        <button
                            type="button"
                            className="workflow-node-model-select nodrag"
                            onClick={() => updateNodeData(id, { subtitle: nextModelSubtitle(data.subtitle) })}
                            aria-label="切换模型"
                        >
                            <span>{data.subtitle}</span>
                            <span aria-hidden="true">⌄</span>
                        </button>
                    )}
                    {data.kind !== 'input' && data.kind !== 'model' && !isCanvasPreview && (
                        <span className="workflow-node-expanded-copy">{data.subtitle}</span>
                    )}
                    <span className="workflow-node-status-row">
                        <span>状态</span>
                        <span className={`workflow-node-status status-${status}`}>{statusLabel(status)}</span>
                    </span>
                    <span className="workflow-node-actions">
                        <button type="button" className="nodrag" onClick={() => duplicateNode(id)}>复制</button>
                        <button type="button" className="danger nodrag" onClick={() => deleteNode(id)}>删除</button>
                    </span>
                </span>
            )}

            {canProvideOutput && (
                <Handle
                    id="output"
                    type="source"
                    position={Position.Right}
                    isConnectable={isConnectable}
                    className="workflow-node-handle workflow-node-handle-source"
                    title="输出端口"
                />
            )}
        </div>
    );
}

const WORKFLOW_NODE_TYPES = {
    workflow: WorkflowNodeCard
};

export const WorkflowBoard: React.FC<WorkflowBoardProps> = ({
    selectedNodeId,
    onSelectNode,
    addNodeRequest,
    onSelectionContextChange,
    persistenceKey
}) => {
    // 首帧同步恢复本项目图存档；无存档或存档损坏时回退默认拓扑。
    const [restoredSnapshot] = useState<WorkflowGraphSnapshot | null>(() => (
        persistenceKey ? loadWorkflowGraphSnapshot(persistenceKey) : null
    ));
    const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowCanvasNode>(
        restoredSnapshot
            ? restoredSnapshot.nodes.map((node) => createCanvasNode(
                node.id,
                { kind: node.kind, title: node.title, subtitle: node.subtitle, typeLabel: node.typeLabel },
                node.position
            ))
            : INITIAL_NODES
    );
    const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowCanvasEdge>(
        restoredSnapshot
            ? restoredSnapshot.edges.map((edge) => ({
                ...createCanvasEdge(edge.id, edge.source, edge.target),
                ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
                ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {})
            }))
            : INITIAL_EDGES
    );
    const [workflowDocumentId] = useState(() => restoredSnapshot?.documentId || createEphemeralWorkflowDocumentId());
    const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<WorkflowCanvasNode, WorkflowCanvasEdge> | null>(null);
    const [viewportZoom, setViewportZoom] = useState(restoredSnapshot?.viewport.zoom ?? 1);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [runHint, setRunHint] = useState('');
    const boardRef = useRef<HTMLElement>(null);
    const nodeSequenceRef = useRef(restoredSnapshot?.nodeSequence ?? INITIAL_NODES.length + 1);
    const runHintTimeoutRef = useRef<number | null>(null);
    const viewportRef = useRef(restoredSnapshot?.viewport ?? INITIAL_VIEWPORT);
    const saveTimeoutRef = useRef<number | null>(null);
    const lastPublishedSelectionKeyRef = useRef<string | null>(null);
    const lastSerializedRef = useRef<string | null>(
        restoredSnapshot ? serializeWorkflowGraphSnapshot(restoredSnapshot) : null
    );

    useEffect(() => () => {
        if (runHintTimeoutRef.current !== null) window.clearTimeout(runHintTimeoutRef.current);
    }, []);

    const buildGraphSnapshot = useCallback((): WorkflowGraphSnapshot => ({
        documentId: workflowDocumentId,
        nodes: nodes.map((node) => ({
            id: node.id,
            kind: node.data.kind,
            title: node.data.title,
            subtitle: node.data.subtitle,
            typeLabel: node.data.typeLabel,
            position: { x: node.position.x, y: node.position.y }
        })),
        edges: edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
            ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {})
        })),
        nodeSequence: nodeSequenceRef.current,
        viewport: {
            x: viewportRef.current.x,
            y: viewportRef.current.y,
            zoom: viewportRef.current.zoom
        }
    }), [edges, nodes, workflowDocumentId]);

    const persistGraphNow = useCallback((): void => {
        if (!persistenceKey) return;
        const snapshot = buildGraphSnapshot();
        const serialized = serializeWorkflowGraphSnapshot(snapshot);
        // 序列化去重：选中态等不进存档的状态变化不触发无意义写入。
        if (serialized === lastSerializedRef.current) return;
        lastSerializedRef.current = serialized;
        persistWorkflowGraphSnapshot(persistenceKey, snapshot);
    }, [buildGraphSnapshot, persistenceKey]);

    const persistGraphNowRef = useRef(persistGraphNow);
    useEffect(() => {
        persistGraphNowRef.current = persistGraphNow;
    }, [persistGraphNow]);

    const schedulePersistGraph = useCallback((): void => {
        if (!persistenceKey) return;
        if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = window.setTimeout(() => {
            saveTimeoutRef.current = null;
            persistGraphNowRef.current();
        }, 500);
    }, [persistenceKey]);

    useEffect(() => {
        schedulePersistGraph();
    }, [edges, nodes, schedulePersistGraph]);

    useEffect(() => {
        // 窗口重载/关闭不经过 React 卸载，pagehide 兜底落盘防抖窗口内的最后编辑。
        const flushOnPageHide = (): void => persistGraphNowRef.current();
        window.addEventListener('pagehide', flushOnPageHide);
        return () => {
            window.removeEventListener('pagehide', flushOnPageHide);
            // 卸载（切换/关闭项目）时立即落盘。
            if (saveTimeoutRef.current !== null) window.clearTimeout(saveTimeoutRef.current);
            persistGraphNowRef.current();
        };
    }, []);

    const selectionContext = useMemo<WorkflowSelectionContext>(() => {
        const fingerprint = buildGraphFingerprint(nodes, edges);
        const selectedNode = selectedNodeId
            ? nodes.find((node) => node.id === selectedNodeId) || null
            : null;
        return {
            schemaVersion: 'workflow-selection-context/v0',
            workflowDocument: {
                id: workflowDocumentId,
                state: persistenceKey ? 'saved_draft' : 'ephemeral_draft'
            },
            graph: {
                revision: `content@${fingerprint}`,
                fingerprint
            },
            selectedNode: selectedNode
                ? {
                    id: selectedNode.id,
                    type: 'workflow',
                    position: {
                        x: selectedNode.position.x,
                        y: selectedNode.position.y
                    },
                    data: { ...selectedNode.data }
                }
                : null
        };
    }, [edges, nodes, persistenceKey, selectedNodeId, workflowDocumentId]);

    useEffect(() => {
        if (!onSelectionContextChange) return;
        const selectionKey = buildWorkflowSelectionContextKey(selectionContext);
        if (selectionKey === lastPublishedSelectionKeyRef.current) return;

        lastPublishedSelectionKeyRef.current = selectionKey;
        onSelectionContextChange(selectionContext);
    }, [onSelectionContextChange, selectionContext]);

    const createNodeId = useCallback((): WorkflowNodeId => {
        const sequence = nodeSequenceRef.current;
        nodeSequenceRef.current += 1;
        return `node-${Date.now()}-${sequence}`;
    }, []);

    const updateNodeData = useCallback((
        nodeId: WorkflowNodeId,
        patch: Partial<WorkflowPaletteItem>
    ): void => {
        setNodes((current) => current.map((node) => {
            if (node.id !== nodeId) return node;
            return { ...node, data: { ...node.data, ...patch } };
        }));
    }, [setNodes]);

    const deleteNode = useCallback((nodeId: WorkflowNodeId): void => {
        setNodes((current) => current.filter((node) => node.id !== nodeId));
        setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
        onSelectNode(null);
    }, [onSelectNode, setEdges, setNodes]);

    const duplicateNodes = useCallback((nodeIds: WorkflowNodeId[]): void => {
        const selectedIds = new Set(nodeIds);
        const sourceNodes = nodes.filter((node) => selectedIds.has(node.id));
        if (sourceNodes.length === 0) return;

        const copies = sourceNodes.map((source) => createCanvasNode(
            createNodeId(),
            { ...source.data, title: `${source.data.title} 副本` },
            { x: source.position.x + 36, y: source.position.y + 36 }
        ));
        const selectedCopies = copies.map((copy) => ({ ...copy, selected: true }));
        setNodes((current) => [
            ...current.map((node) => ({ ...node, selected: false })),
            ...selectedCopies
        ]);
        onSelectNode(selectedCopies[selectedCopies.length - 1].id);
    }, [createNodeId, nodes, onSelectNode, setNodes]);

    const duplicateNode = useCallback((nodeId: WorkflowNodeId): void => {
        duplicateNodes([nodeId]);
    }, [duplicateNodes]);

    const addNode = useCallback((item: WorkflowPaletteItem, position?: XYPosition): void => {
        let nextPosition = position;
        const board = boardRef.current;
        if (!nextPosition && reactFlowInstance && board) {
            const rect = board.getBoundingClientRect();
            nextPosition = reactFlowInstance.screenToFlowPosition({
                x: rect.left + rect.width * 0.48,
                y: rect.top + rect.height * 0.42
            });
        }
        if (!nextPosition) nextPosition = { x: 520, y: 320 };

        const nodeId = createNodeId();
        const nextNode = {
            ...createCanvasNode(nodeId, item, nextPosition),
            selected: true
        };
        setNodes((current) => [
            ...current.map((node) => ({ ...node, selected: false })),
            nextNode
        ]);
        onSelectNode(nodeId);
        setAddMenuOpen(false);
    }, [createNodeId, onSelectNode, reactFlowInstance, setNodes]);

    const handledAddRequestRef = useRef<number | null>(null);
    useEffect(() => {
        if (!addNodeRequest) return;
        // 同一请求只消费一次：addNode 身份变化（如 ReactFlow init 完成）不得用旧请求重复加节点。
        if (handledAddRequestRef.current === addNodeRequest.revision) return;
        handledAddRequestRef.current = addNodeRequest.revision;
        const item = WORKFLOW_PALETTE[addNodeRequest.paletteIndex];
        if (item) addNode(item);
    }, [addNode, addNodeRequest]);

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const rawPaletteIndex = event.dataTransfer.getData('application/x-designecho-workflow-node');
        if (!/^\d+$/.test(rawPaletteIndex)) return;
        const paletteIndex = Number.parseInt(rawPaletteIndex, 10);
        const item = WORKFLOW_PALETTE[paletteIndex];
        if (!item || !reactFlowInstance) return;

        const flowPosition = reactFlowInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY
        });
        addNode(item, {
            x: flowPosition.x - NODE_WIDTH / 2,
            y: flowPosition.y - NODE_DROP_Y_OFFSET
        });
    }, [addNode, reactFlowInstance]);

    const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleConnect = useCallback((connection: Connection): void => {
        setEdges((current) => {
            if (connectionCreatesCycle(connection, current)) return current;
            return addEdge({
                ...connection,
                animated: true,
                className: 'workflow-edge',
                type: 'default'
            }, current);
        });
    }, [setEdges]);

    const handleReconnect = useCallback<OnReconnect<WorkflowCanvasEdge>>((oldEdge, connection): void => {
        setEdges((current) => {
            const remainingEdges = current.filter((edge) => edge.id !== oldEdge.id);
            if (connectionCreatesCycle(connection, remainingEdges)) return current;
            return reconnectEdge(oldEdge, connection, current);
        });
    }, [setEdges]);

    const isValidConnection = useCallback((connection: Connection | WorkflowCanvasEdge): boolean => {
        return !connectionCreatesCycle(connection, edges);
    }, [edges]);

    const handleNodesDelete = useCallback((deletedNodes: WorkflowCanvasNode[]): void => {
        const deletedIds = new Set(deletedNodes.map((node) => node.id));
        setEdges((current) => current.filter(
            (edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)
        ));
        onSelectNode(null);
    }, [onSelectNode, setEdges]);

    const handleSelectionChange = useCallback((
        params: OnSelectionChangeParams<WorkflowCanvasNode, WorkflowCanvasEdge>
    ): void => {
        const selectedNodes = params.nodes;
        if (selectedNodes.length !== 1) {
            // Agent 上下文绑定当前只接受唯一对象；多选仍保留画布交互，但不能静默取第一个节点。
            onSelectNode(null);
            return;
        }
        if (selectedNodeId && selectedNodes.some((node) => node.id === selectedNodeId)) return;
        onSelectNode(selectedNodes[0].id);
    }, [onSelectNode, selectedNodeId]);

    const handleNodeClick = useCallback((_event: React.MouseEvent, node: WorkflowCanvasNode): void => {
        onSelectNode(node.id);
    }, [onSelectNode]);

    const handlePaneClick = useCallback((): void => {
        setAddMenuOpen(false);
        onSelectNode(null);
    }, [onSelectNode]);

    const handleViewportMove = useCallback<OnMove>((_event, viewport): void => {
        viewportRef.current = viewport;
        setViewportZoom(viewport.zoom);
    }, []);

    const handleViewportMoveEnd = useCallback<OnMove>((_event, viewport): void => {
        viewportRef.current = viewport;
        schedulePersistGraph();
    }, [schedulePersistGraph]);

    const handleBoardKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>): void => {
        const target = event.target as HTMLElement;
        if (target.closest('textarea, input, select, button, [contenteditable="true"]')) return;

        if (event.key === 'Escape') {
            setNodes((current) => current.map((node) => ({ ...node, selected: false })));
            setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
            setAddMenuOpen(false);
            onSelectNode(null);
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            const selectedNodeIds = new Set(
                nodes.filter((node) => node.selected).map((node) => node.id)
            );
            const selectedEdgeIds = new Set(
                edges.filter((edge) => edge.selected).map((edge) => edge.id)
            );
            if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;
            event.preventDefault();
            setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
            setEdges((current) => current.filter((edge) => (
                !selectedEdgeIds.has(edge.id)
                && !selectedNodeIds.has(edge.source)
                && !selectedNodeIds.has(edge.target)
            )));
            onSelectNode(null);
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
            const selectedIds = nodes.filter((node) => node.selected).map((node) => node.id);
            if (selectedIds.length === 0 && selectedNodeId) selectedIds.push(selectedNodeId);
            if (selectedIds.length === 0) return;
            event.preventDefault();
            duplicateNodes(selectedIds);
        }
    }, [duplicateNodes, edges, nodes, onSelectNode, selectedNodeId, setEdges, setNodes]);

    const handleSendToAgent = useCallback((): void => {
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]');
        input?.focus();
        setRunHint('请在右侧输入或确认需求后发送给 Agent。');
        if (runHintTimeoutRef.current !== null) window.clearTimeout(runHintTimeoutRef.current);
        runHintTimeoutRef.current = window.setTimeout(() => {
            runHintTimeoutRef.current = null;
            setRunHint('');
        }, 2600);
    }, []);

    const nodeActions = useMemo<WorkflowNodeActionsContextValue>(() => ({
        activeNodeId: selectedNodeId,
        statusByNodeId: {},
        updateNodeData,
        duplicateNode,
        deleteNode
    }), [deleteNode, duplicateNode, selectedNodeId, updateNodeData]);

    return (
        <WorkflowNodeActionsContext.Provider value={nodeActions}>
            <section
                ref={boardRef}
                className="workflow-board"
                aria-label="设计工作流画布"
                onKeyDown={handleBoardKeyDown}
            >
                <ReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>
                    className="workflow-react-flow"
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={WORKFLOW_NODE_TYPES}
                    defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodesDelete={handleNodesDelete}
                    onNodeClick={handleNodeClick}
                    onConnect={handleConnect}
                    onReconnect={handleReconnect}
                    isValidConnection={isValidConnection}
                    onSelectionChange={handleSelectionChange}
                    onPaneClick={handlePaneClick}
                    onMove={handleViewportMove}
                    onMoveEnd={handleViewportMoveEnd}
                    onInit={setReactFlowInstance}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    deleteKeyCode={null}
                    selectionKeyCode="Control"
                    multiSelectionKeyCode={MULTI_SELECTION_KEY_CODES}
                    panActivationKeyCode={null}
                    panOnDrag={PAN_ON_DRAG_MOUSE_BUTTONS}
                    panOnScroll={false}
                    zoomOnScroll
                    zoomOnPinch
                    zoomOnDoubleClick={false}
                    selectionMode={SelectionMode.Partial}
                    minZoom={0.25}
                    maxZoom={2}
                    defaultViewport={restoredSnapshot?.viewport ?? INITIAL_VIEWPORT}
                    nodeDragThreshold={3}
                    connectionDragThreshold={4}
                    connectionLineStyle={CONNECTION_LINE_STYLE}
                    elevateEdgesOnSelect
                    edgesReconnectable
                    preventScrolling
                    proOptions={REACT_FLOW_PRO_OPTIONS}
                    aria-label="可平移、缩放和连接节点的工作流画布"
                >
                    <Background
                        id="workflow-grid"
                        variant={BackgroundVariant.Dots}
                        gap={22}
                        size={1}
                        color="rgba(255, 255, 255, 0.10)"
                    />
                    <MiniMap<WorkflowCanvasNode>
                        className="workflow-minimap"
                        nodeColor={miniMapNodeColor}
                        maskColor="rgba(8, 11, 15, 0.72)"
                        pannable
                        zoomable
                        ariaLabel="工作流小地图"
                    />
                </ReactFlow>

                <span className="workflow-canvas-help" aria-hidden="true">
                    Ctrl + 拖动框选 · 鼠标中键平移 · 滚轮缩放
                </span>

                <div className="workflow-board-controls workflow-viewport-controls" aria-label="画布视口控制">
                    <button
                        type="button"
                        onClick={() => reactFlowInstance?.zoomOut({ duration: 140 })}
                        aria-label="缩小画布"
                    >
                        −
                    </button>
                    <button
                        type="button"
                        className="workflow-zoom-value"
                        onClick={() => reactFlowInstance?.zoomTo(1, { duration: 140 })}
                        aria-label="恢复 100% 缩放"
                    >
                        {Math.round(viewportZoom * 100)}%
                    </button>
                    <button
                        type="button"
                        onClick={() => reactFlowInstance?.zoomIn({ duration: 140 })}
                        aria-label="放大画布"
                    >
                        ＋
                    </button>
                    <span className="workflow-toolbar-divider" />
                    <button
                        type="button"
                        className="workflow-fit-view-button"
                        onClick={() => reactFlowInstance?.fitView(FIT_VIEW_OPTIONS)}
                        aria-label="适配全部节点"
                    >
                        适配
                    </button>
                </div>

                <div className="workflow-board-controls workflow-creation-dock" aria-label="工作流创作工具">
                    <button
                        type="button"
                        className="workflow-add-button"
                        aria-expanded={addMenuOpen}
                        onClick={() => setAddMenuOpen((open) => !open)}
                    >
                        <span aria-hidden="true">＋</span> 节点
                    </button>
                    <span className="workflow-toolbar-divider" />
                    <button type="button" className="workflow-run-button" onClick={handleSendToAgent}>
                        <span aria-hidden="true">↗</span> 交给 Agent
                    </button>
                </div>

                {addMenuOpen && (
                    <div className="workflow-add-menu" role="menu" aria-label="添加节点">
                        {[WORKFLOW_PALETTE[0], WORKFLOW_PALETTE[1], WORKFLOW_PALETTE[4], WORKFLOW_PALETTE[5], WORKFLOW_PALETTE[6]].map((item) => (
                            <button
                                key={item.kind}
                                type="button"
                                role="menuitem"
                                onClick={() => addNode(item)}
                            >
                                ＋ {paletteMenuLabel(item)}
                            </button>
                        ))}
                    </div>
                )}

                <span className="workflow-run-hint" aria-live="polite">{runHint}</span>
            </section>
        </WorkflowNodeActionsContext.Provider>
    );
};
