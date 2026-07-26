const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  matteProductExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'matte-product.executor.ts'));

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

async function withMockedToolExecutor(mock, fn) {
  const original = toolExecutor.executeToolCall;
  toolExecutor.executeToolCall = mock;
  try {
    return await fn();
  } finally {
    toolExecutor.executeToolCall = original;
  }
}

function stepTitles(steps) {
  return steps.map((step) => String(step.title || ''));
}

async function main() {
  const route = fastDeterministicRoute('帮我把当前选中的袜子抠图去背景');
  record(
    'agent-route-pauses-matte-product',
    route === null,
    route
  );

  const skill = getSkillById('matte-product');
  record(
    'skill-declaration',
    !!skill
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('removeBackground')
      && skill.visibility === 'user-facing',
    skill
  );

  const successSteps = [];
  const successProgress = [];
  let calledParams = null;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName !== 'removeBackground') {
      return { success: false, error: `unexpected tool ${toolName}` };
    }
    calledParams = params;
    return {
      success: true,
      message: '抠图完成',
      newLayerId: 42,
      usedMode: 'ai',
      processingTime: 1280,
      useBinaryTransfer: true,
      binaryImageWidth: 900,
      binaryImageHeight: 1200,
      targetPrompt: params.targetPrompt
    };
  }, async () => {
    const result = await matteProductExecutor.execute({
      params: { targetPrompt: '袜子', quality: 'balanced', maxSize: 1024 },
      callbacks: {
        onStep: (step) => successSteps.push(step),
        onProgress: (message, percent) => successProgress.push({ message, percent })
      },
      context: {}
    });
    const titles = stepTitles(successSteps);
    record(
      'executor-success-observable-steps',
      result.success === true
        && result.message === '抠图完成'
        && calledParams
        && calledParams.targetPrompt === '袜子'
        && titles.includes('准备抠图参数')
        && titles.includes('调用 Photoshop 工具：removeBackground')
        && titles.includes('Photoshop 工具完成：removeBackground')
        && titles.includes('抠图结果已返回')
        && successProgress.some((item) => item.message === '正在调用 Photoshop 抠图工具'),
      { result, titles, successProgress }
    );
  });

  const failedSteps = [];
  await withMockedToolExecutor(async () => ({
    success: false,
    message: '分割模型未安装',
    error: 'MODEL_NOT_INSTALLED'
  }), async () => {
    const result = await matteProductExecutor.execute({
      params: { targetPrompt: '袜子' },
      callbacks: {
        onStep: (step) => failedSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(failedSteps);
    record(
      'executor-failure-is-observable-and-not-success',
      result.success === false
        && result.message.includes('抠图失败')
        && titles.includes('抠图未完成')
        && failedSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('MODEL_NOT_INSTALLED')),
      { result, titles, failedSteps }
    );
  });
}

main().catch((error) => {
  record('unexpected-exception', false, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  });
}).finally(() => {
  const failed = cases.filter((item) => item.status !== 'pass');
  const report = {
    generatedAt: new Date().toISOString(),
    success: failed.length === 0,
    cases
  };

  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const jsonPath = path.join(tmpDir, 'matte-product-skill-smoke.json');
  const mdPath = path.join(tmpDir, 'matte-product-skill-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Matte Product Skill Smoke',
      '',
      `success: ${report.success}`,
      '',
      ...cases.map((item) => `- ${item.name}: ${item.status}`)
    ].join('\n'),
    'utf8'
  );

  console.log(JSON.stringify({
    success: report.success,
    cases: cases.map(({ name, status }) => ({ name, status })),
    report: { json: jsonPath, md: mdPath }
  }, null, 2));

  process.exit(report.success ? 0 : 1);
});
