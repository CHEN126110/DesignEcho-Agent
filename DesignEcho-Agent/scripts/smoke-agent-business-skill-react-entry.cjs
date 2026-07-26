'use strict';

/**
 * smoke: business design skills enter ReAct through the autonomous Agent
 *
 * Core business skills may still be located as legacy workflow bridges inside
 * the ReAct tool loop, but DesignAgentEngine must not call their executors as
 * a terminal deterministic shortcut for confirmed design production requests.
 */

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));

function createContext(userInput) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'SKU.psb',
      activeLayerName: 'SKU'
    },
    projectContext: {
      projectPath: 'C:/DesignEcho/test-project',
      projectImageCount: 12,
      sampleImagePaths: ['C:/DesignEcho/test-project/SKU/white.jpg']
    }
  };
}

async function main() {
  console.log('smoke: agent-business-skill-react-entry');

  const userInput = '我已确认 SKU 组合：2双：白色+黑色；3双：白色+黑色+灰色。请继续生成 SKU 组合图和自选备注。';
  const control = buildAgentIntentControlPlaneDecision({
    userInput,
    hasDocument: true,
    photoshopConnected: true
  });

  assert.strictEqual(control.requestKind, 'autonomous_execution');
  assert.strictEqual(control.executionAuthorization, 'confirmed_tool_required');

  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const executed = [];

  try {
    skillExecutors.getSkillExecutor = (skillId) => ({
      skillId,
      execute: async () => ({ success: true, message: `stub:${skillId}` })
    });
    skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
      executed.push({
        skillId,
        params: payload?.params || {}
      });
      return {
        success: true,
        message: `stub:${skillId}`,
        data: { stubbed: true }
      };
    };

    const engine = new DesignAgentEngine();
    const steps = [];
    const result = await engine.run(createContext(userInput), {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'direct_response',
              intentSummary: '确认后的 SKU 生产应进入 Agent ReAct。',
              directResponse: '可以开始生成 SKU。'
            })
          };
        }
        return { text: '公开判断：先进入 ReAct，定位 sku-batch 工作流桥后观察结果。' };
      },
      callbacks: {
        onStep: (step) => steps.push(step)
      }
    });

    assert.deepStrictEqual(
      executed.map((item) => item.skillId),
      ['autonomous-agent'],
      `business production should enter autonomous-agent only, got ${JSON.stringify(executed)}`
    );
    assert.strictEqual(result.data?.agentRequestLifecycle?.decision?.route, 'autonomous_agent');
    assert.strictEqual(result.data?.agentRequestLifecycle?.decision?.skillId, 'autonomous-agent');
    assert.ok(
      !executed.some((item) => item.skillId === 'sku-batch'),
      'engine must not call sku-batch directly for confirmed production'
    );
    assert.ok(
      steps.some((step) => /整理设计计划|准备处理任务/.test(String(step.title || ''))),
      'engine should expose the ReAct planning entry step'
    );

    console.log('  ✓ confirmed SKU production enters autonomous-agent, not direct sku-batch');
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  console.log('\n✅ agent-business-skill-react-entry smoke 全部通过');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
