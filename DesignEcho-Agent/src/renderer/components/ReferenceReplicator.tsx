/**
 * 参考图排版复刻组件
 * 
 * 功能流程：
 * 1. 上传参考图
 * 2. AI 分析参考图布局
 * 3. 显示布局分析结果
 * 4. 映射到当前文档图层
 * 5. 执行布局复刻
 */

import React, { useState, useCallback } from 'react';
import { ReferenceUpload } from './ReferenceUpload';
import { useReferenceReplication, ReplicationState } from '../hooks/useReferenceReplication';
import { LayoutElement } from '../../shared/prompts/reference-analysis';

interface ReferenceReplicatorProps {
    isPluginConnected: boolean;
    onClose?: () => void;
}

export const ReferenceReplicator: React.FC<ReferenceReplicatorProps> = ({
    isPluginConnected,
    onClose
}) => {
    const { state, analyzeReference, executeReplication, reset } = useReferenceReplication();
    const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());

    // 上传参考图
    const handleUpload = useCallback(async (_file: File, base64: string) => {
        await analyzeReference(base64);
    }, [analyzeReference]);

    // 切换元素选择
    const toggleElement = useCallback((id: string) => {
        setSelectedElements(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    // 全选/取消全选
    const toggleAllElements = useCallback(() => {
        if (!state.layoutAnalysis) return;
        
        if (selectedElements.size === state.layoutAnalysis.elements.length) {
            setSelectedElements(new Set());
        } else {
            setSelectedElements(new Set(state.layoutAnalysis.elements.map(e => e.id)));
        }
    }, [state.layoutAnalysis, selectedElements]);

    // 执行复刻
    const handleExecute = useCallback(async () => {
        await executeReplication();
    }, [executeReplication]);

    // 重新开始
    const handleReset = useCallback(() => {
        reset();
        setSelectedElements(new Set());
    }, [reset]);

    // 获取阶段描述
    const getStageText = (stage: ReplicationState['stage']): string => {
        const stageMap: Record<ReplicationState['stage'], string> = {
            'idle': '等待上传',
            'analyzing': '分析中...',
            'mapping': '元素映射中...',
            'generating': '生成指令中...',
            'executing': '执行复刻中...',
            'done': '完成',
            'error': '出错'
        };
        return stageMap[stage];
    };

    // 获取元素类型的中文名
    const getElementTypeName = (type: LayoutElement['type']): string => {
        const typeMap: Record<LayoutElement['type'], string> = {
            'main-title': '主标题',
            'sub-title': '副标题',
            'body-text': '正文',
            'cta': '行动按钮',
            'product-image': '产品图',
            'background': '背景',
            'decoration': '装饰',
            'logo': 'Logo',
            'tag': '标签'
        };
        return typeMap[type] || type;
    };

    // 获取元素类型的图标
    const getElementIcon = (type: LayoutElement['type']): string => {
        const iconMap: Record<LayoutElement['type'], string> = {
            'main-title': '📝',
            'sub-title': '📄',
            'body-text': '📋',
            'cta': '🔘',
            'product-image': '🖼️',
            'background': '🎨',
            'decoration': '✨',
            'logo': '🏷️',
            'tag': '🏅'
        };
        return iconMap[type] || '📦';
    };

    return (
        <div className="reference-replicator">
            {/* 头部 */}
            <div className="replicator-header">
                <h3>📐 参考图排版复刻</h3>
                {onClose && (
                    <button className="close-btn" onClick={onClose}>×</button>
                )}
            </div>

            {/* 连接状态提示 */}
            {!isPluginConnected && (
                <div className="connection-warning">
                    ⚠️ 请先连接 Photoshop 插件
                </div>
            )}

            {/* 主要内容区 */}
            <div className="replicator-content">
                {/* 阶段 1: 上传参考图 */}
                {state.stage === 'idle' && (
                    <div className="upload-section">
                        <p className="section-desc">
                            上传一张参考图，AI 将分析其布局结构并应用到当前设计中
                        </p>
                        <ReferenceUpload 
                            onUpload={handleUpload} 
                            isLoading={false}
                        />
                    </div>
                )}

                {/* 阶段 2: 分析中 */}
                {(state.stage === 'analyzing' || state.stage === 'mapping' || state.stage === 'generating') && (
                    <div className="analyzing-section">
                        <div className="analyzing-indicator">
                            <div className="spinner"></div>
                            <span>{getStageText(state.stage)}</span>
                        </div>
                        
                        {/* 参考图预览 */}
                        {state.referenceImage && (
                            <div className="reference-preview">
                                <img 
                                    src={`data:image/jpeg;base64,${state.referenceImage}`} 
                                    alt="参考图" 
                                />
                            </div>
                        )}

                        {/* 日志输出 */}
                        <div className="logs-panel">
                            {state.logs.map((log, i) => (
                                <div key={i} className="log-line">{log}</div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 阶段 3: 分析完成，显示结果 */}
                {(state.stage === 'done' && state.layoutAnalysis) && (
                    <div className="result-section">
                        {/* 布局信息 */}
                        <div className="layout-info">
                            <h4>📊 布局分析结果</h4>
                            <div className="info-grid">
                                <div className="info-item">
                                    <span className="label">布局类型</span>
                                    <span className="value">{state.layoutAnalysis.layoutType}</span>
                                </div>
                                <div className="info-item">
                                    <span className="label">画布尺寸</span>
                                    <span className="value">
                                        {state.layoutAnalysis.canvasSize.width} × {state.layoutAnalysis.canvasSize.height}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="label">宽高比</span>
                                    <span className="value">{state.layoutAnalysis.canvasSize.aspectRatio}</span>
                                </div>
                                <div className="info-item">
                                    <span className="label">元素数量</span>
                                    <span className="value">{state.layoutAnalysis.elements.length} 个</span>
                                </div>
                            </div>
                        </div>

                        {/* 元素列表 */}
                        <div className="elements-section">
                            <div className="elements-header">
                                <h4>🎯 识别的元素</h4>
                                <button 
                                    className="select-all-btn"
                                    onClick={toggleAllElements}
                                >
                                    {selectedElements.size === state.layoutAnalysis.elements.length 
                                        ? '取消全选' : '全选'}
                                </button>
                            </div>
                            
                            <div className="elements-list">
                                {state.layoutAnalysis.elements.map((element) => (
                                    <div 
                                        key={element.id}
                                        className={`element-card ${selectedElements.has(element.id) ? 'selected' : ''}`}
                                        onClick={() => toggleElement(element.id)}
                                    >
                                        <div className="element-header">
                                            <span className="element-icon">{getElementIcon(element.type)}</span>
                                            <span className="element-type">{getElementTypeName(element.type)}</span>
                                            <span className="element-id">{element.id}</span>
                                        </div>
                                        {element.content && (
                                            <div className="element-content">"{element.content}"</div>
                                        )}
                                        <div className="element-position">
                                            位置: X {element.position.x}% Y {element.position.y}% | 
                                            尺寸: {element.position.width}% × {element.position.height}%
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 布局建议 */}
                        {state.layoutAnalysis.suggestions && state.layoutAnalysis.suggestions.length > 0 && (
                            <div className="suggestions-section">
                                <h4>💡 布局建议</h4>
                                <ul>
                                    {state.layoutAnalysis.suggestions.map((sugg, i) => (
                                        <li key={i}>{sugg}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* 操作指令预览 */}
                        {state.actions.length > 0 && (
                            <div className="actions-preview">
                                <h4>📋 将执行的操作 ({state.actions.length} 步)</h4>
                                <div className="actions-list">
                                    {state.actions.slice(0, 5).map((action, i) => (
                                        <div key={i} className="action-item">
                                            <span className="step">{i + 1}.</span>
                                            <span className="tool">{action.tool}</span>
                                            <span className="params">{JSON.stringify(action.params)}</span>
                                        </div>
                                    ))}
                                    {state.actions.length > 5 && (
                                        <div className="more-actions">
                                            还有 {state.actions.length - 5} 个操作...
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 操作按钮 */}
                        <div className="action-buttons">
                            <button 
                                className="reset-btn"
                                onClick={handleReset}
                            >
                                重新上传
                            </button>
                            <button 
                                className="execute-btn"
                                onClick={handleExecute}
                                disabled={state.actions.length === 0 || !isPluginConnected}
                            >
                                🚀 执行复刻
                            </button>
                        </div>
                    </div>
                )}

                {/* 阶段 4: 执行中 */}
                {state.stage === 'executing' && (
                    <div className="executing-section">
                        <div className="progress-header">
                            <span>正在执行复刻...</span>
                            <span className="progress-text">{state.progress}%</span>
                        </div>
                        <div className="progress-bar">
                            <div 
                                className="progress-fill"
                                style={{ width: `${state.progress}%` }}
                            ></div>
                        </div>
                        
                        {/* 实时日志 */}
                        <div className="logs-panel executing">
                            {state.logs.slice(-10).map((log, i) => (
                                <div key={i} className="log-line">{log}</div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 错误状态 */}
                {state.stage === 'error' && (
                    <div className="error-section">
                        <div className="error-icon">❌</div>
                        <div className="error-message">{state.error}</div>
                        <button className="retry-btn" onClick={handleReset}>
                            重试
                        </button>
                    </div>
                )}
            </div>

            <style>{`
                .reference-replicator {
                    background: var(--de-bg-card);
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid var(--de-border);
                }

                .replicator-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1));
                    border-bottom: 1px solid var(--de-border);
                }

                .replicator-header h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--de-text-primary);
                }

                .close-btn {
                    width: 28px;
                    height: 28px;
                    border: none;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 6px;
                    font-size: 18px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .close-btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                    color: var(--de-text-primary);
                }

                .connection-warning {
                    padding: 12px 20px;
                    background: rgba(251, 191, 36, 0.15);
                    color: #f59e0b;
                    font-size: 13px;
                    border-bottom: 1px solid rgba(251, 191, 36, 0.2);
                }

                .replicator-content {
                    padding: 20px;
                }

                .section-desc {
                    color: var(--de-text-secondary);
                    font-size: 13px;
                    margin-bottom: 16px;
                    line-height: 1.5;
                }

                /* 分析中状态 */
                .analyzing-section {
                    text-align: center;
                }

                .analyzing-indicator {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    margin-bottom: 20px;
                    color: var(--de-primary);
                    font-weight: 500;
                }

                .spinner {
                    width: 24px;
                    height: 24px;
                    border: 3px solid var(--de-border);
                    border-top-color: var(--de-primary);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .reference-preview {
                    max-width: 300px;
                    margin: 0 auto 20px;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid var(--de-border);
                }

                .reference-preview img {
                    width: 100%;
                    display: block;
                }

                /* 日志面板 */
                .logs-panel {
                    background: var(--de-bg-dark);
                    border-radius: 8px;
                    padding: 12px;
                    max-height: 150px;
                    overflow-y: auto;
                    font-family: 'JetBrains Mono', 'Fira Code', monospace;
                    font-size: 11px;
                    text-align: left;
                }

                .logs-panel.executing {
                    max-height: 200px;
                }

                .log-line {
                    color: var(--de-text-secondary);
                    padding: 2px 0;
                    word-break: break-all;
                }

                .log-line:last-child {
                    color: var(--de-text-primary);
                }

                /* 结果展示 */
                .result-section h4 {
                    margin: 0 0 12px;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--de-text-primary);
                }

                .layout-info {
                    margin-bottom: 20px;
                }

                .info-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                }

                .info-item {
                    background: var(--de-bg-light);
                    padding: 12px;
                    border-radius: 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .info-item .label {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .info-item .value {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--de-text-primary);
                }

                /* 元素列表 */
                .elements-section {
                    margin-bottom: 20px;
                }

                .elements-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                }

                .elements-header h4 {
                    margin: 0;
                }

                .select-all-btn {
                    padding: 6px 12px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .select-all-btn:hover {
                    background: var(--de-primary);
                    color: white;
                    border-color: var(--de-primary);
                }

                .elements-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 250px;
                    overflow-y: auto;
                }

                .element-card {
                    background: var(--de-bg-light);
                    padding: 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: 2px solid transparent;
                }

                .element-card:hover {
                    background: var(--de-bg-card);
                    border-color: var(--de-border);
                }

                .element-card.selected {
                    border-color: var(--de-primary);
                    background: rgba(99, 102, 241, 0.1);
                }

                .element-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 6px;
                }

                .element-icon {
                    font-size: 16px;
                }

                .element-type {
                    font-weight: 600;
                    color: var(--de-text-primary);
                    font-size: 13px;
                }

                .element-id {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    background: var(--de-bg-dark);
                    padding: 2px 6px;
                    border-radius: 4px;
                    margin-left: auto;
                }

                .element-content {
                    font-size: 12px;
                    color: var(--de-primary);
                    margin-bottom: 6px;
                    font-style: italic;
                }

                .element-position {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                }

                /* 建议列表 */
                .suggestions-section {
                    margin-bottom: 20px;
                }

                .suggestions-section ul {
                    margin: 0;
                    padding-left: 20px;
                }

                .suggestions-section li {
                    color: var(--de-text-secondary);
                    font-size: 13px;
                    margin-bottom: 6px;
                }

                /* 操作预览 */
                .actions-preview {
                    margin-bottom: 20px;
                    background: var(--de-bg-dark);
                    border-radius: 8px;
                    padding: 12px;
                }

                .actions-preview h4 {
                    margin-bottom: 8px;
                }

                .actions-list {
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 11px;
                }

                .action-item {
                    display: flex;
                    gap: 8px;
                    padding: 4px 0;
                    color: var(--de-text-secondary);
                }

                .action-item .step {
                    color: var(--de-primary);
                    font-weight: 600;
                }

                .action-item .tool {
                    color: #10b981;
                }

                .action-item .params {
                    color: var(--de-text-secondary);
                    opacity: 0.7;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .more-actions {
                    color: var(--de-text-secondary);
                    font-style: italic;
                    padding-top: 4px;
                }

                /* 操作按钮 */
                .action-buttons {
                    display: flex;
                    gap: 12px;
                }

                .reset-btn, .execute-btn, .retry-btn {
                    flex: 1;
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .reset-btn {
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    color: var(--de-text-secondary);
                }

                .reset-btn:hover {
                    background: var(--de-bg-card);
                    color: var(--de-text-primary);
                }

                .execute-btn {
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    border: none;
                    color: white;
                }

                .execute-btn:hover:not(:disabled) {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
                }

                .execute-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .retry-btn {
                    background: var(--de-primary);
                    border: none;
                    color: white;
                    max-width: 200px;
                    margin: 0 auto;
                }

                /* 执行中 */
                .executing-section {
                    text-align: center;
                }

                .progress-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 14px;
                    color: var(--de-text-primary);
                }

                .progress-text {
                    color: var(--de-primary);
                    font-weight: 600;
                }

                .progress-bar {
                    height: 8px;
                    background: var(--de-bg-dark);
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 20px;
                }

                .progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #6366f1, #8b5cf6);
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }

                /* 错误状态 */
                .error-section {
                    text-align: center;
                    padding: 20px;
                }

                .error-icon {
                    font-size: 48px;
                    margin-bottom: 16px;
                }

                .error-message {
                    color: #ef4444;
                    font-size: 14px;
                    margin-bottom: 20px;
                }
            `}</style>
        </div>
    );
};

export default ReferenceReplicator;
