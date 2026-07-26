/**
 * 审美知识库模块入口
 * 
 * 提供专业设计知识管理和 AI 审美决策能力
 */

// 类型导出
export * from './types';

// 服务导出
export { 
    AestheticKnowledgeService, 
    getAestheticKnowledgeService 
} from './aesthetic-knowledge-service';

export { 
    AestheticDecisionService, 
    getAestheticDecisionService 
} from './aesthetic-decision-service';

export {
    ProductLibraryService,
    getProductLibraryService
} from './product-library-service';

export {
    TrendSensingService,
    getTrendSensingService,
    TrendInfo,
    TrendInsight
} from './trend-sensing-service';

export {
    VLMAestheticService,
    getVLMAestheticService,
    DesignAnalysisRequest,
    DesignAnalysisResult,
    SelfValidationResult
} from './vlm-aesthetic-service';
