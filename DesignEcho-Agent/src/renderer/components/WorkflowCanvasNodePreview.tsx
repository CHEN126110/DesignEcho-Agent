import React, { useCallback, useEffect, useRef, useState } from 'react';

// 画布预览节点的取数组件：WorkflowBoard 契约要求 shell 保持展示层，
// Photoshop 桥接调用与连接状态治理收拢在这里（与 ChatPanel 同一功能组件模式）。

interface DocumentSnapshotResponse {
    success: boolean;
    imageData?: string;
    width?: number;
    height?: number;
    documentInfo?: {
        id: number;
        name: string;
        width: number;
        height: number;
    };
    error?: string;
}

type CanvasPreviewPhase = 'unavailable' | 'disconnected' | 'loading' | 'ready' | 'error';

interface CanvasPreviewState {
    phase: CanvasPreviewPhase;
    imageDataUrl: string | null;
    documentName: string;
    documentSize: string;
    capturedAtLabel: string;
    notice: string;
}

const SNAPSHOT_REQUEST = {
    maxWidth: 480,
    maxHeight: 360,
    format: 'jpeg' as const
};

const INITIAL_STATE: CanvasPreviewState = {
    phase: 'loading',
    imageDataUrl: null,
    documentName: '',
    documentSize: '',
    capturedAtLabel: '',
    notice: ''
};

function formatCaptureTime(date: Date): string {
    return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function toBridgeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error || '');
    if (raw.includes('未连接')) {
        return '未连接 Photoshop：请启动 Photoshop 并打开 DesignEcho 插件面板。';
    }
    return raw || '获取画布截图失败：Photoshop 桥接调用未返回原因。';
}

export const WorkflowCanvasNodePreview: React.FC = () => {
    const [state, setState] = useState<CanvasPreviewState>(INITIAL_STATE);
    const [refreshing, setRefreshing] = useState(false);
    const requestSeqRef = useRef(0);
    const mountedRef = useRef(true);

    const captureSnapshot = useCallback(async (): Promise<void> => {
        const bridge = window.designEcho;
        if (!bridge?.sendToPlugin) {
            setState((current) => ({
                ...current,
                phase: 'unavailable',
                notice: '当前环境无法访问 Photoshop 桥接服务，画布预览不可用。'
            }));
            return;
        }

        const requestSeq = requestSeqRef.current + 1;
        requestSeqRef.current = requestSeq;
        setRefreshing(true);
        setState((current) => ({
            ...current,
            phase: current.imageDataUrl ? current.phase : 'loading',
            notice: ''
        }));

        try {
            const response = await bridge.sendToPlugin(
                'getDocumentSnapshot',
                SNAPSHOT_REQUEST
            ) as DocumentSnapshotResponse;
            if (!mountedRef.current || requestSeqRef.current !== requestSeq) return;

            if (!response?.success || !response.imageData) {
                setState((current) => ({
                    ...current,
                    phase: 'error',
                    notice: response?.error || '获取画布截图失败：Photoshop 未返回图像数据。'
                }));
                return;
            }

            const documentInfo = response.documentInfo;
            setState({
                phase: 'ready',
                imageDataUrl: `data:image/jpeg;base64,${response.imageData}`,
                documentName: documentInfo?.name || '未命名文档',
                documentSize: documentInfo
                    ? `${Math.round(documentInfo.width)} × ${Math.round(documentInfo.height)} px`
                    : '',
                capturedAtLabel: formatCaptureTime(new Date()),
                notice: ''
            });
        } catch (error) {
            if (!mountedRef.current || requestSeqRef.current !== requestSeq) return;
            const message = toBridgeErrorMessage(error);
            // phase 按错误语义划分：断连走琥珀提示，其余（超时/插件内部错误）走红色错误，避免样式与文案矛盾。
            const isDisconnect = message.includes('未连接 Photoshop');
            setState((current) => ({
                ...current,
                phase: isDisconnect ? 'disconnected' : 'error',
                notice: isDisconnect && current.imageDataUrl
                    ? 'Photoshop 连接已断开，正在显示最后一次截图。'
                    : message
            }));
        } finally {
            if (mountedRef.current && requestSeqRef.current === requestSeq) {
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        const bridge = window.designEcho;
        if (!bridge?.sendToPlugin) {
            setState((current) => ({
                ...current,
                phase: 'unavailable',
                notice: '当前环境无法访问 Photoshop 桥接服务，画布预览不可用。'
            }));
            return () => {
                mountedRef.current = false;
            };
        }

        let disposed = false;
        const initialize = async (): Promise<void> => {
            let connected = false;
            try {
                const status = await bridge.getConnectionStatus();
                connected = Boolean(status?.connected);
            } catch {
                connected = false;
            }
            if (disposed || !mountedRef.current) return;
            if (connected) {
                void captureSnapshot();
            } else if (requestSeqRef.current === 0) {
                // 若 onPluginConnected 已抢先触发截图，这份陈旧的"未连接"状态不再落盘。
                setState((current) => ({
                    ...current,
                    phase: 'disconnected',
                    notice: '未连接 Photoshop：请启动 Photoshop 并打开 DesignEcho 插件面板。'
                }));
            }
        };
        void initialize();

        const offConnected = bridge.onPluginConnected?.(() => {
            void captureSnapshot();
        });
        const offDisconnected = bridge.onPluginDisconnected?.(() => {
            setState((current) => ({
                ...current,
                phase: 'disconnected',
                notice: current.imageDataUrl
                    ? 'Photoshop 连接已断开，正在显示最后一次截图。'
                    : '未连接 Photoshop：请启动 Photoshop 并打开 DesignEcho 插件面板。'
            }));
        });

        return () => {
            disposed = true;
            mountedRef.current = false;
            offConnected?.();
            offDisconnected?.();
        };
    }, [captureSnapshot]);

    const showPlaceholder = !state.imageDataUrl;
    const placeholderText = state.phase === 'loading'
        ? '正在获取画布截图…'
        : state.notice || '暂无画布截图，点击刷新获取。';

    return (
        <span className="workflow-canvas-preview" data-testid="workflow-canvas-preview">
            {showPlaceholder ? (
                <span className={`workflow-canvas-preview-placeholder phase-${state.phase}`}>
                    {placeholderText}
                </span>
            ) : (
                <span className="workflow-canvas-preview-frame">
                    <img
                        src={state.imageDataUrl || undefined}
                        alt={state.documentName ? `Photoshop 文档 ${state.documentName} 的画布截图` : 'Photoshop 画布截图'}
                        draggable={false}
                    />
                </span>
            )}

            {!showPlaceholder && state.phase !== 'ready' && state.notice && (
                <span className={`workflow-canvas-preview-notice phase-${state.phase}`}>{state.notice}</span>
            )}

            <span className="workflow-canvas-preview-meta">
                <span className="workflow-canvas-preview-doc" title={state.documentName}>
                    {state.phase === 'ready' || state.imageDataUrl
                        ? `${state.documentName}${state.documentSize ? ` · ${state.documentSize}` : ''}`
                        : 'Photoshop 画布'}
                </span>
                <button
                    type="button"
                    className="workflow-canvas-preview-refresh nodrag"
                    onClick={(event) => {
                        // 阻止冒泡：刷新不应顺带改变节点选中/展开状态。
                        event.stopPropagation();
                        void captureSnapshot();
                    }}
                    disabled={refreshing || state.phase === 'unavailable'}
                    aria-label="刷新画布截图"
                >
                    {refreshing ? '刷新中…' : '刷新'}
                </button>
            </span>

            {state.capturedAtLabel && (
                <span className="workflow-canvas-preview-updated">更新于 {state.capturedAtLabel}</span>
            )}
        </span>
    );
};
