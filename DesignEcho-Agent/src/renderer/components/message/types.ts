import type {
    InteractiveCardDefinition,
    InteractiveCardSubmission
} from '../../../shared/interactive-card-contract';
import type { AgentResponseInterruption } from '../../../shared/agent-response-interruption';
import type { AgentTaskPlanPresentation } from '../../../shared/agent-task-plan-presentation';
import type {
    ThinkingStepDisplayRole,
    VisibleThinkingStepSourceType
} from './thinkingStepPresentation';

/**
 * 多模态消息类型定义
 * 
 * 借鉴 GPT/Claude 概念，支持丰富的内容块类型
 */

// 内容块类型
export type ContentBlockType = 
    | 'text'           // 纯文本/Markdown
    | 'code'           // 代码块
    | 'image'          // 图片
    | 'image_gallery'  // 图片画廊
    | 'tool_call'      // 工具调用
    | 'tool_result'    // 工具结果
    | 'file'           // 文件预览
    | 'card'           // 信息卡片
    | 'list'           // 列表
    | 'table'          // 表格
    | 'progress'       // 进度指示
    | 'error'          // 错误信息
    | 'warning'        // 警告信息
    | 'success'        // 成功信息
    | 'thinking'       // 思考过程
    | 'task_plan'      // Runtime R4 计划状态投影
    | 'interactive_card' // 可交互确认卡片
    | 'artifact'       // 生成产物（类似 Claude Artifacts）
    | 'action'         // 可操作按钮组
    | 'collapsible';   // 可折叠区域

// 基础内容块
export interface BaseContentBlock {
    id: string;
    type: ContentBlockType;
    timestamp?: number;
}

// 文本块
export interface TextBlock extends BaseContentBlock {
    type: 'text';
    content: string;
    format?: 'plain' | 'markdown';
}

// 代码块
export interface CodeBlock extends BaseContentBlock {
    type: 'code';
    code: string;
    language: string;
    filename?: string;
    lineNumbers?: boolean;
    highlightLines?: number[];
    copyable?: boolean;
}

// 图片块
export interface ImageBlock extends BaseContentBlock {
    type: 'image';
    src: string;            // Base64 或 URL
    alt?: string;
    caption?: string;
    width?: number;
    height?: number;
    aspectRatio?: number;
    thumbnailSrc?: string;
    zoomable?: boolean;
}

// 图片画廊块
export interface ImageGalleryBlock extends BaseContentBlock {
    type: 'image_gallery';
    images: Array<{
        src: string;
        alt?: string;
        caption?: string;
    }>;
    layout?: 'grid' | 'carousel' | 'masonry';
    columns?: number;
}

// 工具调用块
export interface ToolCallBlock extends BaseContentBlock {
    type: 'tool_call';
    toolName: string;
    displayName: string;
    icon: string;
    params?: Record<string, any>;
    status: 'pending' | 'running' | 'success' | 'error';
    duration?: number;
}

// 工具结果块
export interface ToolResultBlock extends BaseContentBlock {
    type: 'tool_result';
    toolName: string;
    displayName: string;
    icon: string;
    success: boolean;
    result?: any;
    error?: string;
    duration?: number;
    details?: Array<{
        label: string;
        value: string | number;
        type?: 'text' | 'code' | 'link';
    }>;
    actions?: ActionItem[];
}

// 文件块
export interface FileBlock extends BaseContentBlock {
    type: 'file';
    filename: string;
    path: string;
    size?: number;
    mimeType?: string;
    icon?: string;
    previewType?: 'code' | 'image' | 'document' | 'none';
    previewContent?: string;
    downloadable?: boolean;
}

// 卡片块
export interface CardBlock extends BaseContentBlock {
    type: 'card';
    variant: 'info' | 'success' | 'warning' | 'error' | 'neutral';
    title?: string;
    icon?: string;
    content: string;
    details?: Array<{
        label: string;
        value: string | number;
    }>;
    actions?: ActionItem[];
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}

// 列表块
export interface ListBlock extends BaseContentBlock {
    type: 'list';
    style: 'bullet' | 'number' | 'check' | 'none';
    items: Array<{
        content: string;
        checked?: boolean;
        subItems?: string[];
    }>;
}

// 表格块
export interface TableBlock extends BaseContentBlock {
    type: 'table';
    headers: string[];
    rows: string[][];
    caption?: string;
    striped?: boolean;
}

// 进度块
export interface ProgressBlock extends BaseContentBlock {
    type: 'progress';
    label: string;
    current: number;
    total: number;
    showPercentage?: boolean;
    variant?: 'linear' | 'circular';
}

// 错误块
export interface ErrorBlock extends BaseContentBlock {
    type: 'error';
    title: string;
    message: string;
    code?: string;
    stack?: string;
    suggestion?: string;
}

// 警告块
export interface WarningBlock extends BaseContentBlock {
    type: 'warning';
    title: string;
    message: string;
    dismissible?: boolean;
}

// 成功块
export interface SuccessBlock extends BaseContentBlock {
    type: 'success';
    title: string;
    message: string;
    details?: string[];
}

// 思考过程块
export interface ThinkingBlock extends BaseContentBlock {
    type: 'thinking';
    title?: string;
    steps: ThinkingStep[];
    isExpanded?: boolean;
    totalDuration?: number;
}

export interface ThinkingStep {
    id: string;
    label: string;
    icon: string;
    status: 'pending' | 'running' | 'success' | 'error';
    tone?: 'thought' | 'action';
    displayRole?: ThinkingStepDisplayRole;
    roleLabel?: string;
    sourceType?: VisibleThinkingStepSourceType;
    actionLabel?: string;
    detail?: string;
    duration?: number;
}

// 任务计划展示块。只承载共享纯投影，不在 Renderer 重算业务状态。
export interface TaskPlanBlock extends BaseContentBlock {
    type: 'task_plan';
    presentation: AgentTaskPlanPresentation;
}

// 可交互卡片块
export interface InteractiveCardBlock extends BaseContentBlock {
    type: 'interactive_card';
    card: InteractiveCardDefinition;
    sourceMessageId: string;
    submission?: InteractiveCardSubmission;
}

// 生成产物块（类似 Claude Artifacts）
export interface ArtifactBlock extends BaseContentBlock {
    type: 'artifact';
    title: string;
    artifactType: 'code' | 'document' | 'image' | 'design' | 'data';
    content: string;
    language?: string;
    previewable?: boolean;
    downloadable?: boolean;
    copyable?: boolean;
}

// 操作按钮项
export interface ActionItem {
    id: string;
    label: string;
    icon?: string;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    disabled?: boolean;
    loading?: boolean;
    action: string;
    params?: Record<string, any>;
}

// 操作按钮组块
export interface ActionBlock extends BaseContentBlock {
    type: 'action';
    layout?: 'horizontal' | 'vertical';
    actions: ActionItem[];
}

// 可折叠区域块
export interface CollapsibleBlock extends BaseContentBlock {
    type: 'collapsible';
    title: string;
    icon?: string;
    defaultExpanded?: boolean;
    content: ContentBlock[];
}

// 内容块联合类型
export type ContentBlock = 
    | TextBlock
    | CodeBlock
    | ImageBlock
    | ImageGalleryBlock
    | ToolCallBlock
    | ToolResultBlock
    | FileBlock
    | CardBlock
    | ListBlock
    | TableBlock
    | ProgressBlock
    | ErrorBlock
    | WarningBlock
    | SuccessBlock
    | ThinkingBlock
    | TaskPlanBlock
    | InteractiveCardBlock
    | ArtifactBlock
    | ActionBlock
    | CollapsibleBlock;

// 多模态消息
export interface MultimodalMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    timestamp: number;
    blocks: ContentBlock[];
    isStreaming?: boolean;
    metadata?: {
        model?: string;
        tokens?: number;
        duration?: number;
        cost?: number;
        agentResponseInterruption?: AgentResponseInterruption;
    };
}

// 消息解析选项
export interface ParseOptions {
    enableMarkdown?: boolean;
    enableCodeHighlight?: boolean;
    enableImages?: boolean;
    enableTools?: boolean;
    maxImageWidth?: number;
}
