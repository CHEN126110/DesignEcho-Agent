export type DesignImageSource =
    | 'chat-paste'
    | 'chat-upload'
    | 'reference-upload'
    | 'generated'
    | 'unknown';

export interface DesignImageInput {
    id: string;
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    source: DesignImageSource;
    createdAt: number;
    name?: string;
}

interface CreateDesignImageInputParams {
    data: string;
    mediaType?: string;
    type?: string;
    source?: DesignImageSource;
    name?: string;
    id?: string;
}

export interface DesignImageAttachment {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

function createImageId(source: DesignImageSource): string {
    return `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeImageMediaType(value?: string): DesignImageInput['mediaType'] {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'image/png') return 'image/png';
    if (normalized === 'image/webp') return 'image/webp';
    return 'image/jpeg';
}

export function stripImageDataUrl(input: string): { data: string; mediaType?: string } {
    const value = String(input || '').trim();
    const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return { data: value };
    return {
        mediaType: match[1].toLowerCase(),
        data: match[2]
    };
}

export function createDesignImageInput(params: CreateDesignImageInputParams): DesignImageInput | null {
    const parsed = stripImageDataUrl(params.data);
    const data = String(parsed.data || '').trim();
    if (!data) return null;

    return {
        id: params.id || createImageId(params.source || 'unknown'),
        data,
        mediaType: normalizeImageMediaType(parsed.mediaType || params.mediaType || params.type),
        source: params.source || 'unknown',
        createdAt: Date.now(),
        name: params.name
    };
}

export function createDesignImageInputs(inputs: CreateDesignImageInputParams[]): DesignImageInput[] {
    return inputs
        .map((item) => createDesignImageInput(item))
        .filter((item): item is DesignImageInput => !!item);
}

export function toModelMessageImageBlock(image: DesignImageInput): {
    type: 'image';
    image: { data: string; mediaType: DesignImageInput['mediaType'] };
} {
    return {
        type: 'image',
        image: {
            data: image.data,
            mediaType: image.mediaType
        }
    };
}

export function toModelMessageContent(
    text: string,
    images: DesignImageInput[]
): Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: { data: string; mediaType: DesignImageInput['mediaType'] } }
> {
    const blocks: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; image: { data: string; mediaType: DesignImageInput['mediaType'] } }
    > = [];
    const messageText = String(text || '').trim();
    if (messageText) {
        blocks.push({ type: 'text', text: messageText });
    }
    for (const image of images) {
        blocks.push(toModelMessageImageBlock(image));
    }
    return blocks;
}

export function injectImagesIntoLastUserMessage<T extends { role: string; content?: any }>(
    messages: T[],
    images: DesignImageInput[]
): T[] {
    if (!Array.isArray(messages) || images.length === 0) return messages;
    const lastUserIndex = [...messages].map((msg) => msg.role).lastIndexOf('user');
    if (lastUserIndex < 0) return messages;

    return messages.map((msg, index) => {
        if (index !== lastUserIndex || msg.role !== 'user') return msg;

        const textContent = Array.isArray(msg.content)
            ? msg.content
                .filter((block) => block?.type === 'text')
                .map((block) => String(block?.text || '').trim())
                .filter(Boolean)
                .join('\n')
            : String(msg.content || '').trim();

        return {
            ...msg,
            content: toModelMessageContent(textContent, images)
        };
    });
}

export function toAgentImageAttachments(images: DesignImageInput[]): DesignImageAttachment[] {
    return images.map((image) => ({
        data: image.data,
        mediaType: image.mediaType
    }));
}
