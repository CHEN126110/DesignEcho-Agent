/**
 * 文本块渲染组件
 * 
 * 性能优化：
 * - React.memo 避免不必要的重渲染
 * - useMemo 缓存 Markdown 解析结果
 */

import React, { useMemo } from 'react';
import type { TextBlock as TextBlockType } from '../types';
import { parseMessageMarkdown } from '../markdown';

interface TextBlockProps {
    block: TextBlockType;
}

/**
 * 文本块组件
 * 
 * 使用 React.memo 进行浅比较优化
 */
const TextBlockComponent: React.FC<TextBlockProps> = ({ block }) => {
    const isMarkdown = block.format !== 'plain';
    
    // 缓存 Markdown 解析结果，仅当 content 变化时重新计算
    const parsedHtml = useMemo(() => {
        if (!isMarkdown) return null;
        return parseMessageMarkdown(block.content);
    }, [block.content, isMarkdown]);
    
    if (isMarkdown && parsedHtml) {
        return (
            <div 
                className="message-block text-block markdown-content"
                dangerouslySetInnerHTML={{ __html: parsedHtml }}
            />
        );
    }
    
    return (
        <div className="message-block text-block plain-text">
            {block.content}
        </div>
    );
};

// 使用 React.memo 包装，当 block 引用不变时跳过渲染
export const TextBlock = React.memo(TextBlockComponent, (prevProps, nextProps) => {
    // 自定义比较：仅比较关键属性
    return (
        prevProps.block.id === nextProps.block.id &&
        prevProps.block.content === nextProps.block.content &&
        prevProps.block.format === nextProps.block.format
    );
});

export default TextBlock;
