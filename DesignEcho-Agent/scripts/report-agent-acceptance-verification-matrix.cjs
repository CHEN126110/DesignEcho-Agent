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
  AGENT_ACCEPTANCE_MODE_IDS
} = require('../src/shared/agent-acceptance-control-plane.ts');
const {
  buildAgentAcceptanceVerificationMatrix,
  formatAgentAcceptanceVerificationMatrixMarkdown,
  getAgentAcceptanceModeArtifactPath
} = require('../src/shared/agent-acceptance-verification-matrix.ts');

const ROOT = path.resolve(__dirname, '..');

function readArtifact(mode) {
  const relativePath = getAgentAcceptanceModeArtifactPath(mode);
  if (relativePath === 'not-supported') {
    return {
      relativePath,
      exists: false
    };
  }

  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      relativePath,
      exists: false
    };
  }

  try {
    return {
      relativePath,
      exists: true,
      payload: JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
    };
  } catch (error) {
    return {
      relativePath,
      exists: true,
      parseError: error && error.message ? error.message : String(error)
    };
  }
}

function readArtifacts() {
  return Object.fromEntries(AGENT_ACCEPTANCE_MODE_IDS.map((mode) => [mode, readArtifact(mode)]));
}

function buildOptInFlagsFromEnv() {
  return {
    DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE: process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE,
    DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API: process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API,
    DESIGNECHO_LIVE_AGENT_ACCEPTANCE: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE,
    DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER,
    DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT
  };
}

function buildRuntimeFromEnv() {
  return {
    agentDesktopBuilt: fs.existsSync(path.join(ROOT, 'dist', 'main', 'main', 'index.js'))
      && fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html')),
    uxpPluginConnected: process.env.DESIGNECHO_ACCEPTANCE_UXP_CONNECTED === '1',
    photoshopBridgeReady: process.env.DESIGNECHO_ACCEPTANCE_PHOTOSHOP_BRIDGE_READY === '1',
    disposableDocumentAllowed: process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT === '1'
  };
}

function main() {
  const args = process.argv.slice(2);
  const report = buildAgentAcceptanceVerificationMatrix({
    artifacts: readArtifacts(),
    optInFlags: buildOptInFlagsFromEnv(),
    runtime: buildRuntimeFromEnv()
  });

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatAgentAcceptanceVerificationMatrixMarkdown(report));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
