/**
 * 多模态消息模块导出
 */

// 类型
export type {
    ContentBlock,
    ContentBlockType,
    MultimodalMessage,
    TextBlock,
    CodeBlock,
    ImageBlock,
    ImageGalleryBlock,
    ToolCallBlock,
    ToolResultBlock,
    FileBlock,
    CardBlock,
    ListBlock,
    TableBlock,
    ProgressBlock,
    ErrorBlock,
    WarningBlock,
    SuccessBlock,
    ThinkingBlock,
    ThinkingStep,
    ArtifactBlock,
    ActionItem,
    ActionBlock,
    CollapsibleBlock,
    ParseOptions
} from './types';

// 组件
export { MessageRenderer } from './MessageRenderer';

// 内容块组件
export {
    TextBlock as TextBlockComponent,
    CodeBlock as CodeBlockComponent,
    ImageBlock as ImageBlockComponent,
    ToolResultBlock as ToolResultBlockComponent,
    CardBlock as CardBlockComponent,
    ThinkingBlock as ThinkingBlockComponent
} from './blocks';

// 解析器
export {
    parseMessageContent,
    convertLegacyMessage
} from './parser';
