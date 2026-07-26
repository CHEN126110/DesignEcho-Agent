import React from 'react';

export interface TextSuggestion {
    version: number;
    text: string;
    charCount: number;
    design: {
        suggestedFontSize?: number | string;
        suggestedLetterSpacing?: string;
        suggestedLineHeight?: number;
        reason: string;
    };
    style: string;
}

interface SuggestionListProps {
    suggestions: TextSuggestion[];
    onApply: (suggestion: TextSuggestion) => void;
}

export const SuggestionList: React.FC<SuggestionListProps> = ({ suggestions, onApply }) => {
    if (!suggestions || suggestions.length === 0) return null;

    return (
        <div className="suggestion-list">
            <div className="suggestion-header">
                <span className="icon">✨</span>
                <span>优化建议</span>
            </div>
            
            <div className="suggestion-items">
                {suggestions.map((item, index) => (
                    <div key={index} className="suggestion-card">
                        <div className="card-header">
                            <span className="suggestion-style">{item.style}</span>
                            <span className="char-count">{item.charCount} 字符</span>
                        </div>
                        
                        <div className="suggestion-content">
                            {item.text}
                        </div>
                        
                        <div className="design-tips">
                            <div className="tip-reason">💡 {item.design.reason}</div>
                            <div className="tip-specs">
                                {item.design.suggestedFontSize && (
                                    <span className="spec-tag">
                                        字号: {item.design.suggestedFontSize}
                                    </span>
                                )}
                                {item.design.suggestedLetterSpacing && (
                                    <span className="spec-tag">
                                        间距: {item.design.suggestedLetterSpacing}
                                    </span>
                                )}
                            </div>
                        </div>
                        
                        <button 
                            className="apply-button"
                            onClick={() => onApply(item)}
                        >
                            应用此方案
                        </button>
                    </div>
                ))}
            </div>

            <style>{`
                .suggestion-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    margin-top: 8px;
                    width: 100%;
                }

                .suggestion-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--de-text-secondary);
                    margin-bottom: 4px;
                }

                .suggestion-items {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .suggestion-card {
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    padding: 12px;
                    transition: all 0.2s ease;
                }

                .suggestion-card:hover {
                    border-color: var(--de-primary);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                }

                .card-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 8px;
                    font-size: 12px;
                }

                .suggestion-style {
                    background: rgba(0, 102, 255, 0.1);
                    color: var(--de-primary);
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-weight: 500;
                }

                .char-count {
                    color: var(--de-text-secondary);
                }

                .suggestion-content {
                    font-size: 15px;
                    color: var(--de-text);
                    margin-bottom: 12px;
                    line-height: 1.5;
                    white-space: pre-wrap;
                    font-weight: 500;
                }

                .design-tips {
                    background: var(--de-bg);
                    border-radius: 6px;
                    padding: 8px;
                    margin-bottom: 12px;
                    font-size: 12px;
                }

                .tip-reason {
                    color: var(--de-text-secondary);
                    margin-bottom: 6px;
                    line-height: 1.4;
                }

                .tip-specs {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .spec-tag {
                    background: var(--de-bg-light);
                    padding: 2px 6px;
                    border-radius: 4px;
                    color: var(--de-text-secondary);
                    font-family: monospace;
                }

                .apply-button {
                    width: 100%;
                    padding: 8px;
                    background: var(--de-bg-light);
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    color: var(--de-text);
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .apply-button:hover {
                    background: var(--de-primary);
                    border-color: var(--de-primary);
                    color: white;
                }
            `}</style>
        </div>
    );
};
