import React, { useEffect, useMemo, useState } from 'react';
import { Archive, Download, Plus, RotateCcw, Upload } from 'lucide-react';

import {
    getMemoryService,
    type PreferenceMemoryItem
} from '../services/memory.service';
import { useAppStore } from '../stores/app.store';

type PreferenceScopeType = NonNullable<PreferenceMemoryItem['scope']>['type'];
type PreferenceFilter = 'all' | PreferenceMemoryItem['status'];

interface PreferenceDraft {
    category: PreferenceMemoryItem['category'];
    value: string;
    label: string;
    sourceNote: string;
    scopeType: PreferenceScopeType;
    scopeId: string;
}

const STATUS_LABELS: Record<PreferenceMemoryItem['status'], string> = {
    active: '启用',
    disabled: '已禁用',
    needs_review: '待确认',
    archived: '已归档'
};

const SOURCE_LABELS: Record<PreferenceMemoryItem['sourceType'], string> = {
    explicit: '用户明确设置',
    inferred: 'Agent 推断',
    temporary: '临时偏好',
    deprecated: '旧版迁移'
};

const CATEGORY_LABELS: Record<PreferenceMemoryItem['category'], string> = {
    font: '字体',
    color: '颜色',
    style: '风格',
    workflow: '工作流',
    interaction: '交互',
    copywriting: '文案',
    layout: '排版',
    unknown: '其他'
};

const SCOPE_LABELS: Record<PreferenceScopeType, string> = {
    user: '用户级',
    project: '项目级',
    brand: '品牌级',
    session: '会话级'
};

const EMPTY_DRAFT: PreferenceDraft = {
    category: 'style',
    value: '',
    label: '',
    sourceNote: '',
    scopeType: 'user',
    scopeId: ''
};

export function UserPreferencesPanel(): React.ReactElement {
    const currentProject = useAppStore((state) => state.currentProject);
    const [items, setItems] = useState<PreferenceMemoryItem[]>(() => getMemoryService().listPreferenceItems());
    const [filter, setFilter] = useState<PreferenceFilter>('all');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<PreferenceDraft>(EMPTY_DRAFT);
    const [editorOpen, setEditorOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState('');
    const [exportText, setExportText] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => getMemoryService().subscribe(() => {
        setItems(getMemoryService().listPreferenceItems());
    }), []);

    const counts = useMemo(() => ({
        active: items.filter((item) => item.status === 'active').length,
        needsReview: items.filter((item) => item.status === 'needs_review').length,
        disabled: items.filter((item) => item.status === 'disabled').length,
        archived: items.filter((item) => item.status === 'archived').length
    }), [items]);

    // 「全部」不含已归档：归档是历史留档，平铺会淹没当前有效偏好；要看归档请点「已归档」标签。
    const visibleItems = useMemo(() => (
        filter === 'all'
            ? items.filter((item) => item.status !== 'archived')
            : items.filter((item) => item.status === filter)
    ), [filter, items]);

    function openCreate(): void {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        setEditorOpen(true);
        setMessage('');
    }

    function openEdit(item: PreferenceMemoryItem): void {
        setEditingId(item.id);
        setDraft({
            category: item.category,
            value: item.value,
            label: item.label,
            sourceNote: item.sourceNote,
            scopeType: item.scope?.type || 'user',
            scopeId: item.scope?.id || ''
        });
        setEditorOpen(true);
        setMessage('');
    }

    function closeEditor(): void {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        setEditorOpen(false);
    }

    function saveDraft(): void {
        const value = draft.value.trim();
        if (!value) {
            setMessage('偏好值不能为空。');
            return;
        }
        if (draft.scopeType !== 'user' && !draft.scopeId.trim()) {
            setMessage('项目级、品牌级或会话级偏好需要明确的作用域。');
            return;
        }
        const payload = {
            category: draft.category,
            value,
            label: draft.label.trim() || undefined,
            sourceNote: draft.sourceNote.trim() || undefined,
            scope: draft.scopeId.trim()
                ? { type: draft.scopeType, id: draft.scopeId.trim() }
                : { type: draft.scopeType }
        };
        try {
            const saved = editingId
                ? getMemoryService().updatePreferenceItem(editingId, {
                    ...payload,
                    sourceType: 'explicit',
                    status: 'active'
                })
                : getMemoryService().upsertExplicitPreference(payload);
            closeEditor();
            setMessage(`已保存偏好：${saved.label}`);
        } catch (error) {
            setMessage(formatError(error, '保存偏好失败。'));
        }
    }

    function togglePreference(item: PreferenceMemoryItem): void {
        try {
            const enabled = item.status !== 'active';
            const updated = getMemoryService().setPreferenceEnabled(item.id, enabled);
            setMessage(enabled ? `已启用偏好：${updated.label}` : `已禁用偏好：${updated.label}`);
        } catch (error) {
            setMessage(formatError(error, '更新偏好失败。'));
        }
    }

    function archivePreference(item: PreferenceMemoryItem): void {
        try {
            const updated = getMemoryService().archivePreference(item.id);
            setMessage(`已归档偏好：${updated.label}`);
        } catch (error) {
            setMessage(formatError(error, '归档偏好失败。'));
        }
    }

    async function exportPreferences(): Promise<void> {
        const text = JSON.stringify(getMemoryService().exportPreferences(), null, 2);
        setExportText(text);
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text).catch(() => undefined);
        }
        setMessage('已生成偏好 JSON，并尝试复制到剪贴板。');
    }

    function importPreferences(): void {
        if (!importText.trim()) {
            setMessage('请先粘贴需要导入的偏好 JSON。');
            return;
        }
        try {
            const result = getMemoryService().importPreferences(importText, { mode: 'merge' });
            setMessage(`已导入 ${result.importedCount} 条，更新 ${result.replacedExistingCount} 条，跳过 ${result.skippedCount} 条。`);
            setImportOpen(false);
        } catch (error) {
            setMessage(formatError(error, '导入偏好失败。'));
        }
    }

    function handleScopeChange(scopeType: PreferenceScopeType): void {
        let scopeId = draft.scopeId;
        if (scopeType === 'user') scopeId = '';
        if (scopeType === 'project') scopeId = currentProject?.id || '';
        setDraft((current) => ({ ...current, scopeType, scopeId }));
    }

    return (
        <section className="knowledge-panel" data-testid="knowledge-user-preferences-panel">
            <div className="knowledge-panel__heading">
                <div>
                    <span className="knowledge-eyebrow">个性化边界</span>
                    <h2>用户偏好</h2>
                    <p>明确偏好可直接启用；Agent 推断只会进入待确认，不会覆盖当前任务和项目事实。</p>
                </div>
                <div className="knowledge-panel__actions">
                    <button className="knowledge-button knowledge-button--secondary" type="button" onClick={() => setImportOpen((open) => !open)}>
                        <Upload size={15} aria-hidden="true" />导入
                    </button>
                    <button className="knowledge-button knowledge-button--secondary" type="button" onClick={exportPreferences}>
                        <Download size={15} aria-hidden="true" />导出
                    </button>
                    <button className="knowledge-button knowledge-button--primary" type="button" onClick={openCreate}>
                        <Plus size={15} aria-hidden="true" />新增偏好
                    </button>
                </div>
            </div>

            <div className="knowledge-stat-grid knowledge-stat-grid--four">
                <StatusCard label="已启用" value={counts.active} tone="active" />
                <StatusCard label="待确认" value={counts.needsReview} tone="review" />
                <StatusCard label="已禁用" value={counts.disabled} tone="disabled" />
                <StatusCard label="已归档" value={counts.archived} tone="archived" />
            </div>

            <div className="knowledge-filter-row" role="group" aria-label="偏好状态筛选">
                {(['all', 'active', 'needs_review', 'disabled', 'archived'] as PreferenceFilter[]).map((status) => (
                    <button
                        key={status}
                        type="button"
                        className={filter === status ? 'is-active' : ''}
                        aria-pressed={filter === status}
                        onClick={() => setFilter(status)}
                    >
                        {status === 'all' ? '全部' : STATUS_LABELS[status]}
                    </button>
                ))}
            </div>

            {message && <div className="knowledge-inline-message" role="status" aria-live="polite">{message}</div>}

            {importOpen && (
                <div className="knowledge-editor-card">
                    <div className="knowledge-editor-card__heading">
                        <div><strong>导入偏好</strong><span>只接受 designecho-preferences/v1 JSON，默认与当前记忆合并。</span></div>
                        <button className="knowledge-button knowledge-button--primary" type="button" onClick={importPreferences}>确认导入</button>
                    </div>
                    <textarea value={importText} rows={5} onChange={(event) => setImportText(event.target.value)} aria-label="偏好 JSON" placeholder="粘贴 designecho-preferences/v1 JSON" />
                </div>
            )}

            {exportText && (
                <details className="knowledge-export-details">
                    <summary>查看已导出的 JSON</summary>
                    <textarea value={exportText} rows={5} readOnly aria-label="已导出的偏好 JSON" />
                </details>
            )}

            {editorOpen && (
                <div className="knowledge-editor-card" data-testid="knowledge-preference-editor">
                    <div className="knowledge-editor-card__heading">
                        <div><strong>{editingId ? '编辑偏好' : '新增偏好'}</strong><span>保存后立即进入本地偏好记忆。</span></div>
                    </div>
                    <div className="knowledge-form-grid">
                        <label>分类<select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as PreferenceMemoryItem['category'] }))}>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                        <label>作用域<select value={draft.scopeType} onChange={(event) => handleScopeChange(event.target.value as PreferenceScopeType)}>{Object.entries(SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                        <label>偏好值<input value={draft.value} onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))} placeholder="例如：克制、低广告感" /></label>
                        <label>显示名称<input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="可选" /></label>
                        {draft.scopeType !== 'user' && <label>作用域 ID<input value={draft.scopeId} readOnly={draft.scopeType === 'project'} onChange={(event) => setDraft((current) => ({ ...current, scopeId: event.target.value }))} placeholder="项目、品牌或会话 ID" /></label>}
                        <label className="knowledge-form-grid__wide">来源说明<textarea value={draft.sourceNote} rows={3} onChange={(event) => setDraft((current) => ({ ...current, sourceNote: event.target.value }))} placeholder="说明来自哪次用户明确设置或确认" /></label>
                    </div>
                    <div className="knowledge-editor-card__actions">
                        <button className="knowledge-button knowledge-button--primary" type="button" onClick={saveDraft}>保存偏好</button>
                        <button className="knowledge-button knowledge-button--secondary" type="button" onClick={closeEditor}>取消</button>
                    </div>
                </div>
            )}

            {visibleItems.length === 0 ? (
                <div className="knowledge-empty-state">
                    {filter === 'all' && counts.archived > 0
                        ? `还没有生效中的偏好；${counts.archived} 条历史归档记录可在「已归档」标签查看。点右上「新增偏好」可直接设置。`
                        : '当前筛选下没有偏好。'}
                </div>
            ) : (
                <div className="knowledge-record-list">
                    {visibleItems.map((item) => (
                        <article key={item.id} className={`knowledge-record knowledge-record--${item.status}`}>
                            <div className="knowledge-record__main">
                                <div className="knowledge-record__title-row">
                                    <h3>{item.label}</h3>
                                    <span className={`knowledge-status knowledge-status--${item.status}`}>{STATUS_LABELS[item.status]}</span>
                                </div>
                                <div className="knowledge-record__meta">
                                    <span>{CATEGORY_LABELS[item.category]}</span>
                                    <span>{SOURCE_LABELS[item.sourceType]}</span>
                                    <span>{SCOPE_LABELS[item.scope?.type || 'user']}{item.scope?.id ? ` · ${item.scope.id}` : ''}</span>
                                    <span>使用 {item.usageCount || 0} 次</span>
                                </div>
                                <p>{item.sourceNote}</p>
                            </div>
                            <div className="knowledge-record__actions">
                                {item.status !== 'archived' && <button type="button" onClick={() => openEdit(item)}>编辑</button>}
                                {item.status !== 'archived' && <button type="button" onClick={() => togglePreference(item)}>{preferenceToggleLabel(item)}</button>}
                                {item.status !== 'archived' && <button type="button" onClick={() => archivePreference(item)}><Archive size={14} aria-hidden="true" />归档</button>}
                                {item.status === 'archived' && <span className="knowledge-record__muted"><RotateCcw size={14} aria-hidden="true" />归档记录保留</span>}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function StatusCard({ label, value, tone }: { label: string; value: number; tone: string }): React.ReactElement {
    return <div className={`knowledge-stat-card knowledge-stat-card--${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function preferenceToggleLabel(item: PreferenceMemoryItem): string {
    if (item.status === 'active') return '禁用';
    if (item.sourceType === 'inferred' || item.status === 'needs_review') return '确认并启用';
    return '启用';
}

function formatError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}
