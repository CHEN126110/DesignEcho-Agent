/**
 * 代码块渲染组件
 * 
 * 性能优化：
 * - React.memo 避免不必要的重渲染
 * - useMemo 缓存行分割结果
 * - useCallback 缓存复制处理函数
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { CodeBlock as CodeBlockType } from '../types';

interface CodeBlockProps {
    block: CodeBlockType;
}

// 语言显示名称映射（模块级常量，只创建一次）
const LANGUAGE_NAMES: Record<string, string> = {
    'js': 'JavaScript',
    'javascript': 'JavaScript',
    'ts': 'TypeScript',
    'typescript': 'TypeScript',
    'tsx': 'TSX',
    'jsx': 'JSX',
    'py': 'Python',
    'python': 'Python',
    'json': 'JSON',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'bash': 'Bash',
    'shell': 'Shell',
    'sh': 'Shell',
    'sql': 'SQL',
    'yaml': 'YAML',
    'yml': 'YAML',
    'md': 'Markdown',
    'markdown': 'Markdown',
    'xml': 'XML',
    'java': 'Java',
    'c': 'C',
    'cpp': 'C++',
    'cs': 'C#',
    'go': 'Go',
    'rust': 'Rust',
    'swift': 'Swift',
    'kotlin': 'Kotlin',
    'ruby': 'Ruby',
    'php': 'PHP',
};

/**
 * 代码块组件
 */
const CodeBlockComponent: React.FC<CodeBlockProps> = ({ block }) => {
    const [copied, setCopied] = useState(false);
    
    // 缓存复制处理函数
    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(block.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('复制失败:', err);
        }
    }, [block.code]);
    
    // 缓存语言显示名称
    const languageDisplay = useMemo(() => {
        return LANGUAGE_NAMES[block.language?.toLowerCase()] || block.language || 'Code';
    }, [block.language]);
    
    // 缓存行分割结果
    const lines = useMemo(() => block.code.split('\n'), [block.code]);
    
    // 缓存高亮行集合（Set 查找 O(1)）
    const highlightedLinesSet = useMemo(() => {
        return new Set(block.highlightLines || []);
    }, [block.highlightLines]);
    
    return (
        <div className="message-block code-block">
            {/* 代码块头部 */}
            <div className="code-header">
                <div className="code-info">
                    <span className="code-language">{languageDisplay}</span>
                    {block.filename && (
                        <span className="code-filename">{block.filename}</span>
                    )}
                </div>
                {block.copyable !== false && (
                    <button 
                        className={`code-copy-btn ${copied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        title={copied ? '已复制' : '复制代码'}
                    >
                        {copied ? (
                            <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span>已复制</span>
                            </>
                        ) : (
                            <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                </svg>
                                <span>复制</span>
                            </>
                        )}
                    </button>
                )}
            </div>
            
            {/* 代码内容 */}
            <div className="code-content">
                {block.lineNumbers !== false ? (
                    <pre className="code-pre with-line-numbers">
                        <code className={`language-${block.language}`}>
                            {lines.map((line, index) => {
                                const lineNum = index + 1;
                                const isHighlighted = highlightedLinesSet.has(lineNum);
                                return (
                                    <div 
                                        key={index} 
                                        className={`code-line ${isHighlighted ? 'highlighted' : ''}`}
                                    >
                                        <span className="line-number">{lineNum}</span>
                                        <span className="line-content">{line || ' '}</span>
                                    </div>
                                );
                            })}
                        </code>
                    </pre>
                ) : (
                    <pre className="code-pre">
                        <code className={`language-${block.language}`}>{block.code}</code>
                    </pre>
                )}
            </div>
        </div>
    );
};

// 使用 React.memo 包装
export const CodeBlock = React.memo(CodeBlockComponent, (prevProps, nextProps) => {
    const prev = prevProps.block;
    const next = nextProps.block;
    return (
        prev.id === next.id &&
        prev.code === next.code &&
        prev.language === next.language &&
        prev.filename === next.filename &&
        prev.lineNumbers === next.lineNumbers &&
        prev.copyable === next.copyable &&
        // 数组比较：长度相同且元素相同
        (prev.highlightLines?.length ?? 0) === (next.highlightLines?.length ?? 0) &&
        (prev.highlightLines?.every((v, i) => v === next.highlightLines?.[i]) ?? true)
    );
});

export default CodeBlock;
