/**
 * Playwright 网页内容提取服务
 *
 * 访问指定 URL，提取设计相关内容（标题、正文、图片、布局信息）
 */

import { chromium } from 'playwright';

const DEFAULT_TIMEOUT = 30000;

/**
 * 启动用于读网页的浏览器。优先用系统已装浏览器（系统 Chrome → 系统 Edge），
 * 最后回退 Playwright 自带 chromium。这样不依赖 Playwright 单独下载的 browser 版本——
 * 实测 Playwright 1.59.1 需要 chromium-headless-shell 1217（Chrome 147.0.7727.15），
 * 官方 CDN 下载卡、国内镜像缺该版本，导致读网页失败；改用系统浏览器彻底绕开版本与下载问题。
 */
async function launchWebBrowserWithFallback() {
    const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    const candidates: Array<{ channel?: string }> = [
        { channel: 'chrome' },
        { channel: 'msedge' },
        {}
    ];
    let lastError: unknown;
    for (const candidate of candidates) {
        try {
            return await chromium.launch({
                ...(candidate.channel ? { channel: candidate.channel } : {}),
                headless: true,
                args: launchArgs
            });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error('无法启动任何浏览器（系统 Chrome/Edge 与 Playwright Chromium 均不可用）。');
}
const MAX_TEXT_LENGTH = 8000;
const MAX_IMAGES = 20;

export interface FetchPageResult {
    success: boolean;
    url: string;
    title?: string;
    description?: string;
    textContent?: string;
    images?: Array<{
        src: string;
        alt?: string;
        width?: number;
        height?: number;
    }>;
    error?: string;
}

/**
 * 访问指定网页并提取设计相关内容
 */
export async function fetchWebPageDesignContent(params: {
    url: string;
    extractImages?: boolean;
    maxTextLength?: number;
}): Promise<FetchPageResult> {
    const { url, extractImages = true, maxTextLength = MAX_TEXT_LENGTH } = params;
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    let browser;

    try {
        browser = await launchWebBrowserWithFallback();

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ignoreHTTPSErrors: true
        });

        const page = await context.newPage();
        page.setDefaultTimeout(DEFAULT_TIMEOUT);

        await page.goto(normalizedUrl, {
            waitUntil: 'domcontentloaded',
            timeout: DEFAULT_TIMEOUT
        });

        await page.waitForTimeout(1500);

        const result = await page.evaluate((opts: { extractImages: boolean; maxLen: number; maxImages: number }) => {
            const { extractImages: doExtractImages, maxLen, maxImages } = opts;
            const images: Array<{ src: string; alt?: string; width?: number; height?: number }> = [];

            let description: string | undefined;
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc?.getAttribute('content')) {
                description = metaDesc.getAttribute('content')!.trim().slice(0, 500);
            }

            const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post', '.article'];
            let mainEl: Element | null = null;
            for (const sel of mainSelectors) {
                mainEl = document.querySelector(sel);
                if (mainEl) break;
            }
            const contentRoot = mainEl || document.body;

            const walker = document.createTreeWalker(contentRoot, NodeFilter.SHOW_TEXT, null);
            const texts: string[] = [];
            let len = 0;
            while (walker.nextNode() && len < maxLen) {
                const t = walker.currentNode.textContent?.trim();
                if (t && t.length > 2) {
                    texts.push(t);
                    len += t.length;
                }
            }
            const textContent = texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);

            if (doExtractImages) {
                const imgs = contentRoot.querySelectorAll('img[src]');
                const seen = new Set<string>();
                for (let i = 0; i < Math.min(imgs.length, maxImages); i++) {
                    const img = imgs[i] as HTMLImageElement;
                    const src = img.src;
                    if (!src || seen.has(src)) continue;
                    if (/^data:/.test(src) || /\.(svg|gif)$/i.test(src)) continue;
                    seen.add(src);
                    images.push({
                        src,
                        alt: img.alt || undefined,
                        width: img.naturalWidth || undefined,
                        height: img.naturalHeight || undefined
                    });
                }
            }

            return {
                success: true,
                url: window.location.href,
                title: document.title || undefined,
                description,
                textContent,
                images
            };
        }, { extractImages, maxLen: maxTextLength, maxImages: MAX_IMAGES });

        await browser.close();
        return result;
    } catch (e: any) {
        if (browser) {
            await browser.close().catch(() => {});
        }
        return {
            success: false,
            url: normalizedUrl,
            error: e?.message || '访问网页失败'
        };
    }
}
