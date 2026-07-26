import React, { useEffect, useRef, useState } from 'react';
import { Database, Images, Library, Plus, Workflow, X } from 'lucide-react';

import './WorkspaceTabBar.css';

export type WorkspacePageKind = 'workflow' | 'assets' | 'eagle' | 'knowledge';

export interface WorkspacePageTab {
    id: WorkspacePageKind;
    kind: WorkspacePageKind;
    title: string;
    closable: boolean;
}

export interface WorkspaceTabsState {
    tabs: WorkspacePageTab[];
    activeTabId: WorkspacePageKind;
}

export type WorkspaceTabsAction =
    | { type: 'activate'; tabId: WorkspacePageKind }
    | { type: 'open'; kind: WorkspacePageKind }
    | { type: 'close'; tabId: WorkspacePageKind }
    | { type: 'reset' };

const WORKSPACE_PAGE_DEFINITIONS: Record<WorkspacePageKind, WorkspacePageTab> = {
    workflow: { id: 'workflow', kind: 'workflow', title: '工作流', closable: false },
    assets: { id: 'assets', kind: 'assets', title: '项目素材', closable: true },
    eagle: { id: 'eagle', kind: 'eagle', title: 'Eagle 素材库', closable: true },
    knowledge: { id: 'knowledge', kind: 'knowledge', title: '知识库', closable: true }
};

export const INITIAL_WORKSPACE_TABS_STATE: WorkspaceTabsState = {
    tabs: [WORKSPACE_PAGE_DEFINITIONS.workflow],
    activeTabId: 'workflow'
};

export function workspaceTabsReducer(
    state: WorkspaceTabsState,
    action: WorkspaceTabsAction
): WorkspaceTabsState {
    switch (action.type) {
        case 'activate':
            if (!state.tabs.some((tab) => tab.id === action.tabId)) return state;
            return { ...state, activeTabId: action.tabId };
        case 'open': {
            if (state.tabs.some((tab) => tab.kind === action.kind)) {
                return { ...state, activeTabId: action.kind };
            }
            return {
                tabs: [...state.tabs, WORKSPACE_PAGE_DEFINITIONS[action.kind]],
                activeTabId: action.kind
            };
        }
        case 'close': {
            const closingIndex = state.tabs.findIndex((tab) => tab.id === action.tabId);
            const closingTab = state.tabs[closingIndex];
            if (!closingTab?.closable) return state;
            const nextTabs = state.tabs.filter((tab) => tab.id !== action.tabId);
            if (state.activeTabId !== action.tabId) return { ...state, tabs: nextTabs };
            const fallbackIndex = Math.max(0, closingIndex - 1);
            return {
                tabs: nextTabs,
                activeTabId: nextTabs[fallbackIndex]?.id || 'workflow'
            };
        }
        case 'reset':
            return INITIAL_WORKSPACE_TABS_STATE;
    }
}

interface WorkspaceTabBarProps {
    state: WorkspaceTabsState;
    onActivate: (tabId: WorkspacePageKind) => void;
    onOpen: (kind: WorkspacePageKind) => void;
    onClose: (tabId: WorkspacePageKind) => void;
}

function WorkspacePageIcon({ kind }: { kind: WorkspacePageKind }): React.ReactElement {
    if (kind === 'assets') return <Images size={14} strokeWidth={1.8} aria-hidden="true" />;
    if (kind === 'eagle') return <Database size={14} strokeWidth={1.8} aria-hidden="true" />;
    if (kind === 'knowledge') return <Library size={14} strokeWidth={1.8} aria-hidden="true" />;
    return <Workflow size={14} strokeWidth={1.8} aria-hidden="true" />;
}

export const WorkspaceTabBar: React.FC<WorkspaceTabBarProps> = ({
    state,
    onActivate,
    onOpen,
    onClose
}) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const firstMenuItemRef = useRef<HTMLButtonElement>(null);
    const pendingFocusTabIdRef = useRef<WorkspacePageKind | null>(null);

    useEffect(() => {
        if (!menuOpen) return;
        function handlePointerDown(event: PointerEvent): void {
            if (menuRef.current?.contains(event.target as Node)) return;
            setMenuOpen(false);
        }
        function handleEscape(event: KeyboardEvent): void {
            if (event.key === 'Escape') setMenuOpen(false);
        }
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        window.requestAnimationFrame(() => firstMenuItemRef.current?.focus());
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [menuOpen]);

    useEffect(() => {
        const pendingFocusTabId = pendingFocusTabIdRef.current;
        if (!pendingFocusTabId) return;
        const target = document.getElementById(`workspace-tab-${pendingFocusTabId}`);
        if (!target) return;
        target.focus();
        pendingFocusTabIdRef.current = null;
    }, [state.activeTabId, state.tabs]);

    function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const nextIndex = (index + direction + state.tabs.length) % state.tabs.length;
        onActivate(state.tabs[nextIndex].id);
        const tabButtons = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabButtons?.[nextIndex]?.focus();
    }

    function handleCloseTab(tabId: WorkspacePageKind, index: number): void {
        const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
        const fallbackId = state.activeTabId === tabId
            ? nextTabs[Math.max(0, index - 1)]?.id
            : state.activeTabId;
        pendingFocusTabIdRef.current = fallbackId || null;
        onClose(tabId);
    }

    return (
        <div className="workspace-tab-bar" data-testid="workspace-tab-bar">
            <div className="workspace-tab-list" role="tablist" aria-label="项目页面">
                {state.tabs.map((tab, index) => {
                    const isActive = state.activeTabId === tab.id;
                    return (
                        <div key={tab.id} className={`workspace-tab ${isActive ? 'active' : ''}`}>
                            <button
                                type="button"
                                role="tab"
                                id={`workspace-tab-${tab.id}`}
                                aria-controls={`workspace-panel-${tab.id}`}
                                aria-selected={isActive}
                                tabIndex={isActive ? 0 : -1}
                                className="workspace-tab-activate"
                                onClick={() => onActivate(tab.id)}
                                onKeyDown={(event) => handleTabKeyDown(event, index)}
                            >
                                <WorkspacePageIcon kind={tab.kind} />
                                <span>{tab.title}</span>
                            </button>
                            {tab.closable && (
                                <button
                                    type="button"
                                    className="workspace-tab-close"
                                    aria-label={`关闭${tab.title}页面`}
                                    onClick={() => handleCloseTab(tab.id, index)}
                                >
                                    <X size={13} strokeWidth={1.8} aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="workspace-tab-add" ref={menuRef}>
                <button
                    type="button"
                    className="workspace-tab-add-button"
                    aria-label="打开项目页面"
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                    onClick={() => setMenuOpen((open) => !open)}
                >
                    <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
                </button>
                {menuOpen && (
                    <div className="workspace-tab-menu" role="menu" aria-label="可打开页面">
                        <button
                            ref={firstMenuItemRef}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                onOpen('assets');
                                setMenuOpen(false);
                            }}
                        >
                            <Images size={15} strokeWidth={1.8} aria-hidden="true" />
                            <span>
                                <strong>项目素材</strong>
                                <small>浏览项目图片与设计文件</small>
                            </span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                onOpen('eagle');
                                setMenuOpen(false);
                            }}
                        >
                            <Database size={15} strokeWidth={1.8} aria-hidden="true" />
                            <span>
                                <strong>Eagle 素材库</strong>
                                <small>直接浏览 Eagle 模板与设计参考</small>
                            </span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                onOpen('knowledge');
                                setMenuOpen(false);
                            }}
                        >
                            <Library size={15} strokeWidth={1.8} aria-hidden="true" />
                            <span>
                                <strong>知识库</strong>
                                <small>管理知识、学习与设计参考</small>
                            </span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
