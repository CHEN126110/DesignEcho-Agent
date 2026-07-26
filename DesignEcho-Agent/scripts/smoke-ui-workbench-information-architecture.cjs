#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoPseudoThinking(source, label) {
  const forbidden = [
    '等待响应',
    '请求已发送',
    '正在准备',
    '稍等，正在准备处理你的需求'
  ];
  for (const marker of forbidden) {
    assert(!source.includes(marker), `${label} must not reintroduce local pseudo-thinking marker: ${marker}`);
  }
}

function main() {
  const pkg = JSON.parse(read('package.json'));
  const app = read('src/renderer/App.tsx');
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const chatPanelTestBridge = read('src/renderer/testing/chat-panel-test-bridge.ts');
  const changeBoundaries = read('scripts/report-change-boundaries.cjs');
  const maintenance = read('scripts/validate-maintenance-hygiene.cjs');
  const viteConfig = read('vite.config.mts');
  const buildWarningBoundary = read('scripts/check-build-warning-boundary.cjs');

  assert(
    exists('src/renderer/components/DesignAgentWorkbench.tsx'),
    'DesignAgentWorkbench component should exist as the project-mode workspace shell'
  );
  assert(
    exists('src/renderer/components/DesignAgentWorkbench.css'),
    'DesignAgentWorkbench.css should exist so workbench layout tokens stay out of App.tsx'
  );
  assert(
    exists('src/renderer/components/WorkflowBoard.tsx') &&
      exists('src/renderer/components/WorkflowBoard.css'),
    'WorkflowBoard component and styles should own the editable workflow canvas'
  );
  assert(
    exists('src/renderer/components/WorkspaceTabBar.tsx') &&
      exists('src/renderer/components/WorkspaceTabBar.css') &&
      exists('src/renderer/components/KnowledgeLibraryPage.tsx') &&
      exists('src/renderer/components/KnowledgeLibraryPage.css') &&
      exists('src/renderer/components/ThinkingModeControl.tsx') &&
      exists('src/renderer/components/ThinkingModeControl.css'),
    'Project tabs and Thinking mode should be shared components rather than duplicated page-local markup'
  );

  const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
  const workbenchCss = read('src/renderer/components/DesignAgentWorkbench.css');
  const workflowBoard = read('src/renderer/components/WorkflowBoard.tsx');
  const workflowBoardCss = read('src/renderer/components/WorkflowBoard.css');
  const canvasNodePreview = read('src/renderer/components/WorkflowCanvasNodePreview.tsx');
  const graphPersistence = read('src/renderer/components/workflow-graph-persistence.ts');
  const assetGallery = read('src/renderer/components/AssetGallery.tsx');
  const workspaceTabBar = read('src/renderer/components/WorkspaceTabBar.tsx');
  const workspaceTabBarCss = read('src/renderer/components/WorkspaceTabBar.css');
  const knowledgeLibrary = read('src/renderer/components/KnowledgeLibraryPage.tsx');
  const projectManager = read('src/renderer/components/ProjectManager.tsx');
  const projectManagerCss = read('src/renderer/components/ProjectManager.css');
  const thinkingModeControl = read('src/renderer/components/ThinkingModeControl.tsx');

  assert(
    pkg.scripts?.['smoke:ui:workbench-information-architecture'] === 'node scripts/smoke-ui-workbench-information-architecture.cjs',
    'package should expose smoke:ui:workbench-information-architecture'
  );
  assert(
    typeof pkg.devDependencies?.['@xyflow/react'] === 'string',
    'Workflow canvas should use the maintained React Flow interaction engine'
  );
  assert(
    typeof pkg.devDependencies?.['lucide-react'] === 'string',
    'Lovart-derived home and shared controls should use the source project icon library'
  );
  assert(
    viteConfig.includes("normalizedId.includes('/node_modules/@xyflow/')") &&
      viteConfig.includes("return 'workflow-vendor'") &&
      buildWarningBoundary.includes('/Circular chunk:/i'),
    'React Flow should have an explicit vendor boundary and circular chunks should fail the build warning gate'
  );
  assert(
    pkg.scripts?.['maintenance:preflight']?.includes('smoke:ui:workbench-information-architecture'),
    'maintenance:preflight should include the workbench IA smoke'
  );
  assert(
    app.includes("const DesignAgentWorkbench = lazy(() =>") &&
      app.includes("import('./components/DesignAgentWorkbench')") &&
      app.includes('<DesignAgentWorkbench') &&
      app.includes('workspaceTabsReducer') &&
      app.includes('workspaceNavigation={(') &&
      app.includes('activePage={workspaceTabs.activeTabId}') &&
      app.includes('openPages={workspaceTabs.tabs.map') &&
      app.includes('key={`${currentProject.id}:${currentProject.path}`}') &&
      app.includes('const commitProjectSession = useCallback(') &&
      app.includes('setEcommerceStructure(null)') &&
      app.includes('commitProjectSession({') &&
      app.includes('commitProjectSession(null)') &&
      app.includes('const synchronizedProject = useAppStore.getState().currentProject') &&
      app.includes('commitProjectSession(synchronizedProject)') &&
      (app.match(/dispatchWorkspaceTabs\(\{ type: 'reset' \}\)/g) || []).length === 1,
    'App should own one project-page tab state and delegate the keep-mounted page deck to DesignAgentWorkbench'
  );
  assert(
    !app.includes("import { Sidebar } from './components/Sidebar';") &&
      !app.includes("import { ChatPanel } from './components/ChatPanel';") &&
      !app.includes("import { AssetGallery } from './components/AssetGallery';"),
    'App should not own the chat/assets layout after workbench shell extraction'
  );

  assert(
    workbench.includes('data-testid="design-agent-workbench"') &&
      workbench.includes('data-testid="workbench-agent-canvas"') &&
      workbench.includes('className="workflow-left-rail"') &&
      workbench.includes('data-testid="workflow-node-library"') &&
      workbench.includes('className="workbench-agent-panel"') &&
      !workbench.includes('data-testid="workbench-evidence-inspector"') &&
      !workbench.includes('data-testid="workbench-project-overview"') &&
      !workbench.includes('data-testid="workbench-qa-panel"'),
    'Workbench should expose the node library, workflow canvas and right Agent panel without diagnostic rails'
  );
  assert(
    !workbench.includes('nodeLibraryOpen') &&
      workbench.includes('data-testid="workflow-node-library"') &&
      workflowBoard.includes('className="workflow-board-controls workflow-viewport-controls"') &&
      workflowBoard.includes('className="workflow-board-controls workflow-creation-dock"') &&
      workflowBoard.includes('const duplicateNode = useCallback(') &&
      workflowBoard.includes('const deleteNode = useCallback(') &&
      workflowBoard.includes('onKeyDown={handleBoardKeyDown}'),
    'Workbench should keep the node library visible, separate canvas controls and provide reusable node management interactions'
  );
  assert(
    workbench.includes("import { ChatPanel } from './ChatPanel';") &&
      workbench.includes('WORKFLOW_PALETTE,') &&
      workbench.includes('WorkflowBoard,') &&
      workbench.includes("const AssetGallery = lazy(() =>") &&
      workbench.includes("import('./AssetGallery')") &&
      workbench.includes("const assetsOpened = openPages.includes('assets')") &&
      workbench.includes("const knowledgeOpened = openPages.includes('knowledge')") &&
      workbench.includes("import('./KnowledgeLibraryPage')") &&
      workbench.includes('<KnowledgeLibraryPage') &&
      workbench.includes('<ChatPanel') &&
      !workbench.includes("activeView === 'chat'"),
    'Workbench should keep one ChatPanel mounted while workflow and full-width asset pages switch visibility'
  );
  assert(
    workbench.includes('const [knowledgeReferences, setKnowledgeReferences]') &&
      workbench.includes('onAddReference={handleAddKnowledgeReference}') &&
      workbench.includes('selectedReferences={knowledgeReferences}') &&
      workbench.includes('knowledgeReferences={knowledgeReferences}') &&
      chatPanel.includes('knowledgeReferences?: KnowledgeSelectionReference[]') &&
      chatPanel.includes('const submissionKnowledgeReferences = knowledgeReferences.map') &&
      chatPanel.includes('knowledgeReferences: submissionKnowledgeReferences') &&
      chatPanel.includes('data-testid="composer-knowledge-reference"'),
    'Selected governed knowledge must remain visible and enter the same request-scoped ChatPanel context'
  );
  assert(
      workflowBoard.includes('export interface WorkflowSelectionContext') &&
      workflowBoard.includes('export function buildWorkflowSelectionContextKey') &&
      workflowBoard.includes('const selectionContext = useMemo<WorkflowSelectionContext>') &&
      workflowBoard.includes('const fingerprint = buildGraphFingerprint(nodes, edges)') &&
      workflowBoard.includes('const lastPublishedSelectionKeyRef = useRef<string | null>(null)') &&
      workflowBoard.includes('const selectionKey = buildWorkflowSelectionContextKey(selectionContext)') &&
      workflowBoard.includes('if (selectionKey === lastPublishedSelectionKeyRef.current) return') &&
      workflowBoard.includes('if (selectedNodes.length !== 1)') &&
      workflowBoard.includes('onSelectionContextChange(selectionContext)') &&
      workbench.includes('const [workflowSelectionContext, setWorkflowSelectionContext]') &&
      workbench.includes('const nextContextKey = buildWorkflowSelectionContextKey(context)') &&
      workbench.includes('buildWorkflowSelectionContextKey(current) === nextContextKey') &&
      workbench.includes('onSelectionContextChange={handleWorkflowSelectionContextChange}') &&
      workbench.includes('activeWorkspacePage={activePage}') &&
      workbench.includes('workflowSelectionContext={workflowSelectionContext}') &&
      chatPanel.includes('workflowSelectionContext?: WorkflowSelectionContext | null') &&
      chatPanel.includes('const submissionWorkflowContext = toOperatingWorkflowContext(workflowSelectionContext)') &&
      chatPanel.includes('const operatingContextSnapshot = buildOperatingContextSnapshot({') &&
      chatPanel.includes('operatingContextSnapshot,'),
    'Workflow selection must project through Workbench into one request-scoped Agent operating context snapshot'
  );
  assert(
    assetGallery.includes('export interface AssetSelectionContext') &&
      assetGallery.includes('onAssetSelectionChange?.(buildAssetSelectionContext(image))') &&
      assetGallery.includes("className={`image-card ${selectedImagePath === image.path ? 'selected' : ''}`}") &&
      !workbench.includes('type WorkspacePrimarySelection =') &&
      workbench.includes('const [selectedAssetContext, setSelectedAssetContext]') &&
      workbench.includes('onAssetSelectionChange={handleAssetSelectionChange}') &&
      workbench.includes('selectedAssetContext={selectedAssetContext}') &&
      workbench.includes('setSelectedAssetContext(context)') &&
      workbench.includes('setSelectedNodeId(null)') &&
      workbench.includes('useLayoutEffect(() => {') &&
      !workbench.includes('setWorkflowSelectionContext(null)') &&
      chatPanel.includes('selectedAssetContext?: AssetSelectionContext | null') &&
      chatPanel.includes('const submissionSelectedAssetContext = selectedAssetContext') &&
      chatPanel.includes('selectedProjectImagePath: submissionSelectedAssetContext?.path') &&
      assetGallery.includes('onAssetSelectionChange?.(buildAssetSelectionContext(nextImage))') &&
      chatPanel.includes('data-testid="composer-asset-selection"') &&
      chatPanel.includes('data-testid="composer-workflow-selection"'),
    'Workflow identity must survive an empty node selection while the visible node or asset remains one explicit request target'
  );
  assert(
    workbench.includes('aria-label="节点库"') &&
      workbench.includes('aria-label="Agent 任务画布"') &&
      workbench.includes('aria-label="项目素材"') &&
      workspaceTabBar.includes('role="tablist"') &&
      workspaceTabBar.includes('aria-selected={isActive}') &&
      workspaceTabBar.includes('aria-controls={`workspace-panel-${tab.id}`}') &&
      workbench.includes('role="tabpanel"') &&
      workbench.includes('aria-labelledby="workspace-tab-workflow"') &&
      workbench.includes('aria-labelledby="workspace-tab-assets"'),
    'Workbench page regions and root project tabs should expose accessible labels and active state'
  );
  assert(
      !workbench.includes('当前项目') &&
      !workbench.includes('当前任务') &&
      !workbench.includes('连接与验收') &&
      !workbench.includes('交付进度') &&
      !workbench.includes('任务详情') &&
      !workbench.includes('项目证据') &&
      !workbench.includes('项目概览') &&
      !workbench.includes('项目结构详情') &&
      !workbench.includes('业务素材概览'),
    'Workbench should keep project status, QA and delivery diagnostics out of the default user surface'
  );
  assert(
    !workbench.includes('executeToolCall') &&
      !workbench.includes('processWithUnifiedAgent') &&
      !workbench.includes('streamChatAsync') &&
      !workbench.includes('window.designEcho') &&
      !workflowBoard.includes('executeToolCall') &&
      !workflowBoard.includes('processWithUnifiedAgent') &&
      !workflowBoard.includes('streamChatAsync') &&
      !workflowBoard.includes('window.designEcho'),
    'Workbench shell must remain presentational and must not call Agent, Photoshop or provider services'
  );

  assert(
    workflowBoard.includes("from '@xyflow/react'") &&
      workflowBoard.includes('useNodesState<WorkflowCanvasNode>') &&
      workflowBoard.includes('useEdgesState<WorkflowCanvasEdge>') &&
      workflowBoard.includes('<ReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>') &&
      workflowBoard.includes("title: '用户需求'") &&
      workflowBoard.includes("title: 'AI 逻辑理解'") &&
      workflowBoard.includes("title: '视觉分析'") &&
      workflowBoard.includes("title: '生成设计方案'") &&
      workflowBoard.includes("title: '写入 Photoshop'") &&
      workflowBoard.includes('onDrop={handleDrop}') &&
      workflowBoard.includes('screenToFlowPosition') &&
      workflowBoard.includes('onConnect={handleConnect}') &&
      workflowBoard.includes('onReconnect={handleReconnect}') &&
      workflowBoard.includes('selectionKeyCode="Control"') &&
      workflowBoard.includes('panActivationKeyCode={null}') &&
      workflowBoard.includes('const PAN_ON_DRAG_MOUSE_BUTTONS = [1]') &&
      workflowBoard.includes('panOnDrag={PAN_ON_DRAG_MOUSE_BUTTONS}') &&
      workflowBoard.includes('Ctrl + 拖动框选 · 鼠标中键平移 · 滚轮缩放') &&
      !workflowBoard.includes('panOnDrag={[0, 1]}') &&
      workflowBoard.includes('selectionMode={SelectionMode.Partial}') &&
      workflowBoard.includes('defaultViewport={restoredSnapshot?.viewport ?? INITIAL_VIEWPORT}') &&
      workflowBoard.includes('const expanded = selected && activeNodeId === id') &&
      workflowBoard.includes('<MiniMap<WorkflowCanvasNode>') &&
      workflowBoard.includes('handleSendToAgent') &&
      workflowBoard.includes('connectionCreatesCycle') &&
      workflowBoard.includes("if (!/^\\d+$/.test(rawPaletteIndex)) return") &&
      workflowBoard.includes('deleteKeyCode={null}') &&
      !workflowBoard.includes('useAppStore'),
    'WorkflowBoard should preserve the reference topology while rejecting invalid drops/cycles and avoiding fake Agent execution state'
  );
  assert(
    workflowBoard.includes("{ kind: 'canvas', title: 'Photoshop 画布'") &&
      workflowBoard.includes("import { WorkflowCanvasNodePreview } from './WorkflowCanvasNodePreview'") &&
      workflowBoard.includes('{isCanvasPreview && <WorkflowCanvasNodePreview />}') &&
      canvasNodePreview.includes("'getDocumentSnapshot'") &&
      canvasNodePreview.includes('getConnectionStatus') &&
      canvasNodePreview.includes('onPluginConnected') &&
      canvasNodePreview.includes('onPluginDisconnected') &&
      canvasNodePreview.includes('未连接 Photoshop') &&
      workflowBoardCss.includes('.workflow-canvas-preview') &&
      !workbench.includes('WorkflowCanvasNodePreview'),
    'The Photoshop canvas preview node must own its bridge access in a feature component outside the presentational WorkflowBoard shell'
  );
  assert(
    workflowBoard.includes("from './workflow-graph-persistence'") &&
      workflowBoard.includes('persistenceKey ? loadWorkflowGraphSnapshot(persistenceKey) : null') &&
      workflowBoard.includes('const persistGraphNow = useCallback(') &&
      workflowBoard.includes("state: persistenceKey ? 'saved_draft' : 'ephemeral_draft'") &&
      workflowBoard.includes('onMoveEnd={handleViewportMoveEnd}') &&
      graphPersistence.includes("'designecho.workflow-graph.v1:'") &&
      graphPersistence.includes('workflow-graph/v1') &&
      graphPersistence.includes('已回退默认拓扑') &&
      workbench.includes('persistenceKey={workflowPersistenceKey}') &&
      app.includes('workflowPersistenceKey={`${currentProject.id}:${currentProject.path}`}'),
    'The workflow graph must persist per project through one validated local snapshot and restore on re-entry'
  );
  assert(
    !workflowBoard.includes('CANVAS_WIDTH') &&
      !workflowBoard.includes('CANVAS_HEIGHT') &&
      !workflowBoard.includes('canvasPanRef') &&
      !workflowBoard.includes('canvasScrollRef') &&
      !workflowBoard.includes('handleNodePointerMove') &&
      !workflowBoard.includes('buildEdgePath') &&
      !workflowBoard.includes('workflow-canvas-extent'),
    'WorkflowBoard must retire the fixed-size scroll canvas and handwritten pointer/edge implementation'
  );

  assert(
    workbenchCss.includes('.design-agent-workbench') &&
      workbenchCss.includes('.workbench-shell') &&
      workbenchCss.includes('.workbench-primary') &&
      workbenchCss.includes('.workbench-page.active') &&
      workbenchCss.includes('.workbench-shell.page-assets .workflow-left-rail') &&
      workbenchCss.includes('.workbench-assets-page') &&
      workbenchCss.includes('.workflow-left-rail') &&
      workbenchCss.includes('min-width: 200px') &&
      workbenchCss.includes('.workbench-agent-panel') &&
      !workbenchCss.includes('.workbench-inspector') &&
      !workbenchCss.includes('grid-template-columns'),
    'Workbench CSS should define the reference three-column shell without a diagnostic inspector column'
  );
  assert(
    workflowBoardCss.includes('.workflow-react-flow') &&
      workflowBoardCss.includes('.react-flow__pane') &&
      workflowBoardCss.includes('.workflow-node') &&
      workflowBoardCss.includes('width: 200px') &&
      workflowBoardCss.includes('.workflow-node-handle') &&
      workflowBoardCss.includes('.workflow-minimap') &&
      workflowBoardCss.includes('.workflow-board-controls') &&
      !workflowBoardCss.includes('.workflow-canvas-scroll') &&
      !workflowBoardCss.includes('.workflow-canvas-extent'),
    'WorkflowBoard CSS should style the React Flow viewport, compact nodes, ports, minimap and canvas controls without the old scroll extent'
  );
  assert(
    workspaceTabBar.includes("export type WorkspacePageKind = 'workflow' | 'assets' | 'eagle' | 'knowledge'") &&
      workspaceTabBar.includes("title: 'Eagle 素材库'") &&
      workspaceTabBar.includes("title: '知识库'") &&
      workspaceTabBar.includes("case 'open':") &&
      workspaceTabBar.includes("case 'close':") &&
      workspaceTabBar.includes("case 'reset':") &&
      workspaceTabBar.includes("if (!closingTab?.closable) return state") &&
      workspaceTabBar.includes("activeTabId: nextTabs[fallbackIndex]?.id || 'workflow'") &&
      workspaceTabBar.includes('function handleCloseTab(') &&
      workspaceTabBar.includes('pendingFocusTabIdRef.current = fallbackId || null') &&
      workspaceTabBar.includes('document.getElementById(`workspace-tab-${pendingFocusTabId}`)') &&
      workspaceTabBarCss.includes('.workspace-tab.active') &&
      workspaceTabBarCss.includes('-webkit-app-region: no-drag'),
    'Workspace tabs should be a single reducer-owned current-project page model with close fallback and Electron-safe hit targets'
  );
  assert(
    knowledgeLibrary.includes("label: '知识资产'") &&
      knowledgeLibrary.includes("label: '复核中心'") &&
      !knowledgeLibrary.includes("label: '用户偏好'") &&
      !knowledgeLibrary.includes("label: '来源管理'"),
    'Knowledge Library should expose assets and review; preferences and sources live in Settings'
  );
  assert(
    projectManager.includes('让设计工作更简单') &&
      projectManager.includes('<ThinkingModeControl') &&
      projectManager.includes('onProjectOpen(openedProject, homePrompt.trim() || undefined)') &&
      projectManagerCss.includes('width: min(560px, 100%)') &&
      projectManagerCss.includes('padding: clamp(48px, 6vh, 72px) 24px 80px') &&
      projectManagerCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr))') &&
      thinkingModeControl.includes('自主规划复杂任务并交付成品') &&
      thinkingModeControl.includes('role="tooltip"') &&
      chatPanel.includes('<ThinkingModeControl') &&
      chatPanel.includes('externalDraftRevision') &&
      !projectManager.includes('scanEcommerceProject') &&
      !projectManager.includes('role="button"') &&
      projectManager.includes('className="project-card-open"'),
    'Lovart home hierarchy and Thinking styling should reuse one real preference control and hand drafts into the sole ChatPanel'
  );
  assert(
    /\.project-card-open\s*\{[^}]*width:\s*100%;[^}]*align-items:\s*stretch;[^}]*flex-direction:\s*column;/s.test(projectManagerCss) &&
      /\.project-card-preview,\s*\.project-card-new\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3;/s.test(projectManagerCss),
    'Recent project buttons must stretch their preview to the same 4:3 grid card geometry as the new-project card'
  );
  assert(
    !/font-size:\s*clamp\([^;]*vw|font-size:\s*\d+vw/.test(workbenchCss),
    'Workbench CSS must not scale text directly with viewport width'
  );
  assert(
    !/letter-spacing:\s*-\d/.test(workbenchCss),
    'Workbench CSS must not use negative letter spacing'
  );
  assertNoPseudoThinking(workbench, 'DesignAgentWorkbench');
  assertNoPseudoThinking(workbenchCss, 'DesignAgentWorkbench.css');
  assertNoPseudoThinking(workflowBoard, 'WorkflowBoard');
  assertNoPseudoThinking(workflowBoardCss, 'WorkflowBoard.css');
  assertNoPseudoThinking(canvasNodePreview, 'WorkflowCanvasNodePreview');

  assert(
    chatPanel.includes('installChatPanelTestBridge') &&
      chatPanelTestBridge.includes("CHAT_TEST_BRIDGE_KEY = '__DESIGNECHO_CHAT_TEST_BRIDGE__'") &&
      chatPanelTestBridge.includes('(window as any)[CHAT_TEST_BRIDGE_KEY]') &&
      !chatPanel.includes('workbench-evidence-inspector'),
    'Workbench extraction must not move or break ChatPanel test bridge ownership'
  );
  assert(
    changeBoundaries.includes('smoke:ui:workbench-information-architecture') &&
      changeBoundaries.includes('DesignAgentWorkbench'),
    'change boundary report should classify the workbench shell and its smoke'
  );
  assert(
    maintenance.includes("scripts/smoke-ui-workbench-information-architecture.cjs") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/DesignAgentWorkbench.tsx'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/DesignAgentWorkbench.css'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/WorkflowBoard.tsx'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/WorkflowBoard.css'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/ProjectManager.tsx'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/ProjectManager.css'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/WorkspaceTabBar.tsx'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/WorkspaceTabBar.css'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/ThinkingModeControl.tsx'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/ThinkingModeControl.css'"),
    'maintenance hygiene should syntax-check and focused-diff the workbench, home, tabs and shared Thinking control'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'App owns one current-project page-tab reducer and delegates the keep-mounted page deck',
      'Workbench keeps WorkflowBoard, full-width AssetGallery and the sole ChatPanel in one shell',
      'Workbench exposes a persistent node library, editable canvas and right Agent panel without diagnostic rails',
      'Browser-style page tabs add, focus and close project pages without creating another Agent runtime',
      'WorkflowBoard preserves React Flow interactions while invalid drops, cycles and fake execution projection are removed',
      'The Photoshop canvas preview node reads the live document snapshot through its own feature component',
      'The workflow graph persists per project and restores when the project reopens',
      'Workflow selection projects through Workbench into the Agent request snapshot without creating a second owner',
      'Selected project assets are visible in the composer and share the same request-scoped context path',
      'Selected governed knowledge enters the same request snapshot and stays visible in the composer',
      'Fixed-size scroll canvas, handwritten pointer dragging and static SVG edge math are retired',
      'Lovart home hierarchy and Thinking tooltip share real DesignEcho preference state',
      'Workbench does not call Agent, provider, Photoshop or window.designEcho services',
      'Workbench does not reintroduce pseudo-thinking placeholders',
      'ChatPanel test bridge ownership remains in ChatPanel',
      'package, maintenance preflight, change boundaries and maintenance hygiene are wired'
    ]
  }, null, 2));
}

main();
