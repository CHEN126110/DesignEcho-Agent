/**
 * 设计上下文服务
 * 
 * 为 Agent 提供 Photoshop 实时上下文感知能力
 * 
 * 设计原则：
 * 1. 缓存优先 - 减少 UXP API 调用频率
 * 2. 增量更新 - 只在必要时刷新上下文
 * 3. 轻量级获取 - 避免一次性获取大量数据
 * 4. 超时保护 - 防止 UXP 调用阻塞 UI
 * 
 * UXP 限制考虑：
 * - executeAsModal 需要用户交互窗口
 * - 大文档的图层遍历可能很慢 (>1000 图层)
 * - WebSocket 通信有延迟
 */

// ==================== 类型定义 ====================

/**
 * 文档上下文
 */
export interface DocumentContext {
    id: number;
    name: string;
    path?: string;
    width: number;
    height: number;
    resolution: number;
    colorMode: string;
    layerCount: number;
    isActive: boolean;
}

/**
 * 选中图层上下文
 */
export interface SelectedLayerContext {
    id: number;
    name: string;
    type: string;          // 'text' | 'pixel' | 'group' | 'smartObject' | etc.
    visible: boolean;
    locked: boolean;
    bounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
    // 文本图层特有
    textContent?: string;
    textStyle?: {
        fontName?: string;
        fontSize?: number;
        fontWeight?: string;
        color?: string;
        alignment?: string;
    };
    // 智能对象特有
    isSmartObject?: boolean;
    smartObjectPath?: string;
    smartObjectInfo?: {
        linked: boolean;           // 是否是链接的智能对象
        fileReference?: string;    // 链接文件路径
        originalWidth?: number;    // 原始宽度
        originalHeight?: number;   // 原始高度
    };
}

/**
 * 图层层级摘要（轻量级）
 */
export interface LayerHierarchySummary {
    totalLayers: number;
    topLevelCount: number;
    groups: number;
    textLayers: number;
    smartObjects: number;
    // 顶层图层名称（用于快速参考）
    topLevelNames: string[];
}

/**
 * 完整设计上下文
 */
export interface DesignContext {
    // 时间戳
    timestamp: number;
    isStale: boolean;          // 是否过期需要刷新
    
    // 连接状态
    isConnected: boolean;
    
    // 文档上下文
    activeDocument: DocumentContext | null;
    openDocuments: DocumentContext[];
    
    // 选中状态
    selectedLayers: SelectedLayerContext[];
    
    // 图层层级摘要
    layerSummary: LayerHierarchySummary | null;
    
    // 项目上下文
    projectPath?: string;
    skuDocumentName?: string;   // 检测到的 SKU 文件
    templateDocumentName?: string;  // 检测到的模板文件
}

/**
 * 上下文刷新选项
 */
export interface RefreshOptions {
    forceRefresh?: boolean;     // 强制刷新，忽略缓存
    includeLayerSummary?: boolean;  // 是否获取图层摘要（较慢）
    includeTextContent?: boolean;   // 是否获取选中文本内容
    timeout?: number;           // 超时时间（毫秒）
}

// ==================== 配置常量 ====================

const CACHE_TTL = 5000;         // 缓存有效期（5秒）
const LAYER_SUMMARY_TTL = 10000; // 图层摘要缓存（10秒）
const DEFAULT_TIMEOUT = 3000;   // 默认超时时间
const MAX_TOP_LEVEL_NAMES = 10; // 顶层图层名称最大数量

// ==================== 上下文服务类 ====================

class ContextService {
    private cachedContext: DesignContext | null = null;
    private lastLayerSummaryTime: number = 0;
    private isRefreshing: boolean = false;
    private refreshPromise: Promise<DesignContext> | null = null;
    
    // 事件回调
    private onContextChanged: ((ctx: DesignContext) => void) | null = null;
    
    constructor() {
        console.log('[ContextService] 初始化');
    }
    
    /**
     * 设置上下文变更回调
     */
    setOnContextChanged(callback: (ctx: DesignContext) => void): void {
        this.onContextChanged = callback;
    }
    
    /**
     * 获取当前上下文（带缓存）
     */
    async getContext(options: RefreshOptions = {}): Promise<DesignContext> {
        const now = Date.now();
        
        // 检查缓存是否有效
        if (
            !options.forceRefresh &&
            this.cachedContext &&
            !this.cachedContext.isStale &&
            now - this.cachedContext.timestamp < CACHE_TTL
        ) {
            return this.cachedContext;
        }
        
        // 避免并发刷新
        if (this.isRefreshing && this.refreshPromise) {
            return this.refreshPromise;
        }
        
        this.isRefreshing = true;
        this.refreshPromise = this.refreshContext(options);
        
        try {
            const ctx = await this.refreshPromise;
            return ctx;
        } finally {
            this.isRefreshing = false;
            this.refreshPromise = null;
        }
    }
    
    /**
     * 快速获取（仅使用缓存，不刷新）
     */
    getContextSync(): DesignContext | null {
        return this.cachedContext;
    }
    
    /**
     * 标记上下文为过期（需要在下次请求时刷新）
     */
    invalidate(): void {
        if (this.cachedContext) {
            this.cachedContext.isStale = true;
        }
    }
    
    /**
     * 刷新上下文
     */
    private async refreshContext(options: RefreshOptions): Promise<DesignContext> {
        const timeout = options.timeout || DEFAULT_TIMEOUT;
        
        // 检查连接状态
        const isConnected = await this.checkConnection();
        
        if (!isConnected) {
            const ctx: DesignContext = {
                timestamp: Date.now(),
                isStale: false,
                isConnected: false,
                activeDocument: null,
                openDocuments: [],
                selectedLayers: [],
                layerSummary: null
            };
            this.cachedContext = ctx;
            return ctx;
        }
        
        // 并行获取上下文数据（带超时保护）
        const [
            documentResult,
            selectedResult,
            layerSummaryResult
        ] = await Promise.allSettled([
            this.withTimeout(this.fetchDocumentContext(), timeout),
            this.withTimeout(this.fetchSelectedLayers(options.includeTextContent), timeout),
            options.includeLayerSummary 
                ? this.withTimeout(this.fetchLayerSummary(), timeout)
                : Promise.resolve(this.getLayerSummaryCache())
        ]);
        
        // 解析结果
        const { activeDocument, openDocuments } = 
            documentResult.status === 'fulfilled' ? documentResult.value : { activeDocument: null, openDocuments: [] };
        
        const selectedLayers = 
            selectedResult.status === 'fulfilled' ? selectedResult.value : [];
        
        const layerSummary = 
            layerSummaryResult.status === 'fulfilled' ? layerSummaryResult.value : null;
        
        // 检测项目类型
        const projectInfo = this.detectProjectType(openDocuments);
        
        const ctx: DesignContext = {
            timestamp: Date.now(),
            isStale: false,
            isConnected: true,
            activeDocument,
            openDocuments,
            selectedLayers,
            layerSummary,
            ...projectInfo
        };
        
        this.cachedContext = ctx;
        
        // 触发回调
        if (this.onContextChanged) {
            this.onContextChanged(ctx);
        }
        
        return ctx;
    }
    
    /**
     * 检查 UXP 连接状态
     */
    private async checkConnection(): Promise<boolean> {
        try {
            const status = await window.designEcho?.getConnectionStatus?.();
            return status?.connected === true;
        } catch {
            return false;
        }
    }
    
    /**
     * 获取文档上下文
     */
    private async fetchDocumentContext(): Promise<{
        activeDocument: DocumentContext | null;
        openDocuments: DocumentContext[];
    }> {
        try {
            // 获取所有打开的文档
            const listResult = await window.designEcho.sendToPlugin('listDocuments', { includeDetails: true });
            
            if (!listResult?.success) {
                return { activeDocument: null, openDocuments: [] };
            }
            
            const openDocuments: DocumentContext[] = listResult.documents.map((doc: any) => ({
                id: doc.id,
                name: doc.name,
                path: doc.path,
                width: doc.width || 0,
                height: doc.height || 0,
                resolution: doc.resolution || 72,
                colorMode: doc.colorMode || 'RGB',
                layerCount: doc.layerCount || 0,
                isActive: doc.isActive || false
            }));
            
            const activeDocument = openDocuments.find(d => d.isActive) || null;
            
            return { activeDocument, openDocuments };
            
        } catch (error) {
            console.warn('[ContextService] 获取文档上下文失败:', error);
            return { activeDocument: null, openDocuments: [] };
        }
    }
    
    /**
     * 获取选中图层
     */
    private async fetchSelectedLayers(includeTextContent: boolean = true): Promise<SelectedLayerContext[]> {
        try {
            // 使用 diagnoseState 获取选中图层的详细信息
            const diagnosis = await window.designEcho.sendToPlugin('diagnoseState', { verbose: true });
            
            if (!diagnosis?.success || !diagnosis.selectedLayers?.length) {
                return [];
            }
            
            const layers: SelectedLayerContext[] = [];
            
            for (const layer of diagnosis.selectedLayers) {
                const ctx: SelectedLayerContext = {
                    id: layer.id,
                    name: layer.name,
                    type: layer.type || layer.kind || 'unknown',
                    visible: layer.visible !== false,
                    locked: layer.locked || false,
                    bounds: layer.bounds
                };
                
                // 如果是文本图层且需要获取内容
                if (includeTextContent && (ctx.type === 'text' || ctx.type === 'TEXT')) {
                    try {
                        const textContent = await window.designEcho.sendToPlugin('getTextContent', { layerId: layer.id });
                        if (textContent?.success) {
                            ctx.textContent = textContent.content;
                        }
                        
                        const textStyle = await window.designEcho.sendToPlugin('getTextStyle', { layerId: layer.id });
                        if (textStyle?.success) {
                            ctx.textStyle = {
                                fontName: textStyle.fontName,
                                fontSize: textStyle.fontSize,
                                fontWeight: textStyle.fontWeight,
                                color: textStyle.color,
                                alignment: textStyle.alignment
                            };
                        }
                    } catch {
                        // 忽略文本获取失败
                    }
                }
                
                // 检测智能对象
                if (ctx.type === 'smartObject' || ctx.type === 'SMARTOBJECT') {
                    ctx.isSmartObject = true;
                }
                
                layers.push(ctx);
            }
            
            return layers;
            
        } catch (error) {
            console.warn('[ContextService] 获取选中图层失败:', error);
            return [];
        }
    }
    
    /**
     * 获取图层层级摘要（轻量级）
     */
    private async fetchLayerSummary(): Promise<LayerHierarchySummary | null> {
        const now = Date.now();
        
        // 检查图层摘要缓存
        if (this.cachedContext?.layerSummary && now - this.lastLayerSummaryTime < LAYER_SUMMARY_TTL) {
            return this.cachedContext.layerSummary;
        }
        
        try {
            // 使用 getLayerHierarchy 获取（不包含边界信息以提高速度）
            const result = await window.designEcho.sendToPlugin('getLayerHierarchy', {
                includeHidden: false,  // 排除隐藏图层以减少数据量
                includeBounds: false,  // 不获取边界以提高速度
                flatList: false
            });
            
            if (!result?.success) {
                return null;
            }
            
            // 提取顶层图层名称
            const topLevelNames = (result.hierarchy || [])
                .slice(0, MAX_TOP_LEVEL_NAMES)
                .map((layer: any) => layer.name);
            
            const summary: LayerHierarchySummary = {
                totalLayers: result.totalLayers || 0,
                topLevelCount: result.hierarchy?.length || 0,
                groups: result.summary?.groups || 0,
                textLayers: result.summary?.textLayers || 0,
                smartObjects: result.summary?.smartObjects || 0,
                topLevelNames
            };
            
            this.lastLayerSummaryTime = now;
            return summary;
            
        } catch (error) {
            console.warn('[ContextService] 获取图层摘要失败:', error);
            return null;
        }
    }
    
    /**
     * 获取缓存的图层摘要
     */
    private getLayerSummaryCache(): LayerHierarchySummary | null {
        return this.cachedContext?.layerSummary || null;
    }
    
    /**
     * 检测项目类型（SKU、模板等）
     */
    private detectProjectType(documents: DocumentContext[]): {
        projectPath?: string;
        skuDocumentName?: string;
        templateDocumentName?: string;
    } {
        const result: { projectPath?: string; skuDocumentName?: string; templateDocumentName?: string } = {};
        
        for (const doc of documents) {
            const nameLower = doc.name.toLowerCase();
            
            // 检测 SKU 素材文件
            if (nameLower.includes('sku') && (nameLower.endsWith('.psd') || nameLower.endsWith('.psb'))) {
                result.skuDocumentName = doc.name;
                if (doc.path) {
                    result.projectPath = doc.path.replace(/[/\\][^/\\]+$/, '');
                }
            }
            
            // 检测模板文件
            if (nameLower.includes('模板') || nameLower.includes('template')) {
                result.templateDocumentName = doc.name;
            }
        }
        
        return result;
    }
    
    /**
     * 带超时的 Promise 包装
     */
    private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        return Promise.race([
            promise,
            new Promise<T>((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), ms)
            )
        ]);
    }
    
    // ==================== 上下文格式化（用于 Prompt 注入）====================
    
    /**
     * 生成简洁的上下文摘要（用于注入到系统提示）
     */
    formatForPrompt(ctx: DesignContext): string {
        if (!ctx.isConnected) {
            return '【Photoshop 状态】未连接\n';
        }
        
        const parts: string[] = [];
        
        // 1. 当前文档
        if (ctx.activeDocument) {
            const doc = ctx.activeDocument;
            parts.push(`## 当前文档\n- 文件名: ${doc.name}\n- 尺寸: ${doc.width}×${doc.height}px\n- 图层数: ${doc.layerCount}`);
        }
        
        // 2. 其他打开的文档
        if (ctx.openDocuments.length > 1) {
            const otherDocs = ctx.openDocuments
                .filter(d => !d.isActive)
                .map(d => d.name)
                .join('、');
            parts.push(`- 其他打开的文档: ${otherDocs}`);
        }
        
        // 3. 选中图层
        if (ctx.selectedLayers.length > 0) {
            const layer = ctx.selectedLayers[0]; // 主选中图层
            let layerInfo = `\n## 选中图层\n- 名称: "${layer.name}"\n- 类型: ${layer.type}`;
            
            if (layer.textContent) {
                const truncatedText = layer.textContent.length > 50 
                    ? layer.textContent.slice(0, 50) + '...'
                    : layer.textContent;
                layerInfo += `\n- 文本内容: "${truncatedText}"`;
            }
            
            if (layer.textStyle) {
                const style = layer.textStyle;
                const styleInfo = [
                    style.fontName && `字体: ${style.fontName}`,
                    style.fontSize && `字号: ${style.fontSize}pt`,
                    style.color && `颜色: ${style.color}`
                ].filter(Boolean).join('，');
                if (styleInfo) {
                    layerInfo += `\n- 样式: ${styleInfo}`;
                }
            }
            
            if (ctx.selectedLayers.length > 1) {
                layerInfo += `\n- (共选中 ${ctx.selectedLayers.length} 个图层)`;
            }
            
            parts.push(layerInfo);
        } else {
            parts.push('\n## 选中图层\n- 无（请在 PS 中选择图层）');
        }
        
        // 4. 图层结构摘要
        if (ctx.layerSummary) {
            const summary = ctx.layerSummary;
            parts.push(`\n## 图层结构概览\n- 总图层数: ${summary.totalLayers}\n- 顶层项: ${summary.topLevelCount} 个\n- 文本图层: ${summary.textLayers}，组: ${summary.groups}，智能对象: ${summary.smartObjects}`);
            
            if (summary.topLevelNames.length > 0) {
                parts.push(`- 顶层图层: ${summary.topLevelNames.slice(0, 5).join('、')}${summary.topLevelNames.length > 5 ? '...' : ''}`);
            }
        }
        
        // 5. 项目类型检测
        if (ctx.skuDocumentName || ctx.templateDocumentName) {
            let projectInfo = '\n## 项目检测';
            if (ctx.skuDocumentName) {
                projectInfo += `\n- SKU 素材文件: ${ctx.skuDocumentName}`;
            }
            if (ctx.templateDocumentName) {
                projectInfo += `\n- 模板文件: ${ctx.templateDocumentName}`;
            }
            parts.push(projectInfo);
        }
        
        return parts.join('\n');
    }
    
    /**
     * 生成超简洁的一行摘要（用于日志或快速展示）
     */
    formatOneLiner(ctx: DesignContext): string {
        if (!ctx.isConnected) {
            return 'PS: 未连接';
        }
        
        const doc = ctx.activeDocument;
        const layer = ctx.selectedLayers[0];
        
        if (!doc) {
            return 'PS: 已连接，无文档';
        }
        
        const layerPart = layer 
            ? ` | 选中: "${layer.name}" (${layer.type})`
            : ' | 无选中图层';
        
        return `PS: ${doc.name} (${doc.width}×${doc.height})${layerPart}`;
    }
}

// ==================== 单例导出 ====================

let contextServiceInstance: ContextService | null = null;

export function getContextService(): ContextService {
    if (!contextServiceInstance) {
        contextServiceInstance = new ContextService();
    }
    return contextServiceInstance;
}

export default ContextService;
