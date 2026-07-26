import React, { useEffect, useMemo, useState } from 'react';
import { Database, Globe2, Save, SearchCheck, ShieldCheck } from 'lucide-react';

import { getModelById } from '../../shared/config/models.config';
import { buildDesignKnowledgeRuntimeCapabilitySummary } from '../../shared/design-knowledge-runtime-capability';
import {
    buildDesignKnowledgeSettingsSummary,
    normalizeDesignKnowledgeSettings
} from '../../shared/design-knowledge-settings';
import { useAppStore } from '../stores/app.store';

type ProbeStatus = 'idle' | 'testing' | 'success' | 'error';

export function KnowledgeSourceManagementPanel(): React.ReactElement {
    const designKnowledgeSettings = useAppStore((state) => state.designKnowledgeSettings);
    const setDesignKnowledgeSettings = useAppStore((state) => state.setDesignKnowledgeSettings);
    const modelPreferences = useAppStore((state) => state.modelPreferences);
    const [draft, setDraft] = useState(() => normalizeDesignKnowledgeSettings(designKnowledgeSettings));
    const [saveMessage, setSaveMessage] = useState('');
    const [searxngStatus, setSearxngStatus] = useState<ProbeStatus>('idle');
    const [searxngMessage, setSearxngMessage] = useState('');
    const [eagleStatus, setEagleStatus] = useState<ProbeStatus>('idle');
    const [eagleMessage, setEagleMessage] = useState('');

    useEffect(() => {
        setDraft(normalizeDesignKnowledgeSettings(designKnowledgeSettings));
    }, [designKnowledgeSettings]);

    const settingsSummary = useMemo(() => buildDesignKnowledgeSettingsSummary(draft), [draft]);
    const selectedModel = getModelById(
        modelPreferences.orchestrator?.primaryModel || modelPreferences.preferredCloudModels.layoutAnalysis
    );
    const runtimeCapability = useMemo(() => buildDesignKnowledgeRuntimeCapabilitySummary({
        settings: draft,
        model: selectedModel
    }), [draft, selectedModel]);

    function updateSearxng(patch: Partial<typeof draft.searxng>): void {
        setDraft((current) => normalizeDesignKnowledgeSettings({
            ...current,
            searxng: { ...current.searxng, ...patch }
        }));
        setSaveMessage('有未保存的来源配置。');
    }

    function updateXiaomi(patch: Partial<typeof draft.xiaomiWebSearch>): void {
        setDraft((current) => normalizeDesignKnowledgeSettings({
            ...current,
            xiaomiWebSearch: { ...current.xiaomiWebSearch, ...patch }
        }));
        setSaveMessage('有未保存的来源配置。');
    }

    function saveSources(): void {
        setDesignKnowledgeSettings(draft);
        setSaveMessage('来源配置已保存。后续知识检索会使用这份设置。');
    }

    async function probeEagle(): Promise<void> {
        setEagleStatus('testing');
        setEagleMessage('正在检查 Eagle 只读连接…');
        const probe = window.designEcho?.probeDesignKnowledgeEagleReadonly;
        if (!probe) {
            setEagleStatus('error');
            setEagleMessage('当前桌面运行时未提供 Eagle 只读检查。');
            return;
        }
        try {
            const result = await probe({ enabled: true });
            if (result.success && result.status === 'ok') {
                setEagleStatus('success');
                setEagleMessage('Eagle 已连接；只读取索引，不会修改素材。');
                return;
            }
            setEagleStatus('error');
            setEagleMessage(result.error || result.warnings.join('；') || 'Eagle 只读连接不可用。');
        } catch (error) {
            setEagleStatus('error');
            setEagleMessage(formatError(error, 'Eagle 只读检查失败。'));
        }
    }

    async function probeSearxng(): Promise<void> {
        const settings = normalizeDesignKnowledgeSettings(draft);
        if (!settings.searxng.enabled || !settings.searxng.endpoint) {
            setSearxngStatus('error');
            setSearxngMessage('请先启用 SearXNG 并填写 endpoint。');
            return;
        }
        const probe = window.designEcho?.probeDesignKnowledgeSearxng;
        if (!probe) {
            setSearxngStatus('error');
            setSearxngMessage('当前桌面运行时未提供 SearXNG 健康检查。');
            return;
        }
        setSearxngStatus('testing');
        setSearxngMessage('正在检查 SearXNG endpoint…');
        try {
            const result = await probe(settings);
            if (result.success && result.status === 'ok') {
                setSearxngStatus('success');
                setSearxngMessage(`SearXNG 已响应。HTTP ${result.httpStatus || 200}`);
                return;
            }
            setSearxngStatus('error');
            setSearxngMessage(result.error || result.warnings?.join('；') || `SearXNG 状态：${result.status}`);
        } catch (error) {
            setSearxngStatus('error');
            setSearxngMessage(formatError(error, 'SearXNG 健康检查失败。'));
        }
    }

    return (
        <section className="knowledge-panel" data-testid="knowledge-source-management-panel">
            <div className="knowledge-panel__heading">
                <div>
                    <span className="knowledge-eyebrow">Source governance</span>
                    <h2>来源管理</h2>
                    <p>连接、健康检查和检索参数都在这里管理；页面不会自动搜索，也不会启动或停止外部服务。</p>
                </div>
                <button className="knowledge-button knowledge-button--primary" type="button" onClick={saveSources}>
                    <Save size={15} aria-hidden="true" />保存来源配置
                </button>
            </div>

            <div className="knowledge-source-overview">
                <SourceSummaryCard icon={<ShieldCheck size={18} />} label="内置方法论" value="始终可用" description="随应用版本发布，保留内容指纹和来源版本。" tone="active" />
                <SourceSummaryCard icon={<Database size={18} />} label="Eagle 设计参考" value={probeStatusLabel(eagleStatus)} description="只读候选；视觉结论仍需单独分析。" tone={eagleStatus} />
                <SourceSummaryCard icon={<Globe2 size={18} />} label="Web 来源" value={settingsSummary.status === 'ready' || draft.xiaomiWebSearch.enabled ? '已配置' : '未启用'} description="外部内容经过来源与新鲜度治理后才可用。" tone={settingsSummary.status === 'ready' ? 'success' : 'idle'} />
                <SourceSummaryCard icon={<SearchCheck size={18} />} label="当前规划模型" value={runtimeCapability.selectedModel?.name || '未识别'} description={`工具流：${formatCapability(runtimeCapability.providerObservation.toolStream.mode)}`} tone={runtimeCapability.status === 'ready' ? 'success' : 'idle'} />
            </div>

            {saveMessage && <div className="knowledge-inline-message" role="status" aria-live="polite">{saveMessage}</div>}

            <article className="knowledge-source-card">
                <div className="knowledge-source-card__heading">
                    <div className="knowledge-source-card__icon"><Database size={18} aria-hidden="true" /></div>
                    <div><h3>Eagle 素材库</h3><p>把设计收藏作为多模态参考候选；DesignEcho 不写标签、不移动文件，也不删除 Eagle 条目。</p></div>
                    <span className={`knowledge-status knowledge-status--${eagleStatus}`}>{probeStatusLabel(eagleStatus)}</span>
                </div>
                <div className="knowledge-source-card__actions">
                    <button className="knowledge-button knowledge-button--secondary" type="button" onClick={probeEagle} disabled={eagleStatus === 'testing'}>
                        {eagleStatus === 'testing' ? '检查中…' : '检查连接'}
                    </button>
                    {eagleMessage && <span className={`knowledge-probe-message knowledge-probe-message--${eagleStatus}`} role="status" aria-live="polite">{eagleMessage}</span>}
                </div>
                <div className="knowledge-boundary-note">当前稳定入口：已启用 MCP Server 的 Eagle 只读服务。后续仍在同一 Adapter 下扩展搜索能力，不复制 Eagle 资产库。</div>
            </article>

            <article className="knowledge-source-card">
                <div className="knowledge-source-card__heading">
                    <div className="knowledge-source-card__icon"><Globe2 size={18} aria-hidden="true" /></div>
                    <div><h3>小米官方 Web Search</h3><p>模型原生联网搜索，只在支持的模型与提供方上进入请求计划。</p></div>
                    <label className="knowledge-toggle"><input type="checkbox" checked={draft.xiaomiWebSearch.enabled} onChange={(event) => updateXiaomi({ enabled: event.target.checked })} /><span>启用</span></label>
                </div>
                <div className="knowledge-form-grid knowledge-form-grid--compact">
                    <label>关键词数量<input type="number" min={1} max={5} value={draft.xiaomiWebSearch.maxKeyword} onChange={(event) => updateXiaomi({ maxKeyword: Number(event.target.value) })} /></label>
                    <label>结果数量<input type="number" min={1} max={10} value={draft.xiaomiWebSearch.limit} onChange={(event) => updateXiaomi({ limit: Number(event.target.value) })} /></label>
                    <label>用户位置<input value={draft.xiaomiWebSearch.userLocation} onChange={(event) => updateXiaomi({ userLocation: event.target.value })} placeholder="例如 China" /></label>
                    <label className="knowledge-toggle knowledge-toggle--field"><input type="checkbox" checked={draft.xiaomiWebSearch.forceSearch} onChange={(event) => updateXiaomi({ forceSearch: event.target.checked })} /><span>每次强制搜索</span></label>
                </div>
            </article>

            <article className="knowledge-source-card">
                <div className="knowledge-source-card__heading">
                    <div className="knowledge-source-card__icon"><SearchCheck size={18} aria-hidden="true" /></div>
                    <div><h3>SearXNG 本地 Web 搜索</h3><p>可选的本地聚合搜索 endpoint；DesignEcho 不负责启动 Docker、Harbor 或 SearXNG。</p></div>
                    <label className="knowledge-toggle"><input type="checkbox" checked={draft.searxng.enabled} onChange={(event) => updateSearxng({ enabled: event.target.checked })} /><span>启用</span></label>
                </div>
                <div className="knowledge-form-grid knowledge-form-grid--compact">
                    <label className="knowledge-form-grid__wide">Endpoint<input value={draft.searxng.endpoint} onChange={(event) => updateSearxng({ endpoint: event.target.value })} placeholder="http://127.0.0.1:8080" /></label>
                    <label>语言<input value={draft.searxng.language} onChange={(event) => updateSearxng({ language: event.target.value })} /></label>
                    <label>安全搜索<select value={draft.searxng.safeSearch} onChange={(event) => updateSearxng({ safeSearch: Number(event.target.value) as 0 | 1 | 2 })}><option value={0}>关闭</option><option value={1}>适中</option><option value={2}>严格</option></select></label>
                    <label>超时（毫秒）<input type="number" min={1000} max={30000} value={draft.searxng.timeoutMs} onChange={(event) => updateSearxng({ timeoutMs: Number(event.target.value) })} /></label>
                </div>
                <div className="knowledge-source-card__actions">
                    <button className="knowledge-button knowledge-button--secondary" type="button" onClick={probeSearxng} disabled={searxngStatus === 'testing'}>{searxngStatus === 'testing' ? '检查中…' : '检查连接'}</button>
                    {searxngMessage && <span className={`knowledge-probe-message knowledge-probe-message--${searxngStatus}`} role="status" aria-live="polite">{searxngMessage}</span>}
                </div>
            </article>
        </section>
    );
}

function SourceSummaryCard({ icon, label, value, description, tone }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    description: string;
    tone: string;
}): React.ReactElement {
    return <div className={`knowledge-source-summary knowledge-source-summary--${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{description}</p></div></div>;
}

function probeStatusLabel(status: ProbeStatus): string {
    if (status === 'success') return '可用';
    if (status === 'error') return '不可用';
    if (status === 'testing') return '检查中';
    return '未检查';
}

function formatCapability(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'stream') return '流式';
    if (normalized === 'non_stream' || normalized === 'non-stream') return '非流式';
    if (normalized === 'ready' || normalized === 'ok') return '可用';
    return normalized || '未确认';
}

function formatError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}
