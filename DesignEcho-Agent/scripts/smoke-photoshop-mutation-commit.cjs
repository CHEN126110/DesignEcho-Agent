#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const root = path.resolve(__dirname, '..');
const {
  readPhotoshopMutationCommit
} = require(path.join(root, 'src', 'shared', 'photoshop-history-state-ref.ts'));
const {
  buildAgentOperationDocumentTimeline,
  findLatestObservedPhotoshopMutationIndex
} = require(path.join(root, 'src', 'shared', 'agent-operation-document-timeline.ts'));
const {
  buildAgentToolExecutionPreflight
} = require(path.join(root, 'src', 'shared', 'agent-tool-execution-preflight.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rawCommit(overrides = {}) {
  return {
    version: 'photoshop-mutation-commit/v1',
    basis: 'same_execute_as_modal',
    bindingStrength: 'document_revision',
    before: { documentId: 406, historyStateId: 8500, activeLayerId: 45 },
    after: { documentId: 406, historyStateId: 8501, activeLayerId: 46 },
    toolActionCompleted: false,
    mutationObserved: false,
    documentChanged: true,
    ...overrides
  };
}

function main() {
  const failedButMutatedResult = {
    success: false,
    error: 'rename failed after make',
    photoshopMutationCommit: rawCommit()
  };
  const parsed = readPhotoshopMutationCommit(failedButMutatedResult);
  assert(parsed, 'a valid same-modal commit must parse');
  assert(parsed.mutationObserved === true, 'Renderer must rederive mutationObserved from Host refs');
  assert(parsed.documentChanged === false, 'Renderer must rederive documentChanged from document IDs');
  assert(parsed.toolActionCompleted === false, 'callback failure must remain distinguishable from full completion');
  assert(parsed.after.activeLayerId === 46, 'the post-mutation active layer identity must survive parsing');

  const forged = readPhotoshopMutationCommit({
    photoshopMutationCommit: rawCommit({
      before: { documentId: 406, historyStateId: 8500, activeLayerId: 45 },
      after: { documentId: 406, historyStateId: 8500, activeLayerId: 45 },
      mutationObserved: true
    })
  });
  assert(forged && forged.mutationObserved === false, 'a forged mutation boolean must not create Host evidence');
  assert(
    readPhotoshopMutationCommit({
      photoshopMutationCommit: rawCommit({ version: 'photoshop-mutation-commit/v0' })
    }) === undefined,
    'legacy or unknown commit versions must fail closed'
  );
  assert(
    readPhotoshopMutationCommit({
      photoshopMutationCommit: rawCommit({
        before: { documentId: 406, historyStateId: 8500 }
      })
    }) === undefined,
    'a malformed supplied before state must not be downgraded to an honest unknown state'
  );

  const operationLog = [{
    name: 'createRectangle',
    result: failedButMutatedResult,
    succeeded: false
  }];
  const timeline = buildAgentOperationDocumentTimeline(operationLog);
  assert(timeline.entries[0].photoshopMutationObserved === true, 'failed-but-mutated writes must invalidate stale observations');
  assert(findLatestObservedPhotoshopMutationIndex(operationLog) === 0, 'the same-modal commit must become the mutation frontier');

  const preflight = buildAgentToolExecutionPreflight({
    assistantContent: '',
    requiresUserVisiblePreActionRationale: false,
    completedToolCalls: [
      {
        name: 'getDocumentInfo',
        result: {
          success: true,
          document: { id: 406, activeLayerId: 45 },
          historyStateRef: { documentId: 406, historyStateId: 8500 }
        }
      },
      {
        name: 'createRectangle',
        result: failedButMutatedResult
      }
    ],
    toolCalls: [{ name: 'createTextLayer', arguments: { content: '继续写入' } }]
  });
  assert(preflight.status === 'ready', `commit.after must ground the next guarded write: ${JSON.stringify(preflight)}`);
  assert(preflight.preconditions.targetGuard.expectedDocumentId === 406, 'the next guard must retain the committed document');
  assert(preflight.preconditions.targetGuard.expectedHistoryStateRef.historyStateId === 8501, 'the next guard must use the committed Host revision');
  assert(preflight.preconditions.targetGuard.expectedActiveLayerId === 46, 'the next guard must use the committed active layer');
  assert(
    preflight.preconditions.targetGuard.observationTool === 'createRectangle:mutation_commit_after',
    'the target guard must disclose its same-modal commit source'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'Renderer rederives same-modal commit facts from before/after Host identity',
      'failed-but-mutated writes advance the shared mutation frontier',
      'commit.after grounds the next exact target guard without a second ledger',
      'unknown commit versions fail closed'
    ]
  }, null, 2));
}

main();
