#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(repoRoot, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function run() {
  const toolPath = path.join(workspaceRoot, 'DesignEcho-UXP', 'src', 'tools', 'image', 'export-group.ts');
  const registryPath = path.join(workspaceRoot, 'DesignEcho-UXP', 'src', 'tools', 'registry.ts');
  const adapterPath = path.join(repoRoot, 'src', 'shared', 'main-image-live-photoshop-adapter-contract.ts');
  const matrixPath = path.join(repoRoot, 'src', 'shared', 'main-image-photoshop-tool-capability-matrix.ts');

  assert(fs.existsSync(toolPath), 'exportGroup UXP tool file must exist', { toolPath });
  const toolSource = readText(toolPath);
  const registrySource = readText(registryPath);
  const adapterSource = readText(adapterPath);
  const matrixSource = readText(matrixPath);

  assert(toolSource.includes("name = 'exportGroup'"), 'tool must expose exportGroup name');
  assert(toolSource.includes('sourceDoc.duplicate'), 'tool must use temporary document isolation');
  assert(toolSource.includes('tempDoc.saveAs'), 'tool must save PNG from the temporary document');
  assert(toolSource.includes('targetWidth') && toolSource.includes('targetHeight'), 'tool must support explicit export dimensions');
  assert(registrySource.includes("import { ExportGroupTool } from './image/export-group';"), 'registry must import ExportGroupTool');
  assert(registrySource.includes('new ExportGroupTool()'), 'registry must register ExportGroupTool');
  assert(adapterSource.includes("if (request.tool === 'exportGroup') return ['exportGroup'];"), 'adapter must map exportGroup requests to the exportGroup tool');
  assert(!adapterSource.includes('exportGroup_has_no_registered_photoshop_tool'), 'adapter must not keep the old exportGroup missing-tool blocker');
  assert(matrixSource.includes("requiredToolNames: ['exportGroup']"), 'capability matrix must require exportGroup for group-scoped export');

  console.log('smoke-uxp-group-export-tool passed');
}

run();
