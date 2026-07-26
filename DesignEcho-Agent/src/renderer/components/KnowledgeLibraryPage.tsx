import React, { useEffect, useMemo, useState } from 'react';
import {
    ArchiveRestore,
    BookOpen,
    BrainCircuit,
    CheckCircle2,
    Clock3,
    Database,
    ExternalLink,
    FileClock,
    Filter,
    History,
    Image as ImageIcon,
    Library,
    PencilLine,
    Plus,
    RefreshCw,
    ScanSearch,
    Search,
    ShieldAlert,
    SlidersHorizontal,
    Trash2,
    X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
    designMemoryItemToKnowledgeResult,
    type DesignLearningInsights,
    type DesignMemoryItem,
    type DesignMemoryStatus
} from '../../shared/design-memory-knowledge';
import {
    assessDesignKnowledgeFreshness,
    type DesignKnowledgeDisposition
} from '../../shared/design-knowledge-governance';
import type { DesignKnowledgeResult } from '../../shared/design-knowledge-search';
import {
    KNOWLEDGE_REFERENCE_USE_ROLES,
    type CreateKnowledgeSelectionOptions,
    type KnowledgeReferenceUseRole,
    type KnowledgeSelectionReference,
    type KnowledgeSelectionResult
} from '../../shared/knowledge-selection-context';
import {
    getKnowledgeLibraryService,
    type EagleKnowledgeAnalysisObservation,
    type KnowledgeLibrarySearchScope
} from '../services/knowledge-library.service';
import { getMemoryService } from '../services/memory.service';
import { useAppStore } from '../stores/app.store';
import { VisualCaseView } from './DesignLearningReviewSettingsPanel';
import { KnowledgeLearningCenter } from './KnowledgeLearningCenter';

import './KnowledgeLibraryPage.css';

type KnowledgeSection = 'assets' | 'review';
type ManagedStatusFilter = 'all' | DesignMemoryStatus;
type EagleAnalysisStatus = 'idle' | 'running' | 'queued' | 'error';
type EaglePreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

interface EagleAnalysisState {
    status: EagleAnalysisStatus;
    summary?: string;
}

interface EaglePreviewState {
    status: EaglePreviewStatus;
    dataUrl?: string;
    width?: number;
    height?: number;
    error?: string;
}

interface KnowledgeLibraryPageProps {
    isActive: boolean;
    selectedReferences: KnowledgeSelectionReference[];
    onAddReference: (result: DesignKnowledgeResult, options?: CreateKnowledgeSelectionOptions) => KnowledgeSelectionResult;
    onRemoveReference: (bindingRef: string) => void;
}

const SECTION_ITEMS: Array<{
    id: KnowledgeSection;
    label: string;
    description: string;
    icon: LucideIcon;
}> = [
    { id: 'assets', label: '知识资产', description: '搜索、修订与治理', icon: Library },
    { id: 'review', label: '复核中心', description: '候选经人工批准', icon: BrainCircuit }
];

const SOURCE_FILTERS: Array<{ id: KnowledgeLibrarySearchScope | 'retired'; label: string }> = [
    { id: 'all', label: '全部来源' },
    { id: 'managed', label: '长期知识' },
    { id: 'built_in', label: '内置方法论' },
    { id: 'eagle', label: 'Eagle 参考' },
    { id: 'web', label: 'Web 来源' },
    { id: 'retired', label: '已剔除' }
];

const STATUS_LABELS: Record<DesignMemoryStatus, string> = {
    active: '当前有效',
    needs_review: '待复核',
    disabled: '已剔除',
    superseded: '旧版本',
    expired: '已过期'
};

export function KnowledgeLibraryPage({
    isActive,
    selectedReferences,
    onAddReference,
    onRemoveReference
}: KnowledgeLibraryPageProps): React.ReactElement {
    const designKnowledgeSettings = useAppStore((state) => state.designKnowledgeSettings);
    const [section, setSection] = useState<KnowledgeSection>('assets');
    const [query, setQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState<KnowledgeLibrarySearchScope | 'retired'>('all');
    const [statusFilter, setStatusFilter] = useState<ManagedStatusFilter>('all');
    const [managedItems, setManagedItems] = useState<DesignMemoryItem[]>(() => loadManagedItems());
    const [dispositions, setDispositions] = useState<DesignKnowledgeDisposition[]>(() => getMemoryService().listDesignKnowledgeDispositions());
    const [searchResults, setSearchResults] = useState<DesignKnowledgeResult[]>([]);
    const [disabledSearchResults, setDisabledSearchResults] = useState<DesignKnowledgeResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
    const [message, setMessage] = useState('');
    const [retireTarget, setRetireTarget] = useState<{ kind: 'managed'; item: DesignMemoryItem } | { kind: 'result'; item: DesignKnowledgeResult } | null>(null);
    const [retireReason, setRetireReason] = useState('');
    const [revisionTarget, setRevisionTarget] = useState<DesignMemoryItem | null>(null);
    const [revisionDraft, setRevisionDraft] = useState({ title: '', summary: '', tags: '', changeNote: '' });
    const [rolePickerTarget, setRolePickerTarget] = useState<{ result: DesignKnowledgeResult; insights?: DesignLearningInsights } | null>(null);
    const [eagleAnalysisByResultId, setEagleAnalysisByResultId] = useState<Record<string, EagleAnalysisState>>({});
    const [eaglePreviewByResultId, setEaglePreviewByResultId] = useState<Record<string, EaglePreviewState>>({});

    useEffect(() => getMemoryService().subscribe(() => {
        setManagedItems(loadManagedItems());
        setDispositions(getMemoryService().listDesignKnowledgeDispositions());
    }), []);

    useEffect(() => {
        if (!isActive) return;
        setManagedItems(loadManagedItems());
        setDispositions(getMemoryService().listDesignKnowledgeDispositions());
    }, [isActive]);

    const counts = useMemo(() => ({
        active: managedItems.filter((item) => item.status === 'active').length,
        review: managedItems.filter((item) => item.status === 'needs_review').length,
        retired: managedItems.filter((item) => item.status === 'disabled').length + dispositions.length,
        versions: managedItems.filter((item) => item.status === 'superseded').length
    }), [dispositions.length, managedItems]);

    const visibleManagedItems = useMemo(() => managedItems.filter((item) => {
        if (sourceFilter !== 'all' && sourceFilter !== 'managed' && sourceFilter !== 'retired') return false;
        if (sourceFilter === 'retired' && item.status !== 'disabled' && item.status !== 'superseded' && item.status !== 'expired') return false;
        if (sourceFilter !== 'retired' && statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (sourceFilter !== 'retired' && sourceFilter !== 'managed' && item.status === 'disabled') return false;
        return matchesManagedQuery(item, query);
    }), [managedItems, query, sourceFilter, statusFilter]);

    const visibleSearchResults = useMemo(() => {
        if (sourceFilter === 'managed' || sourceFilter === 'retired') return [];
        return searchResults.filter((result) => (
            result.sourceType !== 'local_case' && matchesResultSource(result, sourceFilter)
        ));
    }, [searchResults, sourceFilter]);

    async function runSearch(): Promise<void> {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
            setMessage('请输入要查找的设计主题、规则、案例或表现手法。');
            return;
        }
        const searchScope = sourceFilter === 'retired' ? 'all' : sourceFilter;
        setSearching(true);
        setMessage('');
        setEaglePreviewByResultId({});
        try {
            const response = await getKnowledgeLibraryService().search({
                query: normalizedQuery,
                scope: searchScope,
                limit: 40,
                settings: designKnowledgeSettings
            });
            setSearchResults(response.results);
            setDisabledSearchResults(response.disabledResults);
            setSearchWarnings(response.warnings);
            setMessage(`找到 ${response.results.length} 条当前可见知识。`);
        } finally {
            setSearching(false);
        }
    }

    function handleAddReference(result: DesignKnowledgeResult, insights?: DesignLearningInsights): void {
        // 检索卡片路径没带上洞察时，从长期知识里按 id 找回（仅 local_case 长期知识有 insights）。
        const resolvedInsights = insights
            || (result.sourceType === 'local_case' && result.id.startsWith('local-memory:')
                ? managedItems.find((item) => `local-memory:${item.id}` === result.id)?.learnedInsights
                : undefined);
        // 两段式：先声明用途，再真正创建引用，让 Agent 知道这条知识"当什么用"。
        setRolePickerTarget({ result, ...(resolvedInsights ? { insights: resolvedInsights } : {}) });
    }

    function confirmRoleSelection(useRole: KnowledgeReferenceUseRole): void {
        if (!rolePickerTarget) return;
        const { result, insights } = rolePickerTarget;
        const selection = onAddReference(result, { useRole, ...(insights ? { insights } : {}) });
        if (!selection.ok) {
            setMessage(selection.reason || '这条知识当前不能加入任务。');
            setRolePickerTarget(null);
            return;
        }
        if (result.sourceType === 'local_case' && result.id.startsWith('local-memory:')) {
            const itemId = result.id.slice('local-memory:'.length);
            try {
                getMemoryService().recordDesignMemoryUsed(itemId);
            } catch {
                // 引用已通过治理；使用计数失败不应撤销本次请求级引用。
            }
        }
        setMessage(`已作为「${KNOWLEDGE_REFERENCE_USE_ROLES[useRole].label}」加入本次任务：${result.title}`);
        setRolePickerTarget(null);
    }

    function beginRevision(item: DesignMemoryItem): void {
        setRevisionTarget(item);
        setRevisionDraft({
            title: item.title,
            summary: item.summary,
            tags: (item.tags || []).join('，'),
            changeNote: ''
        });
    }

    function publishRevision(): void {
        if (!revisionTarget) return;
        try {
            const revised = getMemoryService().createDesignMemoryRevision({
                itemId: revisionTarget.id,
                title: revisionDraft.title,
                summary: revisionDraft.summary,
                tags: splitTags(revisionDraft.tags),
                changeNote: revisionDraft.changeNote
            });
            setRevisionTarget(null);
            setMessage(`已发布 ${revised.title} 的第 ${revised.revision || 1} 版，旧版本已停止进入 Agent。`);
        } catch (error) {
            setMessage(formatError(error, '发布知识修订失败。'));
        }
    }

    function confirmRetire(): void {
        if (!retireTarget) return;
        try {
            let retiredResultId = '';
            let retiredSourceRevision = '';
            if (retireTarget.kind === 'managed') {
                const projected = designMemoryItemToKnowledgeResult(retireTarget.item);
                retiredResultId = projected?.id || '';
                retiredSourceRevision = projected?.governance?.sourceRevision || '';
                getMemoryService().setDesignMemoryLifecycle({
                    itemId: retireTarget.item.id,
                    status: 'disabled',
                    reason: retireReason
                });
            } else {
                retiredResultId = retireTarget.item.id;
                retiredSourceRevision = retireTarget.item.governance?.sourceRevision || '';
                getMemoryService().disableDesignKnowledgeResult(retireTarget.item, retireReason);
                setSearchResults((results) => results.filter((item) => item !== retireTarget.item));
            }
            for (const reference of selectedReferences) {
                if (reference.resultId !== retiredResultId) continue;
                if (retiredSourceRevision && reference.sourceRevision !== retiredSourceRevision) continue;
                onRemoveReference(reference.bindingRef);
            }
            setMessage('已剔除该知识版本。记录仍可恢复，也不会再进入默认检索和 Agent 上下文。');
            setRetireTarget(null);
            setRetireReason('');
        } catch (error) {
            setMessage(formatError(error, '剔除知识失败。'));
        }
    }

    function restoreManaged(item: DesignMemoryItem): void {
        try {
            getMemoryService().setDesignMemoryLifecycle({
                itemId: item.id,
                status: 'active',
                reason: '用户在知识库中恢复该版本。'
            });
            setMessage(`已恢复知识：${item.title}`);
        } catch (error) {
            setMessage(formatError(error, '恢复知识失败。'));
        }
    }

    function restoreDisposition(item: DesignKnowledgeDisposition): void {
        try {
            getMemoryService().restoreDesignKnowledgeDisposition(item.dispositionId);
            setMessage(`已恢复来源知识：${item.title}。下次检索会重新显示。`);
        } catch (error) {
            setMessage(formatError(error, '恢复来源知识失败。'));
        }
    }

    async function analyzeEagleReference(result: DesignKnowledgeResult): Promise<void> {
        setEagleAnalysisByResultId((current) => ({
            ...current,
            [result.id]: { status: 'running' }
        }));
        setMessage(`正在理解 Eagle 参考“${result.title}”…`);
        const response = await getKnowledgeLibraryService().analyzeEagleReference(result);
        if (!response.success || !response.observation) {
            const error = response.error || '视觉模型没有形成可复核洞察。';
            setEagleAnalysisByResultId((current) => ({
                ...current,
                [result.id]: { status: 'error', summary: error }
            }));
            setMessage(error);
            return;
        }
        try {
            const candidate = createEagleLearningCandidate(result, response.observation);
            getMemoryService().recordDesignLearningMemoryReview({
                candidate,
                decision: 'needs_review',
                reviewer: 'knowledge-library-eagle-analysis',
                notes: ['用户在知识库中明确发起视觉理解；结果须人工复核后才能进入长期知识。']
            });
            setEagleAnalysisByResultId((current) => ({
                ...current,
                [result.id]: { status: 'queued', summary: response.observation!.summary }
            }));
            setMessage(`已看过“${result.title}”并形成多模态候选，正在等待人工复核。`);
        } catch (error) {
            const message = formatError(error, '视觉洞察进入复核队列失败。');
            setEagleAnalysisByResultId((current) => ({
                ...current,
                [result.id]: { status: 'error', summary: message }
            }));
            setMessage(message);
        }
    }

    async function loadEaglePreview(result: DesignKnowledgeResult): Promise<void> {
        setEaglePreviewByResultId((current) => ({
            ...current,
            [result.id]: { status: 'loading' }
        }));
        const response = await getKnowledgeLibraryService().getEagleReferencePreview(result);
        if (!response.success || !response.preview) {
            const error = response.error || '没有可安全展示的 Eagle 缩略图。';
            setEaglePreviewByResultId((current) => ({
                ...current,
                [result.id]: { status: 'error', error }
            }));
            setMessage(error);
            return;
        }
        setEaglePreviewByResultId((current) => ({
            ...current,
            [result.id]: {
                status: 'ready',
                dataUrl: response.preview!.dataUrl,
                width: response.preview!.width,
                height: response.preview!.height
            }
        }));
        setMessage(`已临时加载“${result.title}”的缩略图；关闭页面或重新检索后即释放。`);
    }

    function clearEaglePreview(resultId: string): void {
        setEaglePreviewByResultId((current) => {
            const next = { ...current };
            delete next[resultId];
            return next;
        });
    }

    return (
        <div className="knowledge-library-page" data-testid="knowledge-library-page">
            <aside className="knowledge-library-nav" aria-label="知识库栏目">
                <div className="knowledge-library-brand">
                    <div className="knowledge-library-brand__icon"><BookOpen size={18} aria-hidden="true" /></div>
                    <div><strong>知识库</strong><span>Design intelligence</span></div>
                </div>
                <nav>
                    {SECTION_ITEMS.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button key={item.id} type="button" className={section === item.id ? 'is-active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>
                                <Icon size={17} aria-hidden="true" />
                                <span><strong>{item.label}</strong><small>{item.description}</small></span>
                                {item.id === 'review' && counts.review > 0 && <em>{counts.review}</em>}
                            </button>
                        );
                    })}
                </nav>
                <div className="knowledge-library-nav__status">
                    <span><CheckCircle2 size={14} aria-hidden="true" />{counts.active} 条当前有效</span>
                    <span><Clock3 size={14} aria-hidden="true" />{counts.review} 条待复核</span>
                    <span><ShieldAlert size={14} aria-hidden="true" />{counts.retired} 条已剔除</span>
                </div>
            </aside>

            <div className="knowledge-library-main">
                {section === 'assets' && (
                    <section className="knowledge-assets" aria-labelledby="knowledge-assets-title">
                        <header className="knowledge-assets__header">
                            <div><span className="knowledge-eyebrow">Knowledge lifecycle</span><h1 id="knowledge-assets-title">知识资产</h1><p>查找设计方法与参考，管理每条知识的来源、版本、状态和本次任务引用。</p></div>
                            <div className="knowledge-header-stats" aria-label="知识资产统计">
                                <span><strong>{counts.active}</strong>有效</span><span><strong>{counts.review}</strong>待复核</span><span><strong>{counts.retired}</strong>已剔除</span><span><strong>{counts.versions}</strong>旧版本</span>
                            </div>
                        </header>

                        {selectedReferences.length > 0 && (
                            <div className="knowledge-reference-tray" aria-label="本次任务知识引用">
                                <div><strong>本次任务</strong><span>{selectedReferences.length} / 5 条知识已关联，可与项目素材同时使用。</span></div>
                                <div className="knowledge-reference-tray__items">
                                    {selectedReferences.map((reference) => (
                                        <span key={reference.bindingRef} title={`${reference.title} · ${reference.sourceRevision} · 用途：${KNOWLEDGE_REFERENCE_USE_ROLES[reference.useRole || 'general'].label}`}>
                                            <em className="knowledge-reference-role">{KNOWLEDGE_REFERENCE_USE_ROLES[reference.useRole || 'general'].label}</em>
                                            {reference.title}
                                            <button type="button" aria-label={`移除知识引用：${reference.title}`} onClick={() => onRemoveReference(reference.bindingRef)}><X size={13} aria-hidden="true" /></button>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="knowledge-search-shell">
                            <label className="knowledge-search-input">
                                <Search size={17} aria-hidden="true" />
                                <span className="sr-only">搜索知识</span>
                                <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }} placeholder="搜索设计知识、方法、案例或表现手法…" />
                                {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} aria-hidden="true" /></button>}
                            </label>
                            <button className="knowledge-button knowledge-button--primary" type="button" onClick={() => void runSearch()} disabled={searching}>
                                {searching ? <RefreshCw className="is-spinning" size={15} aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
                                {searching ? '检索中' : '检索'}
                            </button>
                        </div>

                        <div className="knowledge-assets__body">
                            <aside className="knowledge-source-rail" aria-label="知识来源筛选">
                                <div className="knowledge-source-rail__heading"><Filter size={14} aria-hidden="true" />来源</div>
                                {SOURCE_FILTERS.map((filter) => (
                                    <button key={filter.id} type="button" className={sourceFilter === filter.id ? 'is-active' : ''} aria-pressed={sourceFilter === filter.id} onClick={() => setSourceFilter(filter.id)}>
                                        <span>{filter.label}</span>
                                        {filter.id === 'retired' && <em>{counts.retired}</em>}
                                    </button>
                                ))}
                                <div className="knowledge-source-rail__note"><SlidersHorizontal size={14} aria-hidden="true" /><span>外部和 Eagle 检索只在你点击“检索”后运行。</span></div>
                            </aside>

                            <div className="knowledge-result-area" aria-busy={searching}>
                                <div className="knowledge-result-toolbar">
                                    <div role="group" aria-label="长期知识状态筛选">
                                        {(['all', 'active', 'needs_review', 'disabled', 'superseded', 'expired'] as ManagedStatusFilter[]).map((status) => (
                                            <button key={status} type="button" className={statusFilter === status ? 'is-active' : ''} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>{status === 'all' ? '全部状态' : STATUS_LABELS[status]}</button>
                                        ))}
                                    </div>
                                    <span role="status" aria-live="polite">{message || `${visibleManagedItems.length + visibleSearchResults.length} 条可见结果`}</span>
                                </div>

                                {retireTarget && (
                                    <div className="knowledge-confirm-strip" role="alert">
                                        <Trash2 size={17} aria-hidden="true" />
                                        <div><strong>剔除“{retireTarget.item.title}”？</strong><span>此操作可恢复；该版本将立即停止进入 Agent。</span></div>
                                        <input value={retireReason} onChange={(event) => setRetireReason(event.target.value)} placeholder="原因（可选）" aria-label="剔除原因" />
                                        <button type="button" className="knowledge-button knowledge-button--danger" onClick={confirmRetire}>确认剔除</button>
                                        <button type="button" className="knowledge-button knowledge-button--secondary" onClick={() => setRetireTarget(null)}>取消</button>
                                    </div>
                                )}

                                {rolePickerTarget && (
                                    <div className="knowledge-role-picker" data-testid="knowledge-role-picker" role="dialog" aria-label={`声明引用用途：${rolePickerTarget.result.title}`}>
                                        <div className="knowledge-role-picker__heading">
                                            <div><strong>「{rolePickerTarget.result.title}」当什么用？</strong><span>用途会随引用一起告诉 Agent，避免误用——例如只想参考构图，却被连配色、文案一起抄走。</span></div>
                                            <button type="button" aria-label="取消加入" onClick={() => setRolePickerTarget(null)}><X size={16} /></button>
                                        </div>
                                        <div className="knowledge-role-picker__grid" role="group" aria-label="引用用途">
                                            {(Object.keys(KNOWLEDGE_REFERENCE_USE_ROLES) as KnowledgeReferenceUseRole[]).map((role) => {
                                                const meta = KNOWLEDGE_REFERENCE_USE_ROLES[role];
                                                return (
                                                    <button key={role} type="button" className="knowledge-role-option" data-role={role} onClick={() => confirmRoleSelection(role)}>
                                                        <strong>{meta.label}</strong>
                                                        <span>{meta.hint}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {revisionTarget && (
                                    <div className="knowledge-revision-editor" data-testid="knowledge-revision-editor">
                                        <div className="knowledge-revision-editor__heading"><div><strong>发布新版本</strong><span>旧版会保留为审计记录，并停止进入 Agent。</span></div><button type="button" aria-label="关闭修订编辑器" onClick={() => setRevisionTarget(null)}><X size={16} /></button></div>
                                        <div className="knowledge-form-grid">
                                            <label>标题<input value={revisionDraft.title} onChange={(event) => setRevisionDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                                            <label>标签<input value={revisionDraft.tags} onChange={(event) => setRevisionDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="使用逗号分隔" /></label>
                                            <label className="knowledge-form-grid__wide">知识内容<textarea rows={5} value={revisionDraft.summary} onChange={(event) => setRevisionDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
                                            <label className="knowledge-form-grid__wide">变更说明<input value={revisionDraft.changeNote} onChange={(event) => setRevisionDraft((current) => ({ ...current, changeNote: event.target.value }))} placeholder="说明为什么更新这条知识" /></label>
                                        </div>
                                        <div className="knowledge-editor-card__actions"><button type="button" className="knowledge-button knowledge-button--primary" onClick={publishRevision}>发布新版本</button><button type="button" className="knowledge-button knowledge-button--secondary" onClick={() => setRevisionTarget(null)}>取消</button></div>
                                    </div>
                                )}

                                {sourceFilter === 'retired' && dispositions.length > 0 && (
                                    <div className="knowledge-card-grid">
                                        {dispositions.map((item) => <DispositionCard key={item.dispositionId} item={item} onRestore={() => restoreDisposition(item)} />)}
                                    </div>
                                )}

                                {(visibleManagedItems.length > 0 || visibleSearchResults.length > 0) ? (
                                    <div className="knowledge-card-grid">
                                        {visibleManagedItems.map((item) => (
                                            <ManagedKnowledgeCard key={item.id} item={item} selectedReferences={selectedReferences} onAddReference={handleAddReference} onOpenLearning={() => setSection('review')} onRevise={() => beginRevision(item)} onRetire={() => setRetireTarget({ kind: 'managed', item })} onRestore={() => restoreManaged(item)} />
                                        ))}
                                        {visibleSearchResults.map((result) => (
                                            <SearchKnowledgeCard
                                                key={`${result.sourceType}:${result.id}:${result.governance?.sourceRevision || 'legacy'}`}
                                                result={result}
                                                selectedReferences={selectedReferences}
                                                analysisState={eagleAnalysisByResultId[result.id] || { status: 'idle' }}
                                                previewState={eaglePreviewByResultId[result.id] || { status: 'idle' }}
                                                onAddReference={handleAddReference}
                                                onAnalyze={() => void analyzeEagleReference(result)}
                                                onPreview={() => void loadEaglePreview(result)}
                                                onClearPreview={() => clearEaglePreview(result.id)}
                                                onOpenLearning={() => setSection('review')}
                                                onRetire={() => setRetireTarget({ kind: 'result', item: result })}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="knowledge-empty-state knowledge-empty-state--large"><BookOpen size={24} aria-hidden="true" /><strong>{query ? '没有符合条件的知识' : '从长期知识开始管理'}</strong><span>{query ? '调整关键词、来源或状态筛选后再试。' : '输入主题可同时检索内置方法、Eagle 参考和已配置的 Web 来源。'}</span></div>
                                )}

                                {sourceFilter === 'retired' && disabledSearchResults.length > 0 && (
                                    <p className="knowledge-boundary-note">本轮搜索另有 {disabledSearchResults.length} 条具体来源版本已被治理过滤。</p>
                                )}
                                {searchWarnings.length > 0 && <ul className="knowledge-warning-list">{searchWarnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                            </div>
                        </div>
                    </section>
                )}
                {section === 'review' && <KnowledgeLearningCenter />}
            </div>
        </div>
    );
}

function ManagedKnowledgeCard({ item, selectedReferences, onAddReference, onOpenLearning, onRevise, onRetire, onRestore }: {
    item: DesignMemoryItem;
    selectedReferences: KnowledgeSelectionReference[];
    onAddReference: (result: DesignKnowledgeResult, insights?: DesignLearningInsights) => void;
    onOpenLearning: () => void;
    onRevise: () => void;
    onRetire: () => void;
    onRestore: () => void;
}): React.ReactElement {
    const result = designMemoryItemToKnowledgeResult(item);
    const selected = result ? selectedReferences.some((reference) => reference.resultId === result.id) : false;
    return (
        <article className={`knowledge-card knowledge-card--${item.status}`}>
            <div className="knowledge-card__heading"><div className="knowledge-card__icon"><BrainCircuit size={17} aria-hidden="true" /></div><div><h3>{item.title}</h3><span>{formatMemoryKind(item.kind)}</span></div><span className={`knowledge-status knowledge-status--${item.status}`}>{STATUS_LABELS[item.status || 'needs_review']}</span></div>
            {item.visualCase && <VisualCaseView visualCase={item.visualCase} />}
            <p className="knowledge-card__summary">{item.summary}</p>
            <div className="knowledge-card__tags">{(item.tags || []).slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
            <dl className="knowledge-card__meta"><div><dt>版本</dt><dd>v{item.revision || 1}</dd></div><div><dt>作用域</dt><dd>{formatScope(item.scope)}</dd></div><div><dt>更新</dt><dd>{formatDate(item.updatedAt)}</dd></div><div><dt>使用</dt><dd>{item.usageCount || 0} 次</dd></div></dl>
            {item.retirementReason && <div className="knowledge-card__reason"><ShieldAlert size={14} aria-hidden="true" />{item.retirementReason}</div>}
            <div className="knowledge-card__actions">
                {item.status === 'active' && result && <button type="button" className="is-primary" disabled={selected} onClick={() => onAddReference(result, item.learnedInsights)}><Plus size={14} aria-hidden="true" />{selected ? '已加入任务' : '加入本次任务'}</button>}
                {item.status === 'active' && <button type="button" onClick={onRevise}><PencilLine size={14} aria-hidden="true" />修订</button>}
                {item.status === 'active' && <button type="button" className="is-danger" onClick={onRetire}><Trash2 size={14} aria-hidden="true" />剔除</button>}
                {item.status === 'needs_review' && <button type="button" className="is-primary" onClick={onOpenLearning}><Clock3 size={14} aria-hidden="true" />去复核</button>}
                {item.status === 'disabled' && <button type="button" onClick={onRestore}><ArchiveRestore size={14} aria-hidden="true" />恢复</button>}
                {item.status === 'superseded' && <span className="knowledge-card__muted"><History size={14} aria-hidden="true" />由 {shortId(item.supersededById)} 替代</span>}
                {item.status === 'expired' && <span className="knowledge-card__muted"><FileClock size={14} aria-hidden="true" />重新修订后才能使用</span>}
            </div>
        </article>
    );
}

function SearchKnowledgeCard({ result, selectedReferences, analysisState, previewState, onAddReference, onAnalyze, onPreview, onClearPreview, onOpenLearning, onRetire }: {
    result: DesignKnowledgeResult;
    selectedReferences: KnowledgeSelectionReference[];
    analysisState: EagleAnalysisState;
    previewState: EaglePreviewState;
    onAddReference: (result: DesignKnowledgeResult) => void;
    onAnalyze: () => void;
    onPreview: () => void;
    onClearPreview: () => void;
    onOpenLearning: () => void;
    onRetire: () => void;
}): React.ReactElement {
    const freshness = assessDesignKnowledgeFreshness(result);
    const selected = selectedReferences.some((reference) => reference.resultId === result.id && reference.sourceRevision === result.governance?.sourceRevision);
    const isEagle = result.sourceType === 'eagle_library';
    return (
        <article className={`knowledge-card knowledge-card--search knowledge-card--${freshness}`}>
            <div className="knowledge-card__heading"><div className="knowledge-card__icon">{isEagle ? <Database size={17} aria-hidden="true" /> : <BookOpen size={17} aria-hidden="true" />}</div><div><h3>{result.title}</h3><span>{sourceTypeLabel(result.sourceType)}</span></div><span className={`knowledge-status knowledge-status--${freshness}`}>{freshnessLabel(freshness)}</span></div>
            {isEagle && previewState.status === 'ready' && previewState.dataUrl && (
                <figure className="knowledge-card__preview">
                    <img src={previewState.dataUrl} alt={`Eagle 参考缩略图：${result.title}`} />
                    <figcaption><span>{previewState.width && previewState.height ? `${previewState.width} × ${previewState.height}` : '临时缩略图'}</span><button type="button" onClick={onClearPreview}>关闭预览</button></figcaption>
                </figure>
            )}
            <p className="knowledge-card__summary">{result.summary}</p>
            <div className="knowledge-card__tags">{result.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
            <dl className="knowledge-card__meta"><div><dt>用途</dt><dd>{result.allowedUses.includes('user_reference') ? '可引用' : '受限'}</dd></div><div><dt>来源</dt><dd>{sourceLevelLabel(result.sourceLevel)}</dd></div><div><dt>版本</dt><dd>{shortId(result.governance?.sourceRevision)}</dd></div><div><dt>更新</dt><dd>{formatDate(result.updatedAt)}</dd></div></dl>
            {isEagle && <div className="knowledge-card__reason"><ShieldAlert size={14} aria-hidden="true" />当前是元数据候选，不代表 Agent 已看过原图。</div>}
            {isEagle && analysisState.summary && <div className={`knowledge-card__analysis knowledge-card__analysis--${analysisState.status}`}><ScanSearch size={14} aria-hidden="true" /><span>{analysisState.summary}</span></div>}
            <div className="knowledge-card__actions">
                <button type="button" className="is-primary" disabled={selected || freshness !== 'current'} onClick={() => onAddReference(result)}><Plus size={14} aria-hidden="true" />{selected ? '已加入任务' : '加入本次任务'}</button>
                {isEagle && previewState.status !== 'ready' && <button type="button" disabled={previewState.status === 'loading'} onClick={onPreview}><ImageIcon size={14} aria-hidden="true" />{previewState.status === 'loading' ? '加载预览' : '预览图片'}</button>}
                {isEagle && analysisState.status !== 'queued' && <button type="button" disabled={analysisState.status === 'running'} onClick={onAnalyze}><ScanSearch className={analysisState.status === 'running' ? 'is-spinning' : ''} size={14} aria-hidden="true" />{analysisState.status === 'running' ? '正在看图' : '视觉理解'}</button>}
                {isEagle && analysisState.status === 'queued' && <button type="button" onClick={onOpenLearning}><Clock3 size={14} aria-hidden="true" />去复核</button>}
                {result.sourceUrl && <button type="button" onClick={() => window.designEcho?.openExternal?.(result.sourceUrl!)}><ExternalLink size={14} aria-hidden="true" />查看来源</button>}
                <button type="button" className="is-danger" onClick={onRetire}><Trash2 size={14} aria-hidden="true" />剔除此版本</button>
            </div>
        </article>
    );
}

function DispositionCard({ item, onRestore }: { item: DesignKnowledgeDisposition; onRestore: () => void }): React.ReactElement {
    return (
        <article className="knowledge-card knowledge-card--disabled">
            <div className="knowledge-card__heading"><div className="knowledge-card__icon"><ShieldAlert size={17} aria-hidden="true" /></div><div><h3>{item.title}</h3><span>{sourceTypeLabel(item.sourceType)}</span></div><span className="knowledge-status knowledge-status--disabled">已剔除</span></div>
            <p className="knowledge-card__summary">{item.reason}</p>
            <dl className="knowledge-card__meta"><div><dt>来源版本</dt><dd>{shortId(item.sourceRevision)}</dd></div><div><dt>剔除时间</dt><dd>{formatDate(item.updatedAt)}</dd></div></dl>
            <div className="knowledge-card__actions"><button type="button" onClick={onRestore}><ArchiveRestore size={14} aria-hidden="true" />恢复显示</button></div>
        </article>
    );
}

function createEagleLearningCandidate(
    result: DesignKnowledgeResult,
    observation: EagleKnowledgeAnalysisObservation
): DesignMemoryItem {
    const now = new Date().toISOString();
    const eagleItemId = result.id.replace(/^eagle:/i, '');
    const sourceRevision = result.governance?.sourceRevision || 'unversioned';
    const candidateId = `design-learning:eagle:${safeIdentity(eagleItemId)}:${safeIdentity(sourceRevision)}`;
    const strengths = observation.strengths.map((item) => `${item.aspect}：${item.observation}`);
    const reasons = observation.strengths.map((item) => `${item.aspect}：${item.reason}`);
    return {
        id: candidateId,
        lineageId: candidateId,
        revision: 1,
        kind: 'visual_case',
        scope: { type: 'user' },
        status: 'needs_review',
        source: 'imported_case',
        title: `Eagle 视觉经验 · ${result.title}`,
        summary: observation.summary,
        learnedInsights: {
            whatLooksGood: strengths,
            whyItWorks: reasons,
            reusableHeuristics: observation.reusableHeuristics,
            suitableScenarios: observation.suitableScenarios,
            avoidWhen: observation.avoidWhen,
            limitations: observation.limitations
        },
        sourceNotes: [
            {
                source: 'design-learning-experience',
                summary: `source=eagle:${safeIdentity(eagleItemId)}; source_revision=${safeIdentity(sourceRevision)}; analysis_source=${observation.analysisSource}`,
                status: 'needs_review'
            },
            ...observation.sourceNotes.map((summary) => ({
                source: 'eagle-visual-analysis',
                summary,
                status: 'needs_review' as const
            }))
        ],
        tags: Array.from(new Set([
            'design-learning',
            'eagle',
            'multimodal-review',
            ...(result.tags || []),
            observation.productCategory || '',
            observation.designType || ''
        ].filter(Boolean))).slice(0, 24),
        appliesTo: ['reference'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceRank: 0,
        usageCount: 0,
        createdAt: now,
        updatedAt: now
    };
}

function safeIdentity(value: unknown): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'unknown';
}

function loadManagedItems(): DesignMemoryItem[] {
    return getMemoryService().listPersistedDesignMemoryItems({ limit: 2000 });
}

function matchesManagedQuery(item: DesignMemoryItem, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return [item.title, item.summary, item.kind, item.source, ...(item.tags || [])].join(' ').toLowerCase().includes(normalized);
}

function matchesResultSource(result: DesignKnowledgeResult, filter: KnowledgeLibrarySearchScope | 'retired'): boolean {
    if (filter === 'all') return true;
    if (filter === 'managed') return result.sourceType === 'local_case';
    if (filter === 'built_in') return result.sourceType === 'local_recipe' || result.sourceType === 'manual_rule';
    if (filter === 'eagle') return result.sourceType === 'eagle_library';
    if (filter === 'web') return result.sourceType === 'design_crawler' || result.sourceType === 'web_page' || result.sourceType === 'mimo_web_search';
    return false;
}

function formatMemoryKind(kind: DesignMemoryItem['kind']): string {
    const labels: Record<DesignMemoryItem['kind'], string> = { user_preference: '用户偏好', brand_preference: '品牌偏好', project_rule: '项目规则', approved_recipe: '已批准方法', rejected_pattern: '反例模式', visual_case: '视觉案例', benchmark_case: '基准案例', failure_pattern: '失败经验' };
    return labels[kind];
}

function formatScope(scope: DesignMemoryItem['scope']): string {
    let label = '用户';
    if (scope.type === 'project') label = '项目';
    else if (scope.type === 'brand') label = '品牌';
    else if (scope.type === 'session') label = '会话';
    return scope.id ? `${label} · ${scope.id}` : label;
}

function sourceTypeLabel(sourceType: DesignKnowledgeResult['sourceType']): string {
    const labels: Record<DesignKnowledgeResult['sourceType'], string> = { local_recipe: '内置配方', manual_rule: '内置规则', design_crawler: '设计站点', web_page: '网页来源', mimo_web_search: '小米 Web Search', local_case: '长期知识', eagle_library: 'Eagle 素材库' };
    return labels[sourceType];
}

function freshnessLabel(value: ReturnType<typeof assessDesignKnowledgeFreshness>): string {
    if (value === 'current') return '当前有效';
    if (value === 'stale') return '需更新';
    if (value === 'withdrawn') return '已撤回';
    if (value === 'superseded') return '已替代';
    if (value === 'invalid') return '治理异常';
    return '旧版未验证';
}

function sourceLevelLabel(value: DesignKnowledgeResult['sourceLevel']): string {
    if (value === 'curated_rule') return '审核规则';
    if (value === 'curated_recipe') return '审核方法';
    if (value === 'external_snippet') return '外部摘要';
    if (value === 'local_case') return '本地案例';
    if (value === 'benchmark_case') return '基准案例';
    return '待确认';
}

function formatDate(value: unknown): string {
    const timestamp = Date.parse(String(value || ''));
    if (!Number.isFinite(timestamp)) return '未记录';
    return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function shortId(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '未记录';
    return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

function splitTags(value: string): string[] {
    return Array.from(new Set(value.split(/[，,]/).map((item) => item.trim()).filter(Boolean))).slice(0, 20);
}

function formatError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}
