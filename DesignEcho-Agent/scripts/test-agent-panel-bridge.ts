import { extractMcpTools, recommendMcpTools } from '../src/renderer/services/skill-executors/agent-panel-bridge.executor.ts';

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function run(): void {
    const shapeA = {
        tools: [
            { name: 'parseDetailPageTemplate', description: 'parse detail structure' },
            { name: 'quickExport', description: 'export image quickly' }
        ]
    };
    const listA = extractMcpTools(shapeA);
    assert(listA.length === 2, 'shapeA 解析失败');

    const shapeB = {
        result: {
            tools: [
                { name: 'getSubjectBounds', description: 'detect subject bounds' }
            ]
        }
    };
    const listB = extractMcpTools(shapeB);
    assert(listB.length === 1, 'shapeB 解析失败');
    assert(listB[0].name === 'getSubjectBounds', 'shapeB 名称不匹配');

    const detailRecommended = recommendMcpTools('调试详情页文案溢出', [...listA, ...listB]);
    assert(detailRecommended.some((tool) => tool.name === 'parseDetailPageTemplate'), '详情页推荐失败');

    const mainRecommended = recommendMcpTools('主图导出异常', [...listA, ...listB]);
    assert(mainRecommended.some((tool) => tool.name === 'quickExport' || tool.name === 'getSubjectBounds'), '主图推荐失败');

    console.log('PASS: agent-panel-bridge helper tests');
}

run();
