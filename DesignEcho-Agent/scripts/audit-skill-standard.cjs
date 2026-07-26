const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(root, 'tsconfig.main.json')
});

const {
  SKILL_REGISTRY
} = require(path.join(root, 'src', 'shared', 'skills', 'skill-declarations.ts'));

const VALID_KINDS = new Set(['workflow', 'operation', 'debug']);
const VALID_VISIBILITIES = new Set(['user-facing', 'internal-debug', 'system-only']);
const VALID_OUTPUT_TYPES = new Set(['layer', 'layers', 'document', 'files', 'data', 'none']);
const VALID_VISUAL_SAMPLING_SCENARIOS = new Set([
  'main-image',
  'detail-page',
  'sku',
  'reference-replication',
  'general-design'
]);
const PROTECTED_BUSINESS_SKILLS = new Set(['main-image-design', 'detail-page-design', 'sku-color-card', 'sku-batch']);
const USER_VISIBLE_TECHNICAL_MARKERS = [
  'MCP',
  'Executor',
  'executor',
  'JSON',
  'DSL',
  'tool_call',
  'debug payload'
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasRoutingIntentSignals(routing) {
  return hasItems(routing?.intentSignals) || hasItems(routing?.intentSignalGroups);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function addIssue(target, level, message, details) {
  target[level].push(details ? { message, details } : { message });
}

function auditParameter(param, index, record) {
  if (!param || typeof param !== 'object') {
    addIssue(record, 'blockers', `parameters[${index}] must be an object`);
    return;
  }
  if (!hasText(param.name)) {
    addIssue(record, 'blockers', `parameters[${index}] is missing name`);
  }
  if (!hasText(param.description)) {
    addIssue(record, 'warnings', `parameter ${param.name || index} is missing description`);
  }
  if (!['string', 'number', 'boolean', 'array', 'object', 'image'].includes(param.type)) {
    addIssue(record, 'blockers', `parameter ${param.name || index} has invalid type`, { type: param.type });
  }
  if (typeof param.required !== 'boolean') {
    addIssue(record, 'warnings', `parameter ${param.name || index} should declare required as boolean`);
  }
}

function auditRouteStatusMessages(skill, record) {
  const messages = skill.routing?.routeStatusMessages;
  if (!messages || skill.visibility !== 'user-facing') {
    return;
  }

  const joined = Object.values(messages).filter(Boolean).join('\n');
  const leakedMarkers = USER_VISIBLE_TECHNICAL_MARKERS.filter((marker) => joined.includes(marker));
  if (leakedMarkers.length > 0) {
    addIssue(record, 'warnings', 'route status messages contain technical markers', { leakedMarkers });
  }
}

function auditSkill(skill) {
  const record = {
    id: skill?.id || '(missing-id)',
    name: skill?.name || '',
    kind: skill?.kind || '',
    visibility: skill?.visibility || '',
    category: skill?.category || '',
    protected: PROTECTED_BUSINESS_SKILLS.has(skill?.id),
    blockers: [],
    warnings: [],
    checks: {}
  };

  if (!skill || typeof skill !== 'object') {
    addIssue(record, 'blockers', 'skill declaration must be an object');
    record.status = 'fail';
    return record;
  }

  if (!hasText(skill.id)) {
    addIssue(record, 'blockers', 'missing id');
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.id)) {
    addIssue(record, 'blockers', 'id must use lowercase letters, digits, and hyphens only', { id: skill.id });
  }

  if (!hasText(skill.name)) {
    addIssue(record, 'blockers', 'missing name');
  }
  if (!VALID_KINDS.has(skill.kind)) {
    addIssue(record, 'blockers', 'invalid kind', { kind: skill.kind });
  }
  if (!VALID_VISIBILITIES.has(skill.visibility)) {
    addIssue(record, 'blockers', 'invalid visibility', { visibility: skill.visibility });
  }
  if (!hasText(skill.category)) {
    addIssue(record, 'blockers', 'missing category');
  }
  if (!hasText(skill.description)) {
    addIssue(record, 'blockers', 'missing description');
  }
  if (
    skill.visualSamplingScenario !== undefined
    && !VALID_VISUAL_SAMPLING_SCENARIOS.has(skill.visualSamplingScenario)
  ) {
    addIssue(record, 'blockers', 'invalid visualSamplingScenario', {
      visualSamplingScenario: skill.visualSamplingScenario
    });
  }
  if (!hasItems(skill.whenToUse)) {
    addIssue(record, 'blockers', 'missing whenToUse');
  }

  const isUserFacing = skill.visibility === 'user-facing';
  const isWorkflow = skill.kind === 'workflow';
  const isProtectedBusinessSkill = PROTECTED_BUSINESS_SKILLS.has(skill.id);

  if (!hasItems(skill.whenNotToUse)) {
    if (isProtectedBusinessSkill) {
      addIssue(record, 'blockers', 'protected business skill must declare whenNotToUse');
    } else if (isUserFacing) {
      addIssue(record, 'warnings', 'user-facing skill should declare whenNotToUse');
    }
  }

  if (!skill.routing) {
    if (isProtectedBusinessSkill) {
      addIssue(record, 'blockers', 'protected business skill must declare routing metadata');
    } else if (isUserFacing && isWorkflow) {
      addIssue(record, 'warnings', 'user-facing workflow should declare routing metadata');
    } else if (isUserFacing) {
      addIssue(record, 'warnings', 'user-facing operation should declare routing metadata before auto-routing');
    }
  } else {
    if (!hasRoutingIntentSignals(skill.routing)) {
      if (isProtectedBusinessSkill) {
        addIssue(record, 'blockers', 'protected business skill must declare intent signals');
      } else if (isUserFacing) {
        addIssue(record, 'warnings', 'routing metadata should include intent signals');
      }
    }
    if (!hasItems(skill.routing.negativeSignals)) {
      if (isProtectedBusinessSkill) {
        addIssue(record, 'blockers', 'protected business skill must declare negative signals');
      } else if (isUserFacing) {
        addIssue(record, 'warnings', 'routing metadata should include negative signals');
      }
    }
    if (!hasItems(skill.routing.preconditions)) {
      if (isProtectedBusinessSkill) {
        addIssue(record, 'blockers', 'protected business skill must declare preconditions');
      } else if (isWorkflow) {
        addIssue(record, 'warnings', 'workflow routing should include preconditions');
      }
    }
    if (!hasItems(skill.routing.supportedModes)) {
      if (isProtectedBusinessSkill) {
        addIssue(record, 'blockers', 'protected business skill must declare supportedModes');
      } else if (isWorkflow) {
        addIssue(record, 'warnings', 'workflow routing should include supportedModes');
      }
    }
    if (!hasItems(skill.routing.decisionGuidance)) {
      if (isProtectedBusinessSkill) {
        addIssue(record, 'blockers', 'protected business skill must declare decisionGuidance');
      } else if (isUserFacing && isWorkflow) {
        addIssue(record, 'warnings', 'workflow routing should include decisionGuidance');
      }
    }
  }

  if (!Array.isArray(skill.parameters)) {
    addIssue(record, 'blockers', 'parameters must be an array');
  } else {
    skill.parameters.forEach((param, index) => auditParameter(param, index, record));
  }

  if (!skill.output || typeof skill.output !== 'object') {
    addIssue(record, 'blockers', 'missing output contract');
  } else {
    if (!VALID_OUTPUT_TYPES.has(skill.output.type)) {
      addIssue(record, 'blockers', 'invalid output type', { outputType: skill.output.type });
    }
    if (!hasText(skill.output.description)) {
      addIssue(record, 'blockers', 'missing output description');
    }
  }

  if (!Array.isArray(skill.requiredTools)) {
    addIssue(record, 'blockers', 'requiredTools must be an array');
  }

  if (!hasItems(skill.examples)) {
    addIssue(record, 'blockers', 'missing examples');
  } else {
    skill.examples.forEach((example, index) => {
      if (!hasText(example?.userSays)) {
        addIssue(record, 'warnings', `example ${index} is missing userSays`);
      }
      if (!example || typeof example.parameters !== 'object' || Array.isArray(example.parameters)) {
        addIssue(record, 'warnings', `example ${index} should include parameter mapping`);
      }
    });
  }

  auditRouteStatusMessages(skill, record);

  record.checks = {
    hasWhenToUse: hasItems(skill.whenToUse),
    hasWhenNotToUse: hasItems(skill.whenNotToUse),
    hasRouting: Boolean(skill.routing),
    hasIntentSignals: hasRoutingIntentSignals(skill.routing),
    hasNegativeSignals: hasItems(skill.routing?.negativeSignals),
    hasPreconditions: hasItems(skill.routing?.preconditions),
    hasSupportedModes: hasItems(skill.routing?.supportedModes),
    hasDecisionGuidance: hasItems(skill.routing?.decisionGuidance),
    hasParameters: Array.isArray(skill.parameters),
    hasOutput: Boolean(skill.output),
    hasRequiredTools: Array.isArray(skill.requiredTools),
    hasExamples: hasItems(skill.examples),
    visualSamplingScenario: skill.visualSamplingScenario || null
  };
  record.status = record.blockers.length > 0 ? 'fail' : 'pass';
  return record;
}

function buildMarkdownReport(payload) {
  const lines = [
    '# Skill Standard Audit',
    '',
    `- success: ${payload.success}`,
    `- totalSkills: ${payload.summary.totalSkills}`,
    `- blockerCount: ${payload.summary.blockerCount}`,
    `- warningCount: ${payload.summary.warningCount}`,
    `- protectedBusinessSkills: ${payload.summary.protectedBusinessSkills.join(', ')}`,
    '',
    '## Cases',
    ''
  ];

  for (const item of payload.cases) {
    lines.push(`### ${item.id}`);
    lines.push(`- status: ${item.status}`);
    lines.push(`- kind: ${item.kind}`);
    lines.push(`- visibility: ${item.visibility}`);
    lines.push(`- protected: ${item.protected}`);
    if (item.blockers.length > 0) {
      lines.push(`- blockers: ${item.blockers.map((entry) => entry.message).join('；')}`);
    }
    if (item.warnings.length > 0) {
      lines.push(`- warnings: ${item.warnings.map((entry) => entry.message).join('；')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function writeReport(payload) {
  const outDir = path.join(root, 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'skill-standard-audit.json');
  const mdPath = path.join(outDir, 'skill-standard-audit.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(mdPath, buildMarkdownReport(payload), 'utf8');
  return { json: jsonPath, md: mdPath };
}

function run() {
  const ids = new Set();
  const cases = SKILL_REGISTRY.map((skill) => {
    const result = auditSkill(skill);
    if (ids.has(skill.id)) {
      addIssue(result, 'blockers', 'duplicate skill id', { id: skill.id });
      result.status = 'fail';
    }
    ids.add(skill.id);
    return result;
  });

  const blockerCount = cases.reduce((count, item) => count + item.blockers.length, 0);
  const warningCount = cases.reduce((count, item) => count + item.warnings.length, 0);
  const payload = {
    success: blockerCount === 0,
    summary: {
      totalSkills: cases.length,
      passCases: cases.filter((item) => item.status === 'pass').length,
      failCases: cases.filter((item) => item.status === 'fail').length,
      warningCases: cases.filter((item) => item.warnings.length > 0).length,
      blockerCount,
      warningCount,
      userFacingSkills: cases.filter((item) => item.visibility === 'user-facing').length,
      protectedBusinessSkills: Array.from(PROTECTED_BUSINESS_SKILLS)
    },
    cases
  };

  payload.report = writeReport(payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.success ? 0 : 1);
}

run();
