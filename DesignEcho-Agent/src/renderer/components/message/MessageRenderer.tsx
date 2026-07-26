/**
 * 多模态消息渲染器
 * 
 * 借鉴 GPT/Claude 概念，支持多种内容块类型的混合渲染
 * 
 * 性能优化：
 * - React.memo 避免不必要的重渲染
 * - useCallback 缓存回调函数
 * - 稳定的 key 避免组件重建
 */

import React, { useCallback, useMemo } from 'react';
import { isStructuredAgentResponseContent } from '../../../shared/agent-response-presentation';
import { formatAgentResponseInterruption } from '../../../shared/agent-response-interruption';
import type { ContentBlock, MultimodalMessage } from './types';
import {
    TextBlock,
    CodeBlock,
    ImageBlock,
    ToolResultBlock,
    CardBlock,
    ThinkingBlock,
    TaskPlanBlock,
    InteractiveCardBlock
} from './blocks';
import './MessageRenderer.css';

interface MessageRendererProps {
    message: MultimodalMessage;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
    isStreaming?: boolean;
    onEdit?: () => void;
    showEditButton?: boolean;
}

function getProcessBlockRenderKey(blockId: string, collapseProcessBlocks: boolean): string {
    return `${blockId}:${collapseProcessBlocks ? 'terminal' : 'active'}`;
}

/**
 * 渲染单个内容块
 * 
 * 注意：此函数在 renderBlock 内部不使用 hooks
 * 所有使用 hooks 的组件都应该是独立的 React 组件
 */
const renderBlock = (
    block: ContentBlock,
    onAction?: (actionId: string, params?: Record<string, any>) => void,
    collapseProcessBlocks: boolean = false
): React.ReactNode => {
    switch (block.type) {
        case 'text':
            return <TextBlock key={block.id} block={block} />;
            
        case 'code':
            return <CodeBlock key={block.id} block={block} />;
            
        case 'image':
            return <ImageBlock key={block.id} block={block} />;
            
        case 'tool_result':
            return (
                <ToolResultBlock
                    key={getProcessBlockRenderKey(block.id, collapseProcessBlocks)}
                    block={block}
                    onAction={onAction}
                    collapseForTerminalState={collapseProcessBlocks}
                />
            );
            
        case 'card':
        case 'success':
        case 'warning':
        case 'error':
            // 将 success/warning/error 转换为 card
            if (block.type !== 'card') {
                const sourceBlock = block as any;
                // 转换 details: string[] → { label: string; value: string | number }[]
                const convertedDetails = Array.isArray(sourceBlock.details)
                    ? sourceBlock.details.map((item: string | { label: string; value: string | number }, idx: number) =>
                        typeof item === 'string' 
                            ? { label: `${idx + 1}`, value: item }
                            : item
                      )
                    : undefined;
                const cardBlock = {
                    id: block.id,
                    type: 'card' as const,
                    variant: block.type as 'success' | 'warning' | 'error',
                    title: sourceBlock.title,
                    content: sourceBlock.message || '',
                    details: convertedDetails,
                    timestamp: block.timestamp,
                };
                return <CardBlock key={block.id} block={cardBlock} onAction={onAction} />;
            }
            return <CardBlock key={block.id} block={block} onAction={onAction} />;
            
        case 'thinking':
            return (
                <ThinkingBlock
                    key={getProcessBlockRenderKey(block.id, collapseProcessBlocks)}
                    block={block}
                    collapseForTerminalState={collapseProcessBlocks}
                />
            );

        case 'task_plan':
            return <TaskPlanBlock key={block.id} block={block} />;

        case 'interactive_card':
            return <InteractiveCardBlock key={block.id} block={block} onAction={onAction} />;
            
        case 'image_gallery':
            return (
                <ImageGallery key={block.id} block={block} />
            );
            
        case 'tool_call':
            return (
                <ToolCallDisplay key={block.id} block={block} />
            );
            
        case 'list':
            return (
                <ListDisplay key={block.id} block={block} />
            );
            
        case 'table':
            return (
                <TableDisplay key={block.id} block={block} />
            );
            
        case 'progress':
            return (
                <ProgressDisplay key={block.id} block={block} />
            );
            
        case 'file':
            return (
                <FileDisplay key={block.id} block={block} />
            );
            
        case 'action':
            return (
                <ActionButtons key={block.id} block={block} onAction={onAction} />
            );
            
        case 'artifact':
            return (
                <ArtifactDisplay key={block.id} block={block} />
            );
            
        case 'collapsible':
            return (
                <CollapsibleSection
                    key={block.id}
                    title={block.title}
                    icon={block.icon}
                    defaultExpanded={block.defaultExpanded}
                    blocks={block.content}
                    onAction={onAction}
                />
            );
            
        default:
            // 避免在渲染时打印警告（性能考虑）
            return null;
    }
};

// ==================== 子组件（使用 React.memo 优化） ====================

/**
 * 图片画廊组件
 */
const ImageGallery = React.memo<{ block: any }>(({ block }) => (
    <div className="message-block image-gallery-block">
        {block.images.map((img: any, index: number) => (
            <ImageBlock
                key={`${block.id}-${index}`}
                block={{
                    id: `${block.id}-${index}`,
                    type: 'image',
                    src: img.src,
                    alt: img.alt,
                    caption: img.caption,
                    zoomable: true
                }}
            />
        ))}
    </div>
));

/**
 * 工具调用显示组件
 */
const ToolCallDisplay = React.memo<{ block: any }>(({ block }) => (
    <div className={`message-block tool-call-block status-${block.status}`}>
        <span className="tool-call-icon">{block.icon}</span>
        <span className="tool-call-name">{block.displayName}</span>
        {block.status === 'running' && (
            <span className="tool-call-spinner"></span>
        )}
        {block.status === 'success' && (
            <span className="tool-call-check">✓</span>
        )}
        {block.status === 'error' && (
            <span className="tool-call-error">✗</span>
        )}
    </div>
));

/**
 * 列表显示组件
 */
const ListDisplay = React.memo<{ block: any }>(({ block }) => (
    <div className="message-block list-block">
        {block.style === 'number' ? (
            <ol>
                {block.items.map((item: any, index: number) => (
                    <li key={index}>
                        {item.content}
                        {item.subItems && (
                            <ul>
                                {item.subItems.map((sub: string, subIdx: number) => (
                                    <li key={subIdx}>{sub}</li>
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ol>
        ) : block.style === 'check' ? (
            <ul className="check-list">
                {block.items.map((item: any, index: number) => (
                    <li key={index} className={item.checked ? 'checked' : ''}>
                        <span className="check-icon">
                            {item.checked ? '☑' : '☐'}
                        </span>
                        {item.content}
                    </li>
                ))}
            </ul>
        ) : (
            <ul>
                {block.items.map((item: any, index: number) => (
                    <li key={index}>{item.content}</li>
                ))}
            </ul>
        )}
    </div>
));

/**
 * 表格显示组件
 */
const TableDisplay = React.memo<{ block: any }>(({ block }) => (
    <div className="message-block table-block">
        <table className={block.striped ? 'striped' : ''}>
            <thead>
                <tr>
                    {block.headers.map((header: string, index: number) => (
                        <th key={index}>{header}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {block.rows.map((row: string[], rowIndex: number) => (
                    <tr key={rowIndex}>
                        {row.map((cell: string, cellIndex: number) => (
                            <td key={cellIndex}>{cell}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
        {block.caption && (
            <div className="table-caption">{block.caption}</div>
        )}
    </div>
));

/**
 * 进度显示组件
 */
const ProgressDisplay = React.memo<{ block: any }>(({ block }) => {
    const percentage = Math.round((block.current / block.total) * 100);
    return (
        <div className="message-block progress-block">
            <div className="progress-header">
                <span className="progress-label">{block.label}</span>
                {block.showPercentage !== false && (
                    <span className="progress-percentage">{percentage}%</span>
                )}
            </div>
            <div className="progress-bar">
                <div 
                    className="progress-fill"
                    style={{ width: `${percentage}%` }}
                />
            </div>
            <div className="progress-detail">
                {block.current} / {block.total}
            </div>
        </div>
    );
});

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * 文件显示组件
 */
const FileDisplay = React.memo<{ block: any }>(({ block }) => (
    <div className="message-block file-block">
        <div className="file-icon">{block.icon || '📄'}</div>
        <div className="file-info">
            <div className="file-name">{block.filename}</div>
            {block.size && (
                <div className="file-size">
                    {formatFileSize(block.size)}
                </div>
            )}
        </div>
        {block.downloadable && (
            <button className="file-download">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </button>
        )}
    </div>
));

/**
 * 操作按钮组件
 */
const ActionButtons = React.memo<{ 
    block: any; 
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}>(({ block, onAction }) => (
    <div className={`message-block action-block layout-${block.layout || 'horizontal'}`}>
        {block.actions.map((action: any) => (
            <button
                key={action.id}
                className={`action-button ${action.variant || 'secondary'}`}
                disabled={action.disabled || action.loading}
                onClick={() => onAction?.(action.action, action.params)}
            >
                {action.loading && <span className="button-spinner"></span>}
                {action.icon && <span className="button-icon">{action.icon}</span>}
                <span>{action.label}</span>
            </button>
        ))}
    </div>
));

/**
 * 生成产物显示组件
 */
const ArtifactDisplay = React.memo<{ block: any }>(({ block }) => (
    <div className="message-block artifact-block">
        <div className="artifact-header">
            <span className="artifact-icon">
                {block.artifactType === 'code' ? '💻' :
                 block.artifactType === 'image' ? '🖼️' :
                 block.artifactType === 'design' ? '🎨' :
                 block.artifactType === 'data' ? '📊' : '📄'}
            </span>
            <span className="artifact-title">{block.title}</span>
            <div className="artifact-actions">
                {block.copyable && (
                    <button className="artifact-action" title="复制">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                        </svg>
                    </button>
                )}
                {block.downloadable && (
                    <button className="artifact-action" title="下载">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                )}
            </div>
        </div>
        <div className="artifact-content">
            {block.artifactType === 'code' && block.language ? (
                <CodeBlock block={{
                    id: `${block.id}-code`,
                    type: 'code',
                    code: block.content,
                    language: block.language,
                    copyable: false
                }} />
            ) : (
                <pre>{block.content}</pre>
            )}
        </div>
    </div>
));

/**
 * 可折叠区域组件
 */
const CollapsibleSection = React.memo<{
    title: string;
    icon?: string;
    defaultExpanded?: boolean;
    blocks: ContentBlock[];
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}>(({ title, icon, defaultExpanded, blocks, onAction }) => {
    const [isExpanded, setIsExpanded] = React.useState(defaultExpanded ?? false);
    
    const handleToggle = useCallback(() => {
        setIsExpanded(prev => !prev);
    }, []);
    
    return (
        <div className="message-block collapsible-block">
            <div 
                className="collapsible-header"
                onClick={handleToggle}
            >
                {icon && <span className="collapsible-icon">{icon}</span>}
                <span className="collapsible-title">{title}</span>
                <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                    className={`chevron ${isExpanded ? 'expanded' : ''}`}
                >
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            {isExpanded && (
                <div className="collapsible-content">
                    {blocks.map(block => renderBlock(block, onAction))}
                </div>
            )}
        </div>
    );
});

// ==================== 主组件 ====================

function normalizeMessageRendererSignatureValue(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'function') {
        return '[function]';
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (depth >= 8) {
        return '[depth-limit]';
    }

    if (Array.isArray(value)) {
        return value.map(item => normalizeMessageRendererSignatureValue(item, depth + 1));
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
        const child = input[key];
        if (typeof child === 'undefined') {
            continue;
        }
        output[key] = normalizeMessageRendererSignatureValue(child, depth + 1);
    }
    return output;
}

function stringifyMessageRendererSignature(value: unknown): string {
    try {
        return JSON.stringify(normalizeMessageRendererSignatureValue(value));
    } catch {
        return String(value);
    }
}

function getMessageRendererBlockSignature(block: ContentBlock): string {
    return stringifyMessageRendererSignature(block);
}

function getMessageRendererMessageSignature(message: MultimodalMessage): string {
    return stringifyMessageRendererSignature({
        id: message.id,
        role: message.role,
        timestamp: message.timestamp,
        isStreaming: message.isStreaming,
        metadata: message.metadata,
        blocks: message.blocks.map(getMessageRendererBlockSignature)
    });
}

function hasStructuredAssistantPresentation(message: MultimodalMessage): boolean {
    if (message.role !== 'assistant') return false;
    return message.blocks.some((block) => {
        if (block.type === 'list' || block.type === 'table') return true;
        if (block.type !== 'text') return false;
        return isStructuredAgentResponseContent(block.content);
    });
}

/**
 * 多模态消息渲染器
 */
const MessageRendererComponent: React.FC<MessageRendererProps> = ({
    message,
    onAction,
    isStreaming,
    onEdit,
    showEditButton
}) => {
    const isUser = message.role === 'user';
    const isStructuredResponse = hasStructuredAssistantPresentation(message);
    const interruptionLabel = formatAgentResponseInterruption(
        message.metadata?.agentResponseInterruption
    );
    const isInterruptionOnly = Boolean(interruptionLabel) && message.blocks.length === 0;
    const isProcessActive = isStreaming === true || message.isStreaming === true;
    const collapseProcessBlocks = message.role === 'assistant' && !isProcessActive;
    
    // 缓存时间格式化结果
    const formattedTime = useMemo(() => {
        return new Date(message.timestamp).toLocaleTimeString();
    }, [message.timestamp]);
    
    // 渲染内容块（带缓存）
    const renderedBlocks = useMemo(() => {
        return message.blocks.map(block => renderBlock(block, onAction, collapseProcessBlocks));
    }, [message.blocks, onAction, collapseProcessBlocks]);
    
    return (
        <div className={[
            'multimodal-message',
            message.role,
            isStreaming ? 'streaming' : '',
            isStructuredResponse ? 'structured-response' : '',
            isInterruptionOnly ? 'interruption-only' : ''
        ].filter(Boolean).join(' ')}>
            {/* 头像 */}
            <div className="message-avatar">
                {isUser ? '👤' : '🤖'}
            </div>
            
            {/* 内容区 */}
            <div className="message-body">
                {/* 内容块 */}
                <div className="message-blocks">
                    {renderedBlocks}
                </div>

                {interruptionLabel && (
                    <div
                        className="agent-response-interruption"
                        data-testid="agent-response-interruption"
                        role="status"
                    >
                        <span className="agent-response-interruption-mark" aria-hidden="true" />
                        <span>{interruptionLabel}</span>
                    </div>
                )}
                
                {/* 流式输出指示器 */}
                {isStreaming && (
                    <div className="streaming-indicator">
                        <span className="streaming-dot"></span>
                        <span className="streaming-dot"></span>
                        <span className="streaming-dot"></span>
                    </div>
                )}
                
                {/* 元信息和操作按钮 */}
                <div className="message-meta">
                    <span className="message-time">{formattedTime}</span>
                    {/* 用户消息的编辑按钮 */}
                    {isUser && showEditButton && onEdit && (
                        <button 
                            className="inline-edit-btn"
                            onClick={onEdit}
                            title="编辑消息"
                        >
                            ✏️
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * 使用 React.memo 包装，进行浅比较优化
 */
export const MessageRenderer = React.memo(MessageRendererComponent, (prevProps, nextProps) => {
    // 自定义比较逻辑
    const prevMsg = prevProps.message;
    const nextMsg = nextProps.message;
    
    // 比较关键属性
    return (
        getMessageRendererMessageSignature(prevMsg) === getMessageRendererMessageSignature(nextMsg) &&
        prevProps.isStreaming === nextProps.isStreaming &&
        prevProps.showEditButton === nextProps.showEditButton &&
        prevProps.onEdit === nextProps.onEdit &&
        prevProps.onAction === nextProps.onAction
    );
});

export default MessageRenderer;
