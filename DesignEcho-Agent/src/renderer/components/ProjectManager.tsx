/**
 * 项目管理主页
 * 
 * 显示项目列表，支持创建/导入/打开项目
 * 集成电商项目扫描和素材预览功能
 */

import React, { useState, useCallback } from 'react';
import { ArrowUp, FolderOpen, Plus, Sparkles } from 'lucide-react';

import { normalizeModelThinkingPreference } from '../../shared/config/models.config';
import { useAppStore, ProjectInfo } from '../stores/app.store';
import { ThinkingModeControl } from './ThinkingModeControl';

import './ProjectManager.css';

export const ProjectManager: React.FC<{
    onProjectOpen: (project: ProjectInfo, pendingDraft?: string) => void;
}> = ({ onProjectOpen }) => {
    const { 
        recentProjects, 
        addRecentProject, 
        removeRecentProject, 
        currentProject,
        modelPreferences,
        setModelPreferences
    } = useAppStore();
    const [isLoading, setIsLoading] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState('');
    const [showNewProjectModal, setShowNewProjectModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectPath, setNewProjectPath] = useState('');
    const [exportFolderPath, setExportFolderPath] = useState<string | null>(null);
    const [showExportFolderPrompt, setShowExportFolderPrompt] = useState(false);
    const [homePrompt, setHomePrompt] = useState('');
    const [promptHint, setPromptHint] = useState('');
    const thinkingPreference = normalizeModelThinkingPreference(modelPreferences?.thinking);

    const formatErrorMessage = (error: any, fallback: string): string => {
        if (!error) return fallback;
        if (typeof error === 'string') return error;
        const parts: string[] = [];
        if (error.message) parts.push(error.message);
        if (error.error && error.error !== error.message) parts.push(error.error);
        if (error.code) parts.push(`code=${error.code}`);
        if (error.path) parts.push(`path=${error.path}`);
        if (error.details && typeof error.details === 'string') parts.push(error.details);
        return parts.length > 0 ? parts.join('\n') : fallback;
    };

    /**
     * 电商项目标准目录结构
     */
    const PROJECT_SUBDIRS = [
        'SKU',
        'PSD',
        '主图',
        '模板文件',
        '配置文件',
        '主图视频'
    ];

    /**
     * 导出目录使用当前项目路径；底层通过 getEntryWithUrl 解析为 UXP 可访问入口
     */
    const checkExportFolderStatus = useCallback(async () => {
        // 使用当前项目路径作为导出目录，底层由 UXP entry 解析处理权限
        if (currentProject?.path) {
            setExportFolderPath(currentProject.path);
        }
    }, [currentProject?.path]);

    /**
     * 确认使用当前项目目录作为导出目录
     * 复用当前项目路径，无需重复弹窗选择
     */
    const handleSelectExportFolder = async () => {
        if (currentProject?.path) {
            setExportFolderPath(currentProject.path);
            setShowExportFolderPrompt(false);
            console.log('[ProjectManager] ✅ 使用项目目录:', currentProject.path);
        }
    };

    /**
     * 选择新建项目的父目录
     */
    const handleSelectNewProjectPath = async () => {
        const result: any = await window.designEcho?.selectFolder('选择项目存放位置');
        // 兼容处理：支持返回 { success, path } 对象或直接返回 path 字符串
        const folderPath = (result && typeof result === 'object' && 'path' in result) ? result.path : result;
        
        if (folderPath) {
            setNewProjectPath(folderPath);
        }
    };

    /**
     * 创建新项目
     */
    const handleCreateProject = async () => {
        const normalizedName = newProjectName.trim();
        if (!normalizedName) {
            alert('请输入项目名称');
            return;
        }
        if (/[<>:"/\\|?*\x00-\x1F]/.test(normalizedName)) {
            alert('项目名称包含非法字符，请移除 \ / : * ? " < > |');
            return;
        }
        if (!newProjectPath) {
            alert('请选择项目存放位置');
            return;
        }

        try {
            setIsLoading(true);
            setLoadingStatus('正在创建项目目录...');

            // 完整的项目路径
            const projectFullPath = `${newProjectPath}\\${normalizedName}`;

            // 避免覆盖已有目录
            const alreadyExists = await (window.designEcho as any)?.pathExists?.(projectFullPath);
            if (alreadyExists) {
                throw new Error(`项目目录已存在: ${projectFullPath}`);
            }

            // 创建主目录
            const createResult = await window.designEcho?.invoke('fs:mkdir', projectFullPath);
            if (!createResult?.success) {
                throw createResult || new Error('创建项目目录失败');
            }

            // 创建子目录
            setLoadingStatus('正在创建子目录...');
            for (const subdir of PROJECT_SUBDIRS) {
                const subdirPath = `${projectFullPath}\\${subdir}`;
                const subdirResult = await window.designEcho?.invoke('fs:mkdir', subdirPath);
                if (!subdirResult?.success) {
                    throw { ...(subdirResult || {}), error: subdirResult?.error || `创建子目录失败: ${subdir}` };
                }
            }

            // 创建项目信息
            const project: ProjectInfo = {
                id: crypto.randomUUID(),
                name: normalizedName,
                path: projectFullPath,
                createdAt: Date.now(),
                lastOpenedAt: Date.now(),
                folders: {
                    assets: `${projectFullPath}\\SKU`,
                    psd: `${projectFullPath}\\PSD`,
                    output: `${projectFullPath}\\主图`
                }
            };

            // 添加到最近项目
            addRecentProject(project);

            // 打开项目
            onProjectOpen(project, homePrompt.trim() || undefined);
            setExportFolderPath(projectFullPath);
            setShowExportFolderPrompt(false);

            // 关闭弹窗
            setShowNewProjectModal(false);
            setNewProjectName('');
            setNewProjectPath('');

        } catch (error: any) {
            console.error('[ProjectManager] 创建项目失败:', error);
            const message = formatErrorMessage(error, '创建项目失败，请检查目录权限与路径设置');
            alert(`创建项目失败:\n${message}`);
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
        }
    };

    /**
     * 选择并导入项目文件夹
     */
    const handleImportProject = async () => {
        try {
            setIsLoading(true);
            setLoadingStatus('选择文件夹...');
            
            const result: any = await window.designEcho?.selectFolder('选择项目文件夹');
            
            // 兼容处理：支持返回 { success, path } 对象或直接返回 path 字符串
            const folderPath = (result && typeof result === 'object' && 'path' in result) ? result.path : result;
            
            if (!folderPath) {
                setIsLoading(false);
                setLoadingStatus('');
                return;
            }

            // 提取项目名称（文件夹名）
            const pathParts = folderPath.split(/[/\\]/);
            const projectName = pathParts[pathParts.length - 1] || '未命名项目';

            // 创建项目信息
            const project: ProjectInfo = {
                id: crypto.randomUUID(),
                name: projectName,
                path: folderPath,
                createdAt: Date.now(),
                lastOpenedAt: Date.now(),
                folders: {}
            };

            // 添加到最近项目
            addRecentProject(project);
            
            // 打开项目
            onProjectOpen(project, homePrompt.trim() || undefined);

            // 使用项目路径作为导出目录
            setExportFolderPath(folderPath);
            console.log('[ProjectManager] ✅ 项目目录:', folderPath);

        } catch (error) {
            console.error('[ProjectManager] 导入项目失败:', error);
            alert(`导入项目失败:\n${formatErrorMessage(error, '请检查目录权限与项目路径')}`);
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
        }
    };

    /**
     * 打开已有项目
     */
    const handleOpenProject = (project: ProjectInfo): void => {
        if (isLoading) return;
        setIsLoading(true);
        setLoadingStatus('正在加载项目...');
        
        try {
            const openedProject = { ...project, lastOpenedAt: Date.now() };
            addRecentProject(openedProject);
            onProjectOpen(openedProject, homePrompt.trim() || undefined);
            
            // 使用项目路径作为导出目录
            setExportFolderPath(project.path);
            console.log('[ProjectManager] ✅ 项目目录:', project.path);
        } catch (error) {
            console.error('[ProjectManager] 打开项目失败:', error);
            alert(`打开项目失败:\n${formatErrorMessage(error, '请检查项目路径和读写权限')}`);
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
        }
    };

    /**
     * 删除项目（仅从列表移除）
     */
    const handleRemoveProject = (projectId: string): void => {
        removeRecentProject(projectId);
    };

    /**
     * 在资源管理器中打开
     */
    const handleOpenInExplorer = async (path: string): Promise<void> => {
        await window.designEcho?.openPath(path);
    };

    /**
     * 格式化日期
     */
    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - timestamp;
        
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
        
        return date.toLocaleDateString();
    };

    const handleToggleThinking = (): void => {
        setModelPreferences({ thinking: { enabled: !thinkingPreference.enabled } });
    };

    const handleHomeSubmit = (event: React.FormEvent): void => {
        event.preventDefault();
        if (!homePrompt.trim()) {
            setPromptHint('先描述你想完成的设计任务。');
            return;
        }
        setPromptHint('选择、新建或导入一个项目后，这条需求会自动带入 Agent。');
        document.getElementById('recent-projects-title')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    };

    const taskPresets = [
        '设计一张电商主图',
        '规划详情页结构',
        '批量制作 SKU',
        '分析项目素材'
    ];

    return (
        <div className="project-manager">
            <section className="pm-home" aria-labelledby="project-home-title">
                <div className="pm-identity">
                    <div className="pm-identity-title">
                        <div className="pm-mark" aria-hidden="true">
                            <Sparkles size={17} strokeWidth={1.9} />
                        </div>
                        <h1 id="project-home-title">让设计工作更简单</h1>
                    </div>
                    <p>懂你的设计代理，帮你把素材、创作与交付连成一条工作流</p>
                </div>

                <form className="pm-creator" onSubmit={handleHomeSubmit}>
                    <textarea
                        value={homePrompt}
                        onChange={(event) => {
                            setHomePrompt(event.target.value);
                            setPromptHint('');
                        }}
                        placeholder="描述你想完成的设计任务…"
                        aria-label="设计任务"
                        rows={2}
                    />
                    <div className="pm-creator-toolbar">
                        <div className="pm-creator-tools">
                            <button
                                type="button"
                                className="pm-tool-button"
                                onClick={handleImportProject}
                                disabled={isLoading}
                                aria-label="导入项目文件夹"
                                title="导入项目文件夹"
                            >
                                <FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                            <ThinkingModeControl
                                enabled={thinkingPreference.enabled}
                                onToggle={handleToggleThinking}
                                direction="down"
                            />
                        </div>
                        <button
                            type="submit"
                            className="pm-submit-button"
                            aria-label="准备设计任务"
                        >
                            <ArrowUp size={17} strokeWidth={2} aria-hidden="true" />
                        </button>
                    </div>
                </form>

                <div className="pm-task-presets" aria-label="常用设计任务">
                    {taskPresets.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            className={homePrompt === preset ? 'active' : ''}
                            onClick={() => {
                                setHomePrompt(preset);
                                setPromptHint('');
                            }}
                        >
                            {preset}
                        </button>
                    ))}
                </div>
                <p className="pm-prompt-hint" aria-live="polite">{promptHint}</p>

                <section className="pm-recent" aria-labelledby="recent-projects-title">
                    <div className="pm-recent-heading">
                        <h2 id="recent-projects-title">最近项目</h2>
                        <button type="button" onClick={handleImportProject} disabled={isLoading}>
                            {isLoading ? (loadingStatus || '正在导入…') : '导入项目'}
                        </button>
                    </div>
                    <div className="project-grid">
                        <button
                            type="button"
                            className="project-card project-card-new"
                            onClick={() => setShowNewProjectModal(true)}
                            disabled={isLoading}
                        >
                            <span className="project-card-new-icon">
                                <Plus size={20} strokeWidth={1.6} aria-hidden="true" />
                            </span>
                            <span>新建项目</span>
                        </button>

                        {recentProjects.map(project => (
                            <article key={project.id} className="project-card">
                                <button
                                    type="button"
                                    className="project-card-open"
                                    onClick={() => handleOpenProject(project)}
                                    disabled={isLoading}
                                    aria-label={`打开项目：${project.name}`}
                                >
                                    <span className="project-card-preview">
                                        {project.thumbnail ? (
                                            <img src={project.thumbnail} alt="" />
                                        ) : (
                                            <FolderOpen size={30} strokeWidth={1.35} aria-hidden="true" />
                                        )}
                                    </span>
                                    <span className="card-info">
                                        <span className="card-title">{project.name}</span>
                                        <span className="card-path" title={project.path}>{project.path}</span>
                                        <span className="card-time">{formatDate(project.lastOpenedAt)}</span>
                                    </span>
                                </button>
                                <span className="card-actions">
                                    <button
                                        type="button"
                                        className="card-btn"
                                        onClick={() => void handleOpenInExplorer(project.path)}
                                        disabled={isLoading}
                                    >
                                        打开目录
                                    </button>
                                    <button
                                        type="button"
                                        className="card-btn danger"
                                        onClick={() => handleRemoveProject(project.id)}
                                        disabled={isLoading}
                                    >
                                        移除
                                    </button>
                                </span>
                            </article>
                        ))}
                    </div>
                </section>

                {exportFolderPath && (
                    <div className="pm-export-status">
                        <div className="export-info">
                            <span className="export-label">导出目录</span>
                            <span className="export-path" title={exportFolderPath}>{exportFolderPath}</span>
                        </div>
                        <button className="btn-change-export" onClick={handleSelectExportFolder}>使用项目目录</button>
                    </div>
                )}

                <details className="pm-tips">
                    <summary>标准项目目录</summary>
                    <div className="tips-content">
                        <div className="tip-item"><span className="tip-folder">拍摄图 /</span><span className="tip-desc">原始产品照片</span></div>
                        <div className="tip-item"><span className="tip-folder">PSD /</span><span className="tip-desc">Photoshop 源文件</span></div>
                        <div className="tip-item"><span className="tip-folder">主图 /</span><span className="tip-desc">750 / 800 / 1200 尺寸</span></div>
                        <div className="tip-item"><span className="tip-folder">详情页 /</span><span className="tip-desc">详情页切片</span></div>
                        <div className="tip-item"><span className="tip-folder">SKU /</span><span className="tip-desc">颜色与款式图</span></div>
                    </div>
                </details>
            </section>

            {/* 设置导出目录提示弹窗 */}
            {showExportFolderPrompt && (
                <div className="export-prompt-overlay">
                    <div className="export-prompt-card">
                        <div className="prompt-header">
                            <h3>设置 SKU 导出目录</h3>
                        </div>
                        <p className="prompt-desc">
                            设置导出目录后，批量生成的 SKU 图片将直接保存到该位置，无需重复授权。
                        </p>
                        <div className="prompt-actions">
                            <button className="btn-primary" onClick={handleSelectExportFolder}>
                                选择导出目录
                            </button>
                            <button className="btn-secondary" onClick={() => setShowExportFolderPrompt(false)}>
                                稍后设置
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 新建项目弹窗 */}
            {showNewProjectModal && (
                <div className="new-project-modal" onClick={() => setShowNewProjectModal(false)}>
                    <div className="new-project-card" onClick={e => e.stopPropagation()}>
                        <div className="new-project-header">
                            <h3>新建项目</h3>
                            <button className="btn-close" onClick={() => setShowNewProjectModal(false)} aria-label="关闭新建项目">×</button>
                        </div>
                        
                        <div className="new-project-body">
                            <div className="form-group">
                                <label>项目名称</label>
                                <input
                                    type="text"
                                    placeholder="输入项目名称，如：C-1016"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="form-group">
                                <label>存放位置</label>
                                <div className="path-selector">
                                    <input
                                        type="text"
                                        placeholder="选择项目存放目录..."
                                        value={newProjectPath}
                                        readOnly
                                    />
                                    <button onClick={handleSelectNewProjectPath}>浏览...</button>
                                </div>
                            </div>

                            <div className="form-group">
                                <div className="subdirs-preview">
                                    <h4>将创建以下目录结构</h4>
                                    <div className="subdirs-list">
                                        <div className="subdir-item">SKU</div>
                                        <div className="subdir-item">PSD</div>
                                        <div className="subdir-item">主图</div>
                                        <div className="subdir-item">模板文件</div>
                                        <div className="subdir-item">配置文件</div>
                                        <div className="subdir-item">主图视频</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="new-project-footer">
                            <button 
                                className="btn btn-cancel" 
                                onClick={() => setShowNewProjectModal(false)}
                            >
                                取消
                            </button>
                            <button 
                                className="btn btn-create"
                                onClick={handleCreateProject}
                                disabled={!newProjectName.trim() || !newProjectPath || isLoading}
                            >
                                {isLoading ? loadingStatus : '创建项目'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
