#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const ROOT = path.resolve(__dirname, '..');
const {
  ArtifactRepositoryError,
  ArtifactRepositoryService,
  FileArtifactRepository,
  artifactRepositoryService
} = require(path.join(ROOT, 'src', 'main', 'services', 'artifact-repository-service.ts'));
const {
  DesignProjectStateStore
} = require(path.join(ROOT, 'src', 'main', 'services', 'design-project-state-store.ts'));
const {
  SerializedFileOperations
} = require(path.join(ROOT, 'src', 'main', 'services', 'serialized-file-operations.ts'));
const {
  readArtifactRepositoryProjection
} = require(path.join(
  ROOT,
  'src',
  'shared',
  'agent-runtime-v5',
  'artifact-repository-contract.ts'
));
const {
  canonicalize,
  computeArtifactRecordHash,
  computeAuthoritativeContentHash
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'content-hash.ts'));
const {
  V5_ARTIFACT_TYPES
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'contracts', 'index.ts'));
const {
  RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
  RUNTIME_ARTIFACT_FINALIZATION_VERSION,
  buildRuntimeArtifactId
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-artifact-finalization.ts'));
const {
  validateRuntimeDesignBriefDeclaration
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts'));
const {
  buildRuntimeDesignStrategyDigest,
  validateRuntimeDesignStrategyDeclaration
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-strategy-declaration.ts'));
const {
  validateRuntimeActionPlanDeclaration
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-action-plan-declaration.ts'));
const COMMON_V5_SCHEMA = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'schemas', 'v5', 'common-definitions.schema.json'),
  'utf8'
));

const FIXED_NOW = '2026-07-22T12:00:00.000Z';
const REPOSITORY_PARTS = ['.designecho', 'artifacts', 'v1', 'objects'];

function runtimeScope(overrides = {}) {
  return {
    sessionId: 'session-artifact-smoke',
    runId: 'run-artifact-smoke',
    generation: 1,
    ...overrides
  };
}

function publishRequest(overrides = {}) {
  return {
    artifactId: 'context-json-v1',
    artifactType: V5_ARTIFACT_TYPES.contextSnapshot,
    projectId: 'artifact-smoke-project',
    skillId: 'design.generic.v1',
    sourceRevision: 1,
    sourceRefs: [],
    capabilityStatus: 'real',
    modelProfile: 'smoke-visual-model',
    runtimeBinding: runtimeScope(),
    payload: {
      kind: 'json',
      value: {
        product: '非 UTF-8 二进制之外的 JSON 正文',
        nested: { stable: true },
        order: ['observe', 'plan', 'execute']
      }
    },
    ...overrides
  };
}

function runtimeDesignBriefValue() {
  const result = validateRuntimeDesignBriefDeclaration({
    value: {
      workMode: 'analyze_only',
      taskGoal: '验证 Repository Runtime 收尾',
      deliverables: ['refs-only projection'],
      outputRequirements: [],
      constraints: [],
      inputCoverage: [],
      contextRefs: ['context:user_goal']
    },
    requiredInputKeys: [],
    optionalInputKeys: [],
    allowedContextRefs: ['context:user_goal'],
    inputSources: {},
    resolvedInputs: []
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues, null, 2));
  return result.declaration;
}

function runtimeDesignStrategyValue() {
  const result = validateRuntimeDesignStrategyDeclaration({
    value: {
      stageGoal: '形成可执行设计策略',
      objective: {
        primaryGoal: '验证可追溯的 Repository 收尾',
        secondaryGoals: [],
        targetAudienceSummary: '需要稳定设计交付的用户'
      },
      messageArchitecture: {
        primaryMessage: '声明、执行与交付结果保持可追溯',
        supportingMessages: [],
        supportingFacts: [],
        objectionsToResolve: []
      },
      copyDirection: {
        toneKeywords: ['清晰'],
        headlineOptions: [],
        subtitleOptions: [],
        tagOptions: [],
        prohibitedClaims: []
      },
      visualDirection: {
        moodKeywords: ['克制'],
        paletteIntent: [],
        typographyIntent: [],
        compositionIntent: ['按信息层级递进'],
        imageTreatment: [],
        density: 'medium'
      },
      constraints: [],
      contextRefs: ['context:design_brief'],
      assumptions: [],
      missingInputs: []
    },
    allowedContextRefs: ['context:design_brief']
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues, null, 2));
  return result.declaration;
}

function runtimeActionPlanValue() {
  const result = validateRuntimeActionPlanDeclaration({
    value: {
      planGoal: '先观察，再执行，最后读回',
      strategyRef: 'current:r3_design_strategy',
      contextRefs: ['context:design_strategy'],
      steps: [{
        stepId: 'observe_scene',
        kind: 'observe',
        goal: '观察当前画面与可用上下文',
        dependsOn: [],
        capabilityRefs: ['capability:visual_observation'],
        inputContextRefs: ['context:design_strategy'],
        expectedOutcomes: ['visual_observation'],
        completionCriteria: ['形成可追溯的视觉观察'],
        failurePolicy: 'request_input'
      }],
      missingInputs: []
    },
    strategyDigest: buildRuntimeDesignStrategyDigest(runtimeDesignStrategyValue()),
    allowedContextRefs: ['context:design_strategy'],
    capabilityContext: {
      discoveredCapabilityRefs: ['capability:visual_observation'],
      activeActionCapabilityRefs: ['capability:visual_observation'],
      onDemandActionCapabilityRefs: []
    },
    forbiddenToolNames: []
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues, null, 2));
  return result.declaration;
}

function evaluationReportValue() {
  return {
    version: 'design-quality-verdict/v0',
    status: 'not_applicable',
    source: 'none',
    contractFailedRequirementIds: [],
    blockers: [],
    warnings: [],
    summary: '本 smoke 只验证 Repository 发布边界。'
  };
}

function runtimeDeliveryVerificationValue() {
  return {
    version: 'runtime-delivery-verification/v1',
    status: 'incomplete',
    requiredOutputs: [],
    confirmedOutputs: [],
    missingOutputs: [],
    targetBound: false,
    reviewedPreviewBound: false,
    sourceHistoryStateBound: false,
    boundaries: {
      manifestRequirementsOnly: true,
      explicitReceiptRequired: true,
      sameTargetPreviewRequired: true,
      exactSourceHistoryRequired: true,
      qualityVerdictAuthority: false,
      grantsPermission: false,
      executesTools: false
    }
  };
}

function runtimePublishRequest(overrides = {}) {
  const runtimeBinding = overrides.runtimeBinding || runtimeScope();
  const artifactType = V5_ARTIFACT_TYPES.runtimeDesignBrief;
  return {
    projectId: 'artifact-smoke-project',
    skillId: 'design.generic.v1',
    sourceRefs: [],
    payload: { kind: 'json', value: runtimeDesignBriefValue() },
    ...overrides,
    artifactId: buildRuntimeArtifactId(artifactType, runtimeBinding),
    artifactType,
    runtimeBinding,
    sourceRevision: runtimeBinding.generation,
    capabilityStatus: 'manual_verification_pending',
    modelProfile: undefined
  };
}

function artifactDirectory(projectPath, artifactId) {
  return path.join(projectPath, ...REPOSITORY_PARTS, artifactId);
}

function artifactRecordPath(projectPath, artifactId) {
  return path.join(artifactDirectory(projectPath, artifactId), 'record.json');
}

function assertRefOnly(ref) {
  assert.deepStrictEqual(
    Object.keys(ref).sort(),
    ['artifactId', 'artifactType', 'contentHash'],
    'ArtifactRef must contain only id, type, and authoritative hash'
  );
  assert.match(ref.contentHash, /^sha256-jcs-v1:[0-9a-f]{64}$/);
}

async function expectRepositoryError(promise, expectedCode) {
  await assert.rejects(
    promise,
    (error) => {
      assert(error instanceof ArtifactRepositoryError, String(error));
      assert.strictEqual(error.code, expectedCode, error.message);
      return true;
    }
  );
}

function createProject(root, name) {
  const projectPath = path.join(root, name);
  fs.mkdirSync(projectPath, { recursive: true });
  return projectPath;
}

function createRepository(projectPath, options = {}) {
  return new FileArtifactRepository(projectPath, {
    now: () => FIXED_NOW,
    ...options
  });
}

async function runRestartProbe() {
  const projectPath = process.argv[3];
  const ref = JSON.parse(Buffer.from(process.argv[4], 'base64url').toString('utf8'));
  const scope = JSON.parse(Buffer.from(process.argv[5], 'base64url').toString('utf8'));
  const repository = createRepository(projectPath);
  const read = await repository.get(ref);
  const projection = await repository.readProjection(scope);
  process.stdout.write(JSON.stringify({
    ref: read.ref,
    payload: read.payload,
    projection
  }));
}

async function runSmoke() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-artifact-repository-'));
  let passed = 0;

  async function check(name, operation) {
    await operation();
    passed += 1;
    console.log(`  ✓ ${name}`);
  }

  console.log('smoke: artifact-repository');

  try {
    await check('TS ownership 与共用 JSON Schema 同时承认 R1 / E2 producer', async () => {
      const producers = COMMON_V5_SCHEMA.$defs.artifactProducerUnit.enum;
      assert(producers.includes('R1'));
      assert(producers.includes('E2'));
    });

    await check('权威 content/record hash 与 Node crypto 独立 oracle 一致，object key 重排不改变结果', async () => {
      const orderedContent = {
        schemaVersion: '1.0.0',
        artifactType: V5_ARTIFACT_TYPES.contextSnapshot,
        projectId: 'hash-oracle-project',
        skillId: 'design.generic.v1',
        sourceRevision: 3,
        sourceRefs: [],
        producer: { runtimeUnit: 'R2', capabilityStatus: 'real' },
        payload: { alpha: 1, nested: { beta: 2, gamma: ['三', '四'] } }
      };
      const reorderedContent = {
        payload: { nested: { gamma: ['三', '四'], beta: 2 }, alpha: 1 },
        producer: { capabilityStatus: 'real', runtimeUnit: 'R2' },
        sourceRefs: [],
        sourceRevision: 3,
        skillId: 'design.generic.v1',
        projectId: 'hash-oracle-project',
        artifactType: V5_ARTIFACT_TYPES.contextSnapshot,
        schemaVersion: '1.0.0'
      };
      const expectedContentHex = crypto.createHash('sha256')
        .update(canonicalize(orderedContent), 'utf8')
        .digest('hex');
      assert.strictEqual(
        computeAuthoritativeContentHash(orderedContent),
        `sha256-jcs-v1:${expectedContentHex}`
      );
      assert.strictEqual(
        computeAuthoritativeContentHash(reorderedContent),
        computeAuthoritativeContentHash(orderedContent)
      );

      const orderedRecord = {
        version: 'artifact-repository-record/v2',
        meta: { artifactId: 'hash-oracle-v1', contentHash: `sha256-jcs-v1:${expectedContentHex}` },
        payload: { kind: 'json', fileName: 'payload.json', byteLength: 2 },
        lineage: { version: 1 },
        runtimeBinding: { sessionId: 'session', runId: 'run', generation: 1 }
      };
      const reorderedRecord = {
        runtimeBinding: { generation: 1, runId: 'run', sessionId: 'session' },
        lineage: { version: 1 },
        payload: { byteLength: 2, fileName: 'payload.json', kind: 'json' },
        meta: { contentHash: `sha256-jcs-v1:${expectedContentHex}`, artifactId: 'hash-oracle-v1' },
        version: 'artifact-repository-record/v2'
      };
      const expectedRecordHex = crypto.createHash('sha256')
        .update(canonicalize(orderedRecord), 'utf8')
        .digest('hex');
      assert.strictEqual(
        computeArtifactRecordHash(orderedRecord),
        `sha256-jcs-record-v1:${expectedRecordHex}`
      );
      assert.strictEqual(computeArtifactRecordHash(reorderedRecord), computeArtifactRecordHash(orderedRecord));
    });

    await check('JSON 特殊 own key 进入规范化哈希，同 id 的 __proto__ 异内容重放被拒绝', async () => {
      const specialKeys = JSON.parse(
        '{"__proto__":"data-prototype","constructor":{"kind":"data-constructor"},"prototype":{"kind":"data-prototype-key"}}'
      );
      const canonicalSpecialKeys = canonicalize(specialKeys);
      const reparsedSpecialKeys = JSON.parse(canonicalSpecialKeys);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(reparsedSpecialKeys, '__proto__'), true);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(reparsedSpecialKeys, 'constructor'), true);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(reparsedSpecialKeys, 'prototype'), true);
      assert.strictEqual(reparsedSpecialKeys.__proto__, 'data-prototype');

      const protoA = JSON.parse('{"__proto__":"aa"}');
      const protoB = JSON.parse('{"__proto__":"bb"}');
      assert.strictEqual(Buffer.byteLength(JSON.stringify(protoA)), Buffer.byteLength(JSON.stringify(protoB)));
      assert.notStrictEqual(canonicalize(protoA), canonicalize(protoB));
      const hashInput = (payload) => ({
        schemaVersion: '1.0.0',
        artifactType: V5_ARTIFACT_TYPES.contextSnapshot,
        projectId: 'special-key-hash-project',
        skillId: 'design.generic.v1',
        sourceRevision: 1,
        sourceRefs: [],
        producer: { runtimeUnit: 'R2', capabilityStatus: 'real' },
        payload
      });
      assert.notStrictEqual(
        computeAuthoritativeContentHash(hashInput(protoA)),
        computeAuthoritativeContentHash(hashInput(protoB))
      );

      const specialKeyProject = createProject(temporaryRoot, 'special-key-project');
      const specialKeyRepository = createRepository(specialKeyProject);
      const artifactId = 'special-key-replay-v1';
      const first = await specialKeyRepository.publish(publishRequest({
        artifactId,
        payload: { kind: 'json', value: protoA }
      }));
      assert.strictEqual(first.payload.__proto__, 'aa');
      await expectRepositoryError(
        specialKeyRepository.publish(publishRequest({
          artifactId,
          payload: { kind: 'json', value: protoB }
        })),
        'in_place_modification'
      );
      assert.strictEqual((await specialKeyRepository.get(first.ref)).payload.__proto__, 'aa');
    });

    const healthyProject = createProject(temporaryRoot, 'healthy-project');
    const repository = createRepository(healthyProject);
    const mutableJson = {
      product: '袜子',
      nested: { stable: true },
      order: ['observe', 'plan', 'execute']
    };
    const jsonRequest = publishRequest({
      artifactId: 'context-json-v1',
      payload: { kind: 'json', value: mutableJson }
    });
    let jsonPublished;

    await check('JSON 发布由 Repository 生成 owner/hash，读取返回隔离副本', async () => {
      jsonPublished = await repository.publish(jsonRequest);
      assert.strictEqual(jsonPublished.idempotent, false);
      assert.deepStrictEqual(jsonPublished.warnings, []);
      assertRefOnly(jsonPublished.ref);
      assert.strictEqual(jsonPublished.record.meta.producer.runtimeUnit, 'R2');
      assert.strictEqual(jsonPublished.record.meta.contentHash, jsonPublished.ref.contentHash);
      assert.match(jsonPublished.record.recordHash, /^sha256-jcs-record-v1:[0-9a-f]{64}$/);
      assert.strictEqual(jsonPublished.record.payload.kind, 'json');
      assert.strictEqual(jsonPublished.record.payload.fileName, 'payload.json');

      mutableJson.nested.stable = false;
      jsonPublished.payload.nested.stable = false;
      const reread = await repository.get(jsonPublished.ref);
      assert.deepStrictEqual(reread.payload, {
        product: '袜子',
        nested: { stable: true },
        order: ['observe', 'plan', 'execute']
      });
      assert.strictEqual(
        path.dirname(artifactDirectory(healthyProject, jsonPublished.ref.artifactId)),
        path.join(healthyProject, ...REPOSITORY_PARTS)
      );
    });

    await check('主进程 Service 只把 Repository refs 同步到 Project State', async () => {
      const serviceProject = createProject(temporaryRoot, 'service-project');
      const stateStore = new DesignProjectStateStore();
      const service = new ArtifactRepositoryService(stateStore);
      const published = await service.publishRuntimeArtifact(serviceProject, runtimePublishRequest({
        runtimeBinding: runtimeScope({ runId: 'run-service-linked' })
      }));
      const state = await service.getVerifiedDesignProjectState(serviceProject);
      assert.deepStrictEqual(state.artifactRefs, [published.ref]);
      assert.strictEqual(state.updatedBy, 'artifact_repository');
      const serializedState = JSON.stringify(state);
      assert(!serializedState.includes('payload'));
      assert(!serializedState.includes('payload.json'));
      assert(!serializedState.includes(serviceProject));
    });

    await check('Project State 消费前由 Repository 重建 refs，伪造与失效引用均被清除', async () => {
      const serviceProject = createProject(temporaryRoot, 'verified-state-project');
      const stateStore = new DesignProjectStateStore();
      const service = new ArtifactRepositoryService(stateStore);
      const published = await service.publishRuntimeArtifact(serviceProject, runtimePublishRequest({
        runtimeBinding: runtimeScope({ runId: 'run-state-verification' })
      }));
      const stateFile = path.join(serviceProject, '.designecho', 'design-state.json');
      const poisoned = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      poisoned.artifactRefs = [{
        artifactId: 'caller-forged-ref',
        artifactType: V5_ARTIFACT_TYPES.runtimeActionPlan,
        contentHash: `sha256-jcs-v1:${'f'.repeat(64)}`
      }];
      fs.writeFileSync(stateFile, JSON.stringify(poisoned, null, 2), 'utf8');

      const rawRead = await stateStore.get(serviceProject);
      assert.strictEqual(rawRead.artifactRefs, undefined);
      const repaired = await service.getVerifiedDesignProjectState(serviceProject);
      assert.deepStrictEqual(repaired.artifactRefs, [published.ref]);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).artifactRefs, [published.ref]);

      const updated = await service.updateVerifiedDesignProjectState(serviceProject, {
        set: { targetUser: 'Repository 验证后更新' },
        updatedBy: 'smoke'
      });
      assert.strictEqual(updated.targetUser, 'Repository 验证后更新');
      assert.deepStrictEqual(updated.artifactRefs, [published.ref]);

      fs.rmSync(artifactDirectory(serviceProject, published.ref.artifactId), { recursive: true, force: true });
      const afterDeletion = await service.getVerifiedDesignProjectState(serviceProject);
      assert.strictEqual(afterDeletion.artifactRefs, undefined);
      assert.strictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).artifactRefs, undefined);
    });

    await check('收窄 IPC 批次由主进程生成五类 type/id/sourceRefs/status 并返回 refs-only 投影', async () => {
      const finalizationProject = createProject(temporaryRoot, 'runtime-finalization-project');
      const handlers = new Map();
      const senderFrame = {};
      const event = {
        sender: {
          id: 41,
          isDestroyed: () => false,
          mainFrame: senderFrame
        },
        senderFrame
      };
      let activeProjectPath = finalizationProject;
      const originalLoad = Module._load;
      Module._load = function loadWithFakeElectron(request, parent, isMain) {
        if (request === 'electron') {
          return {
            ipcMain: {
              handle(channel, handler) {
                handlers.set(channel, handler);
              }
            }
          };
        }
        return originalLoad.call(this, request, parent, isMain);
      };
      try {
        const handlerModulePath = path.join(
          ROOT,
          'src',
          'main',
          'ipc-handlers',
          'artifact-repository-handlers.ts'
        );
        delete require.cache[require.resolve(handlerModulePath)];
        const { registerArtifactRepositoryHandlers } = require(handlerModulePath);
        registerArtifactRepositoryHandlers({
          mainWindow: { webContents: event.sender },
          resourceManagerService: { getProjectRoot: () => activeProjectPath }
        });
      } finally {
        Module._load = originalLoad;
      }

      assert(!handlers.has('artifactRepository:publishRuntime'));
      const authorize = handlers.get('artifactRepository:authorizeRuntimeFinalization');
      const finalize = handlers.get('artifactRepository:finalizeRuntime');
      assert.strictEqual(typeof authorize, 'function');
      assert.strictEqual(typeof finalize, 'function');
      const subframeAuthorization = await authorize({ ...event, senderFrame: {} }, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-subframe',
        skillId: 'design.general',
        taskType: 'design.generic.v1'
      });
      assert.strictEqual(subframeAuthorization.success, false);
      assert.strictEqual(subframeAuthorization.code, 'authorization_subframe_forbidden');
      const invalidManifestAuthorization = await authorize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-invalid-manifest',
        skillId: 'design.generic.v1',
        taskType: 'generic_design'
      });
      assert.strictEqual(invalidManifestAuthorization.success, false);
      assert.strictEqual(invalidManifestAuthorization.code, 'authorization_manifest_mismatch');
      const authorization = await authorize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-main-generation-1',
        skillId: 'design.general',
        taskType: 'design.generic.v1'
      });
      assert.strictEqual(authorization.success, true, authorization.error);
      assert.strictEqual(authorization.grant.boundaries.mainProcessIssued, true);
      assert.strictEqual(authorization.grant.boundaries.senderBound, true);
      assert.strictEqual(authorization.grant.boundaries.projectPathBound, true);
      assert.strictEqual(authorization.grant.boundaries.singleUse, true);
      const authorizationRetry = await authorize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-main-generation-1',
        skillId: 'design.general',
        taskType: 'design.generic.v1'
      });
      assert.strictEqual(authorizationRetry.success, true, authorizationRetry.error);
      assert.strictEqual(
        authorizationRetry.grant.authorizationToken,
        authorization.grant.authorizationToken
      );
      const binding = {
        sessionId: authorization.grant.runtimeIdentity.sessionId,
        runId: authorization.grant.runtimeIdentity.runId,
        generation: authorization.grant.runtimeIdentity.generation
      };
      const finalizationRequest = {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: authorization.grant.authorizationToken,
        artifacts: {
          runtimeDesignBrief: runtimeDesignBriefValue(),
          runtimeDesignStrategy: runtimeDesignStrategyValue(),
          runtimeActionPlan: runtimeActionPlanValue(),
          evaluationReport: evaluationReportValue(),
          runtimeDeliveryVerification: runtimeDeliveryVerificationValue()
        }
      };
      const originalPublishRuntimeArtifact = artifactRepositoryService.publishRuntimeArtifact;
      let publishCount = 0;
      let interrupted;
      artifactRepositoryService.publishRuntimeArtifact = async function publishWithOneFailure(...args) {
        publishCount += 1;
        if (publishCount === 2) {
          throw new ArtifactRepositoryError(
            'injected_batch_failure',
            'smoke 注入第二个 Artifact 发布失败'
          );
        }
        return await originalPublishRuntimeArtifact.apply(this, args);
      };
      try {
        interrupted = await finalize(event, finalizationProject, finalizationRequest);
      } finally {
        artifactRepositoryService.publishRuntimeArtifact = originalPublishRuntimeArtifact;
      }
      assert.strictEqual(interrupted.success, false);
      assert.strictEqual(interrupted.code, 'injected_batch_failure');
      const prematureChild = await authorize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-premature-child',
        skillId: 'design.general',
        taskType: 'design.generic.v1',
        previousRunId: binding.runId
      });
      assert.strictEqual(prematureChild.success, false);
      assert.strictEqual(prematureChild.code, 'authorization_parent_not_finalized');
      const changedRetry = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: authorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(changedRetry.success, false);
      assert.strictEqual(changedRetry.code, 'authorization_retry_payload_mismatch');
      const response = await finalize(event, finalizationProject, finalizationRequest);
      assert.strictEqual(response.success, true, response.error);
      const projection = readArtifactRepositoryProjection(response.projection);
      assert(projection);
      assert.strictEqual(projection.refs.length, 5);
      assert.deepStrictEqual(projection.scope, binding);

      const expected = new Map([
        [V5_ARTIFACT_TYPES.runtimeDesignBrief, { producer: 'R1', sourceCount: 0 }],
        [V5_ARTIFACT_TYPES.runtimeDesignStrategy, { producer: 'R3', sourceCount: 1 }],
        [V5_ARTIFACT_TYPES.runtimeActionPlan, { producer: 'R4', sourceCount: 2 }],
        [V5_ARTIFACT_TYPES.evaluationReport, { producer: 'R5', sourceCount: 3 }],
        [V5_ARTIFACT_TYPES.runtimeDeliveryVerification, { producer: 'E2', sourceCount: 4 }]
      ]);
      for (const ref of projection.refs) {
        const expectedRecord = expected.get(ref.artifactType);
        assert(expectedRecord, ref.artifactType);
        assert.strictEqual(ref.artifactId, buildRuntimeArtifactId(ref.artifactType, binding));
        const artifact = await artifactRepositoryService.get(finalizationProject, ref);
        assert.strictEqual(artifact.record.meta.projectId, authorization.grant.projectId);
        assert.strictEqual(artifact.record.meta.skillId, authorization.grant.skillId);
        assert.strictEqual(artifact.record.meta.producer.runtimeUnit, expectedRecord.producer);
        assert.strictEqual(artifact.record.meta.producer.capabilityStatus, 'manual_verification_pending');
        assert.strictEqual(artifact.record.meta.sourceRevision, binding.generation);
        assert.strictEqual(artifact.record.meta.sourceRefs.length, expectedRecord.sourceCount);
        assert.deepStrictEqual(artifact.record.runtimeBinding, binding);
      }

      const replay = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: authorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(replay.success, false);
      assert.strictEqual(replay.code, 'authorization_consumed');

      const nextAuthorization = await authorize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-main-generation-2',
        skillId: 'design.general',
        taskType: 'design.generic.v1',
        previousRunId: binding.runId
      });
      assert.strictEqual(nextAuthorization.success, true, nextAuthorization.error);
      assert.strictEqual(nextAuthorization.grant.runtimeIdentity.sessionId, binding.sessionId);
      assert.strictEqual(nextAuthorization.grant.runtimeIdentity.generation, binding.generation + 1);
      assert.strictEqual(nextAuthorization.grant.runtimeIdentity.parentRunId, binding.runId);
      const forkedAuthorization = await authorize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-main-generation-2-fork',
        skillId: 'design.general',
        taskType: 'design.generic.v1',
        previousRunId: binding.runId
      });
      assert.strictEqual(forkedAuthorization.success, false);
      assert.strictEqual(forkedAuthorization.code, 'authorization_parent_already_advanced');
      const wrongSender = await finalize({
        ...event,
        sender: { ...event.sender, id: 42 }
      }, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: nextAuthorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(wrongSender.success, false);
      assert.strictEqual(wrongSender.code, 'authorization_window_mismatch');
      const otherProject = createProject(temporaryRoot, 'runtime-finalization-other-project');
      const inactiveProject = await finalize(event, otherProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: nextAuthorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(inactiveProject.success, false);
      assert.strictEqual(inactiveProject.code, 'authorization_active_project_mismatch');
      activeProjectPath = otherProject;
      const wrongProject = await finalize(event, otherProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: nextAuthorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(wrongProject.success, false);
      assert.strictEqual(wrongProject.code, 'authorization_project_mismatch');
      activeProjectPath = finalizationProject;
      const nextFinalize = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: nextAuthorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(nextFinalize.success, true, nextFinalize.error);

      const poisonAuthorization = await authorize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
        requestId: 'auth-poison-regression',
        skillId: 'design.general',
        taskType: 'design.generic.v1'
      });
      assert.strictEqual(poisonAuthorization.success, true, poisonAuthorization.error);
      const undefinedOnlyBatch = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: poisonAuthorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: undefined }
      });
      assert.strictEqual(undefinedOnlyBatch.success, false);
      assert.strictEqual(undefinedOnlyBatch.code, 'invalid_finalization');
      const emptyBatch = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: poisonAuthorization.grant.authorizationToken,
        artifacts: {}
      });
      assert.strictEqual(emptyBatch.success, false);
      assert.strictEqual(emptyBatch.code, 'invalid_finalization');
      const emptyDeclaration = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: poisonAuthorization.grant.authorizationToken,
        artifacts: {
          runtimeDesignBrief: {}
        }
      });
      assert.strictEqual(emptyDeclaration.success, false);
      assert.strictEqual(emptyDeclaration.code, 'invalid_finalization');
      const selfReportedAuthority = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: poisonAuthorization.grant.authorizationToken,
        projectId: 'forged-renderer-project',
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(selfReportedAuthority.success, false);
      assert.strictEqual(selfReportedAuthority.code, 'invalid_finalization');
      const poisoned = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: poisonAuthorization.grant.authorizationToken,
        artifacts: {
          runtimeDesignBrief: runtimeDesignBriefValue(),
          previewScene: { forged: true }
        }
      });
      assert.strictEqual(poisoned.success, false);
      assert.strictEqual(poisoned.code, 'invalid_finalization');
      const retryAfterPoison = await finalize(event, finalizationProject, {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken: poisonAuthorization.grant.authorizationToken,
        artifacts: { runtimeDesignBrief: runtimeDesignBriefValue() }
      });
      assert.strictEqual(retryAfterPoison.success, true, retryAfterPoison.error);
    });

    await check('生产 Harness 先发布再读取，Snapshot 与 Run Record 不信任 result.data refs', async () => {
      const agentSource = fs.readFileSync(
        path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'),
        'utf8'
      );
      const executorSource = fs.readFileSync(
        path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
        'utf8'
      );
      const repositoryHandlerSource = fs.readFileSync(
        path.join(ROOT, 'src', 'main', 'ipc-handlers', 'artifact-repository-handlers.ts'),
        'utf8'
      );
      const authorizationServiceSource = fs.readFileSync(
        path.join(ROOT, 'src', 'main', 'services', 'runtime-artifact-authorization-service.ts'),
        'utf8'
      );
      const preloadSource = fs.readFileSync(path.join(ROOT, 'src', 'main', 'preload.ts'), 'utf8');
      const runRecordSource = fs.readFileSync(
        path.join(ROOT, 'src', 'main', 'ipc-handlers', 'run-record-handlers.ts'),
        'utf8'
      );
      assert(agentSource.includes('await this.config.finalizeRuntimeArtifacts'));
      assert(agentSource.includes('attachArtifactRepositoryProjectionToRuntimeTaskSnapshot'));
      assert(agentSource.includes('delete data.runtimeTaskSnapshot'));
      assert(agentSource.includes('delete data.artifactRepositoryReadProjection'));
      assert(executorSource.includes('const finalizeBridge = window.designEcho?.finalizeRuntimeArtifacts'));
      assert(executorSource.includes('await finalizeBridge(projectPath, request)'));
      assert(executorSource.includes('window.designEcho?.authorizeRuntimeArtifactFinalization'));
      assert(executorSource.includes('readArtifactRepositoryProjection(response.projection)'));
      assert(!executorSource.includes('publishRuntimeArtifact'));
      assert(repositoryHandlerSource.includes("ipcMain.handle('artifactRepository:finalizeRuntime'"));
      assert(repositoryHandlerSource.includes("ipcMain.handle('artifactRepository:authorizeRuntimeFinalization'"));
      assert(!repositoryHandlerSource.includes("ipcMain.handle('artifactRepository:publishRuntime'"));
      assert(preloadSource.includes("ipcRenderer.invoke('artifactRepository:finalizeRuntime'"));
      assert(preloadSource.includes("ipcRenderer.invoke('artifactRepository:authorizeRuntimeFinalization'"));
      assert(!preloadSource.includes("ipcRenderer.invoke('artifactRepository:publishRuntime'"));
      assert(authorizationServiceSource.includes("record.status = 'finalizing'"));
      assert(authorizationServiceSource.includes("record.status = 'completed'"));
      assert(authorizationServiceSource.includes('authorization_sender_mismatch'));
      assert(authorizationServiceSource.includes('authorization_project_mismatch'));
      assert(runRecordSource.includes('hasRendererArtifactAuthority'));
      assert(runRecordSource.includes('artifactRepositoryService.readProjection'));
    });

    let binaryPublished;
    const binaryBytes = new Uint8Array([0, 255, 128, 195, 40, 10, 13, 1]);
    await check('binary 非 UTF-8 字节按原样持久化，来源文件名不携带路径', async () => {
      binaryPublished = await repository.publish(publishRequest({
        artifactId: 'preview-binary-v1',
        artifactType: V5_ARTIFACT_TYPES.previewScene,
        payload: {
          kind: 'binary',
          bytes: binaryBytes,
          mediaType: 'application/octet-stream',
          fileName: path.join('private', 'nested', 'opaque-preview.bin')
        }
      }));
      binaryBytes.fill(7);
      assert.strictEqual(binaryPublished.record.meta.producer.runtimeUnit, 'E1');
      assert.strictEqual(binaryPublished.record.payload.sourceFileName, 'opaque-preview.bin');
      assertRefOnly(binaryPublished.ref);

      const reread = await repository.get(binaryPublished.ref);
      assert(reread.payload instanceof Uint8Array);
      assert.deepStrictEqual(Array.from(reread.payload), [0, 255, 128, 195, 40, 10, 13, 1]);
      assert(!JSON.stringify(reread.ref).includes(healthyProject));
      assert(!JSON.stringify(reread.ref).includes('opaque-preview.bin'));
    });

    await check('发布草稿拒绝 owner/contentHash/path 注入与路径穿越 artifactId', async () => {
      for (const forbidden of [
        { owner: 'R5' },
        { producer: { runtimeUnit: 'R5' } },
        { contentHash: `sha256-jcs-v1:${'0'.repeat(64)}` },
        { path: 'C:\\outside\\artifact.json' }
      ]) {
        await expectRepositoryError(
          repository.publish(publishRequest({ artifactId: `strict-${Object.keys(forbidden)[0]}`, ...forbidden })),
          'invalid_request'
        );
      }
      for (const unsafeId of [
        '../escape',
        'nested/artifact',
        'nested\\artifact',
        'a..b',
        '/absolute',
        'reserved.tmp-artifact'
      ]) {
        await expectRepositoryError(
          repository.publish(publishRequest({ artifactId: unsafeId })),
          'invalid_artifact_id'
        );
      }
      assert.strictEqual(fs.existsSync(path.join(healthyProject, 'escape')), false);
    });

    await check('ApprovalService 拥有 approval_record，两个发布入口均拒绝越权', async () => {
      const approvalRequest = publishRequest({
        artifactId: 'approval-v1',
        artifactType: V5_ARTIFACT_TYPES.approvalRecord,
        payload: { kind: 'json', value: { decision: 'approved' } }
      });
      await expectRepositoryError(repository.publish(approvalRequest), 'owner_forbidden');
      const approval = await repository.publish(approvalRequest, 'approval_service');
      assert.strictEqual(approval.record.meta.producer.runtimeUnit, 'ApprovalService');
      assertRefOnly(approval.ref);
      await expectRepositoryError(
        repository.publish(publishRequest({ artifactId: 'approval-cannot-write-r2' }), 'approval_service'),
        'owner_forbidden'
      );
    });

    await check('同 id 仅精确 scope/lineage/内容重放幂等，其余禁止原地修改', async () => {
      const replay = await repository.publish(publishRequest({
        artifactId: jsonRequest.artifactId,
        payload: {
          kind: 'json',
          value: {
            product: '袜子',
            nested: { stable: true },
            order: ['observe', 'plan', 'execute']
          }
        }
      }));
      assert.strictEqual(replay.idempotent, true);
      assert.deepStrictEqual(replay.ref, jsonPublished.ref);

      await expectRepositoryError(
        repository.publish(publishRequest({
          artifactId: jsonRequest.artifactId,
          payload: { kind: 'json', value: { changed: true } }
        })),
        'in_place_modification'
      );
      await expectRepositoryError(
        repository.publish(publishRequest({
          artifactId: jsonRequest.artifactId,
          runtimeBinding: runtimeScope({ runId: 'run-idempotency-scope-change' }),
          payload: {
            kind: 'json',
            value: {
              product: '袜子',
              nested: { stable: true },
              order: ['observe', 'plan', 'execute']
            }
          }
        })),
        'in_place_modification'
      );

      const idempotencyPredecessor = await repository.publish(publishRequest({
        artifactId: 'idempotency-predecessor-v1',
        payload: { kind: 'json', value: { role: 'predecessor' } }
      }));
      const lineageNeutralRequest = publishRequest({
        artifactId: 'idempotency-lineage-target-v1',
        sourceRefs: [idempotencyPredecessor.ref],
        payload: { kind: 'json', value: { stable: 'same-content-hash' } }
      });
      await repository.publish(lineageNeutralRequest);
      await expectRepositoryError(
        repository.publish({
          ...lineageNeutralRequest,
          supersedes: idempotencyPredecessor.ref
        }),
        'in_place_modification'
      );
      const unchanged = await repository.get(jsonPublished.ref);
      assert.strictEqual(unchanged.payload.nested.stable, true);
    });

    await check('并发同内容只发布一次；并发异内容只能有一个不可变版本', async () => {
      const sameRequest = publishRequest({
        artifactId: 'concurrent-same-v1',
        payload: { kind: 'json', value: { concurrency: 'same' } }
      });
      const sameResults = await Promise.all([
        repository.publish(sameRequest),
        repository.publish(sameRequest),
        repository.publish(sameRequest)
      ]);
      assert.strictEqual(sameResults.filter((item) => !item.idempotent).length, 1);
      assert.strictEqual(sameResults.filter((item) => item.idempotent).length, 2);
      assert.strictEqual(new Set(sameResults.map((item) => JSON.stringify(item.ref))).size, 1);

      const conflictResults = await Promise.allSettled([
        repository.publish(publishRequest({
          artifactId: 'concurrent-conflict-v1',
          payload: { kind: 'json', value: { winner: 'a' } }
        })),
        repository.publish(publishRequest({
          artifactId: 'concurrent-conflict-v1',
          payload: { kind: 'json', value: { winner: 'b' } }
        }))
      ]);
      const fulfilled = conflictResults.filter((item) => item.status === 'fulfilled');
      const rejected = conflictResults.filter((item) => item.status === 'rejected');
      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, 'in_place_modification');
      const winner = await repository.get(fulfilled[0].value.ref);
      assert(['a', 'b'].includes(winner.payload.winner));
    });

    let successor;
    await check('supersede 线性增版本，保留旧版本并拒绝静默分叉', async () => {
      const predecessor = await repository.publish(publishRequest({
        artifactId: 'strategy-v1',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        payload: { kind: 'json', value: { version: 1 } }
      }));
      successor = await repository.publish(publishRequest({
        artifactId: 'strategy-v2',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        sourceRevision: 2,
        sourceRefs: [predecessor.ref],
        supersedes: predecessor.ref,
        payload: { kind: 'json', value: { version: 2 } }
      }));
      assert.strictEqual(predecessor.record.lineage.version, 1);
      assert.strictEqual(successor.record.lineage.version, 2);
      assert.deepStrictEqual(successor.record.lineage.supersedes, predecessor.ref);
      assert.deepStrictEqual((await repository.get(predecessor.ref)).payload, { version: 1 });
      assert.deepStrictEqual((await repository.get(successor.ref)).payload, { version: 2 });
      const exactSuccessorReplay = await repository.publish(publishRequest({
        artifactId: 'strategy-v2',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        sourceRevision: 2,
        sourceRefs: [predecessor.ref],
        supersedes: predecessor.ref,
        payload: { kind: 'json', value: { version: 2 } }
      }));
      assert.strictEqual(exactSuccessorReplay.idempotent, true);

      await expectRepositoryError(
        repository.publish(publishRequest({
          artifactId: 'strategy-v2-fork',
          artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
          sourceRevision: 2,
          sourceRefs: [predecessor.ref],
          supersedes: predecessor.ref,
          payload: { kind: 'json', value: { version: 'fork' } }
        })),
        'supersede_conflict'
      );
      await expectRepositoryError(
        repository.publish(publishRequest({
          artifactId: 'wrong-type-successor',
          artifactType: V5_ARTIFACT_TYPES.reviewReport,
          sourceRefs: [successor.ref],
          supersedes: successor.ref,
          payload: { kind: 'json', value: { version: 3 } }
        })),
        'invalid_supersede'
      );
    });

    await check('并发 successor 只能提交一个，另一条明确 supersede_conflict', async () => {
      const predecessor = await repository.publish(publishRequest({
        artifactId: 'concurrent-predecessor-v1',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        payload: { kind: 'json', value: { version: 'concurrent-predecessor' } }
      }));
      const concurrentSuccessors = await Promise.allSettled([
        repository.publish(publishRequest({
          artifactId: 'concurrent-successor-a-v2',
          artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
          sourceRevision: 2,
          sourceRefs: [predecessor.ref],
          supersedes: predecessor.ref,
          payload: { kind: 'json', value: { winner: 'a' } }
        })),
        repository.publish(publishRequest({
          artifactId: 'concurrent-successor-b-v2',
          artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
          sourceRevision: 2,
          sourceRefs: [predecessor.ref],
          supersedes: predecessor.ref,
          payload: { kind: 'json', value: { winner: 'b' } }
        }))
      ]);
      const fulfilled = concurrentSuccessors.filter((item) => item.status === 'fulfilled');
      const rejected = concurrentSuccessors.filter((item) => item.status === 'rejected');
      assert.strictEqual(fulfilled.length, 1);
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, 'supersede_conflict');
    });

    await check('不存在、失配与发布后删除的上游引用全部 fail closed', async () => {
      const sourceProject = createProject(temporaryRoot, 'source-integrity-project');
      const sourceRepository = createRepository(sourceProject);
      await expectRepositoryError(
        sourceRepository.publish(publishRequest({
          artifactId: 'missing-source-consumer-v1',
          sourceRefs: [{
            artifactId: 'source-does-not-exist-v1',
            artifactType: V5_ARTIFACT_TYPES.contextSnapshot,
            contentHash: `sha256-jcs-v1:${'0'.repeat(64)}`
          }]
        })),
        'artifact_missing'
      );

      const predecessor = await sourceRepository.publish(publishRequest({
        artifactId: 'source-integrity-predecessor-v1',
        payload: { kind: 'json', value: { source: true } }
      }));
      const wrongRef = {
        ...predecessor.ref,
        contentHash: `sha256-jcs-v1:${'f'.repeat(64)}`
      };
      await expectRepositoryError(
        sourceRepository.publish(publishRequest({
          artifactId: 'wrong-source-consumer-v1',
          sourceRefs: [wrongRef]
        })),
        'source_ref_mismatch'
      );

      const successor = await sourceRepository.publish(publishRequest({
        artifactId: 'deleted-source-successor-v2',
        sourceRevision: 2,
        sourceRefs: [predecessor.ref],
        supersedes: predecessor.ref,
        payload: { kind: 'json', value: { source: 'depends-on-predecessor' } }
      }));
      fs.rmSync(artifactDirectory(sourceProject, predecessor.ref.artifactId), {
        recursive: true,
        force: true
      });
      await expectRepositoryError(sourceRepository.get(successor.ref), 'artifact_missing');
      const listed = await sourceRepository.listRefs();
      assert.strictEqual(listed.refs.length, 0);
      assert(listed.issues.some((issue) => issue.code === 'artifact_missing'));
    });

    await check('读取投影只暴露当前 runtime scope 的引用，不泄漏正文或物理路径', async () => {
      const otherScope = runtimeScope({ runId: 'run-other', generation: 2 });
      const other = await repository.publish(publishRequest({
        artifactId: 'other-scope-v1',
        runtimeBinding: otherScope,
        payload: { kind: 'json', value: { privatePayload: true } }
      }));
      const projection = await repository.readProjection(runtimeScope());
      const parsed = readArtifactRepositoryProjection(projection);
      assert(parsed, 'read projection must satisfy the renderer-facing parser');
      assert(projection.refs.some((ref) => ref.artifactId === jsonPublished.ref.artifactId));
      assert(projection.refs.some((ref) => ref.artifactId === successor.ref.artifactId));
      assert(!projection.refs.some((ref) => ref.artifactId === other.ref.artifactId));
      projection.refs.forEach(assertRefOnly);
      assert.deepStrictEqual(projection.boundaries, {
        repositoryOwned: true,
        artifactRefsOnly: true,
        payloadsExcluded: true,
        pathsExcluded: true,
        grantsPermission: false
      });
      const serialized = JSON.stringify(projection);
      assert(!serialized.includes(healthyProject));
      assert(!serialized.includes('.designecho'));
      assert(!serialized.includes('privatePayload'));
    });

    await check('新进程重启后可按 ArtifactRef 读取正文与 runtime 投影', async () => {
      const encodedRef = Buffer.from(JSON.stringify(jsonPublished.ref), 'utf8').toString('base64url');
      const encodedScope = Buffer.from(JSON.stringify(runtimeScope()), 'utf8').toString('base64url');
      const child = spawnSync(
        process.execPath,
        [__filename, '--restart-probe', healthyProject, encodedRef, encodedScope],
        { cwd: ROOT, encoding: 'utf8' }
      );
      assert.strictEqual(child.status, 0, child.stderr || child.stdout);
      const restarted = JSON.parse(child.stdout);
      assert.deepStrictEqual(restarted.ref, jsonPublished.ref);
      assert.strictEqual(restarted.payload.nested.stable, true);
      assert(restarted.projection.refs.some((ref) => ref.artifactId === jsonPublished.ref.artifactId));
    });

    await check('真实路径与 junction/symlink 别名共享同一发布锁，不能并发制造 successor 分叉', async () => {
      const realProject = createProject(temporaryRoot, 'realpath-project');
      const aliasProject = path.join(temporaryRoot, 'realpath-project-alias');
      fs.symlinkSync(realProject, aliasProject, process.platform === 'win32' ? 'junction' : 'dir');
      assert.strictEqual(
        path.resolve(fs.realpathSync.native(aliasProject)).toLowerCase(),
        path.resolve(fs.realpathSync.native(realProject)).toLowerCase()
      );
      const realRepository = createRepository(realProject);
      const aliasRepository = createRepository(aliasProject);
      const predecessor = await realRepository.publish(publishRequest({
        artifactId: 'alias-predecessor-v1',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        payload: { kind: 'json', value: { version: 1 } }
      }));
      const aliasResults = await Promise.allSettled([
        realRepository.publish(publishRequest({
          artifactId: 'alias-successor-real-v2',
          artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
          sourceRevision: 2,
          sourceRefs: [predecessor.ref],
          supersedes: predecessor.ref,
          payload: { kind: 'json', value: { path: 'real' } }
        })),
        aliasRepository.publish(publishRequest({
          artifactId: 'alias-successor-link-v2',
          artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
          sourceRevision: 2,
          sourceRefs: [predecessor.ref],
          supersedes: predecessor.ref,
          payload: { kind: 'json', value: { path: 'alias' } }
        }))
      ]);
      assert.strictEqual(aliasResults.filter((item) => item.status === 'fulfilled').length, 1);
      const rejected = aliasResults.filter((item) => item.status === 'rejected');
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].reason.code, 'supersede_conflict');
      const refsFromAlias = await aliasRepository.listRefs();
      assert.strictEqual(refsFromAlias.issues.length, 0);
      assert.strictEqual(
        refsFromAlias.refs.filter((ref) => ref.artifactId.startsWith('alias-successor-')).length,
        1
      );
      const serviceScope = runtimeScope({ runId: 'run-realpath-service' });
      const aliasService = new ArtifactRepositoryService(new DesignProjectStateStore());
      const servicePublished = await aliasService.publishRuntimeArtifact(realProject, runtimePublishRequest({
        runtimeBinding: serviceScope
      }));
      const serviceProjection = await aliasService.readProjection(aliasProject, serviceScope);
      assert(serviceProjection.refs.some((ref) => ref.artifactId === servicePublished.ref.artifactId));
    });

    await check('Repository 元数据根与 Artifact 目录拒绝 junction/symlink 跨项目逃逸', async () => {
      const sourceProject = createProject(temporaryRoot, 'repository-link-source-project');
      const sourceRepository = createRepository(sourceProject);
      const sourceArtifact = await sourceRepository.publish(publishRequest({
        artifactId: 'cross-project-linked-artifact-v1',
        payload: { kind: 'json', value: { sourceProjectOnly: true } }
      }));

      const targetProject = createProject(temporaryRoot, 'repository-link-target-project');
      const targetObjectsRoot = path.join(targetProject, ...REPOSITORY_PARTS);
      fs.mkdirSync(targetObjectsRoot, { recursive: true });
      fs.symlinkSync(
        artifactDirectory(sourceProject, sourceArtifact.ref.artifactId),
        artifactDirectory(targetProject, sourceArtifact.ref.artifactId),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const targetRepository = createRepository(targetProject);
      await expectRepositoryError(
        targetRepository.get(sourceArtifact.ref),
        'artifact_directory_link_forbidden'
      );
      const linkedListing = await targetRepository.listRefs();
      assert.deepStrictEqual(linkedListing.refs, []);
      assert(linkedListing.issues.some((issue) => issue.code === 'artifact_directory_link_forbidden'));
      await expectRepositoryError(
        targetRepository.publish(publishRequest({
          artifactId: sourceArtifact.ref.artifactId,
          payload: { kind: 'json', value: { attemptedOverwrite: true } }
        })),
        'artifact_directory_link_forbidden'
      );

      const metadataProject = createProject(temporaryRoot, 'repository-metadata-link-project');
      const externalMetadataRoot = createProject(temporaryRoot, 'external-metadata-root');
      fs.symlinkSync(
        externalMetadataRoot,
        path.join(metadataProject, '.designecho'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const metadataRepository = createRepository(metadataProject);
      await expectRepositoryError(
        metadataRepository.listRefs(),
        'repository_path_link_forbidden'
      );
      await expectRepositoryError(
        metadataRepository.publish(publishRequest({ artifactId: 'must-not-escape-v1' })),
        'repository_path_link_forbidden'
      );
      assert.strictEqual(fs.existsSync(path.join(externalMetadataRoot, 'artifacts')), false);
    });

    await check('重启恢复全局发现多个 successor，并阻断 list/projection/get/任意 publish', async () => {
      const forkProject = createProject(temporaryRoot, 'fork-recovery-project');
      const forkRepository = createRepository(forkProject);
      const predecessor = await forkRepository.publish(publishRequest({
        artifactId: 'fork-recovery-predecessor-v1',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        payload: { kind: 'json', value: { version: 1 } }
      }));
      const successorA = await forkRepository.publish(publishRequest({
        artifactId: 'fork-recovery-successor-a-v2',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        sourceRevision: 2,
        sourceRefs: [predecessor.ref],
        supersedes: predecessor.ref,
        payload: { kind: 'json', value: { branch: 'a' } }
      }));
      const successorADirectory = artifactDirectory(forkProject, successorA.ref.artifactId);
      const hiddenSuccessorDirectory = path.join(forkProject, '.hidden-successor-a');
      fs.renameSync(successorADirectory, hiddenSuccessorDirectory);
      await forkRepository.publish(publishRequest({
        artifactId: 'fork-recovery-successor-b-v2',
        artifactType: V5_ARTIFACT_TYPES.creativeStrategy,
        sourceRevision: 2,
        sourceRefs: [predecessor.ref],
        supersedes: predecessor.ref,
        payload: { kind: 'json', value: { branch: 'b' } }
      }));
      fs.renameSync(hiddenSuccessorDirectory, successorADirectory);

      const restartedRepository = createRepository(forkProject);
      const listed = await restartedRepository.listRefs();
      assert.deepStrictEqual(listed.refs, []);
      assert(listed.issues.some((issue) => issue.code === 'supersede_conflict'));
      const projection = await restartedRepository.readProjection(runtimeScope());
      assert.deepStrictEqual(projection.refs, []);
      assert(projection.issues.some((issue) => issue.code === 'supersede_conflict'));
      await expectRepositoryError(
        restartedRepository.get(predecessor.ref),
        'supersede_conflict'
      );
      await expectRepositoryError(
        restartedRepository.publish(publishRequest({
          artifactId: 'fork-recovery-unrelated-publish-v1',
          payload: { kind: 'json', value: { mustNotPublishAcrossFork: true } }
        })),
        'supersede_conflict'
      );
      assert.strictEqual(
        fs.existsSync(artifactDirectory(forkProject, 'fork-recovery-unrelated-publish-v1')),
        false
      );
    });

    await check('record 损坏、payload 缺失和二进制篡改均 fail closed', async () => {
      const corruptProject = createProject(temporaryRoot, 'corrupt-project');
      const corruptRepository = createRepository(corruptProject);

      const reorderedRecordArtifact = await corruptRepository.publish(publishRequest({
        artifactId: 'reordered-record-v1'
      }));
      const reorderedRecordPath = artifactRecordPath(
        corruptProject,
        reorderedRecordArtifact.ref.artifactId
      );
      const originalRecord = JSON.parse(fs.readFileSync(reorderedRecordPath, 'utf8'));
      fs.writeFileSync(reorderedRecordPath, JSON.stringify({
        recordHash: originalRecord.recordHash,
        runtimeBinding: originalRecord.runtimeBinding,
        lineage: originalRecord.lineage,
        payload: originalRecord.payload,
        meta: originalRecord.meta,
        version: originalRecord.version
      }, null, 2), 'utf8');
      assert.deepStrictEqual(
        (await corruptRepository.get(reorderedRecordArtifact.ref)).ref,
        reorderedRecordArtifact.ref
      );

      const bindingMutation = await corruptRepository.publish(publishRequest({
        artifactId: 'binding-mutation-v1'
      }));
      const bindingRecordPath = artifactRecordPath(corruptProject, bindingMutation.ref.artifactId);
      const bindingRecord = JSON.parse(fs.readFileSync(bindingRecordPath, 'utf8'));

      const lineagePredecessor = await corruptRepository.publish(publishRequest({
        artifactId: 'lineage-mutation-predecessor-v1'
      }));
      const lineageMutation = await corruptRepository.publish(publishRequest({
        artifactId: 'lineage-mutation-successor-v2',
        sourceRevision: 2,
        sourceRefs: [lineagePredecessor.ref],
        supersedes: lineagePredecessor.ref
      }));
      const lineageRecordPath = artifactRecordPath(corruptProject, lineageMutation.ref.artifactId);
      const lineageRecord = JSON.parse(fs.readFileSync(lineageRecordPath, 'utf8'));
      bindingRecord.runtimeBinding.runId = 'run-tampered-but-well-shaped';
      fs.writeFileSync(bindingRecordPath, JSON.stringify(bindingRecord, null, 2), 'utf8');
      await expectRepositoryError(
        corruptRepository.get(bindingMutation.ref),
        'record_integrity_mismatch'
      );
      lineageRecord.lineage.version = 3;
      fs.writeFileSync(lineageRecordPath, JSON.stringify(lineageRecord, null, 2), 'utf8');
      await expectRepositoryError(
        corruptRepository.get(lineageMutation.ref),
        'record_integrity_mismatch'
      );

      const corruptRecord = await corruptRepository.publish(publishRequest({
        artifactId: 'corrupt-record-v1'
      }));
      const recordPath = path.join(
        artifactDirectory(corruptProject, corruptRecord.ref.artifactId),
        'record.json'
      );
      fs.writeFileSync(recordPath, '{"version":', 'utf8');
      const corruptBytes = fs.readFileSync(recordPath);
      await expectRepositoryError(corruptRepository.get(corruptRecord.ref), 'record_corrupt');
      await expectRepositoryError(
        corruptRepository.publish(publishRequest({ artifactId: corruptRecord.ref.artifactId })),
        'record_corrupt'
      );
      assert.deepStrictEqual(fs.readFileSync(recordPath), corruptBytes);

      const missingPayload = await corruptRepository.publish(publishRequest({
        artifactId: 'missing-payload-v1'
      }));
      fs.rmSync(path.join(
        artifactDirectory(corruptProject, missingPayload.ref.artifactId),
        'payload.json'
      ));
      await expectRepositoryError(corruptRepository.get(missingPayload.ref), 'payload_missing');

      const tamperedBinary = await corruptRepository.publish(publishRequest({
        artifactId: 'tampered-binary-v1',
        artifactType: V5_ARTIFACT_TYPES.previewScene,
        payload: { kind: 'binary', bytes: new Uint8Array([0, 255, 1, 254]) }
      }));
      fs.writeFileSync(
        path.join(artifactDirectory(corruptProject, tamperedBinary.ref.artifactId), 'payload.bin'),
        Buffer.from([0, 255, 2, 253])
      );
      await expectRepositoryError(corruptRepository.get(tamperedBinary.ref), 'binary_integrity_mismatch');

      fs.rmSync(artifactDirectory(corruptProject, reorderedRecordArtifact.ref.artifactId), {
        recursive: true,
        force: true
      });
      fs.rmSync(artifactDirectory(corruptProject, lineagePredecessor.ref.artifactId), {
        recursive: true,
        force: true
      });
      const listed = await corruptRepository.listRefs();
      assert.strictEqual(listed.refs.length, 0);
      assert(listed.issues.some((issue) => issue.code === 'record_corrupt'));
      assert(listed.issues.some((issue) => issue.code === 'record_integrity_mismatch'));
      assert(listed.issues.some((issue) => issue.code === 'payload_missing'));
      assert(listed.issues.some((issue) => issue.code === 'binary_integrity_mismatch'));
      const projection = await corruptRepository.readProjection(runtimeScope());
      assert.strictEqual(projection.refs.length, 0);
      assert(projection.issues.length >= 3);
    });

    await check('目录原子发布中途失败会清理 staging，且不占用 artifactId', async () => {
      const atomicProject = createProject(temporaryRoot, 'atomic-project');
      const baseOperations = new SerializedFileOperations();
      let injected = false;
      const failingOperations = {
        async runExclusive(targetPath, operation) {
          return await baseOperations.runExclusive(targetPath, operation);
        },
        async writeDirectoryAtomically(targetPath, writer) {
          return await baseOperations.writeDirectoryAtomically(targetPath, async (temporaryPath) => {
            await writer(temporaryPath);
            injected = true;
            throw new Error('injected atomic directory failure');
          });
        }
      };
      const failingRepository = createRepository(atomicProject, { fileOperations: failingOperations });
      const request = publishRequest({ artifactId: 'atomic-retry-v1' });
      await assert.rejects(
        failingRepository.publish(request),
        /injected atomic directory failure/
      );
      assert.strictEqual(injected, true);
      assert.strictEqual(fs.existsSync(artifactDirectory(atomicProject, request.artifactId)), false);
      const objectsRoot = path.join(atomicProject, ...REPOSITORY_PARTS);
      const residue = fs.existsSync(objectsRoot)
        ? fs.readdirSync(objectsRoot).filter((name) => name.includes('.tmp-'))
        : [];
      assert.deepStrictEqual(residue, []);

      const recovered = await createRepository(atomicProject).publish(request);
      assert.strictEqual(recovered.idempotent, false);
      assertRefOnly(recovered.ref);
    });

    console.log(JSON.stringify({ ok: true, checks: passed }));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const operation = process.argv[2] === '--restart-probe'
  ? runRestartProbe()
  : runSmoke();

operation.catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
