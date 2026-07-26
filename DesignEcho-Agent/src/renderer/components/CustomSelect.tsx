/**
 * CustomSelect 组件 - 自定义下拉菜单
 * 
 * 解决 UXP WebView 中原生 <select> 元素渲染异常的问题
 * 特点：
 * - 使用 Portal 渲染下拉选项到 body，避免 overflow 裁剪
 * - 高 z-index 确保下拉菜单在最上层
 * - 支持键盘导航
 * - 支持搜索过滤（可选）
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';

export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
    group?: string;
}

interface CustomSelectProps {
    options: SelectOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    size?: 'normal' | 'small';
    disabled?: boolean;
    searchable?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
    options,
    value,
    onChange,
    placeholder = '请选择',
    className = '',
    size = 'normal',
    disabled = false,
    searchable = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // 当前选中的选项
    const selectedOption = options.find(opt => opt.value === value);

    // 过滤选项
    const filteredOptions = searchable && searchTerm
        ? options.filter(opt => 
            opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
            opt.value.toLowerCase().includes(searchTerm.toLowerCase())
          )
        : options;

    // 按分组组织选项
    const groupedOptions = filteredOptions.reduce((acc, opt) => {
        const group = opt.group || '';
        if (!acc[group]) acc[group] = [];
        acc[group].push(opt);
        return acc;
    }, {} as Record<string, SelectOption[]>);

    // 计算下拉菜单位置
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

    const updateDropdownPosition = useCallback(() => {
        if (!containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const maxHeight = 280;

        // 判断下拉菜单应该向上还是向下展开
        const shouldOpenUpward = spaceBelow < maxHeight && spaceAbove > spaceBelow;

        setDropdownStyle({
            position: 'fixed',
            left: rect.left,
            width: rect.width,
            maxHeight: Math.min(maxHeight, shouldOpenUpward ? spaceAbove - 10 : spaceBelow - 10),
            ...(shouldOpenUpward 
                ? { bottom: viewportHeight - rect.top + 4 }
                : { top: rect.bottom + 4 }
            ),
            zIndex: 99999
        });
    }, []);

    // 打开/关闭下拉菜单
    const toggleOpen = () => {
        if (disabled) return;
        
        if (!isOpen) {
            updateDropdownPosition();
            setSearchTerm('');
            setHighlightedIndex(-1);
        }
        setIsOpen(!isOpen);
    };

    // 选择选项
    const handleSelect = (option: SelectOption) => {
        if (option.disabled) return;
        onChange(option.value);
        setIsOpen(false);
        setSearchTerm('');
    };

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node) &&
                dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            window.addEventListener('scroll', updateDropdownPosition, true);
            window.addEventListener('resize', updateDropdownPosition);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', updateDropdownPosition, true);
            window.removeEventListener('resize', updateDropdownPosition);
        };
    }, [isOpen, updateDropdownPosition]);

    // 键盘导航
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setHighlightedIndex(prev => 
                        prev < filteredOptions.length - 1 ? prev + 1 : 0
                    );
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setHighlightedIndex(prev => 
                        prev > 0 ? prev - 1 : filteredOptions.length - 1
                    );
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                        handleSelect(filteredOptions[highlightedIndex]);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    setIsOpen(false);
                    break;
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, highlightedIndex, filteredOptions]);

    // 聚焦搜索框
    useEffect(() => {
        if (isOpen && searchable && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isOpen, searchable]);

    // 下拉菜单内容
    const dropdownContent = isOpen && ReactDOM.createPortal(
        <div 
            ref={dropdownRef}
            className="custom-select-dropdown"
            style={dropdownStyle}
        >
            {/* 搜索框 */}
            {searchable && (
                <div className="custom-select-search">
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="搜索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}

            {/* 选项列表 */}
            <div className="custom-select-options-list">
                {filteredOptions.length === 0 ? (
                    <div className="custom-select-empty">无匹配选项</div>
                ) : (
                    Object.entries(groupedOptions).map(([group, groupOptions]) => (
                        <React.Fragment key={group}>
                            {group && (
                                <div className="custom-select-group-label">{group}</div>
                            )}
                            {groupOptions.map((option, idx) => {
                                const globalIndex = filteredOptions.indexOf(option);
                                return (
                                    <div
                                        key={option.value}
                                        className={`custom-select-option ${option.value === value ? 'selected' : ''} ${option.disabled ? 'disabled' : ''} ${globalIndex === highlightedIndex ? 'highlighted' : ''}`}
                                        onClick={() => handleSelect(option)}
                                        onMouseEnter={() => setHighlightedIndex(globalIndex)}
                                    >
                                        <span className="option-label">{option.label}</span>
                                        {option.value === value && (
                                            <span className="option-check">✓</span>
                                        )}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))
                )}
            </div>
        </div>,
        document.body
    );

    return (
        <>
            <div 
                ref={containerRef}
                className={`custom-select ${className} ${size === 'small' ? 'small' : ''} ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={toggleOpen}
            >
                <div className="custom-select-trigger">
                    <span className={`custom-select-value ${!selectedOption ? 'placeholder' : ''}`}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                    <span className="custom-select-arrow">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
            </div>
            {dropdownContent}

            <style>{`
                .custom-select {
                    position: relative;
                    width: 100%;
                    cursor: pointer;
                    user-select: none;
                }

                .custom-select.disabled {
                    opacity: 0.5;
                    pointer-events: none;
                }

                .custom-select-trigger {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    background: var(--de-bg-light, #1a1a24);
                    border: 1px solid var(--de-border, #2a2a3a);
                    border-radius: 8px;
                    color: var(--de-text, #e0e0e0);
                    font-size: 13px;
                    transition: all 0.2s ease;
                }

                .custom-select.small .custom-select-trigger {
                    padding: 8px 10px;
                    font-size: 12px;
                }

                .custom-select:hover .custom-select-trigger,
                .custom-select.open .custom-select-trigger {
                    border-color: var(--de-primary, #0066ff);
                }

                .custom-select.open .custom-select-trigger {
                    box-shadow: 0 0 0 2px rgba(0, 102, 255, 0.2);
                }

                .custom-select-value {
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .custom-select-value.placeholder {
                    color: var(--de-text-secondary, #8a8a9a);
                }

                .custom-select-arrow {
                    display: flex;
                    align-items: center;
                    color: var(--de-text-secondary, #8a8a9a);
                    transition: transform 0.2s ease;
                }

                .custom-select.open .custom-select-arrow {
                    transform: rotate(180deg);
                }

                /* 下拉菜单（Portal渲染） */
                .custom-select-dropdown {
                    background: var(--de-bg-card, #12121a);
                    border: 1px solid var(--de-border, #2a2a3a);
                    border-radius: 10px;
                    box-shadow: 
                        0 10px 40px rgba(0, 0, 0, 0.5),
                        0 0 0 1px rgba(255, 255, 255, 0.05);
                    overflow: hidden;
                    animation: selectDropdownIn 0.15s ease-out;
                }

                @keyframes selectDropdownIn {
                    from {
                        opacity: 0;
                        transform: translateY(-8px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                .custom-select-search {
                    padding: 8px;
                    border-bottom: 1px solid var(--de-border, #2a2a3a);
                }

                .custom-select-search input {
                    width: 100%;
                    padding: 8px 10px;
                    background: var(--de-bg, #0d0d14);
                    border: 1px solid var(--de-border, #2a2a3a);
                    border-radius: 6px;
                    color: var(--de-text, #e0e0e0);
                    font-size: 12px;
                    outline: none;
                }

                .custom-select-search input:focus {
                    border-color: var(--de-primary, #0066ff);
                }

                .custom-select-search input::placeholder {
                    color: var(--de-text-secondary, #8a8a9a);
                }

                .custom-select-options-list {
                    overflow-y: auto;
                    max-height: inherit;
                }

                .custom-select-group-label {
                    padding: 8px 12px 4px;
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--de-text-secondary, #8a8a9a);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .custom-select-option {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    font-size: 13px;
                    color: var(--de-text, #e0e0e0);
                    cursor: pointer;
                    transition: background 0.1s ease;
                }

                .custom-select-option:hover,
                .custom-select-option.highlighted {
                    background: rgba(255, 255, 255, 0.05);
                }

                .custom-select-option.selected {
                    background: rgba(0, 102, 255, 0.1);
                    color: var(--de-primary, #0066ff);
                }

                .custom-select-option.disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                .option-label {
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .option-check {
                    color: var(--de-primary, #0066ff);
                    font-weight: bold;
                    margin-left: 8px;
                }

                .custom-select-empty {
                    padding: 20px;
                    text-align: center;
                    color: var(--de-text-secondary, #8a8a9a);
                    font-size: 13px;
                }
            `}</style>
        </>
    );
};

export default CustomSelect;
