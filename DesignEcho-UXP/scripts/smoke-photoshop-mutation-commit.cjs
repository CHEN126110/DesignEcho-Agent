#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'core', 'photoshop-mutation-commit.ts');

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPhotoshopHarness() {
  let modalDepth = 0;
  let modalCount = 0;
  let beforeModalCallback = null;
  let state = {
    documentId: 41,
    historyStateId: 701,
    activeLayerId: 17
  };
  const events = [];

  function assertInsideModal(label) {
    assert(modalDepth > 0, `${label} must be read inside executeAsModal`);
  }

  function record(label, detail) {
    events.push({ label, detail, insideModal: modalDepth > 0 });
  }

  const document = {};
  Object.defineProperties(document, {
    id: {
      enumerable: true,
      get() {
        assertInsideModal('document.id');
        record('document.id', state.documentId);
        return state.documentId;
      }
    },
    activeHistoryState: {
      enumerable: true,
      get() {
        assertInsideModal('document.activeHistoryState');
        record('document.activeHistoryState', state.historyStateId);
        return { id: state.historyStateId };
      }
    },
    activeLayers: {
      enumerable: true,
      get() {
        assertInsideModal('document.activeLayers');
        record('document.activeLayers', state.activeLayerId);
        return state.activeLayerId === null ? [] : [{ id: state.activeLayerId }];
      }
    }
  });

  const app = {};
  Object.defineProperty(app, 'activeDocument', {
    enumerable: true,
    get() {
      assertInsideModal('app.activeDocument');
      record('app.activeDocument', state.documentId);
      return document;
    }
  });

  const photoshop = {
    app,
    core: {
      async executeAsModal(callback, options) {
        modalCount += 1;
        record('modal:requested', normalize(options));
        const hook = beforeModalCallback;
        beforeModalCallback = null;
        if (hook) hook();
        assert.strictEqual(modalDepth, 0, 'mutation commit smoke does not permit nested modal scopes');
        modalDepth += 1;
        record('modal:enter', normalize(options));
        try {
          return await callback();
        } finally {
          record('modal:exit', normalize(options));
          modalDepth -= 1;
        }
      }
    }
  };

  function reset(overrides = {}) {
    state = {
      documentId: 41,
      historyStateId: 701,
      activeLayerId: 17,
      ...overrides
    };
    modalDepth = 0;
    modalCount = 0;
    beforeModalCallback = null;
    events.length = 0;
  }

  function setState(overrides) {
    state = { ...state, ...overrides };
    record('host:set-state', normalize(state));
  }

  function setBeforeModalCallback(callback) {
    beforeModalCallback = callback;
  }

  function getState() {
    return {
      host: { ...state },
      modalDepth,
      modalCount,
      events: events.slice()
    };
  }

  reset();
  return {
    photoshop,
    reset,
    setState,
    setBeforeModalCallback,
    getState,
    isInsideModal: () => modalDepth > 0,
    record
  };
}

function resolveLocalModule(parentPath, request) {
  const unresolved = path.resolve(path.dirname(parentPath), request);
  const candidates = [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, path.join(unresolved, 'index.ts')];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) throw new Error(`Unable to resolve ${request} from ${parentPath}`);
  return resolved;
}

function createTypeScriptLoader(photoshop) {
  const cache = new Map();

  function load(modulePath) {
    const absolutePath = path.resolve(modulePath);
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports;

    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true
      },
      fileName: absolutePath
    }).outputText;
    const moduleRecord = { exports: {} };
    cache.set(absolutePath, moduleRecord);
    const localRequire = (request) => {
      if (request === 'photoshop') return photoshop;
      if (request.startsWith('.')) return load(resolveLocalModule(absolutePath, request));
      throw new Error(`Unexpected require ${request} from ${absolutePath}`);
    };

    new Function('require', 'module', 'exports', compiled)(localRequire, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  }

  return load;
}

function revisionGuard(historyStateId = 701) {
  return Object.freeze({
    expectedDocumentId: 41,
    expectedActiveLayerId: 17,
    expectedHistoryStateRef: Object.freeze({
      documentId: 41,
      historyStateId
    }),
    observationTool: 'getDocumentInfo'
  });
}

function documentGuard() {
  return Object.freeze({
    expectedDocumentId: 41,
    expectedActiveLayerId: 17,
    observationTool: 'getDocumentInfo'
  });
}

function assertCommit(commit, expected) {
  assert(commit, 'result must include photoshopMutationCommit');
  assert.strictEqual(commit.version, 'photoshop-mutation-commit/v1');
  assert.strictEqual(commit.basis, 'same_execute_as_modal');
  assert.strictEqual(commit.bindingStrength, expected.bindingStrength);
  assert.deepStrictEqual(normalize(commit.before), expected.before);
  assert.deepStrictEqual(normalize(commit.after), expected.after);
  assert.strictEqual(commit.toolActionCompleted, expected.toolActionCompleted);
  assert.strictEqual(commit.mutationObserved, expected.mutationObserved);
  assert.strictEqual(commit.documentChanged, expected.documentChanged);
}

function assertCommitReadsStayInsideOneModal(events) {
  const enterIndex = events.findIndex((event) => event.label === 'modal:enter');
  const exitIndex = events.findIndex((event) => event.label === 'modal:exit');
  assert(enterIndex >= 0, 'modal must be entered');
  assert(exitIndex > enterIndex, 'modal must exit after the commit observations');
  const observationIndexes = events
    .map((event, index) => (
      event.label === 'app.activeDocument'
      || event.label === 'document.id'
      || event.label === 'document.activeHistoryState'
      || event.label === 'document.activeLayers'
        ? index
        : -1
    ))
    .filter((index) => index >= 0);
  assert(observationIndexes.length > 0, 'commit must read Photoshop Host identity');
  assert(observationIndexes.every((index) => index > enterIndex && index < exitIndex),
    'all before/after Host identity reads must stay inside the same modal callback');
  assert(observationIndexes.every((index) => events[index].insideModal),
    'all before/after Host identity reads must be marked inside modal');
}

async function run() {
  const harness = createPhotoshopHarness();
  const load = createTypeScriptLoader(harness.photoshop);
  const { executePhotoshopMutation } = load(sourcePath);

  harness.reset();
  let callbackCount = 0;
  const success = await executePhotoshopMutation({
    toolName: 'atomicSuccess',
    commandName: 'Atomic success',
    context: {
      requestId: 'success-1',
      photoshopTargetGuard: revisionGuard()
    },
    expectedEffect: 'mutation_required',
    mutate: async () => {
      assert(harness.isInsideModal(), 'successful mutation callback must run inside the commit modal');
      callbackCount += 1;
      harness.record('mutation:success');
      harness.setState({ historyStateId: 702, activeLayerId: 18 });
      return { success: true, value: 'written' };
    }
  });
  assert.strictEqual(success.success, true);
  assert.strictEqual(success.value, 'written');
  assert.strictEqual(callbackCount, 1);
  assert.strictEqual(harness.getState().modalCount, 1);
  assertCommit(success.photoshopMutationCommit, {
    bindingStrength: 'document_revision',
    before: { documentId: 41, historyStateId: 701, activeLayerId: 17 },
    after: { documentId: 41, historyStateId: 702, activeLayerId: 18 },
    toolActionCompleted: true,
    mutationObserved: true,
    documentChanged: false
  });
  assertCommitReadsStayInsideOneModal(harness.getState().events);

  harness.reset();
  callbackCount = 0;
  harness.setBeforeModalCallback(() => {
    harness.setState({ historyStateId: 702 });
  });
  const raced = await executePhotoshopMutation({
    toolName: 'atomicRace',
    commandName: 'Atomic race',
    context: {
      requestId: 'race-1',
      photoshopTargetGuard: revisionGuard()
    },
    expectedEffect: 'mutation_required',
    mutate: async () => {
      callbackCount += 1;
      return { success: true };
    }
  });
  assert.strictEqual(raced.success, false);
  assert.strictEqual(raced.code, 'photoshop_target_changed_before_execution');
  assert.strictEqual(raced.phase, 'mutation_modal');
  assert.strictEqual(raced.expected.historyStateId, 701);
  assert.strictEqual(raced.actual.historyStateId, 702);
  assert.strictEqual(callbackCount, 0, 'modal-time revision mismatch must not invoke mutation callback');
  assert.strictEqual(harness.getState().modalCount, 1);
  assert.strictEqual(raced.photoshopMutationCommit, undefined,
    'a mutation callback that never started must not fabricate an atomic commit');

  harness.reset();
  callbackCount = 0;
  const failedAfterWrite = await executePhotoshopMutation({
    toolName: 'atomicFailure',
    commandName: 'Atomic failure after write',
    context: { requestId: 'failure-1' },
    expectedEffect: 'mutation_required',
    mutate: async () => {
      callbackCount += 1;
      harness.setState({ historyStateId: 702, activeLayerId: 18 });
      throw new Error('failure after Host mutation');
    }
  });
  assert.strictEqual(failedAfterWrite.success, false);
  assert.strictEqual(callbackCount, 1);
  assert(String(failedAfterWrite.errorDetails?.message || '').includes('failure after Host mutation'),
    'callback failure must retain the original diagnostic');
  assertCommit(failedAfterWrite.photoshopMutationCommit, {
    bindingStrength: 'unguarded',
    before: { documentId: 41, historyStateId: 701, activeLayerId: 17 },
    after: { documentId: 41, historyStateId: 702, activeLayerId: 18 },
    toolActionCompleted: false,
    mutationObserved: true,
    documentChanged: false
  });
  assertCommitReadsStayInsideOneModal(harness.getState().events);

  harness.reset();
  callbackCount = 0;
  const explicitBusinessFailure = await executePhotoshopMutation({
    toolName: 'atomicBusinessFailure',
    commandName: 'Atomic explicit business failure',
    context: { requestId: 'business-failure-1' },
    expectedEffect: 'mutation_required',
    mutate: async () => {
      callbackCount += 1;
      return {
        success: false,
        code: 'shape_precondition_failed',
        error: 'original business failure',
        data: null
      };
    }
  });
  assert.strictEqual(explicitBusinessFailure.success, false);
  assert.strictEqual(explicitBusinessFailure.code, 'shape_precondition_failed');
  assert.strictEqual(explicitBusinessFailure.error, 'original business failure');
  assert.strictEqual(callbackCount, 1);
  assertCommit(explicitBusinessFailure.photoshopMutationCommit, {
    bindingStrength: 'unguarded',
    before: { documentId: 41, historyStateId: 701, activeLayerId: 17 },
    after: { documentId: 41, historyStateId: 701, activeLayerId: 17 },
    toolActionCompleted: false,
    mutationObserved: false,
    documentChanged: false
  });

  harness.reset();
  callbackCount = 0;
  const noOp = await executePhotoshopMutation({
    toolName: 'atomicNoOp',
    commandName: 'Atomic no-op',
    context: {
      requestId: 'noop-1',
      photoshopTargetGuard: documentGuard()
    },
    expectedEffect: 'allow_noop',
    mutate: async () => {
      callbackCount += 1;
      return { success: true, value: 'unchanged' };
    }
  });
  assert.strictEqual(noOp.success, true);
  assert.strictEqual(noOp.value, 'unchanged');
  assert.strictEqual(callbackCount, 1);
  assertCommit(noOp.photoshopMutationCommit, {
    bindingStrength: 'document_only',
    before: { documentId: 41, historyStateId: 701, activeLayerId: 17 },
    after: { documentId: 41, historyStateId: 701, activeLayerId: 17 },
    toolActionCompleted: true,
    mutationObserved: false,
    documentChanged: false
  });

  harness.reset();
  callbackCount = 0;
  const cancelled = await executePhotoshopMutation({
    toolName: 'atomicCancelled',
    commandName: 'Atomic cancelled before write',
    context: {
      requestId: 'cancelled-1',
      isCancelled: () => true,
      photoshopTargetGuard: revisionGuard()
    },
    expectedEffect: 'mutation_required',
    mutate: async () => {
      callbackCount += 1;
      return { success: true };
    }
  });
  assert.strictEqual(cancelled.success, false);
  assert.strictEqual(cancelled.cancelled, true);
  assert.strictEqual(callbackCount, 0, 'pre-mutation cancellation must not invoke callback');
  assert.strictEqual(harness.getState().modalCount, 1);
  assert.strictEqual(cancelled.photoshopMutationCommit, undefined,
    'pre-mutation cancellation must not fabricate an atomic commit');
  assert.strictEqual(
    harness.getState().events.some((event) => event.label === 'app.activeDocument'),
    false,
    'pre-mutation cancellation must stop before reading or mutating the Photoshop target'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'matching H701 mutation returns a same-modal H701 to H702 commit',
      'revision change before modal callback blocks mutation with callback count zero',
      'failure after a Host write preserves the changed atomic commit',
      'explicit callback failure keeps its original error and code under mutation-required policy',
      'allowed no-op returns a completed but unchanged document-only commit',
      'pre-mutation cancellation runs no callback and fabricates no commit'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
