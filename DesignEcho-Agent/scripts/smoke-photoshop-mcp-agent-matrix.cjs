#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INVENTORY_PATH = path.join(ROOT, 'tmp', 'photoshop-mcp-inventory.json');
const MATRIX_PATH = path.join(ROOT, 'tmp', 'photoshop-mcp-test-matrix.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const inventory = readJson(INVENTORY_PATH);
  const matrix = readJson(MATRIX_PATH);
  const agentCoverage = inventory.agentToolCoverage || {};
  const agentRuntimeCandidates = Array.isArray(agentCoverage.runtimeCandidates)
    ? agentCoverage.runtimeCandidates
    : [];
  const defaultAgentRuntimeCandidates = agentRuntimeCandidates.filter(
    (candidate) => Array.isArray(candidate.sources) && candidate.sources.includes('default-agent')
  );
  const modelSchemaRuntimeCandidates = agentRuntimeCandidates.filter(
    (candidate) => Array.isArray(candidate.sources) && candidate.sources.includes('model-schema')
  );
  const matrixRows = Array.isArray(matrix.matrix) ? matrix.matrix : [];
  const matrixByRuntimeName = new Map(matrixRows.map((row) => [row.toolName, row]));

  assert(
    matrix.summary?.agentRuntimeCandidates === agentRuntimeCandidates.length,
    'matrix summary should count Agent Photoshop runtime candidates',
    {
      expected: agentRuntimeCandidates.length,
      actual: matrix.summary?.agentRuntimeCandidates
    }
  );

  assert(
    Array.isArray(matrix.agentRuntimeMissing) && matrix.agentRuntimeMissing.length === 0,
    'matrix should expose zero missing Agent runtime tools',
    matrix.agentRuntimeMissing
  );

  assert(
    matrix.summary?.defaultAgentRuntimeCandidates === defaultAgentRuntimeCandidates.length,
    'matrix summary should count default Agent Photoshop runtime candidates separately',
    {
      expected: defaultAgentRuntimeCandidates.length,
      actual: matrix.summary?.defaultAgentRuntimeCandidates
    }
  );

  assert(
    matrix.summary?.modelSchemaRuntimeCandidates === modelSchemaRuntimeCandidates.length,
    'matrix summary should count model-schema Photoshop runtime candidates separately',
    {
      expected: modelSchemaRuntimeCandidates.length,
      actual: matrix.summary?.modelSchemaRuntimeCandidates
    }
  );

  const missingRows = [];
  const rowsWithoutAgentFlag = [];
  const defaultRowsWithoutFlag = [];
  for (const candidate of agentRuntimeCandidates) {
    const row = matrixByRuntimeName.get(candidate.runtimeName);
    if (!row) {
      missingRows.push(candidate);
      continue;
    }
    if (row.usedByAgent !== true || !Array.isArray(row.agentToolNames) || !row.agentToolNames.includes(candidate.toolName)) {
      rowsWithoutAgentFlag.push({ candidate, row });
    }
    if (candidate.sources.includes('default-agent')) {
      if (row.usedByDefaultAgent !== true || !Array.isArray(row.defaultAgentToolNames) || !row.defaultAgentToolNames.includes(candidate.toolName)) {
        defaultRowsWithoutFlag.push({ candidate, row });
      }
    }
  }

  assert(missingRows.length === 0, 'every Agent runtime candidate should have a matrix row', missingRows);
  assert(rowsWithoutAgentFlag.length === 0, 'Agent matrix rows should carry usedByAgent metadata', rowsWithoutAgentFlag);
  assert(defaultRowsWithoutFlag.length === 0, 'default Agent matrix rows should carry usedByDefaultAgent metadata', defaultRowsWithoutFlag);

  const getDocumentInfo = matrixByRuntimeName.get('getDocumentInfo');
  const listDocuments = matrixByRuntimeName.get('listDocuments');
  const diagnoseState = matrixByRuntimeName.get('diagnoseState');
  assert(
    getDocumentInfo?.autoSmoke === 'conditional',
    'getDocumentInfo should require an open document and must not be in safe unattended no-document smoke',
    getDocumentInfo
  );
  assert(listDocuments?.autoSmoke === 'safe', 'listDocuments should remain safe in no-document smoke', listDocuments);
  assert(diagnoseState?.autoSmoke === 'safe', 'diagnoseState should remain safe in no-document smoke', diagnoseState);

  console.log(JSON.stringify({
    success: true,
    agentRuntimeCandidates: agentRuntimeCandidates.length,
    defaultAgentRuntimeCandidates: defaultAgentRuntimeCandidates.length,
    modelSchemaRuntimeCandidates: modelSchemaRuntimeCandidates.length,
    matrixRows: matrixRows.length,
    checks: [
      'matrix summary counts Agent Photoshop runtime candidates',
      'matrix exposes zero missing Agent runtime tools',
      'matrix summary separates default-agent and model-schema runtime candidates',
      'every Agent runtime candidate row carries usedByAgent metadata',
      'default Agent matrix rows carry usedByDefaultAgent metadata',
      'safe no-document lane excludes document-scoped getDocumentInfo'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error?.message || String(error),
    details: error?.details
  }, null, 2));
  process.exit(1);
}
