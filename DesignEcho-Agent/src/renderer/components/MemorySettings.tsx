/**
 * 记忆设置面板
 * 
 * 功能：
 * - 查看和编辑用户偏好
 * - 管理自定义操作模式
 * - 清空记忆
 */

import React, { useState, useEffect } from 'react';
import { getMemoryService, UserPreferences, OperationPattern } from '../services/memory.service';

interface MemorySettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

const MemorySettings: React.FC<MemorySettingsProps> = ({ isOpen, onClose }) => {
    const memory = getMemoryService();
    const [preferences, setPreferences] = useState<UserPreferences>(memory.getPreferences());
    const [patterns, setPatterns] = useState<OperationPattern[]>(memory.getPatterns());
    const [activeTab, setActiveTab] = useState<'preferences' | 'patterns' | 'shortcuts'>('preferences');
    
    // 新建操作模式表单
    const [newPatternName, setNewPatternName] = useState('');
    const [newPatternTrigger, setNewPatternTrigger] = useState('');
    
    useEffect(() => {
        if (isOpen) {
            setPreferences(memory.getPreferences());
            setPatterns(memory.getPatterns());
        }
    }, [isOpen]);
    
    if (!isOpen) return null;
    
    const handleUpdatePreference = (
        category: 'design' | 'interaction' | 'workflow',
        key: string,
        value: any
    ) => {
        const newPrefs = {
            ...preferences,
            [category]: {
                ...preferences[category],
                [key]: value
            }
        };
        setPreferences(newPrefs);
        memory.updatePreferences(newPrefs);
    };
    
    const handleDeletePattern = (patternId: string) => {
        memory.deletePattern(patternId);
        setPatterns(memory.getPatterns());
    };
    
    const handleClearAllMemory = () => {
        if (window.confirm('确定要清空所有记忆吗？这将删除所有用户偏好和操作模式。')) {
            localStorage.removeItem('designecho-memory');
            window.location.reload();
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-neutral-900 rounded-xl w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-700">
                    <h2 className="text-lg font-semibold text-white">💡 Agent 记忆设置</h2>
                    <button
                        onClick={onClose}
                        className="text-neutral-400 hover:text-white transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-neutral-700">
                    <button
                        onClick={() => setActiveTab('preferences')}
                        className={`px-6 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'preferences'
                                ? 'text-blue-400 border-b-2 border-blue-400'
                                : 'text-neutral-400 hover:text-white'
                        }`}
                    >
                        用户偏好
                    </button>
                    <button
                        onClick={() => setActiveTab('patterns')}
                        className={`px-6 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'patterns'
                                ? 'text-blue-400 border-b-2 border-blue-400'
                                : 'text-neutral-400 hover:text-white'
                        }`}
                    >
                        操作模式 ({patterns.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('shortcuts')}
                        className={`px-6 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'shortcuts'
                                ? 'text-blue-400 border-b-2 border-blue-400'
                                : 'text-neutral-400 hover:text-white'
                        }`}
                    >
                        快捷记忆
                    </button>
                </div>
                
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'preferences' && (
                        <div className="space-y-6">
                            {/* 交互偏好 */}
                            <div>
                                <h3 className="text-sm font-medium text-neutral-300 mb-3">交互偏好</h3>
                                <div className="space-y-3">
                                    <label className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-400">回复详细程度</span>
                                        <select
                                            value={preferences.interaction.verbosity}
                                            onChange={(e) => handleUpdatePreference('interaction', 'verbosity', e.target.value)}
                                            className="bg-neutral-800 text-white text-sm rounded px-3 py-1.5 border border-neutral-600"
                                        >
                                            <option value="concise">简洁</option>
                                            <option value="normal">正常</option>
                                            <option value="detailed">详细</option>
                                        </select>
                                    </label>
                                    <label className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-400">执行前确认</span>
                                        <input
                                            type="checkbox"
                                            checked={preferences.interaction.confirmBeforeExecute}
                                            onChange={(e) => handleUpdatePreference('interaction', 'confirmBeforeExecute', e.target.checked)}
                                            className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                        />
                                    </label>
                                    <label className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-400">显示思考过程</span>
                                        <input
                                            type="checkbox"
                                            checked={preferences.interaction.showThinking}
                                            onChange={(e) => handleUpdatePreference('interaction', 'showThinking', e.target.checked)}
                                            className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                        />
                                    </label>
                                </div>
                            </div>
                            
                            {/* 设计偏好 */}
                            <div>
                                <h3 className="text-sm font-medium text-neutral-300 mb-3">设计偏好</h3>
                                <div className="space-y-3">
                                    <div>
                                        <span className="text-sm text-neutral-400 block mb-1">常用字体</span>
                                        <div className="flex flex-wrap gap-2">
                                            {preferences.design.preferredFonts.length > 0 ? (
                                                preferences.design.preferredFonts.map((font, i) => (
                                                    <span key={i} className="px-2 py-1 bg-neutral-800 rounded text-xs text-neutral-300">
                                                        {font}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-xs text-neutral-500">使用过的字体会自动记录</span>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-sm text-neutral-400 block mb-1">常用颜色</span>
                                        <div className="flex flex-wrap gap-2">
                                            {preferences.design.preferredColors.length > 0 ? (
                                                preferences.design.preferredColors.slice(0, 10).map((color, i) => (
                                                    <div
                                                        key={i}
                                                        className="w-6 h-6 rounded border border-neutral-600"
                                                        style={{ backgroundColor: color }}
                                                        title={color}
                                                    />
                                                ))
                                            ) : (
                                                <span className="text-xs text-neutral-500">使用过的颜色会自动记录</span>
                                            )}
                                        </div>
                                    </div>
                                    <label className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-400">默认间距 (px)</span>
                                        <input
                                            type="number"
                                            value={preferences.design.defaultSpacing}
                                            onChange={(e) => handleUpdatePreference('design', 'defaultSpacing', parseInt(e.target.value) || 20)}
                                            className="w-20 bg-neutral-800 text-white text-sm rounded px-3 py-1.5 border border-neutral-600"
                                        />
                                    </label>
                                </div>
                            </div>
                            
                            {/* 工作流偏好 */}
                            <div>
                                <h3 className="text-sm font-medium text-neutral-300 mb-3">工作流偏好</h3>
                                <div className="space-y-3">
                                    <label className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-400">默认导出格式</span>
                                        <select
                                            value={preferences.workflow.defaultExportFormat}
                                            onChange={(e) => handleUpdatePreference('workflow', 'defaultExportFormat', e.target.value)}
                                            className="bg-neutral-800 text-white text-sm rounded px-3 py-1.5 border border-neutral-600"
                                        >
                                            <option value="png">PNG</option>
                                            <option value="jpg">JPG</option>
                                            <option value="webp">WebP</option>
                                        </select>
                                    </label>
                                    <label className="flex items-center justify-between">
                                        <span className="text-sm text-neutral-400">导出质量</span>
                                        <input
                                            type="range"
                                            min="50"
                                            max="100"
                                            value={preferences.workflow.defaultExportQuality}
                                            onChange={(e) => handleUpdatePreference('workflow', 'defaultExportQuality', parseInt(e.target.value))}
                                            className="w-24"
                                        />
                                        <span className="text-xs text-neutral-400 ml-2">{preferences.workflow.defaultExportQuality}%</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {activeTab === 'patterns' && (
                        <div className="space-y-4">
                            <p className="text-sm text-neutral-400">
                                操作模式是你自定义的快捷操作序列。说出触发词，Agent 会自动执行对应的操作。
                            </p>
                            
                            {patterns.length === 0 ? (
                                <div className="text-center py-8 text-neutral-500">
                                    <div className="text-4xl mb-2">📝</div>
                                    <p>还没有自定义操作模式</p>
                                    <p className="text-xs mt-1">在对话中说 "记住这个操作" 可以创建</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {patterns.map((pattern) => (
                                        <div key={pattern.id} className="bg-neutral-800 rounded-lg p-4">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h4 className="font-medium text-white">{pattern.name}</h4>
                                                    <p className="text-xs text-neutral-400 mt-1">
                                                        触发词: {pattern.triggers.join(', ')}
                                                    </p>
                                                    <p className="text-xs text-neutral-500 mt-1">
                                                        使用 {pattern.frequency} 次 · {new Date(pattern.lastUsed).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handleDeletePattern(pattern.id)}
                                                    className="text-neutral-400 hover:text-red-400 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                            <div className="mt-2 text-xs text-neutral-500">
                                                步骤: {pattern.steps.map(s => s.tool).join(' → ')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    
                    {activeTab === 'shortcuts' && (
                        <div className="space-y-4">
                            <p className="text-sm text-neutral-400">
                                快捷记忆可以帮助 Agent 更好地理解你的指令。
                            </p>
                            
                            <div className="bg-neutral-800/50 rounded-lg p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">💡</span>
                                    <span className="text-sm text-white">对话中可以这样说：</span>
                                </div>
                                <ul className="text-sm text-neutral-400 space-y-2 ml-8">
                                    <li>"<span className="text-blue-400">记住</span>：我喜欢用阿里巴巴普惠体"</li>
                                    <li>"<span className="text-blue-400">记住这个操作</span>：居中然后加阴影"</li>
                                    <li>"<span className="text-blue-400">以后导出</span>都用 JPG 格式"</li>
                                    <li>"<span className="text-blue-400">品牌色</span>是 #FF6B00"</li>
                                </ul>
                            </div>
                            
                            <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-amber-400">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span className="text-sm font-medium">提示</span>
                                </div>
                                <p className="text-xs text-amber-300/70 mt-2">
                                    记忆数据存储在本地浏览器中。清除浏览器数据会导致记忆丢失。
                                </p>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-700">
                    <button
                        onClick={handleClearAllMemory}
                        className="text-sm text-red-400 hover:text-red-300 transition-colors"
                    >
                        清空所有记忆
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        完成
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MemorySettings;
