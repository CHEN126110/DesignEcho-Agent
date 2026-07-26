import { agentPanelBridgeExecutor } from '../src/renderer/services/skill-executors/agent-panel-bridge.executor.ts';

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

async function runCaseNotConnected(): Promise<void> {
    (globalThis as any).window = {
        designEcho: {
            invoke: async (channel: string) => {
                if (channel === 'ws:status') return { connected: false };
                throw new Error(`unexpected channel: ${channel}`);
            }
        }
    };

    const result = await agentPanelBridgeExecutor.execute({
        params: { goal: '测试未连接提示', needMcpTools: true },
        callbacks: {}
    } as any);

    assert(result.success === false, '未连接场景应失败');
    assert(String(result.error || '').includes('plugin not connected'), '未连接场景错误信息不正确');
}

async function runCaseConnectedListAndRecommend(): Promise<void> {
    (globalThis as any).window = {
        designEcho: {
            invoke: async (channel: string) => {
                if (channel === 'ws:status') return { connected: true };
                if (channel === 'mcp:tools:list') {
                    return {
                        result: {
                            tools: [
                                { name: 'parseDetailPageTemplate', description: 'parse detail structure' },
                                { name: 'fillDetailPage', description: 'fill copy and image' },
                                { name: 'quickExport', description: 'quick export image' }
                            ]
                        }
                    };
                }
                throw new Error(`unexpected channel: ${channel}`);
            }
        }
    };

    const result = await agentPanelBridgeExecutor.execute({
        params: { goal: '调试详情页文案溢出', needMcpTools: true },
        callbacks: {}
    } as any);

    assert(result.success === true, '连接并拉取工具场景应成功');
    const suggestedTools = (result.data?.suggestedTools || []).map((item: any) => item.name);
    assert(suggestedTools.includes('parseDetailPageTemplate'), '应推荐详情页解析工具');
}

async function runCaseMcpCallFailure(): Promise<void> {
    (globalThis as any).window = {
        designEcho: {
            invoke: async (channel: string) => {
                if (channel === 'ws:status') return { connected: true };
                if (channel === 'mcp:tools:call') throw new Error('call failed');
                if (channel === 'mcp:tools:list') return { tools: [] };
                throw new Error(`unexpected channel: ${channel}`);
            }
        }
    };

    const result = await agentPanelBridgeExecutor.execute({
        params: {
            goal: '测试工具调用失败',
            mcpToolName: 'parseDetailPageTemplate',
            mcpArguments: { strict: false }
        },
        callbacks: {}
    } as any);

    assert(result.success === false, 'MCP 调用失败场景应失败');
    assert(String(result.error || '').includes('call failed'), 'MCP 调用失败错误信息不正确');
}

async function runCaseModelFeedbackPlan(): Promise<void> {
    (globalThis as any).window = {
        designEcho: {
            invoke: async (channel: string) => {
                if (channel === 'ws:status') return { connected: true };
                if (channel === 'mcp:tools:list') {
                    return {
                        tools: [
                            { name: 'parseDetailPageTemplate', description: 'parse detail structure' }
                        ]
                    };
                }
                throw new Error(`unexpected channel: ${channel}`);
            },
            chat: async () => ({
                text: JSON.stringify({
                    action_request: ['调用 parseDetailPageTemplate 并记录 screen count'],
                    expected_feedback: ['返回 success 与 screenCount'],
                    next_steps: ['若失败返回错误栈并建议下一步'],
                    summary: '模型已生成联调路径'
                })
            })
        }
    };

    const result = await agentPanelBridgeExecutor.execute({
        params: { goal: '验证详情页解析链路', needMcpTools: true },
        callbacks: {}
    } as any);

    assert(result.success === true, '模型反馈规划场景应成功');
    const panelMessage = result.data?.panelMessage || {};
    assert(Array.isArray(panelMessage.action_request) && panelMessage.action_request[0].includes('parseDetailPageTemplate'), '模型 action_request 未生效');
    assert(String(result.message || '').includes('模型规划**: 已启用'), '应显示模型规划已启用');
}

async function runCaseMainImageRecommend(): Promise<void> {
    (globalThis as any).window = {
        designEcho: {
            invoke: async (channel: string) => {
                if (channel === 'ws:status') return { connected: true };
                if (channel === 'mcp:tools:list') {
                    return {
                        tools: [
                            { name: 'quickExport', description: 'quick export image' },
                            { name: 'getSubjectBounds', description: 'subject bounds detect' },
                            { name: 'parseDetailPageTemplate', description: 'parse detail structure' }
                        ]
                    };
                }
                throw new Error(`unexpected channel: ${channel}`);
            }
        }
    };

    const result = await agentPanelBridgeExecutor.execute({
        params: { goal: '主图导出失败需要排查', needMcpTools: true },
        callbacks: {}
    } as any);

    const suggestedTools = (result.data?.suggestedTools || []).map((item: any) => item.name);
    assert(suggestedTools.some((name: string) => name === 'quickExport' || name === 'getSubjectBounds'), '主图场景推荐工具不正确');
}

async function main(): Promise<void> {
    await runCaseNotConnected();
    await runCaseConnectedListAndRecommend();
    await runCaseMcpCallFailure();
    await runCaseModelFeedbackPlan();
    await runCaseMainImageRecommend();
    console.log('PASS: agent-panel-bridge executor tests');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
