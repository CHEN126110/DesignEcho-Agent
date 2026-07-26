const PANEL_BACKGROUND = '#0a0a0f';

function applyHostSurfaceLayout(node: HTMLElement | null | undefined): void {
    if (!node) {
        return;
    }

    node.style.width = '100%';
    node.style.height = '100%';
    node.style.margin = '0';
    node.style.background = PANEL_BACKGROUND;
    node.style.overflow = 'hidden';
}

export function preparePanelHostLayout(
    node: HTMLElement,
    options: { root?: HTMLElement | null; body?: HTMLElement | null } = {}
): void {
    const root = options.root === undefined ? document.documentElement as HTMLElement | null : options.root;
    const body = options.body === undefined ? document.body as HTMLElement | null : options.body;
    const parent = node.parentElement as HTMLElement | null;

    applyHostSurfaceLayout(root);
    applyHostSurfaceLayout(body);

    if (parent) {
        applyHostSurfaceLayout(parent);
        parent.style.position = 'relative';
    }

    node.style.position = 'relative';
    node.style.width = '100%';
    node.style.height = '100%';
    node.style.minHeight = '100%';
    node.style.margin = '0';
    node.style.padding = '0';
    node.style.display = 'block';
    node.style.overflow = 'hidden';
    node.style.background = PANEL_BACKGROUND;
}

export function applyEmbeddedWebViewElementLayout(webviewElement: any): void {
    if (!webviewElement) {
        return;
    }

    const element = webviewElement as HTMLElement;
    element.style.position = 'absolute';
    element.style.inset = '0';
    element.style.width = '100%';
    element.style.height = '100%';
    element.style.minWidth = '0';
    element.style.minHeight = '0';
    element.style.display = 'block';

    if (typeof webviewElement.removeAttribute === 'function') {
        webviewElement.removeAttribute('width');
        webviewElement.removeAttribute('height');
    }
}
