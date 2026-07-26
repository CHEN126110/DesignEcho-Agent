#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  projectContextSnapshotService
} = require('../src/main/services/project-context-snapshot-service.ts');
const conversational = require('../src/renderer/services/agent-orchestration/conversational.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const signals = ['\u9359', '\u93c8', '\u951b', '\u95c8', '\u7f01', '\u20ac', '\ufffd'];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  writeFile(path.join(root, '.designecho', 'project.json'), JSON.stringify({
    version: '1.0',
    createdAt: '2026-05-14T00:00:00.000Z',
    lastOpenedAt: '2026-05-14T00:00:00.000Z',
    projectPath: root,
    projectName: 'runtime-context-smoke',
    folderMappings: {
      '原图': 'source',
      'SKU': 'sku',
      '主图': 'mainImage',
      '模板文件': 'psd'
    },
    imageClassifications: {}
  }, null, 2));

  writeFile(path.join(root, '原图', 'C82602', 'YYC_0294.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, '原图', 'C82602', '白色.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, 'SKU', '2双装', '白色+黑色.png'), 'not-a-real-png');
  writeFile(path.join(root, '主图', '800', '主图01.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, '模板文件', 'SKU.psb'), 'not-a-real-psb');
  writeFile(path.join(root, 'SKU配置.csv'), '模板,组合\nSKU.psb,白色+黑色\nSKU.psb,米白+奶白\n');
}

async function main() {
  const agentRoot = path.resolve(__dirname, '..');
  const appSource = fs.readFileSync(path.join(agentRoot, 'src', 'renderer', 'App.tsx'), 'utf8');
  const contextSource = fs.readFileSync(
    path.join(agentRoot, 'src', 'renderer', 'services', 'agent-orchestration', 'context.ts'),
    'utf8'
  );
  const autonomousAgentSource = fs.readFileSync(
    path.join(agentRoot, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  assert(
    appSource.includes('projectRootSynced')
      && appSource.includes('window.designEcho?.setProjectRoot?.(nextProjectRoot)')
      && appSource.includes("String(currentProject?.path || '').trim()"),
    'renderer project restore/switch must synchronize the active project root into the main resource service'
  );
  assert(
    appSource.includes('requestedProjectPath')
      && appSource.includes('useAppStore.getState().currentProject?.path !== requestedProjectPath'),
    'late project scans must not overwrite the active project context after a project switch'
  );
  assert(
    appSource.includes('connectionStatusRevision')
      && appSource.includes('revision !== connectionStatusRevision.current'),
    'late connection polls must not overwrite newer socket events'
  );
  assert(
    contextSource.includes('projectName: String(')
      && contextSource.includes('project.name')
      && contextSource.includes('snapshot?.assetIndex.projectName'),
    'renderer project context must preserve the imported project identity instead of reducing it to image counts'
  );
  assert(
    contextSource.includes("projectId: String(project.id || '').trim() || undefined"),
    'renderer project context must carry the stable currentProject.id for scoped memory isolation'
  );
  assert(
    autonomousAgentSource.includes('只用一句设计语言说明要实现的画面效果')
      && autonomousAgentSource.includes('不要列能力、工具、门禁或技术步骤')
      && !autonomousAgentSource.includes('调用能力前，在正文中给出简短的中文设计计划'),
    'autonomous Agent public progress must use designer language rather than engineering execution language'
  );

  let conversationalSystemPrompt = '';
  const projectIdentityReply = await conversational.tryConversationalModelReplyDetailed(
    {
      userInput: '我现在在做哪个项目？先别动 Photoshop，只告诉我项目名称和项目文件夹。',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: '详情页.psb' },
      projectContext: {
        projectName: 'C-1221',
        projectPath: 'E:\\DesignEchoDemo\\C-1221',
        projectImageCount: 47,
        projectImageFolders: [],
        sampleImagePaths: []
      }
    },
    async (messages) => {
      conversationalSystemPrompt = String(messages?.[0]?.content || '');
      return { text: '你现在做的是 C-1221，项目在 E 盘 WERKE 下的 C-1221 文件夹。' };
    }
  );
  assert(projectIdentityReply.reply?.includes('C-1221'), 'project identity reply should retain the confirmed project name');
  assert(
    conversationalSystemPrompt.includes('当前活动项目名称：C-1221。')
      && conversationalSystemPrompt.includes('当前活动项目位置：E 盘 WERKE 下的 C-1221 文件夹。'),
    'conversational Agent must receive trusted project identity and a designer-readable folder location'
  );
  assert(
    conversationalSystemPrompt.includes('不要把回复写成工程交接单'),
    'conversational Agent must be explicitly governed toward designer-facing language'
  );
  const fixtureRoot = path.join(agentRoot, 'tmp', 'smoke-project-context-runtime');
  assert(
    fixtureRoot.startsWith(path.join(agentRoot, 'tmp')),
    'fixture root must stay inside agent tmp directory'
  );
  buildFixture(fixtureRoot);

  const result = await projectContextSnapshotService.build({
    projectPath: fixtureRoot,
    selectedAssetPaths: [path.join(fixtureRoot, '原图', 'C82602', '白色.jpg')],
    userConstraints: ['runtime smoke only'],
    visualSamplingScenario: 'sku'
  });

  assert(result.success === true, 'runtime snapshot should succeed');
  assert(result.source === 'runtime-project-service', 'snapshot source should be runtime service');
  assert(result.contextSnapshot.snapshotVersion === 'context-snapshot/v0', 'snapshot version should be stable');
  assert(result.assetIndex.indexVersion === 'project-asset-index/v0', 'asset index version should be stable');
  assert(result.visualSamplingPlan.planVersion === 'project-visual-sampling/v0', 'visual sampling plan version should be stable');
  assert(result.visualSamplingPlan.scenario === 'sku', 'runtime snapshot should honor requested sku visual sampling scenario');
  assert(
    result.contextSnapshot.visualSamplingPlan?.planVersion === 'project-visual-sampling/v0',
    'context snapshot should carry visual sampling plan'
  );
  assert(
    result.contextSnapshot.visualSamplingPlan?.scenario === 'sku',
    'context snapshot should preserve requested sku visual sampling scenario'
  );
  assert(result.assetIndex.summary.totalImages >= 4, 'asset index should include image candidates');
  assert(result.assetIndex.summary.totalDesignDocuments >= 1, 'asset index should include design documents');
  assert(result.assetIndex.summary.skuConfigCount >= 2, 'asset index should parse SKU CSV rows');
  assert(
    result.visualSamplingPlan.selectedCandidates.length > 0,
    'runtime visual sampling should select bounded candidates'
  );
  assert(
    result.visualSamplingPlan.selectedCandidates[0]?.role === 'color-single',
    'sku visual sampling should prioritize color-single assets when they exist'
  );

  const mainImageResult = await projectContextSnapshotService.build({
    projectPath: fixtureRoot,
    selectedAssetPaths: [path.join(fixtureRoot, '原图', 'C82602', '白色.jpg')],
    visualSamplingScenario: 'main-image',
    usePersistedVisualInsightCache: false
  });
  assert(mainImageResult.visualSamplingPlan.scenario === 'main-image', 'runtime snapshot should honor requested main-image scenario');
  assert(
    mainImageResult.visualSamplingPlan.selectedCandidates[0]?.role === 'raw-model-wear',
    'main-image visual sampling should prioritize model wearing assets when they exist'
  );
  assert(
    result.visualSamplingPlan.limitations.some((item) => item.includes('不读取图片像素')),
    'visual sampling plan must not claim pixel reads'
  );
  assert(
    result.contextSnapshot.selectedAssetPaths.some((item) => item.includes('白色.jpg')),
    'snapshot should preserve selected asset context'
  );
  assert(
    result.contextSnapshot.limitations.some((item) => item.includes('不是 Photoshop 执行结果')),
    'snapshot must not claim Photoshop execution'
  );
  assert(
    result.contextSnapshot.unverifiedItems.some((item) => item.includes('视觉模型') || item.includes('人工确认')),
    'snapshot should keep visual sampling unverified'
  );
  assertNoMojibake(result, 'runtime context snapshot result');

  console.log(JSON.stringify({
    ok: true,
    source: result.source,
    totalImages: result.assetIndex.summary.totalImages,
    totalDesignDocuments: result.assetIndex.summary.totalDesignDocuments,
    skuConfigCount: result.assetIndex.summary.skuConfigCount,
    readiness: result.contextSnapshot.readiness,
    visualSamplingCandidates: result.visualSamplingPlan.selectedCandidates.length,
    visualSamplingCache: result.visualSamplingPlan.cacheSummary
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
