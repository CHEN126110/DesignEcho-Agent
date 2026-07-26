/**
 * Detail page template parser for UXP side.
 * Parses top-level screens and placeholder layers for the Agent pipeline.
 */

import { app } from 'photoshop';
import {
    type BoundingBox,
    toNumber,
    getBounds as getLayerBoundsUtil,
    normalizeKind,
    isGroup,
    isTextLayer,
    isVectorLike,
    isImageLike
} from './layer-utils';

type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon';
type LayerZone = 'copy' | 'icon' | 'image' | 'unknown';
type ScreenType = string;

interface ScreenTypeConfig {
    type: ScreenType;
    namePatterns: RegExp[];
    keywords: string[];
    recommendedAssetType: AssetType;
}

interface CopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    bounds: BoundingBox;
    role: 'title' | 'subtitle' | 'body' | 'label' | 'unknown';
    fontSize: number;
    fontFamily?: string;
    maxWidth?: number;
    zone?: LayerZone;
}

interface ImagePlaceholder {
    layerId: number;
    layerName: string;
    baseLayerId?: number;
    baseLayerName?: string;
    bounds: BoundingBox;
    isClippingMask: boolean;
    clippingInfo?: {
        isClipped: boolean;
        baseLayerId: number;
        baseBounds: BoundingBox;
    };
    recommendedAssetType: AssetType;
    aspectRatio: number;
    zone?: LayerZone;
}

interface IconPlaceholder {
    layerId: number;
    layerName: string;
    bounds: BoundingBox;
    size: { width: number; height: number };
    isVector: boolean;
    zone?: LayerZone;
}

interface ParsedScreen {
    id: number;
    name: string;
    type: ScreenType;
    typeConfidence: number;
    index: number;
    bounds: BoundingBox;
    visible: boolean;
    copyPlaceholders: CopyPlaceholder[];
    imagePlaceholders: ImagePlaceholder[];
    iconPlaceholders: IconPlaceholder[];
    structure?: {
        hasCopyGroup: boolean;
        hasIconGroup: boolean;
        hasImageGroup: boolean;
        missingGroups: Array<'文案' | 'icon' | '图片'>;
        recognizedGroups: string[];
    };
}

/** 跨屏/全局图层标记 */
interface CrossScreenLayer {
    layerId: number;
    layerName: string;
    layerType: 'text' | 'image' | 'icon' | 'other';
    bounds: BoundingBox;
    /** 该图层覆盖的屏索引列表 */
    overlappingScreens: number[];
    /** 标记类型 */
    tag: 'crossScreen' | 'globalBackground';
}

interface LayerIssue {
    type: string;
    severity: 'critical' | 'warning' | 'info';
    layerId: number;
    layerName: string;
    screenIndex?: number;
    description: string;
    autoFixable: boolean;
    suggestedFix?: string;
    fixParams?: Record<string, any>;
}

interface TemplateParseResult {
    success: boolean;
    status?: 'parsed' | 'no_active_document' | 'document_role_mismatch';
    error?: string;
    documentName: string;
    documentSize: { width: number; height: number };
    screenCount: number;
    screens: ParsedScreen[];
    issues: LayerIssue[];
    /** 跨屏图层和全文档背景图层（不归入任何单屏） */
    crossScreenLayers: CrossScreenLayer[];
    parseTime: number;
}

const ICON_SIZE_THRESHOLD = 120;

const SCREEN_TYPE_CONFIGS: ScreenTypeConfig[] = [
    { type: 'A_营销信息', namePatterns: [/营销/i, /活动/i, /优惠/i, /促销/i], keywords: ['营销', '活动', '优惠'], recommendedAssetType: 'scene' },
    { type: 'B_信任状', namePatterns: [/信任/i, /背书/i, /品牌/i, /认证/i, /品牌背书/i], keywords: ['品牌', '认证', '资质', '背书'], recommendedAssetType: 'icon' },
    { type: 'C_详情页首屏', namePatterns: [/首屏/i, /hero/i, /主视觉/i, /核心/i, /卖点/i], keywords: ['首屏', '卖点', '核心'], recommendedAssetType: 'product' },
    { type: 'D_图标icon', namePatterns: [/icon/i, /图标/i, /图标卖点/i], keywords: ['icon', '图标', '辅助'], recommendedAssetType: 'icon' },
    { type: 'E_KV图_调性', namePatterns: [/kv/i, /氛围/i, /banner/i, /调性/i], keywords: ['kv', '氛围', '调性'], recommendedAssetType: 'scene' },
    { type: 'F_颜色款式展示', namePatterns: [/颜色/i, /款式/i, /color/i], keywords: ['颜色', '款式'], recommendedAssetType: 'product' },
    { type: 'G_面料', namePatterns: [/面料/i, /材质/i, /fabric/i, /材质面料/i], keywords: ['面料', '材质', '纤维'], recommendedAssetType: 'detail' },
    { type: 'H_解决痛点', namePatterns: [/痛点/i, /问题/i, /解决/i], keywords: ['痛点', '解决'], recommendedAssetType: 'detail' },
    { type: 'I_穿搭推荐', namePatterns: [/穿搭/i, /搭配/i, /outfit/i], keywords: ['穿搭', '搭配'], recommendedAssetType: 'model' },
    { type: 'J_细节展示', namePatterns: [/细节/i, /工艺/i, /detail/i], keywords: ['细节', '工艺'], recommendedAssetType: 'detail' },
    { type: 'K_产品参数', namePatterns: [/参数/i, /规格/i, /尺码/i, /信息表/i], keywords: ['参数', '规格', '数据'], recommendedAssetType: 'product' },
    { type: 'L_模特实拍', namePatterns: [/模特/i, /实拍/i, /model/i], keywords: ['模特', '实拍'], recommendedAssetType: 'model' },
    { type: 'M_售后服务', namePatterns: [/售后/i, /服务/i, /保障/i], keywords: ['售后', '服务'], recommendedAssetType: 'icon' }
];

function getRoleByName(layerName: string): CopyPlaceholder['role'] {
    const name = layerName.toLowerCase();
    if (/副标题|subtitle/.test(name)) return 'subtitle';
    if (/标题|title/.test(name)) return 'title';
    if (/正文|描述|卖点|detail|body/.test(name)) return 'body';
    if (/标签|价格|price|label/.test(name)) return 'label';
    return 'unknown';
}

function resolveZone(layerName: string, parentZone: LayerZone): LayerZone {
    const name = String(layerName || '').toLowerCase();
    if (/文案|text|copy|title|subtitle/.test(name)) return 'copy';
    if (/icon|图标|装饰|element|辅助/.test(name)) return 'icon';
    if (/图片|image|photo|product|主图|素材|背景|kv/.test(name)) return 'image';
    return parentZone;
}

interface ScreenLayerCandidate {
    layer: any;
    source: 'root' | 'detailContainer';
    containerLayer?: any;
}

type DesignDocumentRole = 'detailPage' | 'sku' | 'mainImage' | 'unknown';

function inferDesignDocumentRoleFromName(documentName: string): DesignDocumentRole {
    const name = String(documentName || '').trim().toLowerCase();
    if (!name) return 'unknown';

    if (/详情页|商品详情|detail\s*page|detail-page|product\s*detail/.test(name)) {
        return 'detailPage';
    }

    if (/(^|[^a-z0-9])sku([^a-z0-9]|$)|色卡|组合图|规格图|套装|自选/.test(name)) {
        return 'sku';
    }

    if (/主图|点击图|转化图|main\s*image|main-image|hero\s*image/.test(name)) {
        return 'mainImage';
    }

    return 'unknown';
}

function getDetailPageRoleMismatchMessage(documentName: string, role: DesignDocumentRole): string {
    const label = role === 'sku'
        ? 'SKU'
        : role === 'mainImage'
            ? '主图'
            : '未知';
    return `当前 Photoshop 文档「${documentName || '未命名文档'}」按名称识别为${label}文档，不是详情页文档。请切换到名称包含「详情页」的文档后再解析详情页模板。`;
}

export class DetailPageParser {
    async parse(): Promise<TemplateParseResult> {
        const startTime = Date.now();
        const doc = app.activeDocument;

        if (!doc) {
            return {
                success: false,
                status: 'no_active_document',
                error: 'Photoshop 当前没有打开文档。',
                documentName: '',
                documentSize: { width: 0, height: 0 },
                screenCount: 0,
                screens: [],
                issues: [],
                crossScreenLayers: [],
                parseTime: 0
            };
        }

        const screens: ParsedScreen[] = [];
        const issues: LayerIssue[] = [];
        const documentName = String(doc.name || '');
        const docWidth = toNumber(doc.width);
        const docHeight = toNumber(doc.height);
        const documentRole = inferDesignDocumentRoleFromName(documentName);

        if (documentRole === 'sku' || documentRole === 'mainImage') {
            const error = getDetailPageRoleMismatchMessage(documentName, documentRole);
            issues.push({
                type: 'document_role_mismatch',
                severity: 'critical',
                layerId: Number((doc as any)?.id || 0),
                layerName: documentName,
                description: error,
                autoFixable: false,
                suggestedFix: '切换到详情页文档，或先创建/打开名称包含「详情页」的详情页模板文档。'
            });
            return {
                success: false,
                status: 'document_role_mismatch',
                error,
                documentName,
                documentSize: { width: docWidth, height: docHeight },
                screenCount: 0,
                screens: [],
                issues,
                crossScreenLayers: [],
                parseTime: Date.now() - startTime
            };
        }

        let screenIndex = 0;

        // Phase 1: 按详情页屏组解析每屏。
        // 兼容两种模板：顶层组即屏，或顶层「详情页」容器下的二级组才是屏。
        const orphanLayers: any[] = []; // 不在任何组内的根级图层
        for (const layer of doc.layers || []) {
            if (!isGroup(layer)) {
                // 收集根级孤立图层（文字/图片），后面按视觉位置归入屏
                if (layer.visible !== false) {
                    orphanLayers.push(layer);
                }
            }
        }

        const screenCandidates = this.collectScreenCandidates(doc.layers || [], issues);
        for (const candidate of screenCandidates) {
            try {
                const screen = this.parseScreen(candidate.layer, screenIndex, issues, docWidth, docHeight, candidate);
                screens.push(screen);
                screenIndex += 1;
            } catch (error: any) {
                issues.push({
                    type: 'invalid_structure',
                    severity: 'warning',
                    layerId: Number(candidate.layer?.id || 0),
                    layerName: String(candidate.layer?.name || 'unknown'),
                    screenIndex,
                    description: `parse failed: ${error?.message || 'unknown error'}`,
                    autoFixable: false
                });
            }
        }

        const crossScreenLayers: CrossScreenLayer[] = [];

        // Phase 2: 校验占位符视觉归属 + 回收跨组图层 + 跨屏/全局标记
        if (screens.length > 0) {
            this.reassignByVisualBounds(screens, orphanLayers, issues, crossScreenLayers, docWidth, docHeight);
        }

        return {
            success: true,
            status: 'parsed',
            documentName,
            documentSize: { width: docWidth, height: docHeight },
            screenCount: screens.length,
            screens,
            issues,
            crossScreenLayers,
            parseTime: Date.now() - startTime
        };
    }

    private collectScreenCandidates(rootLayers: any[], issues: LayerIssue[]): ScreenLayerCandidate[] {
        const rootGroups = (rootLayers || [])
            .filter((layer) => isGroup(layer) && layer?.visible !== false);
        const detailContainers = rootGroups
            .map((layer) => ({
                layer,
                children: this.getDirectScreenGroups(layer)
            }))
            .filter((item) => this.isDetailPageContainer(item.layer) && item.children.length >= 2)
            .sort((a, b) => b.children.length - a.children.length);

        const selectedContainer = detailContainers[0];
        if (selectedContainer) {
            issues.push({
                type: 'detail_container_detected',
                severity: 'info',
                layerId: Number(selectedContainer.layer?.id || 0),
                layerName: String(selectedContainer.layer?.name || '详情页'),
                description: `检测到「${String(selectedContainer.layer?.name || '详情页')}」为详情页容器，使用其 ${selectedContainer.children.length} 个子组作为实际屏。`,
                autoFixable: false
            });
            return selectedContainer.children.map((layer) => ({
                layer,
                source: 'detailContainer',
                containerLayer: selectedContainer.layer
            }));
        }

        return rootGroups.map((layer) => ({
            layer,
            source: 'root'
        }));
    }

    private getDirectScreenGroups(container: any): any[] {
        return (Array.isArray(container?.layers) ? container.layers : [])
            .filter((layer: any) => isGroup(layer) && layer?.visible !== false && this.isLikelyScreenGroup(layer));
    }

    private isDetailPageContainer(layer: any): boolean {
        const name = String(layer?.name || '').toLowerCase();
        return /详情页|detail\s*page|detail-page/.test(name);
    }

    private isLikelyScreenGroup(layer: any): boolean {
        const name = String(layer?.name || '').trim();
        const children = Array.isArray(layer?.layers) ? layer.layers : [];
        const childGroupNames = children
            .filter((child: any) => isGroup(child))
            .map((child: any) => String(child?.name || ''));
        const hasRoleGroup = childGroupNames.some((childName) => /文案|copy|text|图片|image|photo|图标|icon/i.test(childName));
        const hasScreenNumber = /^\s*\d+(\s*[-_.、]|$)/.test(name);
        const hasDetailRoleName = /首屏|营销|品牌|背书|利益点|材质|参数|颜色|款式|售后|详情|产品|kv|icon/i.test(name);
        return hasRoleGroup || hasScreenNumber || hasDetailRoleName;
    }

    private parseScreen(
        groupLayer: any,
        index: number,
        issues: LayerIssue[],
        docWidth: number,
        docHeight: number,
        candidate?: ScreenLayerCandidate
    ): ParsedScreen {
        const copyPlaceholders: CopyPlaceholder[] = [];
        const imagePlaceholders: ImagePlaceholder[] = [];
        const iconPlaceholders: IconPlaceholder[] = [];

        const directChildren = Array.isArray(groupLayer.layers) ? groupLayer.layers : [];
        const structure = this.analyzeScreenGroups(directChildren);

        this.traverseLayers(directChildren, {
            parentZone: 'unknown',
            onTextLayer: (layer: any, zone: LayerZone) => {
                copyPlaceholders.push(this.parseTextLayer(layer, zone));
            },
            onClippingBase: (baseLayer: any, clippedLayer: any, zone: LayerZone) => {
                imagePlaceholders.push(this.parseImagePlaceholder(clippedLayer, baseLayer, zone));
            },
            onSmallShape: (layer: any, zone: LayerZone) => {
                iconPlaceholders.push(this.parseIconPlaceholder(layer, zone));
            },
            onImageLayer: (layer: any, zone: LayerZone) => {
                imagePlaceholders.push(this.parseImagePlaceholder(layer, null, zone));
            }
        });

        const validCopyPlaceholders = this.filterCopyPlaceholders(copyPlaceholders, groupLayer, index, issues);
        const validImagePlaceholders = this.filterImagePlaceholders(imagePlaceholders, groupLayer, index, issues);
        const validIconPlaceholders = this.filterIconPlaceholders(iconPlaceholders, groupLayer, index, issues);

        const guessed = this.guessScreenType(groupLayer.name || '', validCopyPlaceholders, validImagePlaceholders, validIconPlaceholders);
        const rawBounds = this.getBounds(groupLayer);
        const bounds = this.getStableScreenBounds(groupLayer, rawBounds, index, issues, docWidth, docHeight, candidate);

        return {
            id: Number(groupLayer.id || 0),
            name: String(groupLayer.name || `Screen_${index + 1}`),
            type: guessed.type,
            typeConfidence: guessed.confidence,
            index,
            bounds,
            visible: groupLayer.visible !== false,
            copyPlaceholders: validCopyPlaceholders,
            imagePlaceholders: validImagePlaceholders,
            iconPlaceholders: validIconPlaceholders,
            structure
        };
    }

    private filterCopyPlaceholders(
        placeholders: CopyPlaceholder[],
        screenLayer: any,
        screenIndex: number,
        issues: LayerIssue[]
    ): CopyPlaceholder[] {
        return placeholders.filter((placeholder) => this.keepPlaceholderBounds(
            placeholder.bounds,
            placeholder.layerId,
            placeholder.layerName,
            'copy',
            screenLayer,
            screenIndex,
            issues
        ));
    }

    private filterImagePlaceholders(
        placeholders: ImagePlaceholder[],
        screenLayer: any,
        screenIndex: number,
        issues: LayerIssue[]
    ): ImagePlaceholder[] {
        return placeholders.filter((placeholder) => this.keepPlaceholderBounds(
            placeholder.bounds,
            placeholder.layerId,
            placeholder.layerName,
            'image',
            screenLayer,
            screenIndex,
            issues
        ));
    }

    private filterIconPlaceholders(
        placeholders: IconPlaceholder[],
        screenLayer: any,
        screenIndex: number,
        issues: LayerIssue[]
    ): IconPlaceholder[] {
        return placeholders.filter((placeholder) => this.keepPlaceholderBounds(
            placeholder.bounds,
            placeholder.layerId,
            placeholder.layerName,
            'icon',
            screenLayer,
            screenIndex,
            issues
        ));
    }

    private keepPlaceholderBounds(
        bounds: BoundingBox,
        layerId: number,
        layerName: string,
        layerType: 'copy' | 'image' | 'icon',
        screenLayer: any,
        screenIndex: number,
        issues: LayerIssue[]
    ): boolean {
        if (this.hasUsableBounds(bounds)) return true;
        issues.push({
            type: 'empty_or_invalid_layer_bounds',
            severity: 'warning',
            layerId,
            layerName,
            screenIndex,
            description: `${layerType} 图层「${layerName}」在「${String(screenLayer?.name || '')}」中没有有效 bounds，已从占位解析中排除，避免污染屏范围。`,
            autoFixable: false
        });
        return false;
    }

    private getStableScreenBounds(
        groupLayer: any,
        rawBounds: BoundingBox,
        screenIndex: number,
        issues: LayerIssue[],
        docWidth: number,
        docHeight: number,
        candidate?: ScreenLayerCandidate
    ): BoundingBox {
        const contentBounds = this.getRenderableContentBounds(groupLayer);
        if (!contentBounds) {
            if (!this.hasUsableBounds(rawBounds)) {
                issues.push({
                    type: 'screen_bounds_missing',
                    severity: 'warning',
                    layerId: Number(groupLayer?.id || 0),
                    layerName: String(groupLayer?.name || ''),
                    screenIndex,
                    description: `屏组「${String(groupLayer?.name || '')}」没有有效可渲染内容 bounds。`,
                    autoFixable: false
                });
            }
            return rawBounds;
        }

        if (!this.hasUsableBounds(rawBounds)) {
            issues.push({
                type: 'screen_bounds_from_content',
                severity: 'warning',
                layerId: Number(groupLayer?.id || 0),
                layerName: String(groupLayer?.name || ''),
                screenIndex,
                description: `屏组「${String(groupLayer?.name || '')}」自身 bounds 无效，已按有效内容 bounds 解析。`,
                autoFixable: false
            });
            return contentBounds;
        }

        const rawArea = rawBounds.width * rawBounds.height;
        const contentArea = contentBounds.width * contentBounds.height;
        const docArea = Math.max(1, docWidth * docHeight);
        const outlierTopDelta = contentBounds.top - rawBounds.top;
        const outlierBottomDelta = rawBounds.bottom - contentBounds.bottom;
        const pollutedByOutlier =
            candidate?.source === 'detailContainer'
            && rawArea > contentArea * 1.8
            && rawArea > docArea * 0.18
            && (
                outlierTopDelta > Math.max(160, docHeight * 0.025)
                || outlierBottomDelta > Math.max(160, docHeight * 0.025)
            );

        if (pollutedByOutlier) {
            issues.push({
                type: 'screen_bounds_repaired',
                severity: 'warning',
                layerId: Number(groupLayer?.id || 0),
                layerName: String(groupLayer?.name || ''),
                screenIndex,
                description: `屏组「${String(groupLayer?.name || '')}」的结构 bounds 疑似被空图层或异常位置图层污染，已按非空可渲染内容 bounds 解析。原 bounds=${this.formatBounds(rawBounds)}，修正 bounds=${this.formatBounds(contentBounds)}。`,
                autoFixable: false
            });
            return contentBounds;
        }

        return rawBounds;
    }

    private getRenderableContentBounds(layer: any): BoundingBox | null {
        const boundsList: BoundingBox[] = [];
        this.collectRenderableBounds(layer, boundsList);
        if (boundsList.length === 0) return null;

        const left = Math.min(...boundsList.map((bounds) => bounds.left));
        const top = Math.min(...boundsList.map((bounds) => bounds.top));
        const right = Math.max(...boundsList.map((bounds) => bounds.right));
        const bottom = Math.max(...boundsList.map((bounds) => bounds.bottom));

        return {
            left,
            top,
            right,
            bottom,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top)
        };
    }

    private collectRenderableBounds(layer: any, boundsList: BoundingBox[]): void {
        const children = Array.isArray(layer?.layers) ? layer.layers : [];
        if (children.length > 0) {
            for (const child of children) {
                if (child?.visible === false) continue;
                this.collectRenderableBounds(child, boundsList);
            }
            return;
        }

        const bounds = this.getBounds(layer);
        if (this.hasUsableBounds(bounds)) {
            boundsList.push(bounds);
        }
    }

    private hasUsableBounds(bounds?: BoundingBox | null): bounds is BoundingBox {
        return !!bounds
            && Number.isFinite(bounds.left)
            && Number.isFinite(bounds.top)
            && Number.isFinite(bounds.right)
            && Number.isFinite(bounds.bottom)
            && bounds.width > 0
            && bounds.height > 0;
    }

    private formatBounds(bounds: BoundingBox): string {
        return `${Math.round(bounds.left)},${Math.round(bounds.top)},${Math.round(bounds.right)},${Math.round(bounds.bottom)}`;
    }

    private analyzeScreenGroups(layers: any[]): ParsedScreen['structure'] {
        const directGroups = (layers || [])
            .filter((layer) => isGroup(layer));
        const names = directGroups
            .map((layer) => String(layer?.name || ''));

        const hasCopyGroup = names.some((name) => /文案|text|copy|title|subtitle/i.test(name));
        const hasIconGroup = names.some((name) => /icon|图标|辅助|element/i.test(name));
        const hasImageGroup = names.some((name) => /图片|image|photo|主图|素材|kv|背景/i.test(name));

        const missingGroups: Array<'文案' | 'icon' | '图片'> = [];
        if (!hasCopyGroup) missingGroups.push('文案');
        if (!hasIconGroup) missingGroups.push('icon');
        if (!hasImageGroup) missingGroups.push('图片');

        return {
            hasCopyGroup,
            hasIconGroup,
            hasImageGroup,
            missingGroups,
            recognizedGroups: names
        };
    }

    private traverseLayers(
        layers: any[],
        handlers: {
            parentZone: LayerZone;
            onTextLayer: (layer: any, zone: LayerZone) => void;
            onClippingBase: (baseLayer: any, clippedLayer: any, zone: LayerZone) => void;
            onSmallShape: (layer: any, zone: LayerZone) => void;
            onImageLayer: (layer: any, zone: LayerZone) => void;
        }
    ): void {
        for (let i = 0; i < (layers || []).length; i++) {
            const layer = layers[i];
            const currentZone = resolveZone(String(layer?.name || ''), handlers.parentZone);

            if (isGroup(layer)) {
                this.traverseLayers(layer.layers || [], { ...handlers, parentZone: currentZone });
                continue;
            }

            if (isTextLayer(layer)) {
                handlers.onTextLayer(layer, currentZone);
                continue;
            }

            if (isVectorLike(layer) && this.isSmallShape(layer)) {
                handlers.onSmallShape(layer, currentZone);
                continue;
            }

            if (isImageLike(layer)) {
                if (layer.clipped) {
                    const baseLayer = this.findClippingBase(layers, i);
                    if (baseLayer) {
                        handlers.onClippingBase(baseLayer, layer, currentZone);
                        continue;
                    }
                }
                handlers.onImageLayer(layer, currentZone);
            }
        }
    }

    private findClippingBase(layers: any[], clippedIndex: number): any | null {
        for (let i = clippedIndex + 1; i < layers.length; i++) {
            const candidate = layers[i];
            if (!candidate?.clipped) {
                return candidate;
            }
        }
        return null;
    }

    private parseTextLayer(layer: any, zone: LayerZone): CopyPlaceholder {
        const bounds = this.getBounds(layer);
        const text = String(layer?.textItem?.contents || layer?.text || layer?.name || '').trim();
        const fontSize = toNumber(layer?.textItem?.characterStyle?.size) || 16;
        const fontFamily = String(layer?.textItem?.characterStyle?.font || '').trim() || undefined;

        return {
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || 'Text'),
            currentText: text,
            bounds,
            role: getRoleByName(String(layer?.name || '')),
            fontSize,
            fontFamily,
            maxWidth: bounds.width,
            zone
        };
    }

    private parseImagePlaceholder(layer: any, baseLayer: any | null, zone: LayerZone): ImagePlaceholder {
        const bounds = this.getBounds(layer);
        const aspectRatio = bounds.height > 0 ? bounds.width / bounds.height : 1;
        const recommended = this.recommendAssetType(layer.name || '', zone);

        const baseBounds = baseLayer ? this.getBounds(baseLayer) : undefined;

        return {
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || 'Image'),
            baseLayerId: baseLayer ? Number(baseLayer.id || 0) : undefined,
            baseLayerName: baseLayer ? String(baseLayer.name || '') : undefined,
            bounds,
            isClippingMask: !!layer?.clipped,
            clippingInfo: layer?.clipped && baseLayer
                ? {
                    isClipped: true,
                    baseLayerId: Number(baseLayer.id || 0),
                    baseBounds: baseBounds || bounds
                }
                : undefined,
            recommendedAssetType: recommended,
            aspectRatio,
            zone
        };
    }

    private parseIconPlaceholder(layer: any, zone: LayerZone): IconPlaceholder {
        const bounds = this.getBounds(layer);
        return {
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || 'Icon'),
            bounds,
            size: { width: bounds.width, height: bounds.height },
            isVector: true,
            zone
        };
    }

    private recommendAssetType(layerName: string, zone: LayerZone): AssetType {
        const name = String(layerName || '').toLowerCase();
        if (zone === 'icon' || /icon|图标/.test(name)) return 'icon';
        if (/model|模特/.test(name)) return 'model';
        if (/detail|细节|close/.test(name)) return 'detail';
        if (/scene|场景|背景|kv/.test(name)) return 'scene';
        return 'product';
    }

    private guessScreenType(
        groupName: string,
        copies: CopyPlaceholder[],
        images: ImagePlaceholder[],
        icons: IconPlaceholder[]
    ): { type: ScreenType; confidence: number } {
        const lowerName = String(groupName || '').toLowerCase();
        const scored = SCREEN_TYPE_CONFIGS.map((cfg) => {
            let score = 0;

            for (const re of cfg.namePatterns) {
                if (re.test(lowerName)) score += 50;
            }
            for (const kw of cfg.keywords) {
                if (lowerName.includes(kw.toLowerCase())) score += 15;
            }
            if (cfg.recommendedAssetType === 'icon' && icons.length > images.length) score += 20;
            if (cfg.recommendedAssetType === 'scene' && images.length > 0 && copies.length <= 2) score += 10;

            return { type: cfg.type, score };
        }).sort((a, b) => b.score - a.score);

        const top = scored[0];
        if (!top || top.score <= 0) {
            return { type: 'CUSTOM', confidence: 0.4 };
        }

        return {
            type: top.type,
            confidence: Math.min(0.98, Math.max(0.5, top.score / 100))
        };
    }

    private isSmallShape(layer: any): boolean {
        if (!isVectorLike(layer)) return false;
        const bounds = this.getBounds(layer);
        return bounds.width <= ICON_SIZE_THRESHOLD && bounds.height <= ICON_SIZE_THRESHOLD;
    }

    private getBounds(layer: any): BoundingBox {
        return getLayerBoundsUtil(layer);
    }

    /**
     * Phase 2: 视觉归属校验 + 孤立图层回收 + 跨屏/全局标记
     *
     * 问题：图层面板中的组归属 ≠ 视觉上的位置归属
     * - 文字在「屏2」组里，但 bounds 实际落在「屏1」的可视区域
     * - 文字/图片在根级（不在任何组内），但视觉上属于某一屏
     * - 图层 bounds 横跨多屏（装饰条、全文档背景）
     *
     * 解决：用 bounds 的垂直中心点判断视觉归属，标记跨屏/全局图层
     */
    private reassignByVisualBounds(
        screens: ParsedScreen[],
        orphanLayers: any[],
        issues: LayerIssue[],
        crossScreenLayers: CrossScreenLayer[],
        docWidth: number,
        docHeight: number
    ): void {
        // 1. 校验已分配的占位符是否在所属屏的 bounds 内
        for (const screen of screens) {
            const sb = screen.bounds;

            // 检查文案占位符
            const misplacedCopies: CopyPlaceholder[] = [];
            screen.copyPlaceholders = screen.copyPlaceholders.filter(cp => {
                if (this.isInsideScreen(cp.bounds, sb)) return true;
                misplacedCopies.push(cp);
                return false;
            });

            // 检查图片占位符
            const misplacedImages: ImagePlaceholder[] = [];
            screen.imagePlaceholders = screen.imagePlaceholders.filter(ip => {
                if (this.isInsideScreen(ip.bounds, sb)) return true;
                misplacedImages.push(ip);
                return false;
            });

            // 检查图标占位符
            const misplacedIcons: IconPlaceholder[] = [];
            screen.iconPlaceholders = screen.iconPlaceholders.filter(ic => {
                if (this.isInsideScreen(ic.bounds, sb)) return true;
                misplacedIcons.push(ic);
                return false;
            });

            // 将误归属的占位符重新分配到正确的屏
            for (const cp of misplacedCopies) {
                const target = this.findScreenByBounds(screens, cp.bounds);
                if (target && target.id !== screen.id) {
                    target.copyPlaceholders.push(cp);
                    issues.push({
                        type: 'cross_group_reassign',
                        severity: 'info',
                        layerId: cp.layerId,
                        layerName: cp.layerName,
                        screenIndex: screen.index,
                        description: `文案图层「${cp.layerName}」图层结构在「${screen.name}」组内，但视觉位置落在「${target.name}」区域，已按视觉位置重新归属`,
                        autoFixable: false
                    });
                }
            }
            for (const ip of misplacedImages) {
                // 检查是否跨多屏
                const overlapping = this.findOverlappingScreens(screens, ip.bounds);
                if (this.isGlobalBackground(ip.bounds, docWidth, docHeight)) {
                    crossScreenLayers.push({
                        layerId: ip.layerId,
                        layerName: ip.layerName,
                        layerType: 'image',
                        bounds: ip.bounds,
                        overlappingScreens: overlapping.map(s => s.index),
                        tag: 'globalBackground'
                    });
                    issues.push({
                        type: 'global_background',
                        severity: 'info',
                        layerId: ip.layerId,
                        layerName: ip.layerName,
                        screenIndex: screen.index,
                        description: `图片图层「${ip.layerName}」覆盖几乎整个文档（bounds ≈ 文档大小），标记为全局背景层`,
                        autoFixable: false
                    });
                    continue;
                }
                if (overlapping.length > 1) {
                    crossScreenLayers.push({
                        layerId: ip.layerId,
                        layerName: ip.layerName,
                        layerType: 'image',
                        bounds: ip.bounds,
                        overlappingScreens: overlapping.map(s => s.index),
                        tag: 'crossScreen'
                    });
                    // 归入主要重叠屏（重叠面积最大的屏）
                    const primary = this.findPrimaryOverlapScreen(overlapping, ip.bounds);
                    if (primary) {
                        primary.imagePlaceholders.push(ip);
                    }
                    issues.push({
                        type: 'cross_screen',
                        severity: 'info',
                        layerId: ip.layerId,
                        layerName: ip.layerName,
                        screenIndex: screen.index,
                        description: `图片图层「${ip.layerName}」横跨${overlapping.length}个屏（${overlapping.map(s => s.name).join('、')}），已归入主要重叠屏「${primary?.name || '未知'}」`,
                        autoFixable: false
                    });
                    continue;
                }
                const target = this.findScreenByBounds(screens, ip.bounds);
                if (target && target.id !== screen.id) {
                    target.imagePlaceholders.push(ip);
                    issues.push({
                        type: 'cross_group_reassign',
                        severity: 'info',
                        layerId: ip.layerId,
                        layerName: ip.layerName,
                        screenIndex: screen.index,
                        description: `图片图层「${ip.layerName}」图层结构在「${screen.name}」组内，但视觉位置落在「${target.name}」区域，已按视觉位置重新归属`,
                        autoFixable: false
                    });
                }
            }
            for (const ic of misplacedIcons) {
                const target = this.findScreenByBounds(screens, ic.bounds);
                if (target && target.id !== screen.id) {
                    target.iconPlaceholders.push(ic);
                    issues.push({
                        type: 'cross_group_reassign',
                        severity: 'info',
                        layerId: ic.layerId,
                        layerName: ic.layerName,
                        screenIndex: screen.index,
                        description: `图标图层「${ic.layerName}」图层结构在「${screen.name}」组内，但视觉位置落在「${target.name}」区域，已按视觉位置重新归属`,
                        autoFixable: false
                    });
                }
            }
        }

        // 2. 回收根级孤立图层
        for (const layer of orphanLayers) {
            const bounds = this.getBounds(layer);

            // 检查是否为全文档背景层
            if (isImageLike(layer) && this.isGlobalBackground(bounds, docWidth, docHeight)) {
                crossScreenLayers.push({
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || ''),
                    layerType: 'image',
                    bounds,
                    overlappingScreens: screens.map(s => s.index),
                    tag: 'globalBackground'
                });
                issues.push({
                    type: 'global_background',
                    severity: 'info',
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || ''),
                    description: `根级图层「${layer.name}」覆盖几乎整个文档，标记为全局背景层，不归入任何屏`,
                    autoFixable: false
                });
                continue;
            }

            // 检查是否跨多屏
            const overlapping = this.findOverlappingScreens(screens, bounds);
            if (overlapping.length > 1 && isImageLike(layer)) {
                crossScreenLayers.push({
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || ''),
                    layerType: 'image',
                    bounds,
                    overlappingScreens: overlapping.map(s => s.index),
                    tag: 'crossScreen'
                });
                const primary = this.findPrimaryOverlapScreen(overlapping, bounds);
                if (primary) {
                    primary.imagePlaceholders.push(this.parseImagePlaceholder(layer, null, 'unknown'));
                }
                issues.push({
                    type: 'cross_screen',
                    severity: 'info',
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || ''),
                    description: `根级图层「${layer.name}」横跨${overlapping.length}个屏，已归入主要重叠屏「${primary?.name || '未知'}」`,
                    autoFixable: false
                });
                continue;
            }

            // 单屏归属
            const target = this.findScreenByBounds(screens, bounds);
            if (!target) continue;

            if (isTextLayer(layer)) {
                target.copyPlaceholders.push(this.parseTextLayer(layer, 'unknown'));
                issues.push({
                    type: 'orphan_reclaimed',
                    severity: 'info',
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || ''),
                    description: `根级文案图层「${layer.name}」不在任何屏组内，已按视觉位置归入「${target.name}」`,
                    autoFixable: false
                });
            } else if (isImageLike(layer)) {
                target.imagePlaceholders.push(this.parseImagePlaceholder(layer, null, 'unknown'));
                issues.push({
                    type: 'orphan_reclaimed',
                    severity: 'info',
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || ''),
                    description: `根级图片图层「${layer.name}」不在任何屏组内，已按视觉位置归入「${target.name}」`,
                    autoFixable: false
                });
            } else if (isVectorLike(layer) && this.isSmallShape(layer)) {
                target.iconPlaceholders.push(this.parseIconPlaceholder(layer, 'unknown'));
                issues.push({
                    type: 'orphan_reclaimed',
                    severity: 'info',
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || ''),
                    description: `根级图标图层「${layer.name}」不在任何屏组内，已按视觉位置归入「${target.name}」`,
                    autoFixable: false
                });
            }
        }
    }

    /**
     * 判断一个元素的 bounds 是否视觉上属于某屏
     * 用垂直中心点判断（详情页是竖向排列，垂直位置是关键）
     */
    private isInsideScreen(elementBounds: BoundingBox, screenBounds: BoundingBox): boolean {
        if (!this.hasUsableBounds(elementBounds) || !this.hasUsableBounds(screenBounds)) {
            return false;
        }
        const centerY = elementBounds.top + elementBounds.height / 2;
        // 允许 20% 的溢出容差（设计元素经常稍微超出组边界）
        const tolerance = screenBounds.height * 0.2;
        return centerY >= (screenBounds.top - tolerance) && centerY <= (screenBounds.bottom + tolerance);
    }

    /**
     * 根据元素 bounds 找到视觉上最匹配的屏
     */
    private findScreenByBounds(screens: ParsedScreen[], elementBounds: BoundingBox): ParsedScreen | null {
        if (!this.hasUsableBounds(elementBounds)) return null;
        const centerY = elementBounds.top + elementBounds.height / 2;
        let best: ParsedScreen | null = null;
        let minDist = Infinity;

        for (const screen of screens) {
            if (!this.hasUsableBounds(screen.bounds)) continue;
            const screenCenterY = screen.bounds.top + screen.bounds.height / 2;
            // 元素中心点在屏的垂直范围内
            if (centerY >= screen.bounds.top && centerY <= screen.bounds.bottom) {
                const dist = Math.abs(centerY - screenCenterY);
                if (dist < minDist) {
                    minDist = dist;
                    best = screen;
                }
            }
        }

        // 如果不在任何屏范围内，找最近的屏
        if (!best) {
            for (const screen of screens) {
                if (!this.hasUsableBounds(screen.bounds)) continue;
                const dist = Math.min(
                    Math.abs(centerY - screen.bounds.top),
                    Math.abs(centerY - screen.bounds.bottom)
                );
                if (dist < minDist) {
                    minDist = dist;
                    best = screen;
                }
            }
        }

        return best;
    }

    /**
     * 查找图层 bounds 覆盖（有显著重叠）的所有屏
     */
    private findOverlappingScreens(screens: ParsedScreen[], elementBounds: BoundingBox): ParsedScreen[] {
        const result: ParsedScreen[] = [];
        if (!this.hasUsableBounds(elementBounds)) return result;
        for (const screen of screens) {
            if (!this.hasUsableBounds(screen.bounds)) continue;
            const overlapTop = Math.max(elementBounds.top, screen.bounds.top);
            const overlapBottom = Math.min(elementBounds.bottom, screen.bounds.bottom);
            const overlapHeight = overlapBottom - overlapTop;
            // 至少重叠该屏 10% 的高度才算覆盖
            if (overlapHeight > screen.bounds.height * 0.1) {
                result.push(screen);
            }
        }
        return result;
    }

    /**
     * 在多个重叠屏中找到主要重叠屏（重叠面积最大）
     */
    private findPrimaryOverlapScreen(screens: ParsedScreen[], elementBounds: BoundingBox): ParsedScreen | null {
        let best: ParsedScreen | null = null;
        let maxOverlap = 0;
        if (!this.hasUsableBounds(elementBounds)) return null;
        for (const screen of screens) {
            if (!this.hasUsableBounds(screen.bounds)) continue;
            const overlapTop = Math.max(elementBounds.top, screen.bounds.top);
            const overlapBottom = Math.min(elementBounds.bottom, screen.bounds.bottom);
            const overlapLeft = Math.max(elementBounds.left, screen.bounds.left);
            const overlapRight = Math.min(elementBounds.right, screen.bounds.right);
            const area = Math.max(0, overlapRight - overlapLeft) * Math.max(0, overlapBottom - overlapTop);
            if (area > maxOverlap) {
                maxOverlap = area;
                best = screen;
            }
        }
        return best;
    }

    /**
     * 检测是否为全文档背景层（bounds ≈ 文档大小）
     * 判定条件：宽度覆盖文档 90%+ 且高度覆盖文档 80%+
     */
    private isGlobalBackground(bounds: BoundingBox, docWidth: number, docHeight: number): boolean {
        if (docWidth <= 0 || docHeight <= 0) return false;
        const widthRatio = bounds.width / docWidth;
        const heightRatio = bounds.height / docHeight;
        return widthRatio >= 0.9 && heightRatio >= 0.8;
    }
}

/**
 * 解析结果缓存：单次完整解析在大 PSB 上要 7-9 秒，而一次详情页执行流会解析 2-4 次、
 * 主进程 detail.* 工具每次调用都独立解析——同文档未变更时全是重复劳动。
 * 缓存键 = 文档 id + 历史状态指针 + 图层总数：任何写操作（填充/修复/手动编辑/undo）
 * 都会推进或回退历史指针，缓存自动失效；图层总数用于覆盖极少数不进历史的变更。
 * 另设 60 秒 TTL 双保险。所有调用方（渲染端工具与主进程 MCP 工具）共用同一 UXP 入口，
 * 缓存放这里一处覆盖全部。
 */
const PARSE_CACHE_TTL_MS = 60000;
let parseCache: { key: string; result: TemplateParseResult; cachedAt: number } | null = null;

function buildParseCacheKey(): string | null {
    try {
        const doc = app.activeDocument;
        if (!doc) return null;
        // 教训一：不要递归遍历图层树——UXP DOM 逐层属性访问是跨进程调用，
        // 实测 143 层文档上比解析本身还慢（曾把「缓存命中」拖到 3 分钟）。
        // 教训二：不要在非 modal 上下文用 batchPlay get——会弹「"获取"命令不可用」
        // 原生对话框阻塞整个 Photoshop（用户实测确认）。
        // activeHistoryState 是同步 DOM 属性，读它既快又不弹窗；
        // 任何写操作/undo 都会换 history state id，缓存自动失效。
        const historyId = (doc as any).activeHistoryState?.id ?? -1;
        return `${doc.id}|n${String(doc.name || '')}|h${historyId}|t${doc.layers.length}`;
    } catch {
        return null;
    }
}

export function invalidateDetailPageParseCache(): void {
    parseCache = null;
}

export class DetailPageParserTool {
    name = 'parseDetailPageTemplate';

    schema = {
        name: 'parseDetailPageTemplate',
        description: 'Parse detail page template into screen and placeholder structure.',
        parameters: {
            type: 'object' as const,
            properties: {
                includeStructure: {
                    type: 'boolean',
                    description: 'Whether to include structure analysis result for each screen.'
                }
            },
            required: [] as string[]
        }
    };

    async execute(_params: { includeStructure?: boolean }): Promise<TemplateParseResult> {
        const cacheKey = buildParseCacheKey();
        if (cacheKey && parseCache
            && parseCache.key === cacheKey
            && Date.now() - parseCache.cachedAt < PARSE_CACHE_TTL_MS) {
            console.log(`[DetailPageParser] 命中解析缓存（${cacheKey}），跳过重复解析`);
            return parseCache.result;
        }

        const parser = new DetailPageParser();
        const result = await parser.parse();
        if (cacheKey && result?.success) {
            parseCache = { key: cacheKey, result, cachedAt: Date.now() };
        }
        return result;
    }
}
