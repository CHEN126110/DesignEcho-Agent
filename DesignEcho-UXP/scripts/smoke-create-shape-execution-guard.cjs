#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'canvas', 'create-shape.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function loadCreateShape(action, executePhotoshopMutation, createToolFailureResult) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: sourcePath
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === 'photoshop') return { action };
    if (request === '../../core/photoshop-mutation-commit') return { executePhotoshopMutation };
    if (request === '../../core/tool-error-normalizer') return { createToolFailureResult };
    throw new Error(`Unexpected require: ${request}`);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}

function createFailure(input) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return { success: false, error: message, data: null };
}

async function runResolvedBatchPlayBehavior() {
  const oldLayer = { id: 11, name: 'old-active-layer' };
  const errorDocument = { id: 41, activeLayers: [oldLayer], layers: [oldLayer] };
  let errorBatchPlayCalls = 0;
  const errorAction = {
    async batchPlay() {
      errorBatchPlayCalls += 1;
      return [{ _obj: 'error', message: 'make is unavailable', result: -1 }];
    }
  };
  const executeAgainstErrorDocument = async (input) => {
    try {
      return await input.mutate({ document: errorDocument });
    } catch (error) {
      return createFailure({ error });
    }
  };
  const { CreateRectangleTool: ErrorRectangleTool } = loadCreateShape(
    errorAction,
    executeAgainstErrorDocument,
    createFailure
  );
  const failedMake = await new ErrorRectangleTool().execute({
    name: 'new-shape',
    x: 0,
    y: 0,
    width: 100,
    height: 80
  });
  assert(failedMake.success === false, 'resolved make error descriptor must fail the Tool');
  assert(errorBatchPlayCalls === 1, 'resolved make error must stop before rename');
  assert(oldLayer.name === 'old-active-layer', 'resolved make error must never rename the old active layer');

  const successOldLayer = { id: 31, name: 'keep-old-name' };
  const successDocument = { id: 42, activeLayers: [successOldLayer], layers: [successOldLayer] };
  let successBatchPlayCalls = 0;
  const successAction = {
    async batchPlay(descriptors) {
      successBatchPlayCalls += 1;
      if (descriptors[0]._obj === 'make') {
        const newLayer = { id: 32, name: 'temporary-shape-name' };
        successDocument.layers.push(newLayer);
        successDocument.activeLayers = [newLayer];
        return [{ _obj: 'contentLayer' }];
      }
      const targetId = descriptors[0]._target[0]._id;
      const target = successDocument.layers.find((layer) => layer.id === targetId);
      target.name = descriptors[0].to.name;
      return [{ _obj: 'set' }];
    }
  };
  const executeAgainstSuccessDocument = async (input) => {
    try {
      return await input.mutate({ document: successDocument });
    } catch (error) {
      return createFailure({ error });
    }
  };
  const { CreateEllipseTool } = loadCreateShape(
    successAction,
    executeAgainstSuccessDocument,
    createFailure
  );
  const created = await new CreateEllipseTool().execute({
    name: 'verified-shape',
    x: 50,
    y: 40,
    width: 100,
    height: 80
  });
  assert(created.success === true && created.layerId === 32, 'successful make must return the newly activated layer ID');
  assert(successBatchPlayCalls === 2, 'successful shape creation must run make then explicit-ID rename');
  assert(successOldLayer.name === 'keep-old-name', 'successful shape creation must not rename the prior active layer');
  assert(successDocument.layers[1].name === 'verified-shape', 'the new shape name must be read back from the created layer');
}

async function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert(
    source.includes('createToolFailureResult'),
    'create-shape tools should return normalized tool failures'
  );

  await runResolvedBatchPlayBehavior();
  assert(
    !source.includes('error instanceof Error ? error.message'),
    'create-shape tools should not expose raw Error.message as the whole tool error'
  );
  assert(
    !source.includes("], { commandName: 'DesignEcho:"),
    'create-shape batchPlay calls should not use commandName-only options'
  );
  assert(
    !source.includes("modalBehavior: 'fail'"),
    'create-shape batchPlay calls should not use modalBehavior fail inside executeAsModal'
  );
  assert(
    source.includes('synchronousExecution: true'),
    'create-shape batchPlay calls should run synchronously inside executeAsModal'
  );
  assert(
    source.includes("dialogOptions: 'dontDisplay'"),
    'create-shape batchPlay descriptors should suppress Photoshop action dialogs'
  );
  assert(
    source.includes("executePhotoshopMutation")
      && !source.includes('core.executeAsModal')
      && (source.match(/expectedEffect: 'mutation_required'/g) || []).length === 2,
    'both shape tools must delegate modal ownership to the atomic mutation helper and require a Host revision change'
  );
  assert(
    source.includes("descriptor._obj === 'error'")
      && source.includes('assertBatchPlaySucceeded(makeResults')
      && source.includes("_target: [{ _ref: 'layer', _id: layerId }]")
      && source.includes('createdLayer.name !== name'),
    'shape creation must reject resolved batchPlay errors, rename only the new layer ID, and read back its final name'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'create-shape tools use normalized failures',
      'create-shape batchPlay calls are executeAsModal-safe and no-dialog',
      'rectangle and ellipse share the same-modal mutation owner and reject unobserved writes',
      'resolved batchPlay errors cannot rename an old active layer or fake a new shape',
      'behavior smoke proves make errors stop before rename and success renames only the new layer ID'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
});
