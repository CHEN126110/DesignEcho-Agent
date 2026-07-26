import React from 'react';

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
    componentStack?: string;
}

/**
 * 顶层错误边界：renderer 渲染期或懒加载 chunk（DesignAgentWorkbench 等）抛错时，
 * 渲染一个**可见、非纯黑**的错误页，而不是让 React 整树卸载、#root 变空，
 * 露出与窗口背景同色（#0d0d14）的纯黑屏。提供「重新加载」按钮自愈。
 *
 * 这是桌面端反复黑屏的治本兜底层之一——把"静默黑屏无反馈"变成"可读错误 + 可恢复"。
 * 注意：ErrorBoundary 只能捕获其子树**渲染期**的错误；React 挂载之前/之外的错误
 * （模块导入副作用、persist 同步水合）由 main.tsx 的全局 error 监听兜底。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        // 错误信息可诊断：组件栈进状态（界面可见）+ console.error（主进程 console-message 钩子落盘 errors.log）。
        this.setState({ componentStack: info?.componentStack || undefined });
        console.error(`[ErrorBoundary] renderer 渲染异常: ${error?.message || error} 组件栈: ${info?.componentStack || '无'}`);
    }

    render(): React.ReactNode {
        if (!this.state.hasError) return this.props.children;
        return (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 16,
                    padding: 32,
                    boxSizing: 'border-box',
                    background: '#1a1a24',
                    color: '#e8e8f0',
                    fontFamily: 'system-ui, -apple-system, "Microsoft YaHei", sans-serif',
                    textAlign: 'center'
                }}
            >
                <div style={{ fontSize: 18, fontWeight: 600 }}>界面加载遇到问题</div>
                <pre
                    style={{
                        maxWidth: 680,
                        maxHeight: 240,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        fontSize: 12,
                        color: '#a0a0b8',
                        background: '#0d0d14',
                        padding: '12px 16px',
                        borderRadius: 8,
                        margin: 0
                    }}
                >
                    {this.state.error?.message || '未知渲染错误'}
                    {this.state.componentStack ? `\n\n出错组件位置：${this.state.componentStack}` : ''}
                </pre>
                <button
                    onClick={() => window.location.reload()}
                    style={{
                        padding: '8px 20px',
                        fontSize: 14,
                        border: 'none',
                        borderRadius: 6,
                        background: '#4f7cff',
                        color: '#fff',
                        cursor: 'pointer'
                    }}
                >
                    重新加载
                </button>
            </div>
        );
    }
}
