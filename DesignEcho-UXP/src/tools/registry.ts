/**
 * 工具注册表
 * 
 * 管理所有暴露给 Agent 的工具
 */

import { BinaryMaskStore } from '../core/binary-mask-store';
import { Tool, ToolSchema } from './types';
import { GetTextContentTool } from './text/get-text-content';
import { SetTextContentTool } from './text/set-text-content';
import { AuditTextReplacementTool } from './text/audit-text-replacement';
import { GetTextStyleTool } from './text/get-text-style';
import { SetTextStyleTool } from './text/set-text-style';
import { ResolveFontNameTool } from './text/resolve-font-name';
import { GetAllTextLayersTool } from './layout/get-all-text-layers';
import { GetLayerBoundsTool } from './layout/get-layer-bounds';
import { MoveLayerTool } from './layout/move-layer';
import { AlignLayersTool } from './layout/align-layers';
import { DistributeLayersTool } from './layout/distribute-layers';
import { SelectLayerTool } from './layout/select-layer';
import { FocusLayerTool } from './layout/focus-layer';
import { GetLayerHierarchyTool } from './layout/get-layer-hierarchy';
import { FindLayersTool } from './layout/find-layers';
import { CreateClippingMaskTool, ReleaseClippingMaskTool } from './layout/clipping-mask';
import { RenameLayerTool, BatchRenameLayersTool } from './layout/rename-layer';
import { ReorderLayerTool, GroupLayersTool, UngroupLayersTool } from './layout/reorder-layer';
import { MoveLayerToGroupTool } from './layout/move-layer-to-group';
import { GetDocumentInfoTool } from './canvas/get-document-info';
import { GetDocumentSnapshotTool } from './canvas/get-document-snapshot';
import { GetAcceptanceSnapshotTool } from './acceptance/get-acceptance-snapshot';
import { CreateDocumentTool } from './canvas/create-document';
import { UndoTool, RedoTool, GetHistoryInfoTool } from './canvas/undo-redo';
import { DiagnoseStateTool } from './canvas/diagnose-state';
import { SwitchDocumentTool } from './canvas/switch-document';
import { ListDocumentsTool } from './canvas/list-documents';
import { CloseDocumentTool } from './canvas/close-document';
import { SaveDocumentTool, QuickExportTool, BatchExportTool, SmartSaveTool } from './canvas/save-document';
import { GetCanvasSnapshotTool, GetElementMappingTool, AnalyzeLayoutTool } from './canvas/visual-analysis';
import { GetScreenSnapshotsTool, GetScreenSnapshotsWithOverlayTool } from './canvas/screen-snapshot';
import { GetAnnotatedSnapshotTool } from './canvas/get-annotated-snapshot';
import { RemoveBackgroundTool, ApplyMattingResultTool, ApplyMultiMattingResultTool } from './image/remove-background';
import { PlaceImageTool } from './image/place-image';
import { GetSelectionMaskTool, ApplyRasterImageResultTool, GetSelectionBoundsTool } from './image/inpainting';
import { CreateRectangleTool, CreateEllipseTool } from './canvas/create-shape';
import { CropDocumentTool, ResizeCanvasTool, ResizeImageTool } from './canvas/canvas-crop-resize';
import { GaussianBlurLayerTool, CreateLayerMaskTool, DeleteLayerMaskTool } from './layer/blur-and-mask';
import { CreateTextLayerTool } from './text/create-text-layer';
import { CreateGroupTool } from './layout/create-group';
import { TransformLayerTool, QuickScaleTool } from './layer/transform-layer';
import { ReplaceLayerContentTool } from './layer/replace-content';
// 剪切蒙版信息工具（智能布局）
import { GetClippingMaskInfoTool, GetAllClippingMasksTool } from './layer/clipping-mask-info';
// 图层属性工具 (P0)
import { 
    SetLayerOpacityTool,
    SetLayerVisibilityTool, 
    SetBlendModeTool, 
    SetLayerFillTool, 
    DuplicateLayerTool, 
    DeleteLayerTool, 
    LockLayerTool,
    GetLayerPropertiesTool
} from './layer/layer-properties';
// 图层效果工具 (P1)
import {
    AddDropShadowTool,
    AddStrokeTool,
    AddGlowTool,
    AddGradientOverlayTool,
    ClearLayerEffectsTool
} from './layer/layer-effects';
// 调色 / 调整图层工具（非破坏性）
import {
    AddBrightnessContrastAdjustmentTool,
    AddHueSaturationAdjustmentTool,
    AddLevelsAdjustmentTool,
    AddColorBalanceAdjustmentTool,
    AddVibranceAdjustmentTool,
    AddPhotoFilterAdjustmentTool
} from './layer/adjustment-layers';
// 形态变形工具
import { ExtractShapePathTool, GetLayerContourTool, MorphToShapeTool, BatchMorphToShapeTool, ApplyDisplacementTool } from './morphing/tool-classes';
import { ApplyMorphedImageTool } from './morphing/apply-morphed-image';
import { WarpExplorerTool } from './morphing/warp-explorer';
import { WarpLayerTool } from './morphing/warp-layer';
import { AddDodgeBurnLayerTool } from './layer/dodge-burn-layer';
import { ExportLayerAsBase64Tool } from './image/export-layer';
import { ExportGroupTool } from './image/export-group';
import { ExportMainImageDocumentsTool } from './image/export-main-image-docs';
import { ExportWhiteBgFromSkuMaterialTool } from './image/white-bg-from-sku-material';
import { GetSubjectBoundsTool } from './image/get-subject-bounds';
// SKU 排版工具
import { SKULayoutTool } from './layout/sku-layout-tool';
// 智能布局引擎
import { SmartLayoutTool } from './layout/smart-layout-engine';
// 对齐到参考形状工具
import { AlignToReferenceTool } from './layout/align-to-reference';
// 优化图像传输
import { OptimizedImageTransferTool, OptimizedMattingImageTool } from './image/optimized-image-transfer';
// 模板渲染工具
import { 
    OpenTemplateTool, 
    GetTemplateStructureTool, 
    ReplaceImagePlaceholderTool, 
    ReplaceTextPlaceholderTool,
    BatchRenderTemplateTool 
} from './layout/template-tool';
// SKU 配置工具
import { 
    ExportColorConfigTool, 
    CreateSkuPlaceholdersTool, 
    GetSkuPlaceholdersTool,
    ExportToSkuDirTool 
} from './sku';
import { SockLayoutConfigTool } from './sku/sock-layout-config-tool';
// 导出目录服务已简化，使用 getEntryWithUrl 解析项目路径入口，无需工具类
// 详情页设计工具
import { DetailPageParserTool } from './layout/detail-page-parser';
import { LayerRelationDetectorTool } from './layout/layer-relation-detector';
import { AutoFixerTool } from './layout/auto-fixer';
import { DetailPageFillerTool } from './layout/detail-page-filler';
import { SliceExporterTool } from './layout/slice-exporter';
import { AuditDetailPagePlacementTool } from './layout/audit-detail-page-placement';
// 智能对象工具
import {
    GetSmartObjectInfoTool,
    ConvertToSmartObjectTool,
    EditSmartObjectContentsTool,
    ReplaceSmartObjectContentsTool,
    UpdateSmartObjectTool,
    GetSmartObjectLayersTool,
    DuplicateSmartObjectTool,
    RasterizeSmartObjectTool
} from './layer/smart-object-tools';
// 详情页设计工具（新版）已在下方导入：
// - DetailPageParserTool, LayerRelationDetectorTool, AutoFixerTool
// - DetailPageFillerTool, SliceExporterTool

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();
    private mattingBinaryMaskStore: BinaryMaskStore = new BinaryMaskStore();
    
    // 保存特定工具实例的引用（用于二进制传输等场景）
    private removeBackgroundTool: RemoveBackgroundTool | null = null;
    private applyMattingResultTool: ApplyMattingResultTool | null = null;
    private applyMultiMattingResultTool: ApplyMultiMattingResultTool | null = null;

    constructor() {
        this.registerDefaultTools();
    }

    /**
     * 获取 RemoveBackgroundTool 实例（用于设置 WebSocket 客户端）
     */
    getRemoveBackgroundTool(): RemoveBackgroundTool | null {
        return this.removeBackgroundTool;
    }

    /**
     * 获取 ApplyMattingResultTool 实例（用于二进制蒙版传输）
     */
    getApplyMattingResultTool(): ApplyMattingResultTool | null {
        return this.applyMattingResultTool;
    }

    /**
     * 单目标与多目标抠图共用同一个 take-once 二进制 Store。
     */
    getMattingBinaryMaskStore(): BinaryMaskStore {
        return this.mattingBinaryMaskStore;
    }
    
    /**
     * 获取 ApplyMultiMattingResultTool 实例（用于多目标二进制蒙版传输）
     */
    getApplyMultiMattingResultTool(): ApplyMultiMattingResultTool | null {
        return this.applyMultiMattingResultTool;
    }

    private registerMany(tools: Tool[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    /**
     * 注册默认工具
     */
    private registerDefaultTools(): void {
        // 文本工具
        this.registerMany([
            new GetTextContentTool(),
            new SetTextContentTool(),
            new AuditTextReplacementTool(),
            new GetTextStyleTool(),
            new SetTextStyleTool(),
            new ResolveFontNameTool()
        ]);

        // 布局工具
        this.registerMany([
            new GetAllTextLayersTool(),
            new GetLayerBoundsTool(),
            new MoveLayerTool(),
            new AlignLayersTool(),
            new DistributeLayersTool(),
            new SelectLayerTool(),
            new FocusLayerTool()
        ]);

        // 图层管理工具
        this.registerMany([
            new GetLayerHierarchyTool(),
            new FindLayersTool(),
            new CreateClippingMaskTool(),
            new ReleaseClippingMaskTool(),
            new RenameLayerTool(),
            new BatchRenameLayersTool(),
            new ReorderLayerTool(),
            new MoveLayerToGroupTool(),
            new GroupLayersTool(),
            new UngroupLayersTool()
        ]);

        // 画布/文档工具
        this.registerMany([
            new GetDocumentInfoTool(),
            new GetDocumentSnapshotTool(),
            new GetAcceptanceSnapshotTool(),
            new CreateDocumentTool(),
            new ListDocumentsTool(),
            new SwitchDocumentTool(),
            new CloseDocumentTool(),
            new CropDocumentTool(),
            new ResizeCanvasTool(),
            new ResizeImageTool()
        ]);

        // 历史记录工具
        this.registerMany([
            new UndoTool(),
            new RedoTool(),
            new GetHistoryInfoTool()
        ]);

        // 诊断工具
        this.register(new DiagnoseStateTool());

        // 文档保存/导出工具
        this.registerMany([
            new SaveDocumentTool(),
            new QuickExportTool(),
            new BatchExportTool(),
            new SmartSaveTool()
        ]);

        // 视觉分析工具
        this.registerMany([
            new GetCanvasSnapshotTool(),
            new GetElementMappingTool(),
            new AnalyzeLayoutTool(),
            new GetScreenSnapshotsTool(),
            new GetAnnotatedSnapshotTool(),
            new GetScreenSnapshotsWithOverlayTool()
        ]);

        // 图像处理工具
        // 保存 RemoveBackgroundTool 实例引用（用于二进制图像传输）
        this.removeBackgroundTool = new RemoveBackgroundTool();
        this.register(this.removeBackgroundTool);
        // 保存 ApplyMattingResultTool 实例引用（用于二进制蒙版传输）
        this.applyMattingResultTool = new ApplyMattingResultTool(this.mattingBinaryMaskStore);
        this.register(this.applyMattingResultTool);
        this.applyMultiMattingResultTool = new ApplyMultiMattingResultTool(this.mattingBinaryMaskStore);
        this.register(this.applyMultiMattingResultTool);  // 多目标语义分割
        this.register(new PlaceImageTool());
        
        // 局部重绘工具
        this.registerMany([
            new GetSelectionMaskTool(),
            new ApplyRasterImageResultTool(),
            new GetSelectionBoundsTool()
        ]);

        // 创建工具
        this.registerMany([
            new CreateRectangleTool(),
            new CreateEllipseTool(),
            new CreateTextLayerTool(),
            new CreateGroupTool()
        ]);

        // 图层变换工具
        this.registerMany([
            new TransformLayerTool(),
            new QuickScaleTool(),
            new ReplaceLayerContentTool()
        ]);

        // 高斯模糊与图层蒙版工具
        this.registerMany([
            new GaussianBlurLayerTool(),
            new CreateLayerMaskTool(),
            new DeleteLayerMaskTool()
        ]);

        // 图层属性工具 (P0)
        this.registerMany([
            new SetLayerOpacityTool(),
            new SetLayerVisibilityTool(),
            new SetBlendModeTool(),
            new SetLayerFillTool(),
            new DuplicateLayerTool(),
            new DeleteLayerTool(),
            new LockLayerTool(),
            new GetLayerPropertiesTool(),
            new AddDodgeBurnLayerTool()
        ]);

        // 图层效果工具 (P1)
        this.registerMany([
            new AddDropShadowTool(),
            new AddStrokeTool(),
            new AddGlowTool(),
            new AddGradientOverlayTool(),
            new ClearLayerEffectsTool()
        ]);

        // 调色 / 调整图层工具（非破坏性）
        this.registerMany([
            new AddBrightnessContrastAdjustmentTool(),
            new AddHueSaturationAdjustmentTool(),
            new AddLevelsAdjustmentTool(),
            new AddColorBalanceAdjustmentTool(),
            new AddVibranceAdjustmentTool(),
            new AddPhotoFilterAdjustmentTool()
        ]);

        // 形态变形工具
        this.registerMany([
            new ExtractShapePathTool(),
            new GetLayerContourTool(),
            new MorphToShapeTool(),
            new BatchMorphToShapeTool(),
            new ApplyMorphedImageTool(),
            new WarpExplorerTool(),
            new WarpLayerTool(),
            new ExportLayerAsBase64Tool(),
            new ExportGroupTool(),
            new ExportMainImageDocumentsTool(),
            new ExportWhiteBgFromSkuMaterialTool(),
            new GetSubjectBoundsTool(),
            new ApplyDisplacementTool()
        ]);

        // 剪切蒙版信息工具（智能布局）
        this.registerMany([
            new GetClippingMaskInfoTool(),
            new GetAllClippingMasksTool()
        ]);

        // SKU 排版工具
        this.register(new SKULayoutTool());

        // 智能布局引擎
        this.register(new SmartLayoutTool());
        
        // 对齐到参考形状工具
        this.register(new AlignToReferenceTool());


        // 优化图像传输（参考 sd-ppp 设计）
        this.registerMany([
            new OptimizedImageTransferTool(),
            new OptimizedMattingImageTool()
        ]);

        // 模板渲染工具
        this.registerMany([
            new OpenTemplateTool(),
            new GetTemplateStructureTool(),
            new ReplaceImagePlaceholderTool(),
            new ReplaceTextPlaceholderTool(),
            new BatchRenderTemplateTool()
        ]);

        // 图像协调工具（harmonize_layer / quick_harmonize）已从注册表下架：
        // 该工具路径从未接线（不导出图层像素、调用了不存在的 wsClient.request、
        // setWebSocketClient 从未被调用），注册只会让模型拿到一个必败工具。
        // 面板 WebView 的 harmonize 路径（index.ts handleHarmonize → sendRequest）不受影响。
        // 正确的修复是导出图层字节 → Agent HarmonizationService → 写回结果（见 P1 规划）。

        // SKU 配置工具
        this.registerMany([
            new SockLayoutConfigTool(),
            new ExportColorConfigTool(),
            new CreateSkuPlaceholdersTool(),
            new GetSkuPlaceholdersTool(),
            new ExportToSkuDirTool()
        ]);

        // 导出目录服务已简化，使用 getEntryWithUrl 解析项目路径入口

        // 智能对象工具
        this.registerMany([
            new GetSmartObjectInfoTool(),
            new ConvertToSmartObjectTool(),
            new EditSmartObjectContentsTool(),
            new ReplaceSmartObjectContentsTool(),
            new UpdateSmartObjectTool(),
            new GetSmartObjectLayersTool(),
            new DuplicateSmartObjectTool(),
            new RasterizeSmartObjectTool()
        ]);

        // 详情页设计工具
        this.registerMany([
            new DetailPageParserTool(),
            new LayerRelationDetectorTool(),
            new AutoFixerTool(),
            new DetailPageFillerTool(),
            new SliceExporterTool(),
            new AuditDetailPagePlacementTool()
        ]);

        console.log(`[ToolRegistry] Registered ${this.tools.size} tools`);
    }

    /**
     * 注册工具
     */
    register(tool: Tool): void {
        this.tools.set(tool.name, tool);
        console.log(`[ToolRegistry] Registered tool: ${tool.name}`);
    }

    /**
     * 获取工具
     */
    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /**
     * 获取所有工具 Schema (用于告知 Agent 可用的工具)
     */
    getAllSchemas(): ToolSchema[] {
        return Array.from(this.tools.values()).map(tool => tool.schema);
    }

    /**
     * 列出所有工具名称
     */
    listTools(): string[] {
        return Array.from(this.tools.keys());
    }
}
