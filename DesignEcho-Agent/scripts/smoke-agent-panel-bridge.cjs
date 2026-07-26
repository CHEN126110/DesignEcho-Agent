const path = require('path');

const declarationsPath = path.join(__dirname, '..', 'dist', 'main', 'shared', 'skills', 'skill-declarations.js');

function main() {
  const declarations = require(declarationsPath);
  const skills = declarations.SKILL_REGISTRY || [];
  const bridge = skills.find((s) => s && s.id === 'agent-panel-bridge');

  if (!bridge) {
    console.error('NOT_FOUND: agent-panel-bridge');
    process.exit(1);
  }

  const requiredTools = Array.isArray(bridge.requiredTools) ? bridge.requiredTools : [];
  const hasMcpList = requiredTools.includes('mcp:tools:list');
  const hasMcpCall = requiredTools.includes('mcp:tools:call');

  console.log(`FOUND:${bridge.id}:${bridge.name}`);
  console.log(`REQUIRED_TOOLS:${requiredTools.join(',')}`);
  console.log(`MCP_LIST:${hasMcpList ? 'YES' : 'NO'}`);
  console.log(`MCP_CALL:${hasMcpCall ? 'YES' : 'NO'}`);

  if (!hasMcpList || !hasMcpCall) {
    console.error('INVALID_REQUIRED_TOOLS');
    process.exit(2);
  }
}

main();
