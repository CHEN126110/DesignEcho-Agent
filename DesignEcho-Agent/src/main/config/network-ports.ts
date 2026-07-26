function parsePortEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`${name} must be an integer port between 0 and 65535.`);
    }
    return parsed;
}

function parsePortOffset(): number {
    const raw = process.env.DESIGNECHO_PORT_OFFSET;
    if (raw === undefined || raw.trim() === '') return 0;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 50000) {
        throw new Error('DESIGNECHO_PORT_OFFSET must be an integer between 0 and 50000.');
    }
    return parsed;
}

const PORT_OFFSET = parsePortOffset();

export const WS_PORT = parsePortEnv('DESIGNECHO_WS_PORT', 8765 + PORT_OFFSET);
export const WEBVIEW_SERVER_PORT = parsePortEnv('DESIGNECHO_WEBVIEW_PORT', 8766 + PORT_OFFSET);
export const DEBUG_BRIDGE_PORT = parsePortEnv('DESIGNECHO_DEBUG_BRIDGE_PORT', 8767 + PORT_OFFSET);
export const MCP_HOST_PORT = parsePortEnv('DESIGNECHO_MCP_HOST_PORT', 8768 + PORT_OFFSET);
export const BROWSER_BRIDGE_PORT = parsePortEnv('DESIGNECHO_BROWSER_BRIDGE_PORT', 8769 + PORT_OFFSET);
export const WEBVIEW_BIND_HOST = '127.0.0.1';
