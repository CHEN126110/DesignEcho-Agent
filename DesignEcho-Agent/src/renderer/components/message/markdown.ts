/**
 * DesignEcho 消息 Markdown 的唯一解析入口。
 *
 * 采用逐块解析，避免旧实现用跨段正则把多个列表、标题和正文包进同一个 <ul>。
 * 所有原始文本先转义，链接只允许 http(s) / mailto 协议。
 */

type ListKind = 'ordered' | 'unordered';

interface ParsedListItem {
    content: string;
    number?: number;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value: string): string {
    const codeSpans: string[] = [];
    let html = escapeHtml(value).replace(/`([^`]+)`/g, (_match, code: string) => {
        const token = `@@MDCODE${codeSpans.length}@@`;
        codeSpans.push(`<code>${code}</code>`);
        return token;
    });

    html = html.replace(
        /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/giu,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/@@MDCODE(\d+)@@/g, (_match, index: string) => codeSpans[Number(index)] || '');
    return html;
}

function splitTableCells(row: string): string[] {
    let value = row.trim();
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);
    return value.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
    return /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/u.test(line);
}

function isTableRow(line: string): boolean {
    return line.includes('|') && line.trim().length > 0;
}

function renderTable(headerLine: string, rowLines: string[]): string {
    const headers = splitTableCells(headerLine)
        .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
        .join('');
    const rows = rowLines.map((line) => {
        const cells = splitTableCells(line)
            .map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`)
            .join('');
        return `<tr>${cells}</tr>`;
    }).join('');
    return `<table class="md-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function parseListItem(line: string): { kind: ListKind; item: ParsedListItem } | null {
    const unordered = line.match(/^\s*[-*]\s+(.+)$/u);
    if (unordered) {
        return { kind: 'unordered', item: { content: unordered[1].trim() } };
    }
    const ordered = line.match(/^\s*(\d{1,3})[.、)]\s+(.+)$/u);
    if (!ordered) return null;
    return {
        kind: 'ordered',
        item: {
            number: Number(ordered[1]),
            content: ordered[2].trim()
        }
    };
}

function renderList(kind: ListKind, items: ParsedListItem[]): string {
    const tag = kind === 'ordered' ? 'ol' : 'ul';
    const firstNumber = items[0]?.number;
    const startAttribute = kind === 'ordered' && firstNumber && firstNumber !== 1
        ? ` start="${firstNumber}"`
        : '';
    const body = items
        .map((item) => `<li>${renderInlineMarkdown(item.content)}</li>`)
        .join('');
    return `<${tag}${startAttribute}>${body}</${tag}>`;
}

function resolveHeadingTag(markerLength: number): 'h2' | 'h3' | 'h4' {
    if (markerLength === 1) return 'h2';
    if (markerLength === 2) return 'h3';
    return 'h4';
}

function isBlockStart(lines: string[], index: number): boolean {
    const line = lines[index] || '';
    if (!line.trim()) return true;
    if (/^\s{0,3}#{1,3}\s+\S/u.test(line)) return true;
    if (/^\s*(?:---+|\*\*\*)\s*$/u.test(line)) return true;
    if (parseListItem(line)) return true;
    return index + 1 < lines.length && isTableRow(line) && isTableSeparator(lines[index + 1]);
}

export function parseMessageMarkdown(content: string): string {
    const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks: string[] = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
            index += 1;
            continue;
        }

        const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/u);
        if (heading) {
            const tag = resolveHeadingTag(heading[1].length);
            blocks.push(`<${tag}>${renderInlineMarkdown(heading[2].trim())}</${tag}>`);
            index += 1;
            continue;
        }

        if (/^\s*(?:---+|\*\*\*)\s*$/u.test(line)) {
            blocks.push('<hr />');
            index += 1;
            continue;
        }

        if (index + 1 < lines.length && isTableRow(line) && isTableSeparator(lines[index + 1])) {
            const rows: string[] = [];
            index += 2;
            while (index < lines.length && isTableRow(lines[index]) && lines[index].trim()) {
                rows.push(lines[index]);
                index += 1;
            }
            blocks.push(renderTable(line, rows));
            continue;
        }

        const firstListItem = parseListItem(line);
        if (firstListItem) {
            const items: ParsedListItem[] = [];
            const kind = firstListItem.kind;
            while (index < lines.length) {
                const parsed = parseListItem(lines[index]);
                if (!parsed || parsed.kind !== kind) break;
                items.push(parsed.item);
                index += 1;
            }
            blocks.push(renderList(kind, items));
            continue;
        }

        const paragraphLines: string[] = [];
        while (index < lines.length && !isBlockStart(lines, index)) {
            paragraphLines.push(lines[index].trim());
            index += 1;
        }
        if (paragraphLines.length > 0) {
            blocks.push(`<p>${paragraphLines.map(renderInlineMarkdown).join('<br />')}</p>`);
            continue;
        }

        index += 1;
    }

    return blocks.join('\n');
}
