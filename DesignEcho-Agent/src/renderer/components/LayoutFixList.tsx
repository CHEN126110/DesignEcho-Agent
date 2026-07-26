/**
 * 排版修复列表组件
 * 
 * 展示排版问题和修复建议，允许用户选择性应用修复
 */

import React, { useState } from 'react';

export interface LayoutIssue {
    type: 'alignment' | 'spacing' | 'hierarchy' | 'proportion';
    severity: 'high' | 'medium' | 'low';
    layerId?: number;
    description: string;
    suggestion: string;
}

export interface LayoutFix {
    layerId: number;
    action: 'move' | 'resize' | 'restyle' | 'align';
    changes: Record<string, any>;
    reason: string;
}

export interface LayoutAnalysisResult {
    issues: LayoutIssue[];
    fixes: LayoutFix[];
    overallScore?: number;
    summary?: string;
}

interface LayoutFixListProps {
    result: LayoutAnalysisResult;
    onApplyFix: (fix: LayoutFix) => Promise<void>;
    onApplyAll: (fixes: LayoutFix[]) => Promise<void>;
}

export const LayoutFixList: React.FC<LayoutFixListProps> = ({ 
    result, 
    onApplyFix, 
    onApplyAll 
}) => {
    const [selectedFixes, setSelectedFixes] = useState<Set<number>>(
        new Set(result.fixes.map((_, i) => i))
    );
    const [isApplying, setIsApplying] = useState(false);
    const [appliedFixes, setAppliedFixes] = useState<Set<number>>(new Set());

    if (!result || (!result.issues?.length && !result.fixes?.length)) {
        return (
            <div className="layout-fix-empty">
                ✅ 未发现排版问题，设计看起来很棒！
            </div>
        );
    }

    const toggleFix = (index: number) => {
        const newSelected = new Set(selectedFixes);
        if (newSelected.has(index)) {
            newSelected.delete(index);
        } else {
            newSelected.add(index);
        }
        setSelectedFixes(newSelected);
    };

    const handleApplyFix = async (fix: LayoutFix, index: number) => {
        setIsApplying(true);
        try {
            await onApplyFix(fix);
            setAppliedFixes(prev => new Set([...prev, index]));
        } finally {
            setIsApplying(false);
        }
    };

    const handleApplySelected = async () => {
        const fixesToApply = result.fixes.filter((_, i) => selectedFixes.has(i) && !appliedFixes.has(i));
        if (fixesToApply.length === 0) return;
        
        setIsApplying(true);
        try {
            await onApplyAll(fixesToApply);
            setAppliedFixes(prev => {
                const newApplied = new Set(prev);
                selectedFixes.forEach(i => newApplied.add(i));
                return newApplied;
            });
        } finally {
            setIsApplying(false);
        }
    };

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            case 'low': return '🟢';
            default: return '⚪';
        }
    };

    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'alignment': return '对齐';
            case 'spacing': return '间距';
            case 'hierarchy': return '层级';
            case 'proportion': return '比例';
            default: return type;
        }
    };

    const getActionLabel = (action: string) => {
        switch (action) {
            case 'move': return '移动';
            case 'resize': return '调整大小';
            case 'restyle': return '修改样式';
            case 'align': return '对齐';
            default: return action;
        }
    };

    return (
        <div className="layout-fix-list">
            {/* 评分 */}
            {result.overallScore !== undefined && (
                <div className="score-section">
                    <div className="score-circle" style={{
                        '--score-color': result.overallScore >= 80 ? '#00cc88' : 
                                         result.overallScore >= 60 ? '#ffaa00' : '#ff4444'
                    } as React.CSSProperties}>
                        <span className="score-value">{result.overallScore}</span>
                        <span className="score-label">分</span>
                    </div>
                    {result.summary && (
                        <p className="score-summary">{result.summary}</p>
                    )}
                </div>
            )}

            {/* 问题列表 */}
            {result.issues && result.issues.length > 0 && (
                <div className="issues-section">
                    <h4 className="section-title">📋 发现 {result.issues.length} 个问题</h4>
                    <div className="issues-list">
                        {result.issues.map((issue, index) => (
                            <div key={index} className={`issue-item severity-${issue.severity}`}>
                                <span className="issue-severity">{getSeverityIcon(issue.severity)}</span>
                                <div className="issue-content">
                                    <span className="issue-type">{getTypeLabel(issue.type)}</span>
                                    <span className="issue-desc">{issue.description}</span>
                                    {issue.suggestion && (
                                        <span className="issue-suggestion">💡 {issue.suggestion}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 修复建议 */}
            {result.fixes && result.fixes.length > 0 && (
                <div className="fixes-section">
                    <div className="fixes-header">
                        <h4 className="section-title">🔧 修复建议</h4>
                        <button 
                            className="apply-all-btn"
                            onClick={handleApplySelected}
                            disabled={isApplying || selectedFixes.size === 0 || 
                                     Array.from(selectedFixes).every(i => appliedFixes.has(i))}
                        >
                            {isApplying ? '应用中...' : `应用选中项 (${selectedFixes.size - Array.from(selectedFixes).filter(i => appliedFixes.has(i)).length})`}
                        </button>
                    </div>
                    <div className="fixes-list">
                        {result.fixes.map((fix, index) => (
                            <div 
                                key={index} 
                                className={`fix-item ${appliedFixes.has(index) ? 'applied' : ''} ${selectedFixes.has(index) ? 'selected' : ''}`}
                            >
                                <label className="fix-checkbox">
                                    <input 
                                        type="checkbox"
                                        checked={selectedFixes.has(index)}
                                        onChange={() => toggleFix(index)}
                                        disabled={appliedFixes.has(index)}
                                    />
                                    <span className="checkmark"></span>
                                </label>
                                <div className="fix-content">
                                    <div className="fix-header">
                                        <span className="fix-action">{getActionLabel(fix.action)}</span>
                                        <span className="fix-layer">图层 #{fix.layerId}</span>
                                    </div>
                                    <p className="fix-reason">{fix.reason}</p>
                                    <div className="fix-changes">
                                        {Object.entries(fix.changes).map(([key, value]) => (
                                            <span key={key} className="change-tag">
                                                {key}: {JSON.stringify(value)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <button 
                                    className="apply-single-btn"
                                    onClick={() => handleApplyFix(fix, index)}
                                    disabled={isApplying || appliedFixes.has(index)}
                                >
                                    {appliedFixes.has(index) ? '✓' : '应用'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <style>{`
                .layout-fix-list {
                    margin-top: 12px;
                    width: 100%;
                }

                .layout-fix-empty {
                    padding: 16px;
                    background: rgba(0, 204, 136, 0.1);
                    border: 1px solid rgba(0, 204, 136, 0.3);
                    border-radius: 8px;
                    color: #00cc88;
                    text-align: center;
                }

                .score-section {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 16px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    margin-bottom: 12px;
                }

                .score-circle {
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, var(--score-color), transparent);
                    border: 3px solid var(--score-color);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .score-value {
                    font-size: 20px;
                    font-weight: 700;
                    color: var(--de-text);
                }

                .score-label {
                    font-size: 10px;
                    color: var(--de-text-secondary);
                }

                .score-summary {
                    color: var(--de-text-secondary);
                    font-size: 13px;
                    line-height: 1.5;
                    margin: 0;
                }

                .section-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--de-text);
                    margin: 0 0 8px 0;
                }

                .issues-section {
                    margin-bottom: 16px;
                }

                .issues-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .issue-item {
                    display: flex;
                    gap: 10px;
                    padding: 10px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    border-left: 3px solid;
                }

                .issue-item.severity-high { border-left-color: #ff4444; }
                .issue-item.severity-medium { border-left-color: #ffaa00; }
                .issue-item.severity-low { border-left-color: #00cc88; }

                .issue-severity {
                    font-size: 14px;
                }

                .issue-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .issue-type {
                    font-size: 11px;
                    color: var(--de-primary);
                    background: rgba(0, 102, 255, 0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                    width: fit-content;
                }

                .issue-desc {
                    font-size: 13px;
                    color: var(--de-text);
                }

                .issue-suggestion {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }

                .fixes-section {}

                .fixes-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }

                .apply-all-btn {
                    padding: 6px 12px;
                    background: var(--de-primary);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .apply-all-btn:hover:not(:disabled) {
                    background: #0055dd;
                }

                .apply-all-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .fixes-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .fix-item {
                    display: flex;
                    gap: 10px;
                    padding: 10px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    align-items: flex-start;
                    transition: all 0.2s;
                }

                .fix-item.selected {
                    border-color: var(--de-primary);
                    background: rgba(0, 102, 255, 0.05);
                }

                .fix-item.applied {
                    opacity: 0.6;
                    background: rgba(0, 204, 136, 0.05);
                    border-color: rgba(0, 204, 136, 0.3);
                }

                .fix-checkbox {
                    position: relative;
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }

                .fix-checkbox input {
                    opacity: 0;
                    position: absolute;
                }

                .fix-checkbox .checkmark {
                    position: absolute;
                    width: 18px;
                    height: 18px;
                    background: var(--de-bg);
                    border: 2px solid var(--de-border);
                    border-radius: 4px;
                }

                .fix-checkbox input:checked + .checkmark {
                    background: var(--de-primary);
                    border-color: var(--de-primary);
                }

                .fix-checkbox input:checked + .checkmark::after {
                    content: '✓';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-size: 12px;
                }

                .fix-content {
                    flex: 1;
                }

                .fix-header {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 4px;
                }

                .fix-action {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--de-primary);
                    background: rgba(0, 102, 255, 0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .fix-layer {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    font-family: monospace;
                }

                .fix-reason {
                    font-size: 13px;
                    color: var(--de-text);
                    margin: 4px 0;
                }

                .fix-changes {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                }

                .change-tag {
                    font-size: 11px;
                    background: var(--de-bg);
                    color: var(--de-text-secondary);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: monospace;
                }

                .apply-single-btn {
                    padding: 4px 10px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 4px;
                    color: var(--de-text);
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    flex-shrink: 0;
                }

                .apply-single-btn:hover:not(:disabled) {
                    background: var(--de-primary);
                    border-color: var(--de-primary);
                    color: white;
                }

                .apply-single-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            `}</style>
        </div>
    );
};
