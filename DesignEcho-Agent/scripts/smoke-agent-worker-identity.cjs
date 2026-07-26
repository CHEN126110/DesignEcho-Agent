#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function compileTsModule(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });
  const compiledModule = new Module(filename, module);
  compiledModule.filename = filename;
  compiledModule.paths = Module._nodeModulePaths(path.dirname(filename));
  compiledModule._compile(compiled.outputText, `${filename}.js`);
  return compiledModule.exports;
}

function loadVisibleFeedbackExports() {
  const filename = path.join(ROOT, 'src/renderer/services/agent-visible-feedback.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  const serviceModule = new Module(filename, module);
  serviceModule.filename = filename;
  serviceModule.paths = Module._nodeModulePaths(path.dirname(filename));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './tool-display-info') {
      return {
        getToolDisplayInfo: (toolName) => ({
          name: toolName,
          icon: 'T',
          description: toolName
        })
      };
    }
    if (request === '../../shared/skills/skill-declarations') {
      return {
        getSkillById: (skillId) => {
          const skills = {
            'autonomous-agent': { id: 'autonomous-agent', name: 'Autonomous Agent', visibility: 'system-only' },
            'sku-batch': { id: 'sku-batch', name: 'SKU Batch', visibility: 'user-facing' }
          };
          return skills[skillId];
        }
      };
    }
    if (request === './design-teams') {
      return {
        getDesignTeammateDefinition: (role) => {
          const definitions = {
            'scene-analyst': { role, displayName: 'Scene Analyst' },
            'design-strategist': { role, displayName: 'Design Strategist' },
            executor: { role, displayName: 'Executor' },
            critic: { role, displayName: 'Critic' }
          };
          return definitions[role];
        }
      };
    }
    if (request === '../../shared/agent-observation-channels') {
      const policyFilename = path.join(ROOT, 'src/shared/agent-observation-channels.ts');
      const policySource = fs.readFileSync(policyFilename, 'utf8');
      const policyCompiled = ts.transpileModule(policySource, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true
        },
        fileName: policyFilename
      });
      const policyModule = new Module(policyFilename, module);
      policyModule.filename = policyFilename;
      policyModule.paths = Module._nodeModulePaths(path.dirname(policyFilename));
      policyModule._compile(policyCompiled.outputText, `${policyFilename}.js`);
      return policyModule.exports;
    }
    if (request === '../../shared/chat-response-cleaner') {
      return compileTsModule(path.join(ROOT, 'src/shared/chat-response-cleaner.ts'));
    }
    if (request === './conversational-unavailable-message' || request === '../../shared/conversational-unavailable-message') {
      return compileTsModule(path.join(ROOT, 'src/shared/conversational-unavailable-message.ts'));
    }
    if (request === './agent-user-visible-state') {
      return compileTsModule(path.join(ROOT, 'src/shared/agent-user-visible-state.ts'));
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    serviceModule._compile(compiled.outputText, `${filename}.js`);
  } finally {
    Module._load = originalLoad;
  }

  return serviceModule.exports;
}

function assertWorkerIdentityActivity() {
  const {
    buildVisibleAgentActivityFromStepEvent,
    isVisiblePonderingStep
  } = loadVisibleFeedbackExports();

  assert(typeof buildVisibleAgentActivityFromStepEvent === 'function', 'visible activity event mapper is missing');
  assert(typeof isVisiblePonderingStep === 'function', 'visible pondering filter is missing');

  const started = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '开始子 Agent：Scene Analyst',
    detail: '子 Agent role: scene-analyst',
    status: 'running',
    toolName: 'delegateToAgent:scene-analyst',
    toolCallId: 'delegate-scene-analyst-1'
  });

  assert(started, 'delegateToAgent teammate start event must become visible activity');
  assert(started.kind === 'teammate', `teammate event kind must be teammate, got ${started.kind}`);
  assert(started.agentId === 'scene-analyst', `teammate activity must expose role id, got ${started.agentId}`);
  assert(started.agentLabel === 'Scene Analyst', `teammate activity must use registry label, got ${started.agentLabel}`);
  assert(started.source === 'teammate_event', `teammate source must be teammate_event, got ${started.source}`);
  assert(started.showAsThinking === false, 'teammate activity must not render as provider thinking');
  assert(started.isProviderThinking === false, 'teammate activity must not claim provider thinking');
  assert(started.canClaimModelReasoning === false, 'teammate activity must not claim model reasoning');

  const completed = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_completed',
    title: '子 Agent 完成：Scene Analyst',
    detail: '子 Agent role: scene-analyst',
    status: 'success',
    toolName: 'delegateToAgent:scene-analyst',
    toolCallId: 'delegate-scene-analyst-1'
  });

  assert(completed && completed.kind === 'teammate', 'delegateToAgent teammate completion event must preserve teammate identity');

  assert(
    isVisiblePonderingStep({ type: 'activity', content: 'Scene Analyst 正在工作' }) === false,
    'visible teammate activity must not enter pondering steps'
  );
}

function assertRuntimeDelegateWiring() {
  const executorSource = fs.readFileSync(
    path.join(ROOT, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts'),
    'utf8'
  );

  assert(executorSource.includes('emitTeammateActivityStep'), 'autonomous-agent executor must emit teammate activity events');
  assert(executorSource.includes('createExecuteToolWrapper'), 'delegate tool wrapper must be scoped per run with callbacks');
  assert(executorSource.includes('delegateToAgent:'), 'delegate tool events must expose role-specific tool identity');
  assert(!executorSource.includes('const executeToolWrapper: ExecuteToolFn = async (toolName, params) =>'), 'legacy global executeToolWrapper must be removed');
}

function main() {
  assertWorkerIdentityActivity();
  assertRuntimeDelegateWiring();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'delegateToAgent teammate events expose current worker identity',
      'teammate activity is user-visible but cannot claim provider thinking',
      'teammate activity is excluded from pondering steps',
      'autonomous-agent delegates emit role-scoped UI events'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
