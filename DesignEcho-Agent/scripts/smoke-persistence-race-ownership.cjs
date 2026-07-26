#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
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
  ecommerceProjectService
} = require('../src/main/services/ecommerce-project-service.ts');

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
  throw new Error(`${message}${suffix}`);
}

async function main() {
  const root = path.join(os.tmpdir(), `designecho-persistence-race-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });

  try {
    await ecommerceProjectService.initProjectConfig(root, {
      projectName: 'persistence-race-smoke',
      projectPath: root,
      folders: [],
      images: [],
      totalImages: 0,
      totalSize: 0
    });

    await Promise.all([
      ecommerceProjectService.updateFolderType(root, '原图', 'source'),
      ecommerceProjectService.updateImageType(root, '原图/蓝色.jpg', 'product')
    ]);

    const config = await ecommerceProjectService.loadProjectConfig(root);
    assert(config?.folderMappings?.['原图'] === 'source', 'concurrent folder classification must survive', config);
    assert(
      config?.imageClassifications?.['原图/蓝色.jpg'] === 'product',
      'concurrent image classification must survive',
      config
    );

    const temporaryFiles = fs.readdirSync(path.join(root, '.designecho'))
      .filter((name) => name.includes('.tmp-'));
    assert(temporaryFiles.length === 0, 'atomic project config writes must not leave temporary files', temporaryFiles);

    const agentRoot = path.resolve(__dirname, '..');
    const configHandlers = fs.readFileSync(
      path.join(agentRoot, 'src', 'main', 'ipc-handlers', 'config-handlers.ts'),
      'utf8'
    );
    const preload = fs.readFileSync(path.join(agentRoot, 'src', 'main', 'preload.ts'), 'utf8');
    assert(
      configHandlers.includes('serializedFileOperations.runExclusive(stateStorePath'),
      'renderer state mutations must share the file-scoped owner'
    );
    assert(
      configHandlers.includes('serializedFileOperations.writeUtf8Atomically(stateStorePath'),
      'renderer state writes must replace files atomically'
    );
    assert(
      !configHandlers.includes("ipcMain.on('state:setPersistedValueSync'")
        && !configHandlers.includes("ipcMain.on('state:removePersistedValueSync'"),
      'unused synchronous state writers must stay removed'
    );
    assert(
      !preload.includes('setPersistedValueSync:') && !preload.includes('removePersistedValueSync:'),
      'preload must not re-expose unused synchronous state writers'
    );

    console.log(JSON.stringify({
      success: true,
      checks: [
        'same-project folder and image classification updates are serialized without losing either change',
        'project config writes use atomic replacement',
        'renderer persisted state has one asynchronous writer and a read-only synchronous startup bridge'
      ]
    }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
