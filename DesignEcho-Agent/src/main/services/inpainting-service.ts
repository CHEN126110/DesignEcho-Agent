import sharp from 'sharp';
import { bflService } from './bfl-service';
import {
    assertInpaintingMaskHasEditablePixels,
    clampSoftenedMaskToSelection
} from './inpainting-mask-protection';
import { volcengineJimengInpaintingService } from './volcengine-jimeng-inpainting-service';
import { openRouterGeminiImageService } from './openrouter-gemini-image-service';

export type InpaintingModel =
    | 'flux-fill'
    | 'flux-2-klein-4b'
    | 'flux-2-klein-9b'
    | 'flux-2-pro'
    | 'flux-2-max'
    | 'flux-2-flex'
    | 'jimeng-inpaint'
    | 'google/gemini-3-pro-image-preview';

export interface InpaintingRequest {
    image: string;
    mask: string;
    prompt: string;
    model?: InpaintingModel;
    skipPreview?: boolean;
    imageFormat?: 'raw' | 'png' | 'jpeg';
    imageChannels?: number;
    maskFormat?: 'raw' | 'png';
    maskChannels?: number;
    imageWidth: number;
    imageHeight: number;
    selectionBounds?: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
    } | null;
    documentMeta?: {
        width?: number;
        height?: number;
        scale?: number;
        selectionBoundsOriginal?: {
            left?: number;
            top?: number;
            right?: number;
            bottom?: number;
        } | null;
    } | null;
}

export interface InpaintingResult {
    success: boolean;
    images?: string[];
    rawImages?: string[];
    imageBuffer?: Buffer;
    meta?: {
        provider: 'bfl' | 'jimeng' | 'openrouter';
        model: InpaintingModel;
        outputWidth: number;
        outputHeight: number;
        originalWidth: number;
        originalHeight: number;
        targetBounds: {
            left: number;
            top: number;
        };
        compositingMode: 'transparent-selection-overlay';
        outsideSelectionTransparent: true;
    };
    error?: string;
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    processingTime?: number;
    provider?: string;
    model?: string;
}

export interface InpaintingProgressEvent {
    progress: number;
    message: string;
    stage: string;
    provider: 'local' | 'bfl' | 'jimeng' | 'openrouter';
    model: InpaintingModel;
}

export type InpaintingProgressCallback = (event: InpaintingProgressEvent) => void;

type RegionBounds = {
    left: number;
    top: number;
    width: number;
    height: number;
};

type SelectionBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

type InpaintingPromptIntent = 'context-fill' | 'add' | 'replace' | 'remove' | 'modify';
type InpaintingProvider = 'bfl' | 'jimeng' | 'openrouter';
type InpaintingImageFormat = 'raw' | 'png' | 'jpeg';

type OutputPlacement = {
    targetLeft: number;
    targetTop: number;
    targetWidth: number;
    targetHeight: number;
    cropLeft: number;
    cropTop: number;
    cropWidth: number;
    cropHeight: number;
};

const SUPPORTED_MODELS: InpaintingModel[] = [
    'flux-fill',
    'flux-2-klein-4b',
    'flux-2-klein-9b',
    'flux-2-pro',
    'flux-2-max',
    'flux-2-flex',
    'jimeng-inpaint',
    'google/gemini-3-pro-image-preview'
];

const BFL_MODELS: InpaintingModel[] = [
    'flux-fill',
    'flux-2-klein-4b',
    'flux-2-klein-9b',
    'flux-2-pro',
    'flux-2-max',
    'flux-2-flex'
];

const OPENROUTER_MODELS: InpaintingModel[] = [
    'google/gemini-3-pro-image-preview'
];

export class InpaintingService {
    async inpaint(request: InpaintingRequest, onProgress?: InpaintingProgressCallback): Promise<InpaintingResult> {
        const startedAt = Date.now();

        try {
            const model = this.normalizeModel(request.model);
            const provider = this.getModelProvider(model);
            const normalizedFormats = this.normalizeRequestFormats(request);
            this.emitProgress(onProgress, {
                progress: 4,
                message: 'Validating request',
                stage: 'validate',
                provider: 'local',
                model
            });

            if (!request.image?.trim() || !request.mask?.trim()) {
                throw new Error('Image and mask are required');
            }
            if (!request.imageWidth || !request.imageHeight) {
                throw new Error('Image dimensions are required');
            }

            const promptPlan = this.buildPromptPlan(request.prompt, provider);

            this.validateProviderCredentials(model);

            const fullImage = await this.decodeRgbImage(
                request.image,
                request.imageWidth,
                request.imageHeight,
                request.imageChannels || 3,
                normalizedFormats.imageFormat
            );
            const fullMask = await this.decodeMaskImage(
                request.mask,
                request.imageWidth,
                request.imageHeight,
                request.maskChannels || 1,
                normalizedFormats.maskFormat
            );
            const fullMaskRaw = await fullMask.clone().raw().toBuffer();
            assertInpaintingMaskHasEditablePixels(fullMaskRaw);

            const outputRgba = provider === 'jimeng'
                ? await this.runJimengOfficialFlow(request, promptPlan, model, fullImage, fullMask, onProgress)
                : await this.runCroppedProviderFlow(request, promptPlan, model, provider, fullImage, fullMask, onProgress);

            this.emitProgress(onProgress, {
                progress: 98,
                message: 'Encoding final PNG',
                stage: 'encode-result',
                provider,
                model
            });

            const outputPlacement = this.resolveOutputPlacement(
                request,
                provider === 'jimeng'
                    ? { left: 0, top: 0, width: request.imageWidth, height: request.imageHeight }
                    : await this.resolveRegion(request, fullMask, promptPlan.intent),
                promptPlan.intent
            );
            const outputPng = await sharp(outputRgba, {
                raw: { width: outputPlacement.targetWidth, height: outputPlacement.targetHeight, channels: 4 }
            }).png().toBuffer();

            return {
                success: true,
                images: [],
                rawImages: [],
                imageBuffer: outputPng,
                meta: {
                    provider,
                    model,
                    outputWidth: outputPlacement.targetWidth,
                    outputHeight: outputPlacement.targetHeight,
                    originalWidth: outputPlacement.targetWidth,
                    originalHeight: outputPlacement.targetHeight,
                    targetBounds: {
                        left: outputPlacement.targetLeft,
                        top: outputPlacement.targetTop
                    },
                    compositingMode: 'transparent-selection-overlay',
                    outsideSelectionTransparent: true
                },
                processingTime: Date.now() - startedAt,
                provider,
                model
            };
        } catch (error: any) {
            return {
                success: false,
                error: error?.message || String(error),
                errorStage: typeof error?.errorStage === 'string' ? error.errorStage : '',
                errorCode: typeof error?.errorCode === 'string' ? error.errorCode : '',
                errorDetail: typeof error?.errorDetail === 'string' ? error.errorDetail : '',
                processingTime: Date.now() - startedAt
            };
        }
    }

    private async runCroppedProviderFlow(
        request: InpaintingRequest,
        promptPlan: { originalPrompt: string; effectivePrompt: string; intent: InpaintingPromptIntent },
        model: InpaintingModel,
        provider: InpaintingProvider,
        fullImage: sharp.Sharp,
        fullMask: sharp.Sharp,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        this.emitProgress(onProgress, {
            progress: 10,
            message: 'Analyzing selection',
            stage: 'analyze-selection',
            provider: 'local',
            model
        });

        const region = await this.resolveRegion(request, fullMask, promptPlan.intent);

        this.emitProgress(onProgress, {
            progress: 16,
            message: 'Cropping region of interest',
            stage: 'crop-region',
            provider: 'local',
            model
        });

        const cropImagePng = await fullImage.clone().extract(region).png().toBuffer();
        const cropMaskPng = await fullMask.clone().extract(region).png().toBuffer();
        const sourceMaskRaw = await fullMask.clone().extract(region).raw().toBuffer();

        this.emitProgress(onProgress, {
            progress: 22,
            message: 'Submitting image edit request',
            stage: 'submit-model',
            provider,
            model
        });

        const generatedCrop = await this.runProviderEdit(
            model,
            promptPlan.effectivePrompt,
            cropImagePng,
            cropMaskPng,
            onProgress
        );

        const generatedRgba = await sharp(generatedCrop)
            .resize(region.width, region.height, { fit: 'fill' })
            .ensureAlpha()
            .raw()
            .toBuffer();

        this.emitProgress(onProgress, {
            progress: 94,
            message: 'Compositing masked result',
            stage: 'composite',
            provider,
            model
        });

        const outputPlacement = this.resolveOutputPlacement(request, region, promptPlan.intent);
        return this.buildTransparentOutputFromPlacement(
            generatedRgba,
            sourceMaskRaw,
            region.width,
            region.height,
            outputPlacement,
            promptPlan.intent,
            { softenMask: true }
        );
    }

    private async runJimengOfficialFlow(
        request: InpaintingRequest,
        promptPlan: { originalPrompt: string; effectivePrompt: string; intent: InpaintingPromptIntent },
        model: InpaintingModel,
        fullImage: sharp.Sharp,
        fullMask: sharp.Sharp,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        this.emitProgress(onProgress, {
            progress: 10,
            message: 'Preparing full image and mask for Jimeng',
            stage: 'analyze-selection',
            provider: 'local',
            model
        });

        const sourceImagePng = await fullImage.clone().png().toBuffer();
        const sourceMaskPng = await fullMask.clone().png().toBuffer();
        const sourceMaskRaw = await fullMask.clone().raw().toBuffer();

        this.emitProgress(onProgress, {
            progress: 16,
            message: 'Submitting full-image inpainting request',
            stage: 'crop-region',
            provider: 'local',
            model
        });

        this.emitProgress(onProgress, {
            progress: 22,
            message: 'Submitting Jimeng inpainting task',
            stage: 'submit-model',
            provider: 'jimeng',
            model
        });

        const generatedFull = await this.runJimengInpaint(
            promptPlan.effectivePrompt,
            sourceImagePng,
            sourceMaskPng,
            model,
            onProgress
        );

        const generatedRgba = await sharp(generatedFull)
            .resize(request.imageWidth, request.imageHeight, { fit: 'fill' })
            .ensureAlpha()
            .raw()
            .toBuffer();

        this.emitProgress(onProgress, {
            progress: 94,
            message: 'Extracting masked result from Jimeng output',
            stage: 'composite',
            provider: 'jimeng',
            model
        });

        const fullRegion: RegionBounds = {
            left: 0,
            top: 0,
            width: request.imageWidth,
            height: request.imageHeight
        };
        const outputPlacement = this.resolveJimengOutputPlacement(request, fullRegion);
        return this.buildTransparentOutputFromPlacement(
            generatedRgba,
            sourceMaskRaw,
            request.imageWidth,
            request.imageHeight,
            outputPlacement,
            promptPlan.intent,
            { softenMask: false }
        );
    }

    private resolveJimengOutputPlacement(
        request: InpaintingRequest,
        scaledRegion: RegionBounds
    ): OutputPlacement {
        const scaledSelectionBounds = this.normalizeBounds(request.selectionBounds || null);
        const originalSelectionBounds = this.normalizeBounds(request.documentMeta?.selectionBoundsOriginal || null);

        const scaledOutputBounds = scaledSelectionBounds || {
            left: scaledRegion.left,
            top: scaledRegion.top,
            right: scaledRegion.left + scaledRegion.width,
            bottom: scaledRegion.top + scaledRegion.height
        };

        const cropLeft = this.clamp(scaledOutputBounds.left - scaledRegion.left, 0, Math.max(0, scaledRegion.width - 1));
        const cropTop = this.clamp(scaledOutputBounds.top - scaledRegion.top, 0, Math.max(0, scaledRegion.height - 1));
        const cropWidth = this.clamp(scaledOutputBounds.right - scaledOutputBounds.left, 1, Math.max(1, scaledRegion.width - cropLeft));
        const cropHeight = this.clamp(scaledOutputBounds.bottom - scaledOutputBounds.top, 1, Math.max(1, scaledRegion.height - cropTop));

        if (originalSelectionBounds) {
            return {
                targetLeft: originalSelectionBounds.left,
                targetTop: originalSelectionBounds.top,
                targetWidth: originalSelectionBounds.right - originalSelectionBounds.left,
                targetHeight: originalSelectionBounds.bottom - originalSelectionBounds.top,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        const scale = this.resolveRequestScale(request);
        const documentWidth = Number(request.documentMeta?.width);
        const documentHeight = Number(request.documentMeta?.height);
        if (scale < 0.999 && documentWidth > 0 && documentHeight > 0) {
            const targetLeft = this.clamp(Math.round(scaledOutputBounds.left / scale), 0, Math.max(0, documentWidth - 1));
            const targetTop = this.clamp(Math.round(scaledOutputBounds.top / scale), 0, Math.max(0, documentHeight - 1));
            const targetWidth = this.clamp(Math.round((scaledOutputBounds.right - scaledOutputBounds.left) / scale), 1, Math.max(1, documentWidth - targetLeft));
            const targetHeight = this.clamp(Math.round((scaledOutputBounds.bottom - scaledOutputBounds.top) / scale), 1, Math.max(1, documentHeight - targetTop));
            return {
                targetLeft,
                targetTop,
                targetWidth,
                targetHeight,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        return {
            targetLeft: scaledOutputBounds.left,
            targetTop: scaledOutputBounds.top,
            targetWidth: scaledOutputBounds.right - scaledOutputBounds.left,
            targetHeight: scaledOutputBounds.bottom - scaledOutputBounds.top,
            cropLeft,
            cropTop,
            cropWidth,
            cropHeight
        };
    }

    private async buildTransparentOutputFromPlacement(
        generatedRgba: Buffer,
        sourceMaskRaw: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        outputPlacement: OutputPlacement,
        intent: InpaintingPromptIntent,
        options?: { softenMask?: boolean }
    ): Promise<Buffer> {
        const croppedGeneratedRgba = await this.cropRawRgba(
            generatedRgba,
            sourceWidth,
            sourceHeight,
            outputPlacement.cropLeft,
            outputPlacement.cropTop,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight
        );
        const croppedMaskRaw = await this.cropRawChannel(
            sourceMaskRaw,
            sourceWidth,
            sourceHeight,
            outputPlacement.cropLeft,
            outputPlacement.cropTop,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight,
            1
        );
        const resizedGeneratedRgba = await this.resizeRawRgba(
            croppedGeneratedRgba,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight,
            outputPlacement.targetWidth,
            outputPlacement.targetHeight
        );
        const resizedMaskRaw = await this.resizeRawChannel(
            croppedMaskRaw,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight,
            outputPlacement.targetWidth,
            outputPlacement.targetHeight,
            1
        );
        return this.composeTransparentOutput(
            resizedGeneratedRgba,
            resizedMaskRaw,
            outputPlacement.targetWidth,
            outputPlacement.targetHeight,
            intent,
            options
        );
    }

    private normalizeModel(model?: string): InpaintingModel {
        if (!model) {
            return 'flux-fill';
        }
        if (SUPPORTED_MODELS.includes(model as InpaintingModel)) {
            return model as InpaintingModel;
        }
        throw new Error(`Unsupported inpainting model: ${model}`);
    }

    private validateProviderCredentials(model: InpaintingModel): void {
        if (BFL_MODELS.includes(model)) {
            if (!bflService.hasApiKey()) {
                throw new Error('BFL API Key is not configured');
            }
            return;
        }

        if (OPENROUTER_MODELS.includes(model)) {
            if (!openRouterGeminiImageService.hasApiKey()) {
                throw new Error('OpenRouter API Key is not configured');
            }
            return;
        }

        if (model === 'jimeng-inpaint' && !volcengineJimengInpaintingService.hasCredentials()) {
            throw new Error('即梦AI Access Key ID / Secret Access Key 未配置');
        }
    }

    private getModelProvider(model: InpaintingModel): InpaintingProvider {
        if (model === 'jimeng-inpaint') {
            return 'jimeng';
        }
        if (OPENROUTER_MODELS.includes(model)) {
            return 'openrouter';
        }
        return 'bfl';
    }

    private normalizeRequestFormats(request: InpaintingRequest): { imageFormat: InpaintingImageFormat; maskFormat: InpaintingImageFormat } {
        const imageFormat = this.normalizeTransportFormat(request.imageFormat, 'raw');
        const maskFormat = this.normalizeTransportFormat(request.maskFormat, 'raw');
        return { imageFormat, maskFormat };
    }

    private normalizeTransportFormat(
        format: InpaintingRequest['imageFormat'] | InpaintingRequest['maskFormat'],
        fallback: InpaintingImageFormat
    ): InpaintingImageFormat {
        if (format === 'png' || format === 'jpeg' || format === 'raw') {
            return format;
        }
        return fallback;
    }

    private async runProviderEdit(
        model: InpaintingModel,
        prompt: string,
        cropImagePng: Buffer,
        cropMaskPng: Buffer,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        if (model === 'flux-fill') {
            return this.runFluxFill(prompt, cropImagePng, cropMaskPng, model, onProgress);
        }

        if (model === 'jimeng-inpaint') {
            return this.runJimengInpaint(prompt, cropImagePng, cropMaskPng, model, onProgress);
        }

        if (OPENROUTER_MODELS.includes(model)) {
            return this.runOpenRouterInpaint(prompt, cropImagePng, cropMaskPng, model, onProgress);
        }

        return this.runFlux2RegionEdit(
            model as Exclude<InpaintingModel, 'flux-fill' | 'jimeng-inpaint' | 'google/gemini-3-pro-image-preview'>,
            prompt,
            cropImagePng,
            onProgress
        );
    }

    private async runFluxFill(
        prompt: string,
        cropImagePng: Buffer,
        cropMaskPng: Buffer,
        model: InpaintingModel,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        const result = await bflService.inpaint(
            prompt,
            this.toDataUrl(cropImagePng),
            this.toDataUrl(cropMaskPng),
            { outputFormat: 'png' },
            (event) => {
                const mapped = event.phase === 'ready' ? 90 : this.mapBflProgress(event.progress);
                this.emitProgress(onProgress, {
                    progress: mapped,
                    message: event.phase === 'ready'
                        ? 'BFL returned result'
                        : this.getBflProgressMessage(event.status, event.progress),
                    stage: event.phase === 'ready' ? 'provider-ready' : 'provider-processing',
                    provider: 'bfl',
                    model
                });
            }
        );

        return bflService.downloadImage(result.url);
    }

    private async runFlux2RegionEdit(
        model: Exclude<InpaintingModel, 'flux-fill' | 'jimeng-inpaint' | 'google/gemini-3-pro-image-preview'>,
        prompt: string,
        cropImagePng: Buffer,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        const result = await bflService.generateImage2Image(
            model,
            `Edit only the intended selected area. Preserve overall style, lighting, perspective, and surrounding context.\n${prompt}`,
            this.toDataUrl(cropImagePng),
            { outputFormat: 'png' },
            (event) => {
                const mapped = event.phase === 'ready' ? 90 : this.mapBflProgress(event.progress);
                this.emitProgress(onProgress, {
                    progress: mapped,
                    message: event.phase === 'ready'
                        ? 'BFL returned result'
                        : this.getBflProgressMessage(event.status, event.progress),
                    stage: event.phase === 'ready' ? 'provider-ready' : 'provider-processing',
                    provider: 'bfl',
                    model
                });
            }
        );

        return bflService.downloadImage(result.url);
    }

    private async runJimengInpaint(
        prompt: string,
        cropImagePng: Buffer,
        cropMaskPng: Buffer,
        model: InpaintingModel,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        const result = await volcengineJimengInpaintingService.inpaint(
            prompt,
            cropImagePng,
            cropMaskPng,
            (event) => {
                this.emitProgress(onProgress, {
                    progress: event.progress,
                    message: event.message,
                    stage: event.stage,
                    provider: 'jimeng',
                    model
                });
            }
        );

        return result.image;
    }

    private async runOpenRouterInpaint(
        prompt: string,
        cropImagePng: Buffer,
        cropMaskPng: Buffer,
        model: InpaintingModel,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        const result = await openRouterGeminiImageService.editImage(
            prompt,
            cropImagePng,
            cropMaskPng,
            { model },
            (event) => {
                this.emitProgress(onProgress, {
                    progress: event.progress,
                    message: event.message,
                    stage: event.stage,
                    provider: 'openrouter',
                    model
                });
            }
        );

        return result.image;
    }

    private async decodeRgbImage(
        base64: string,
        width: number,
        height: number,
        channels: number,
        format: 'raw' | 'png' | 'jpeg'
    ): Promise<sharp.Sharp> {
        const normalized = base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(normalized, 'base64');
        if (format === 'raw') {
            if (channels !== 3 && channels !== 4) {
                throw new Error(`Unsupported image channel count: ${channels}`);
            }
            return sharp(buffer, {
                raw: { width, height, channels }
            }).removeAlpha();
        }

        const image = sharp(buffer).removeAlpha();
        const metadata = await image.metadata();
        if ((metadata.width && metadata.width !== width) || (metadata.height && metadata.height !== height)) {
            throw new Error(`Encoded image size mismatch: got ${metadata.width}x${metadata.height}, expected ${width}x${height}`);
        }
        return image;
    }

    private async decodeMaskImage(
        base64: string,
        width: number,
        height: number,
        channels: number,
        format: 'raw' | 'png' | 'jpeg'
    ): Promise<sharp.Sharp> {
        const normalized = base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(normalized, 'base64');
        if (format === 'raw') {
            if (channels !== 1) {
                throw new Error(`Unsupported mask channel count: ${channels}`);
            }
            return sharp(buffer, {
                raw: { width, height, channels: 1 }
            }).grayscale();
        }

        const image = sharp(buffer).grayscale();
        const metadata = await image.metadata();
        if ((metadata.width && metadata.width !== width) || (metadata.height && metadata.height !== height)) {
            throw new Error(`Encoded mask size mismatch: got ${metadata.width}x${metadata.height}, expected ${width}x${height}`);
        }
        return image;
    }

    private async resolveRegion(
        request: InpaintingRequest,
        fullMask: sharp.Sharp,
        intent: InpaintingPromptIntent
    ): Promise<RegionBounds> {
        const rawBounds = request.selectionBounds || {};
        const left = Number(rawBounds.left);
        const top = Number(rawBounds.top);
        const right = Number(rawBounds.right);
        const bottom = Number(rawBounds.bottom);

        if ([left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top) {
            return this.expandBounds({ left, top, right, bottom }, request.imageWidth, request.imageHeight, intent);
        }

        const maskData = await fullMask.clone().raw().toBuffer();
        let minX = request.imageWidth;
        let minY = request.imageHeight;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < request.imageHeight; y++) {
            for (let x = 0; x < request.imageWidth; x++) {
                if (maskData[(y * request.imageWidth) + x] > 0) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX < minX || maxY < minY) {
            throw new Error('Selection bounds are empty');
        }

        return this.expandBounds(
            { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 },
            request.imageWidth,
            request.imageHeight,
            intent
        );
    }

    private expandBounds(
        bounds: { left: number; top: number; right: number; bottom: number },
        imageWidth: number,
        imageHeight: number,
        intent: InpaintingPromptIntent
    ): RegionBounds {
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        const intentPaddingRatio: Record<InpaintingPromptIntent, number> = {
            'context-fill': 0.38,
            add: 0.42,
            replace: 0.32,
            remove: 0.36,
            modify: 0.3
        };
        const padding = Math.max(32, Math.min(224, Math.round(Math.max(width, height) * intentPaddingRatio[intent])));
        const left = Math.max(0, bounds.left - padding);
        const top = Math.max(0, bounds.top - padding);
        const right = Math.min(imageWidth, bounds.right + padding);
        const bottom = Math.min(imageHeight, bounds.bottom + padding);

        return {
            left,
            top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top)
        };
    }

    private async composeTransparentOutput(
        generatedRgba: Buffer,
        maskRaw: Buffer,
        width: number,
        height: number,
        intent: InpaintingPromptIntent,
        options?: { softenMask?: boolean }
    ): Promise<Buffer> {
        const pixelCount = width * height;
        const expectedRgbaLength = pixelCount * 4;
        if (generatedRgba.length !== expectedRgbaLength || maskRaw.length !== pixelCount) {
            throw new Error(
                `局部重绘合成尺寸不一致：RGBA ${generatedRgba.length}/${expectedRgbaLength} 字节，蒙版 ${maskRaw.length}/${pixelCount} 字节`
            );
        }
        const softenedMask = options?.softenMask === false
            ? maskRaw
            : await this.buildCompositeMask(maskRaw, width, height, intent);
        const out = Buffer.alloc(generatedRgba.length);
        for (let i = 0; i < pixelCount; i++) {
            const offset = i * 4;
            out[offset] = generatedRgba[offset];
            out[offset + 1] = generatedRgba[offset + 1];
            out[offset + 2] = generatedRgba[offset + 2];
            out[offset + 3] = softenedMask[i];
        }
        return out;
    }

    private async buildCompositeMask(
        maskRaw: Buffer,
        width: number,
        height: number,
        intent: InpaintingPromptIntent
    ): Promise<Buffer> {
        const sigma = this.resolveCompositeBlurSigma(width, height, intent);
        if (sigma <= 0) {
            return maskRaw;
        }
        const softenedMask = await sharp(maskRaw, {
            raw: { width, height, channels: 1 }
        })
            .blur(sigma)
            .extractChannel(0)
            .raw()
            .toBuffer();
        return Buffer.from(clampSoftenedMaskToSelection(maskRaw, softenedMask));
    }

    private resolveCompositeBlurSigma(
        width: number,
        height: number,
        intent: InpaintingPromptIntent
    ): number {
        const base = Math.max(width, height) * 0.0065;
        const multiplier: Record<InpaintingPromptIntent, number> = {
            'context-fill': 1.2,
            add: 1.35,
            replace: 1.05,
            remove: 1.15,
            modify: 1
        };
        return this.clamp(Number((base * multiplier[intent]).toFixed(2)), 1.1, 4.8);
    }

    private buildPromptPlan(
        prompt: string | undefined,
        provider: InpaintingProvider
    ): { originalPrompt: string; effectivePrompt: string; intent: InpaintingPromptIntent } {
        const originalPrompt = String(prompt || '').trim();
        const normalizedPrompt = originalPrompt.replace(/\s+/g, ' ').trim();

        if (!normalizedPrompt) {
            if (provider === 'jimeng') {
                return {
                    originalPrompt: '',
                    intent: 'context-fill',
                    effectivePrompt: '删除'
                };
            }
            return {
                originalPrompt: '',
                intent: 'context-fill',
                effectivePrompt: '根据周围画面内容自然补全选区，保持原场景的光线、透视、材质、色温、景深和边缘过渡一致，不要生成突兀的新主体，不改动选区外内容。'
            };
        }

        const addIntent = /^(请)?(帮我)?(在)?(这里|画面里|场景里|选区里)?(加入|添加|增加|加上|放入|放上|添上|添入)/;
        const replaceIntent = /^(请)?(帮我)?(把|将).*(换成|替换成|替换为|改成)/;
        const removeIntent = /^(请)?(帮我)?(把|将)?(这里|选区里)?(去掉|移除|删除|擦掉|去除)/;
        const intent: InpaintingPromptIntent = addIntent.test(normalizedPrompt)
            ? 'add'
            : replaceIntent.test(normalizedPrompt)
                ? 'replace'
                : removeIntent.test(normalizedPrompt)
                    ? 'remove'
                    : 'modify';

        if (provider === 'jimeng') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: this.buildJimengPrompt(normalizedPrompt, intent)
            };
        }

        const subject = this.extractPromptSubject(normalizedPrompt, intent);
        if (intent === 'add') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: `在选区内自然加入${subject}，让新增内容与周围画面的光线、透视、材质、色温、景深和边缘过渡保持一致，避免悬浮、拼贴感、重复物体和突兀边缘，不改动选区外内容。`
            };
        }
        if (intent === 'replace') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: `将选区中的原有内容替换为${subject}，保持与周围画面的光线、透视、材质、色温、景深和边缘过渡一致，不改动选区外内容。`
            };
        }
        if (intent === 'remove') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: `移除选区中的${subject}，并根据周围画面自然补全背景，保持原场景的光线、透视、纹理、材质和边缘过渡一致，不改动选区外内容。`
            };
        }
        return {
            originalPrompt: normalizedPrompt,
            intent,
            effectivePrompt: `在选区内根据以下描述进行自然编辑：${normalizedPrompt}。保持与周围画面的光线、透视、材质、色温、景深和边缘过渡一致，不改动选区外内容。`
        };
    }

    private buildJimengPrompt(prompt: string, intent: InpaintingPromptIntent): string {
        if (intent === 'remove' || intent === 'context-fill') {
            return '删除';
        }

        const normalizedTextEditPrompt = this.normalizeJimengTextEditPrompt(prompt, intent);
        if (normalizedTextEditPrompt) {
            return normalizedTextEditPrompt;
        }

        return prompt;
    }

    private normalizeJimengTextEditPrompt(prompt: string, intent: InpaintingPromptIntent): string | null {
        const hasTextEditVerb = /(改为|换成|替换为|替换成|替换内容|文字替换)/.test(prompt);
        const mentionsTextContent = /(文字|文案|标题|logo|字样|字体|内容|英文|中文|数字|日期)/i.test(prompt);
        if (!hasTextEditVerb && !mentionsTextContent) {
            return null;
        }

        const quotedText = this.extractQuotedText(prompt);
        const replacement = this.stripWrappingQuotes(
            quotedText || (intent === 'replace' ? this.extractPromptSubject(prompt, intent) : '')
        );
        if (!replacement) {
            return null;
        }

        const keepFontPrefix = /字体不变/.test(prompt) ? '字体不变，' : '';
        return `${keepFontPrefix}将内容替换为“${replacement}”`;
    }

    private extractPromptSubject(prompt: string, intent: InpaintingPromptIntent): string {
        let subject = prompt;
        if (intent === 'add') {
            subject = subject
                .replace(/^(请)?(帮我)?(在)?(这里|画面里|场景里|选区里)?(加入|添加|增加|加上|放入|放上|添上|添入)(一些|一点|少量|些许)?/, '')
                .trim();
        } else if (intent === 'replace') {
            subject = subject
                .replace(/^(请)?(帮我)?(把|将)/, '')
                .replace(/.*(换成|替换成|替换为|改成)/, '')
                .trim();
        } else if (intent === 'remove') {
            subject = subject
                .replace(/^(请)?(帮我)?(把|将)?(这里|选区里)?(去掉|移除|删除|擦掉|去除)/, '')
                .trim();
        }
        subject = subject.replace(/^[：:，,\s]+|[。！!，,\s]+$/g, '').trim();
        return subject || prompt;
    }

    private extractQuotedText(prompt: string): string {
        const match = prompt.match(/[“"](.*?)[”"]/);
        return match?.[1]?.trim() || '';
    }

    private stripWrappingQuotes(value: string): string {
        return String(value || '')
            .replace(/^[“"'`]+|[”"'`]+$/g, '')
            .trim();
    }

    private resolveOutputPlacement(
        request: InpaintingRequest,
        scaledRegion: RegionBounds,
        intent: InpaintingPromptIntent
    ): OutputPlacement {
        const documentWidth = Number(request.documentMeta?.width);
        const documentHeight = Number(request.documentMeta?.height);
        const scaledSelectionBounds = this.normalizeBounds(request.selectionBounds || null);
        const originalSelectionBounds = this.normalizeBounds(request.documentMeta?.selectionBoundsOriginal || null);
        const scaledOutputBounds = this.resolveSelectionOutputBounds(
            scaledSelectionBounds
                ? {
                    left: scaledSelectionBounds.left,
                    top: scaledSelectionBounds.top,
                    right: scaledSelectionBounds.right,
                    bottom: scaledSelectionBounds.bottom
                }
                : {
                    left: scaledRegion.left,
                    top: scaledRegion.top,
                    right: scaledRegion.left + scaledRegion.width,
                    bottom: scaledRegion.top + scaledRegion.height
                },
            request.imageWidth,
            request.imageHeight,
            intent
        );

        const cropLeft = this.clamp(scaledOutputBounds.left - scaledRegion.left, 0, Math.max(0, scaledRegion.width - 1));
        const cropTop = this.clamp(scaledOutputBounds.top - scaledRegion.top, 0, Math.max(0, scaledRegion.height - 1));
        const cropWidth = this.clamp(scaledOutputBounds.right - scaledOutputBounds.left, 1, Math.max(1, scaledRegion.width - cropLeft));
        const cropHeight = this.clamp(scaledOutputBounds.bottom - scaledOutputBounds.top, 1, Math.max(1, scaledRegion.height - cropTop));

        if (originalSelectionBounds && documentWidth > 0 && documentHeight > 0) {
            const originalOutputBounds = this.resolveSelectionOutputBounds(originalSelectionBounds, documentWidth, documentHeight, intent);
            return {
                targetLeft: originalOutputBounds.left,
                targetTop: originalOutputBounds.top,
                targetWidth: originalOutputBounds.right - originalOutputBounds.left,
                targetHeight: originalOutputBounds.bottom - originalOutputBounds.top,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        const scale = this.resolveRequestScale(request);
        if (scale >= 0.999 || documentWidth <= 0 || documentHeight <= 0) {
            return {
                targetLeft: scaledOutputBounds.left,
                targetTop: scaledOutputBounds.top,
                targetWidth: scaledOutputBounds.right - scaledOutputBounds.left,
                targetHeight: scaledOutputBounds.bottom - scaledOutputBounds.top,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        const targetLeft = this.clamp(Math.round(scaledOutputBounds.left / scale), 0, Math.max(0, documentWidth - 1));
        const targetTop = this.clamp(Math.round(scaledOutputBounds.top / scale), 0, Math.max(0, documentHeight - 1));
        const targetWidth = this.clamp(Math.round((scaledOutputBounds.right - scaledOutputBounds.left) / scale), 1, Math.max(1, documentWidth - targetLeft));
        const targetHeight = this.clamp(Math.round((scaledOutputBounds.bottom - scaledOutputBounds.top) / scale), 1, Math.max(1, documentHeight - targetTop));

        return {
            targetLeft,
            targetTop,
            targetWidth,
            targetHeight,
            cropLeft,
            cropTop,
            cropWidth,
            cropHeight
        };
    }

    private resolveSelectionOutputBounds(
        bounds: SelectionBounds,
        imageWidth: number,
        imageHeight: number,
        intent: InpaintingPromptIntent
    ): SelectionBounds {
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        const basePadding = Math.max(4, Math.min(18, Math.round(Math.max(width, height) * 0.035)));
        const multiplier: Record<InpaintingPromptIntent, number> = {
            'context-fill': 1.05,
            add: 1.15,
            replace: 0.9,
            remove: 1,
            modify: 0.9
        };
        const padding = Math.round(basePadding * multiplier[intent]);
        return {
            left: this.clamp(bounds.left - padding, 0, Math.max(0, imageWidth - 1)),
            top: this.clamp(bounds.top - padding, 0, Math.max(0, imageHeight - 1)),
            right: this.clamp(bounds.right + padding, 1, imageWidth),
            bottom: this.clamp(bounds.bottom + padding, 1, imageHeight)
        };
    }

    private resolveRequestScale(request: InpaintingRequest): number {
        const explicitScale = Number(request.documentMeta?.scale);
        if (Number.isFinite(explicitScale) && explicitScale > 0 && explicitScale <= 1) {
            return explicitScale;
        }

        const documentWidth = Number(request.documentMeta?.width);
        const documentHeight = Number(request.documentMeta?.height);
        if (documentWidth > 0 && documentHeight > 0) {
            const scaleX = request.imageWidth / documentWidth;
            const scaleY = request.imageHeight / documentHeight;
            if (Number.isFinite(scaleX) && Number.isFinite(scaleY) && scaleX > 0 && scaleY > 0) {
                return Math.min(scaleX, scaleY);
            }
        }

        return 1;
    }

    private normalizeBounds(bounds: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
    } | null): SelectionBounds | null {
        if (!bounds) {
            return null;
        }
        const left = Number(bounds.left);
        const top = Number(bounds.top);
        const right = Number(bounds.right);
        const bottom = Number(bounds.bottom);
        if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
            return null;
        }
        return { left, top, right, bottom };
    }

    private async resizeRawRgba(
        rgba: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        targetWidth: number,
        targetHeight: number
    ): Promise<Buffer> {
        if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
            return rgba;
        }
        return sharp(rgba, {
            raw: { width: sourceWidth, height: sourceHeight, channels: 4 }
        })
            .resize(targetWidth, targetHeight, { fit: 'fill' })
            .raw()
            .toBuffer();
    }

    private async cropRawRgba(
        rgba: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        left: number,
        top: number,
        width: number,
        height: number
    ): Promise<Buffer> {
        if (left <= 0 && top <= 0 && width === sourceWidth && height === sourceHeight) {
            return rgba;
        }
        return sharp(rgba, {
            raw: { width: sourceWidth, height: sourceHeight, channels: 4 }
        })
            .extract({ left, top, width, height })
            .raw()
            .toBuffer();
    }

    private async cropRawChannel(
        raw: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        left: number,
        top: number,
        width: number,
        height: number,
        channels: 1 | 2 | 3 | 4
    ): Promise<Buffer> {
        if (left <= 0 && top <= 0 && width === sourceWidth && height === sourceHeight) {
            return raw;
        }
        const pipeline = sharp(raw, {
            raw: { width: sourceWidth, height: sourceHeight, channels }
        })
            .extract({ left, top, width, height });
        if (channels === 1) {
            return pipeline.extractChannel(0).raw().toBuffer();
        }
        return pipeline.raw().toBuffer();
    }

    private async resizeRawChannel(
        raw: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        targetWidth: number,
        targetHeight: number,
        channels: 1 | 2 | 3 | 4
    ): Promise<Buffer> {
        if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
            return raw;
        }
        const pipeline = sharp(raw, {
            raw: { width: sourceWidth, height: sourceHeight, channels }
        })
            .resize(targetWidth, targetHeight, {
                fit: 'fill',
                kernel: sharp.kernel.nearest
            });
        if (channels === 1) {
            return pipeline.extractChannel(0).raw().toBuffer();
        }
        return pipeline.raw().toBuffer();
    }

    private emitProgress(onProgress: InpaintingProgressCallback | undefined, event: InpaintingProgressEvent): void {
        onProgress?.(event);
    }

    private mapBflProgress(progress?: number): number {
        if (typeof progress !== 'number' || !Number.isFinite(progress)) {
            return 32;
        }
        const clamped = this.clamp(progress, 0, 100);
        return Math.round(22 + (clamped * 0.7));
    }

    private getBflProgressMessage(status?: string, progress?: number): string {
        if (typeof progress === 'number' && Number.isFinite(progress)) {
            return `BFL processing ${Math.round(this.clamp(progress, 0, 100))}%`;
        }
        if (status) {
            return `BFL processing (${status})`;
        }
        return 'BFL processing';
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    private toDataUrl(pngBuffer: Buffer): string {
        return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    }
}
