/**
 * 参考图复刻 Hook
 * 
 * 实现参考图布局分析和复刻功能
 * 
 * 工作流程：
 * 1. 用户上传参考图
 * 2. 调用视觉模型分析布局结构
 * 3. 获取当前文档的元素信息
 * 4. 生成布局复刻指令
 * 5. 执行复刻操作
 */

import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/app.store';
import {
    getPrimaryModelForPreferenceBucket,
    isVisionCapableModelId
} from '../../shared/model-selection';
import { 
    ReferenceLayoutAnalysis,
    buildReferenceAnalysisPrompt,
    buildLayoutReplicationPrompt,
    parseLayoutAnalysis,
    parseReplicationActions
} from '../../shared/prompts/reference-analysis';
import { executeToolCall } from '../services/tool-executor.service';

export interface ReplicationState {
    /** 当前阶段 */
    stage: 'idle' | 'analyzing' | 'mapping' | 'generating' | 'executing' | 'done' | 'error';
    /** 参考图 Base64 */
    referenceImage: string | null;
    /** 布局分析结果 */
    layoutAnalysis: ReferenceLayoutAnalysis | null;
    /** 生成的操作指令 */
    actions: { tool: string; params: any }[];
    /** 执行进度 */
    progress: number;
    /** 错误信息 */
    error: string | null;
    /** 执行记录 */
    logs: string[];
}

export interface UseReferenceReplicationReturn {
    state: ReplicationState;
    /** 上传参考图并开始分析 */
    analyzeReference: (imageBase64: string) => Promise<void>;
    /** 执行布局复刻 */
    executeReplication: () => Promise<void>;
    /** 重置状态 */
    reset: () => void;
}

const initialState: ReplicationState = {
    stage: 'idle',
    referenceImage: null,
    layoutAnalysis: null,
    actions: [],
    progress: 0,
    error: null,
    logs: []
};

/**
 * 参考图复刻 Hook
 */
export const useReferenceReplication = (): UseReferenceReplicationReturn => {
    const [state, setState] = useState<ReplicationState>(initialState);
    const { modelPreferences, isPluginConnected, setAbortController } = useAppStore();

    const addLog = useCallback((message: string) => {
        setState(prev => ({
            ...prev,
            logs: [...prev.logs, `[${new Date().toLocaleTimeString()}] ${message}`]
        }));
        console.log(`[ReferenceReplication] ${message}`);
    }, []);

    /**
     * 生成复刻指令（内部函数，必须在 analyzeReference 之前定义）
     */
    const generateReplicationActions = useCallback(async (layoutAnalysis: ReferenceLayoutAnalysis) => {
        setState(prev => ({ ...prev, stage: 'generating' }));
        addLog('获取当前文档元素信息...');

        try {
            // 1. 获取当前文档的元素映射（包含完整信息）
            const elementsResult = await executeToolCall('getElementMapping', { 
                sortBy: 'position',
                includeHidden: false,
                includeGroups: true
            });
            
            if (!elementsResult?.success) {
                throw new Error('无法获取当前文档元素');
            }

            // 2. 提取并格式化图层信息
            const rawElements = elementsResult.elements || [];
            const currentElements = rawElements.map((el: any) => ({
                name: el.name,
                type: el.type,
                bounds: el.bounds,
                id: el.id,
                textContent: el.textContent || undefined
            }));
            
            addLog(`当前文档有 ${currentElements.length} 个图层`);
            
            // 显示图层摘要
            const textLayers = currentElements.filter((e: any) => e.type === 'text').length;
            const imageLayers = currentElements.filter((e: any) => e.type === 'pixel' || e.type === 'smartObject').length;
            addLog(`  - 文本图层: ${textLayers} 个`);
            addLog(`  - 图像图层: ${imageLayers} 个`);

            // 3. 构建复刻指令生成提示词
            const prompt = buildLayoutReplicationPrompt(layoutAnalysis, currentElements);

            // 4. 选择合适的模型生成复刻指令
            const model = getPrimaryModelForPreferenceBucket(modelPreferences, 'layoutAnalysis', {
                mode: modelPreferences?.mode,
                includeFallback: modelPreferences?.autoFallback,
                includeCrossTaskBackups: false
            }) || 'local-qwen2.5-7b';
            addLog(`使用模型生成复刻指令: ${model}`);

            const response = await window.designEcho.chat(model, [
                { 
                    role: 'system', 
                    content: '你是 Photoshop 布局专家。请严格按照 JSON 格式输出复刻指令，不要添加额外解释。' 
                },
                { role: 'user', content: prompt }
            ], {
                maxTokens: 4096,
                temperature: 0.1  // 低温度确保输出稳定
            });

            if (!response?.text) {
                throw new Error('模型无响应');
            }

            addLog('正在解析复刻指令...');

            // 5. 解析复刻指令
            const actions = parseReplicationActions(response.text);
            
            if (actions.length === 0) {
                addLog('⚠️ 未能生成有效的复刻指令，请检查参考图分析结果');
                console.log('[ReferenceReplication] Raw response:', response.text);
            } else {
                addLog(`✓ 生成了 ${actions.length} 个复刻操作`);
            }

            setState(prev => ({
                ...prev,
                stage: 'done',
                actions
            }));

        } catch (error: any) {
            addLog(`❌ 生成指令失败: ${error.message}`);
            console.error('[ReferenceReplication] Error:', error);
            setState(prev => ({
                ...prev,
                stage: 'error',
                error: error.message
            }));
        }
    }, [modelPreferences, addLog]);

    /**
     * 分析参考图布局
     */
    const analyzeReference = useCallback(async (imageBase64: string) => {
        setState(prev => ({
            ...prev,
            stage: 'analyzing',
            referenceImage: imageBase64,
            error: null,
            logs: []
        }));

        addLog('开始分析参考图布局...');

        try {
            // 1. 根据 mode 选择视觉模型
            let visionModel = getPrimaryModelForPreferenceBucket(modelPreferences, 'visualAnalyze', {
                mode: modelPreferences?.mode,
                includeFallback: modelPreferences?.autoFallback,
                includeCrossTaskBackups: false,
                requireVision: true
            }) || 'google-gemini-3-flash';

            if (!isVisionCapableModelId(visionModel)) {
                addLog(`⚠️ ${visionModel} 可能不支持视觉，尝试使用备选模型`);
                visionModel = modelPreferences?.mode === 'local' ? 'local-llava-13b' : 'google-gemini-3-flash';
            }
            
            addLog(`使用视觉模型: ${visionModel} (模式: ${modelPreferences.mode})`);

            // 2. 构建分析提示词
            const prompt = buildReferenceAnalysisPrompt();

            // 3. 调用视觉模型分析参考图
            addLog('正在分析参考图元素和布局...');
            
            const response = await window.designEcho.chat(visionModel, [
                { 
                    role: 'system', 
                    content: '你是专业的电商设计布局分析专家。请仔细分析图片中的设计元素，并以 JSON 格式输出。' 
                },
                { 
                    role: 'user', 
                    content: [
                        { type: 'text', text: prompt },
                        { 
                            type: 'image', 
                            image: { 
                                data: imageBase64, 
                                mediaType: 'image/jpeg'
                            }
                        }
                    ]
                }
            ], {
                maxTokens: 4096,
                temperature: 0.1
            });

            if (!response?.text) {
                throw new Error('视觉模型无响应，请检查模型是否支持图像输入');
            }

            addLog('布局分析完成，解析结果...');

            // 4. 解析布局分析结果
            const layoutAnalysis = parseLayoutAnalysis(response.text);
            
            if (!layoutAnalysis) {
                console.log('[ReferenceReplication] Parse failed, raw response:', response.text);
                addLog('⚠️ JSON 解析失败，请检查模型响应');
                throw new Error('无法解析布局分析结果，模型返回格式异常');
            }

            // 5. 验证分析结果
            if (!layoutAnalysis.elements || layoutAnalysis.elements.length === 0) {
                addLog('⚠️ 未检测到设计元素，可能是图片质量问题');
            } else {
                addLog(`✓ 识别到 ${layoutAnalysis.elements.length} 个设计元素`);
                addLog(`  布局类型: ${layoutAnalysis.layoutType}`);
                addLog(`  画布尺寸: ${layoutAnalysis.canvasSize.width}×${layoutAnalysis.canvasSize.height}`);
            }

            setState(prev => ({
                ...prev,
                stage: 'mapping',
                layoutAnalysis
            }));

            // 6. 如果插件已连接，继续生成复刻指令
            if (isPluginConnected) {
                await generateReplicationActions(layoutAnalysis);
            } else {
                addLog('⚠️ Photoshop 未连接，无法获取当前文档元素');
                addLog('请连接 Photoshop 后重试');
                setState(prev => ({ ...prev, stage: 'done' }));
            }

        } catch (error: any) {
            const errorMsg = error.message || '未知错误';
            addLog(`❌ 分析失败: ${errorMsg}`);
            console.error('[ReferenceReplication] Analysis error:', error);
            
            setState(prev => ({
                ...prev,
                stage: 'error',
                error: errorMsg
            }));
        }
    }, [modelPreferences, isPluginConnected, addLog, generateReplicationActions]);

    /**
     * 执行复刻操作
     */
    const executeReplication = useCallback(async () => {
        if (state.actions.length === 0) {
            addLog('⚠️ 没有可执行的操作');
            return;
        }

        // 创建并设置 AbortController
        const controller = new AbortController();
        setAbortController(controller);
        const signal = controller.signal;

        setState(prev => ({ ...prev, stage: 'executing', progress: 0 }));
        addLog(`开始执行 ${state.actions.length} 个操作...`);

        try {
            for (let i = 0; i < state.actions.length; i++) {
                // 检查取消状态
                if (signal.aborted) {
                    throw new Error('用户停止了任务');
                }

                const action = state.actions[i];
                const progress = Math.round(((i + 1) / state.actions.length) * 100);
                
                addLog(`执行: ${action.tool}(${JSON.stringify(action.params)})`);
                
                const result = await executeToolCall(action.tool, action.params);
                
                if (!result?.success) {
                    addLog(`⚠️ 操作失败: ${result?.error || '未知错误'}`);
                } else {
                    addLog(`✓ 操作成功`);
                }

                setState(prev => ({ ...prev, progress }));
                
                // 短暂延迟，让 PS 有时间处理
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(resolve, 200);
                    signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        reject(new Error('用户停止了任务'));
                    }, { once: true });
                });
            }

            addLog('✅ 布局复刻完成！');
            setState(prev => ({ ...prev, stage: 'done' }));

        } catch (error: any) {
            if (error.message === '用户停止了任务') {
                addLog('⏹️ 任务已停止');
                setState(prev => ({ ...prev, stage: 'done' })); 
            } else {
                addLog(`❌ 执行失败: ${error.message}`);
                setState(prev => ({
                    ...prev,
                    stage: 'error',
                    error: error.message
                }));
            }
        } finally {
            setAbortController(null);
        }
    }, [state.actions, addLog, setAbortController]);

    /**
     * 重置状态
     */
    const reset = useCallback(() => {
        setState(initialState);
    }, []);

    return {
        state,
        analyzeReference,
        executeReplication,
        reset
    };
};

export default useReferenceReplication;
