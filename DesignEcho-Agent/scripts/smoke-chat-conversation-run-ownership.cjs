#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { useAppStore } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'stores', 'app.store.ts'));
const { ConversationStore } = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'conversation-store.ts'));
const { SerializedFileOperations } = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'serialized-file-operations.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const now = Date.now();
const conversations = [
  { id: 'conv-a', title: 'A', createdAt: now, updatedAt: now, messages: [] },
  { id: 'conv-b', title: 'B', createdAt: now, updatedAt: now, messages: [] }
];

useAppStore.setState({
  currentProject: {
    id: 'conversation-run-ownership-smoke',
    name: 'conversation-run-ownership-smoke',
    path: 'C:\\DesignEcho\\tmp\\conversation-run-ownership-smoke',
    createdAt: now,
    lastOpenedAt: now,
    folders: {}
  },
  projectConversations: {
    'conversation-run-ownership-smoke': conversations
  },
  conversations,
  currentConversationId: 'conv-a',
  messages: []
});

let state = useAppStore.getState();
assert(typeof state.addMessageToConversation === 'function', 'store should expose explicit conversation message append');
assert(typeof state.updateMessageInConversation === 'function', 'store should expose explicit conversation message update');

const assistantId = state.addMessageToConversation('conv-a', {
  role: 'assistant',
  content: '',
  isThinking: true
});

useAppStore.getState().switchConversation('conv-b');
useAppStore.getState().updateMessageInConversation('conv-a', assistantId, {
  content: '原会话任务完成',
  isThinking: false
});

state = useAppStore.getState();
const convA = state.conversations.find((conversation) => conversation.id === 'conv-a');
const convB = state.conversations.find((conversation) => conversation.id === 'conv-b');

assert(state.currentConversationId === 'conv-b', 'user should remain on the switched conversation', {
  currentConversationId: state.currentConversationId
});
assert(Array.isArray(state.messages) && state.messages.length === 0, 'visible messages should still belong to the switched conversation', state.messages);
assert(convA?.messages?.some((message) => message.id === assistantId && message.content === '原会话任务完成' && message.isThinking === false), 'running task update should land in its original conversation', convA);
assert((convB?.messages || []).length === 0, 'running task update must not leak into the currently viewed conversation', convB);

function verifyCrossProjectLateRunOwnership() {
  const projectAId = 'conversation-run-project-a';
  const projectBId = 'conversation-run-project-b';
  const conversationA = {
    id: 'project-a-conversation',
    title: '项目 A 任务',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  const conversationB = {
    id: 'project-b-conversation',
    title: '项目 B 当前会话',
    createdAt: now,
    updatedAt: now,
    messages: []
  };

  useAppStore.setState({
    currentProject: {
      id: projectAId,
      name: projectAId,
      path: `C:\\DesignEcho\\tmp\\${projectAId}`,
      createdAt: now,
      lastOpenedAt: now,
      folders: {}
    },
    projectConversations: { [projectAId]: [conversationA] },
    conversations: [conversationA],
    currentConversationId: conversationA.id,
    messages: []
  });

  const pendingMessageId = useAppStore.getState().addMessageToConversation(conversationA.id, {
    role: 'assistant',
    content: '',
    isThinking: true
  });
  const frozenProjectAConversations = useAppStore.getState().conversations;

  useAppStore.setState({
    currentProject: {
      id: projectBId,
      name: projectBId,
      path: `C:\\DesignEcho\\tmp\\${projectBId}`,
      createdAt: now,
      lastOpenedAt: now,
      folders: {}
    },
    projectConversations: {
      [projectAId]: frozenProjectAConversations,
      [projectBId]: [conversationB]
    },
    conversations: [conversationB],
    currentConversationId: conversationB.id,
    messages: []
  });

  const updated = useAppStore.getState().updateMessageInConversation(
    conversationA.id,
    pendingMessageId,
    { content: '项目 A 的迟到完成结果', isThinking: false }
  );
  useAppStore.getState().addMessageToConversation(conversationA.id, {
    role: 'assistant',
    content: '项目 A 的补充结果'
  });

  const afterLateResult = useAppStore.getState();
  const projectAConversation = afterLateResult.projectConversations[projectAId]
    ?.find((conversation) => conversation.id === conversationA.id);
  const projectBConversation = afterLateResult.projectConversations[projectBId]
    ?.find((conversation) => conversation.id === conversationB.id);

  assert(updated === true, 'late result should still update the source conversation after a project switch');
  assert(projectAConversation?.messages?.some((message) => (
    message.id === pendingMessageId
    && message.content === '项目 A 的迟到完成结果'
    && message.isThinking === false
  )), 'late result must be written to the source project', projectAConversation);
  assert(projectAConversation?.messages?.some((message) => message.content === '项目 A 的补充结果'), 'late append must use the source project owner', projectAConversation);
  assert(afterLateResult.currentProject?.id === projectBId, 'late result must not switch the visible project');
  assert(afterLateResult.currentConversationId === conversationB.id, 'late result must not switch the visible conversation');
  assert(afterLateResult.conversations[0]?.id === conversationB.id, 'active conversation collection must remain owned by project B', afterLateResult.conversations);
  assert(afterLateResult.messages.length === 0, 'late project A result must not leak into project B visible messages', afterLateResult.messages);
  assert((projectBConversation?.messages || []).length === 0, 'late project A result must not mutate project B persistence', projectBConversation);
}

async function verifyConversationPersistenceOrdering() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-conversation-store-'));
  const store = new ConversationStore(rootDir, new SerializedFileOperations());

  try {
    await Promise.all([
      store.save('project-a', [{ id: 'first' }]),
      store.save('project-a', [{ id: 'second' }])
    ]);
    const sameProject = await store.load('project-a');
    assert(sameProject.length === 1 && sameProject[0].id === 'second', 'same-project saves must preserve invocation order', sameProject);

    await Promise.all([
      store.save('project-a', [{ id: 'a-final' }]),
      store.save('project-b', [{ id: 'b-final' }])
    ]);
    const [projectA, projectB] = await Promise.all([
      store.load('project-a'),
      store.load('project-b')
    ]);
    assert(projectA[0]?.id === 'a-final' && projectB[0]?.id === 'b-final', 'different projects must retain independent state', { projectA, projectB });

    await Promise.all([
      store.save('project-delete', [{ id: 'temporary' }]),
      store.delete('project-delete')
    ]);
    assert((await store.load('project-delete')).length === 0, 'delete invoked after save must win deterministically');

    const tempResidue = fs.readdirSync(rootDir).filter((name) => name.includes('.tmp-'));
    assert(tempResidue.length === 0, 'atomic conversation writes must not leave temporary files', tempResidue);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

async function verifyLateLoadMergesLocalMessages() {
  const projectId = 'late-load-merge-project';
  const now = Date.now();
  let resolveLoad;
  global.window = {
    designEcho: {
      invoke(channel) {
        if (channel === 'conversation:load') {
          return new Promise((resolve) => {
            resolveLoad = resolve;
          });
        }
        if (channel === 'conversation:save') return Promise.resolve({ success: true });
        return Promise.resolve({ success: true });
      }
    }
  };

  useAppStore.setState({
    currentProject: {
      id: projectId,
      name: projectId,
      path: `C:\\DesignEcho\\tmp\\${projectId}`,
      createdAt: now,
      lastOpenedAt: now,
      folders: {}
    },
    projectConversations: {},
    conversations: [],
    currentConversationId: null,
    messages: []
  });

  useAppStore.getState().loadProjectConversations(projectId);
  const placeholderId = useAppStore.getState().currentConversationId;
  assert(placeholderId, 'load should expose a project-scoped placeholder while disk IO is pending');
  useAppStore.getState().addMessageToConversation(placeholderId, {
    role: 'user',
    content: '加载期间的新消息'
  });

  resolveLoad({
    success: true,
    conversations: [{
      id: 'persisted-conversation',
      title: '磁盘历史',
      createdAt: now - 1000,
      updatedAt: now - 1000,
      messages: []
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const merged = useAppStore.getState().projectConversations[projectId] || [];
  const local = merged.find((conversation) => conversation.id === placeholderId);
  assert(merged.some((conversation) => conversation.id === 'persisted-conversation'), 'late load must retain persisted history', merged);
  assert(local?.messages?.some((message) => message.content === '加载期间的新消息'), 'late load must retain local messages created during IO', merged);
  delete global.window;
}

function verifyRendererPersistenceOwnership() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'stores', 'app.store.ts'), 'utf8');
  const handler = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main', 'ipc-handlers', 'conversation-handlers.ts'), 'utf8');
  assert(source.includes('const _conversationSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();'), 'conversation debounce must be scoped per project');
  assert(source.includes('const _dirtyConversationProjects = new Set<string>();'), 'placeholder projects must not flush before a real mutation');
  assert(source.includes('flushSaveConversations(oldProjectId, currentConversationsToSave);'), 'project switch must flush the dirty previous project');
  assert(source.includes('get().loadProjectConversations(newProjectId);'), 'project switch must load through one guarded owner');
  assert(source.includes('mergeConversationCollections(persistedConversations, localConversations)'), 'late disk loads must merge with local messages instead of overwriting them');
  assert(handler.includes('new ConversationStore(') && !handler.includes('const tempPath = `${filePath}.tmp`;'), 'IPC handler must delegate file lifecycle to ConversationStore');
}

async function main() {
  verifyRendererPersistenceOwnership();
  verifyCrossProjectLateRunOwnership();
  await verifyConversationPersistenceOrdering();
  await verifyLateLoadMergesLocalMessages();
  console.log('[smoke-chat-conversation-run-ownership] pass');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
