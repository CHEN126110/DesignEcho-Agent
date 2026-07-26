import { execFileSync } from 'child_process';
import type { AxiosRequestConfig } from 'axios';
import type { Agent as HttpAgent } from 'http';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

type ProxyAgents = {
    proxyUrl: string;
    httpAgent: HttpAgent;
    httpsAgent: HttpAgent;
};

type EnvSnapshot = {
    host?: string;
    port?: string;
};

let cachedProxyUrl: string | null | undefined;
let cachedAgents: ProxyAgents | null = null;

export function configureProcessProxyFromSystem(): void {
    const proxyUrl = resolveProxyUrl();
    if (!proxyUrl) return;

    process.env.HTTP_PROXY ||= proxyUrl;
    process.env.HTTPS_PROXY ||= proxyUrl;
    process.env.NO_PROXY ||= 'localhost,127.0.0.1,::1';
}

export function getAxiosProxyConfig(): Pick<AxiosRequestConfig, 'proxy' | 'httpAgent' | 'httpsAgent'> {
    const agents = getProxyAgents();
    if (!agents) return {};

    return {
        proxy: false,
        httpAgent: agents.httpAgent,
        httpsAgent: agents.httpsAgent
    };
}

export function getHttpRequestAgent(url: URL): HttpAgent | undefined {
    const agents = getProxyAgents();
    if (!agents) return undefined;
    return url.protocol === 'http:' ? agents.httpAgent : agents.httpsAgent;
}

export function getOpenAIHttpAgent(): HttpAgent | undefined {
    return getProxyAgents()?.httpsAgent;
}

export function applyVolcProxyEnvironment(): EnvSnapshot {
    const previous = {
        host: process.env.VOLC_PROXY_HOST,
        port: process.env.VOLC_PROXY_PORT
    };

    const endpoint = getProxyEndpoint();
    if (!endpoint) {
        delete process.env.VOLC_PROXY_HOST;
        delete process.env.VOLC_PROXY_PORT;
        return previous;
    }

    process.env.VOLC_PROXY_HOST = endpoint.hostname;
    process.env.VOLC_PROXY_PORT = endpoint.port;
    return previous;
}

export function restoreVolcProxyEnvironment(previous: EnvSnapshot): void {
    if (previous.host !== undefined) process.env.VOLC_PROXY_HOST = previous.host;
    else delete process.env.VOLC_PROXY_HOST;

    if (previous.port !== undefined) process.env.VOLC_PROXY_PORT = previous.port;
    else delete process.env.VOLC_PROXY_PORT;
}

export function resolveProxyUrl(): string {
    if (cachedProxyUrl !== undefined) return cachedProxyUrl || '';

    if (process.env.DESIGNECHO_DISABLE_PROXY === '1') {
        cachedProxyUrl = null;
        return '';
    }

    cachedProxyUrl = normalizeProxyUrl(
        process.env.DESIGNECHO_PROXY_URL ||
        process.env.HTTPS_PROXY ||
        process.env.HTTP_PROXY ||
        process.env.https_proxy ||
        process.env.http_proxy ||
        readWindowsUserProxyServer()
    ) || null;

    return cachedProxyUrl || '';
}

function getProxyAgents(): ProxyAgents | null {
    const proxyUrl = resolveProxyUrl();
    if (!proxyUrl) return null;

    if (cachedAgents?.proxyUrl === proxyUrl) return cachedAgents;

    cachedAgents = {
        proxyUrl,
        httpAgent: new HttpProxyAgent(proxyUrl) as unknown as HttpAgent,
        httpsAgent: new HttpsProxyAgent(proxyUrl) as unknown as HttpAgent
    };
    return cachedAgents;
}

function getProxyEndpoint(): { hostname: string; port: string } | null {
    const proxyUrl = resolveProxyUrl();
    if (!proxyUrl) return null;

    try {
        const url = new URL(proxyUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? '443' : '80')
        };
    } catch {
        return null;
    }
}

function readWindowsUserProxyServer(): string {
    if (process.platform !== 'win32') return '';

    try {
        const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        const enabled = execFileSync('reg', ['query', key, '/v', 'ProxyEnable'], { encoding: 'utf8' });
        if (!/\b0x1\b/i.test(enabled)) return '';

        const server = execFileSync('reg', ['query', key, '/v', 'ProxyServer'], { encoding: 'utf8' });
        const match = server.match(/ProxyServer\s+REG_\w+\s+(.+)/i);
        return match?.[1]?.trim() || '';
    } catch {
        return '';
    }
}

function normalizeProxyUrl(raw: string | undefined): string {
    const value = String(raw || '').trim();
    if (!value) return '';

    const fromSchemeMap = value
        .split(';')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => item.split('='))
        .find(([scheme]) => scheme?.toLowerCase() === 'https' || scheme?.toLowerCase() === 'http');

    const candidate = fromSchemeMap?.[1]?.trim() || value;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
        ? candidate
        : `http://${candidate}`;

    try {
        const url = new URL(withScheme);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        if (!url.hostname) return '';
        return url.toString();
    } catch {
        return '';
    }
}
