/* eslint-disable no-console */

const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const healthUrl = endpoint.replace(/\/mcp$/i, '/health');

function asJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${asJson(payload.error)}`);
  }
  return payload.result;
}

async function main() {
  console.log(`[smoke-mcp-host] endpoint: ${endpoint}`);

  const healthResp = await fetch(healthUrl);
  if (!healthResp.ok) {
    throw new Error(`Health check failed: HTTP ${healthResp.status} from ${healthUrl}`);
  }
  const health = await healthResp.json();
  console.log(`[health] ${asJson(health)}`);

  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'smoke-mcp-host', version: '1.0.0' }
  });
  console.log(`[initialize] protocol=${init.protocolVersion} server=${init.serverInfo?.name}`);

  const tools = await rpc('tools/list');
  const list = Array.isArray(tools?.tools) ? tools.tools : [];
  console.log(`[tools/list] count=${list.length}`);

  const status = await rpc('tools/call', {
    name: 'system.status',
    arguments: {}
  });
  const text = status?.content?.[0]?.text || '';
  console.log(`[tools/call system.status] ${text || asJson(status)}`);

  console.log('PASS: MCP host smoke test');
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
