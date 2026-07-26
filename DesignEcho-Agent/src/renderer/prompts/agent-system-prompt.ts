/**
 * AI Agent 系统 Prompt 模板
 *
 * 历史兼容文件：当前用户输入主链路以
 * src/renderer/services/agent-orchestration + src/renderer/services/design-agent/engine.ts
 * 为准。不要在新的 Agent 路由、ChatPanel 主流程或业务 skill 中重新接入本文件。
 * 
 * 职责：定义 AI 的角色、能力和输出格式
 * 原则：单一职责 - 仅包含 Prompt 模板，不包含业务逻辑
 */

export interface PromptTemplateVars {
    toolsDescription: string;
}

/**
 * 获取静态系统 Prompt 模板
 * 原子函数：纯模板字符串，无副作用
 */
export function getAgentSystemPromptTemplate(vars: PromptTemplateVars): string {
    const toolContext = vars.toolsDescription
        ? '\n当前运行时会单独注入工具 schema 和工具说明；不要把工具列表复述给普通用户。'
        : '';

    return `你是 DesignEcho 历史兼容提示模板。

本文件不是当前 Agent 主链路的提示词。当前主链路以 src/renderer/services/agent-orchestration 和 src/renderer/services/design-agent/engine.ts 为准。

如果这个模板被旧入口临时调用，必须遵守这些边界：

1. 始终用简体中文自然回复。
2. 不输出 JSON 路由、内部状态码、伪工具 XML 或调试字段。
3. 不要求模型按关键词直接执行，也不要求模型只输出结构化决策。
4. 对话、能力问题、进度问题和解释性问题直接自然回答。
5. 涉及真实 Photoshop、项目文件、长期记忆或外部写入时，必须由当前运行时工具 schema、工具决策契约和执行前检查共同决定是否允许执行。
6. 缺少真实上下文时，可以说明需要先查看项目或文档；不能编造当前项目事实。
${toolContext}`;
}

/**
 * 构建动态上下文部分
 * 原子函数：根据当前状态生成上下文描述
 */
export function buildDynamicContextSection(context: {
    userInput: string;
    isPluginConnected: boolean;
    photoshopContext?: any;
    projectContext?: any;
}): string {
    const parts: string[] = [];
    
    // Photoshop 连接状态
    if (context.isPluginConnected) {
        parts.push('**Photoshop 状态**: ✅ 已连接');
        
        if (context.photoshopContext?.hasDocument) {
            const ps = context.photoshopContext;
            parts.push(`**当前文档**: ${ps.documentName || '未命名'}`);
            parts.push(`**画布尺寸**: ${ps.canvasSize?.width || 0} x ${ps.canvasSize?.height || 0}`);
            
            if (ps.activeLayerName) {
                parts.push(`**当前图层**: ${ps.activeLayerName}`);
            }
            if (ps.layerCount !== undefined) {
                parts.push(`**图层数量**: ${ps.layerCount}`);
            }
        } else {
            parts.push('**当前文档**: 无打开的文档');
        }
    } else {
        parts.push('**Photoshop 状态**: ❌ 未连接');
    }
    
    // 项目上下文
    if (context.projectContext) {
        const proj = context.projectContext;
        if (proj.projectPath) {
            parts.push(`\n**项目路径**: ${proj.projectPath}`);
        }
        if (proj.hasSkuFiles) {
            parts.push('**SKU 文件**: ✅ 存在');
        }
        if (proj.hasTemplates) {
            parts.push('**模板文件**: ✅ 存在');
        }
        if (proj.availableColors && proj.availableColors.length > 0) {
            parts.push(`**可用颜色**: ${proj.availableColors.join(', ')}`);
        }
        if (proj.assetIndex?.summary) {
            const summary = proj.assetIndex.summary;
            parts.push(`**项目素材索引**: ${summary.totalImages || 0} 张图片，${summary.totalDesignDocuments || 0} 个设计文件`);
            if (proj.contextSnapshotSource) {
                parts.push(`**上下文快照来源**: ${proj.contextSnapshotSource}`);
            }
        }
    }
    
    // 用户输入
    parts.push(`\n**用户需求**: ${context.userInput}`);
    
    return parts.join('\n');
}
