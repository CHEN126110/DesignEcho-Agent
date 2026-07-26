/**
 * 测试项目索引器
 * 
 * 使用 C-649 样本项目测试索引功能
 */

import { ProjectIndexer } from '../src/main/services/project-indexer';
import { getEmbeddingService } from '../src/main/services/rag/embedding-service';
import { getVectorStore } from '../src/main/services/rag/vector-store';
import * as path from 'path';

async function testProjectIndexer() {
    console.log('='.repeat(60));
    console.log('测试项目索引器');
    console.log('='.repeat(60));
    
    const indexer = new ProjectIndexer();
    const embeddingService = getEmbeddingService();
    const vectorStore = getVectorStore();
    
    // 初始化服务
    console.log('\n1. 初始化 Embedding 服务...');
    await embeddingService.initialize();
    console.log('   ✓ Embedding 服务就绪');
    
    console.log('\n2. 初始化向量存储...');
    await vectorStore.initialize();
    console.log('   ✓ 向量存储就绪');
    
    // 测试项目路径
    const testProjectPath = path.join(__dirname, '..', '..', 'C-649');
    console.log(`\n3. 扫描测试项目: ${testProjectPath}`);
    
    const items = await indexer.scanProject(testProjectPath);
    console.log(`   ✓ 扫描完成: ${items.length} 个文件`);
    
    // 统计文件类型
    const typeStats: Record<string, number> = {};
    for (const item of items) {
        typeStats[item.type] = (typeStats[item.type] || 0) + 1;
    }
    
    console.log('\n   文件类型统计:');
    for (const [type, count] of Object.entries(typeStats)) {
        console.log(`   - ${type}: ${count}`);
    }
    
    // 索引项目 (不使用 VLM，只用简单描述)
    console.log('\n4. 开始索引项目...');
    console.log('   (使用简单描述模式，不调用 VLM)');
    
    const result = await indexer.indexProject(
        'C-649',
        items,
        undefined,  // 不使用 VLM
        (current, total, item) => {
            if (current % 10 === 0 || current === total) {
                console.log(`   [${current}/${total}] ${item.relativePath}`);
            }
        }
    );
    
    console.log(`\n5. 索引完成!`);
    console.log(`   成功: ${result.success}`);
    console.log(`   失败: ${result.failed}`);
    
    // 查询向量库
    console.log('\n6. 测试检索...');
    const queryText = '主图 800 尺寸';
    console.log(`   查询: "${queryText}"`);
    
    const queryEmbedding = await embeddingService.embed(queryText);
    const searchResults = await vectorStore.search(queryEmbedding, { limit: 5 });
    
    console.log(`   找到 ${searchResults.length} 个结果:`);
    for (const result of searchResults) {
        console.log(`   - [${result.score.toFixed(3)}] ${result.title}`);
        console.log(`     ${result.text.substring(0, 60)}...`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('测试完成！');
    console.log('='.repeat(60));
}

// 运行测试
testProjectIndexer().catch(error => {
    console.error('测试失败:', error);
    process.exit(1);
});
