#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

try {
  require('ts-node').register({
    skipProject: true,
    transpileOnly: true,
    compilerOptions: {
      module: 'commonjs',
      moduleResolution: 'node',
      esModuleInterop: true
    }
  });
} catch (error) {
  console.error('[smoke-shape-morphing-pipeline] 缺少 ts-node 依赖');
  process.exit(1);
}

const { ShapeMorphingOrchestrator } = require('../src/main/services/shape-morphing-orchestrator');

function ensureTmpDir() {
  const dir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createRectContour(left, top, width, height, samplesPerEdge = 12) {
  const points = [];
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left + width * t, y: top });
  }
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left + width, y: top + height * t });
  }
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left + width * (1 - t), y: top + height });
  }
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left, y: top + height * (1 - t) });
  }
  return points;
}

function createPolylineContour(vertices, samplesPerEdge = 10) {
  const points = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    for (let step = 0; step < samplesPerEdge; step += 1) {
      const t = step / samplesPerEdge;
      points.push({
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t
      });
    }
  }
  return points;
}

function createSockLikeContour(left, top, width, height) {
  return createPolylineContour([
    { x: left + width * 0.24, y: top + height * 0.02 },
    { x: left + width * 0.78, y: top },
    { x: left + width * 0.82, y: top + height * 0.56 },
    { x: left + width * 1.00, y: top + height * 0.67 },
    { x: left + width * 0.88, y: top + height * 0.83 },
    { x: left + width * 0.30, y: top + height * 0.98 },
    { x: left, y: top + height * 0.90 },
    { x: left + width * 0.15, y: top + height * 0.62 },
    { x: left + width * 0.20, y: top + height * 0.28 }
  ], 12);
}

function createEllipseMaskBuffer(width, height) {
  const buffer = Buffer.alloc(width * height, 0);
  const centerX = width * 0.52;
  const centerY = height * 0.52;
  const radiusX = width * 0.30;
  const radiusY = height * 0.44;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      if (dx * dx + dy * dy <= 1) {
        buffer[y * width + x] = 255;
      }
    }
  }
  return buffer;
}

function createMockWsServer(samplePngBase64) {
  const referenceBounds = { left: 100, top: 120, right: 320, bottom: 620, width: 220, height: 500 };
  const productBounds = {
    201: { left: 20, top: 40, right: 200, bottom: 420, width: 180, height: 380 },
    202: { left: 240, top: 60, right: 410, bottom: 430, width: 170, height: 370 }
  };
  const referenceContour = createSockLikeContour(0, 0, 220, 500);
  const productContour = createSockLikeContour(0, 0, 180, 380);

  return {
    async sendRequest(method, params) {
      switch (method) {
        case 'getLayerBounds': {
          if (params.layerId === 101) {
            return { success: true, bounds: referenceBounds, boundsNoEffects: referenceBounds };
          }
          const bounds = productBounds[params.layerId];
          return bounds
            ? { success: true, bounds, boundsNoEffects: bounds }
            : { success: false, error: 'unknown layer' };
        }
        case 'exportLayerAsBase64': {
          return {
            success: true,
            data: {
              base64: samplePngBase64,
              width: 180,
              height: 380
            }
          };
        }
        case 'extractShapePath': {
          return {
            success: true,
            sampledPoints: referenceContour,
            contour: { boundingBox: { width: 220, height: 500 } }
          };
        }
        case 'getLayerContour': {
          return {
            success: true,
            sampledPoints: productContour,
            contour: { boundingBox: { width: 180, height: 380 } }
          };
        }
        case 'alignToReference': {
          return { success: true, params };
        }
        case 'applyDisplacement': {
          return { success: true, layerId: params.layerId };
        }
        default:
          return { success: false, error: `unsupported method: ${method}` };
      }
    }
  };
}

function createLayerContourReferenceWsServer(samplePngBase64) {
  const bounds = {
    301: { left: 100, top: 120, right: 320, bottom: 620, width: 220, height: 500 },
    401: { left: 20, top: 40, right: 200, bottom: 420, width: 180, height: 380 },
    402: { left: 240, top: 60, right: 410, bottom: 430, width: 170, height: 370 }
  };
  const contours = {
    301: createSockLikeContour(0, 0, 220, 500),
    401: createSockLikeContour(0, 0, 180, 380),
    402: createRectContour(0, 0, 170, 370)
  };
  const calls = [];

  return {
    calls,
    async sendRequest(method, params) {
      calls.push({ method, params });
      switch (method) {
        case 'getLayerBounds': {
          const layerBounds = bounds[params.layerId];
          return layerBounds
            ? { success: true, bounds: layerBounds, boundsNoEffects: layerBounds }
            : { success: false, error: 'unknown layer' };
        }
        case 'exportLayerAsBase64': {
          return {
            success: true,
            data: {
              base64: samplePngBase64,
              width: bounds[params.layerId]?.width || 180,
              height: bounds[params.layerId]?.height || 380
            }
          };
        }
        case 'extractShapePath': {
          return { success: false, error: 'not a vector shape layer' };
        }
        case 'getLayerContour': {
          const contour = contours[params.layerId];
          return contour
            ? {
                success: true,
                sampledPoints: contour,
                contour: {
                  boundingBox: {
                    width: bounds[params.layerId].width,
                    height: bounds[params.layerId].height
                  }
                }
              }
            : { success: false, error: 'missing contour' };
        }
        case 'alignToReference': {
          return { success: true, params };
        }
        case 'applyDisplacement': {
          return { success: true, layerId: params.layerId };
        }
        default:
          return { success: false, error: `unsupported method: ${method}` };
      }
    }
  };
}

function createMattingContourReferenceWsServer(samplePngBase64) {
  const bounds = {
    501: { left: 100, top: 120, right: 320, bottom: 620, width: 220, height: 500 },
    601: { left: 20, top: 40, right: 200, bottom: 420, width: 180, height: 380 }
  };
  const rectContours = {
    501: createRectContour(0, 0, 220, 500),
    601: createRectContour(0, 0, 180, 380)
  };
  const calls = [];

  return {
    calls,
    async sendRequest(method, params) {
      calls.push({ method, params });
      switch (method) {
        case 'getLayerBounds': {
          const layerBounds = bounds[params.layerId];
          return layerBounds
            ? { success: true, bounds: layerBounds, boundsNoEffects: layerBounds }
            : { success: false, error: 'unknown layer' };
        }
        case 'exportLayerAsBase64': {
          return {
            success: true,
            data: {
              base64: samplePngBase64,
              width: bounds[params.layerId]?.width || 180,
              height: bounds[params.layerId]?.height || 380
            }
          };
        }
        case 'extractShapePath': {
          return { success: false, error: 'not a vector shape layer' };
        }
        case 'getLayerContour': {
          const contour = rectContours[params.layerId];
          return contour
            ? {
                success: true,
                sampledPoints: contour,
                contour: {
                  boundingBox: {
                    width: bounds[params.layerId].width,
                    height: bounds[params.layerId].height
                  }
                }
              }
            : { success: false, error: 'missing contour' };
        }
        case 'alignToReference': {
          return { success: true, params };
        }
        default:
          return { success: false, error: `unsupported method: ${method}` };
      }
    }
  };
}

function createMockMattingService() {
  return {
    async detectWithYoloWorld() {
      return [{ x1: 10, y1: 10, x2: 150, y2: 340, confidence: 0.93 }];
    },
    async removeBackground() {
      return { success: false, error: 'not expected in non-rect contour fixture' };
    }
  };
}

function createNoDetectionMattingService() {
  return {
    async detectWithYoloWorld() {
      return [];
    },
    async removeBackground() {
      return { success: false, error: 'mask unavailable in this fixture' };
    }
  };
}

function createMaskContourMattingService() {
  const calls = [];
  return {
    calls,
    async detectWithYoloWorld() {
      return [];
    },
    async removeBackground(_imageBase64, options) {
      calls.push({ options });
      return {
        success: true,
        maskBuffer: createEllipseMaskBuffer(96, 160),
        maskWidth: 96,
        maskHeight: 160,
        usedModel: 'birefnet'
      };
    }
  };
}

async function main() {
  const samplePngBase64 = await sharp({
    create: {
      width: 32,
      height: 64,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).png().toBuffer().then((buffer) => buffer.toString('base64'));

  const wsServer = createMockWsServer(samplePngBase64);
  const mattingService = createMockMattingService();
  const orchestrator = new ShapeMorphingOrchestrator(wsServer, mattingService);

  const alignment = await orchestrator.executeAlignment({
    referenceShapeId: 101,
    productLayerIds: [201, 202],
    step: 'align',
    preAlign: true
  });

  const morph = await orchestrator.executeFullMorphing({
    referenceShapeId: 101,
    productLayerIds: [201, 202],
    step: 'morph',
    preAlign: true,
    shapeMatch: true,
    edgeStrength: 70,
    contentProtection: 80,
    smoothness: 50,
    cuffProtected: true
  });

  const fastQualityMorph = await orchestrator.executeFullMorphing({
    referenceShapeId: 101,
    productLayerIds: [201],
    step: 'morph',
    preAlign: true,
    shapeMatch: true,
    edgeStrength: 70,
    contentProtection: 80,
    smoothness: 50,
    cuffProtected: true,
    selectedRegions: ['body', 'toe'],
    quality: 'fast'
  });

  const rejected = await orchestrator.executeFullMorphing({
    referenceShapeId: 101,
    productLayerIds: [201],
    step: 'morph',
    preAlign: true,
    shapeMatch: true,
    edgeStrength: 70,
    contentProtection: 80,
    smoothness: 50,
    cuffProtected: true,
    cuffType: 'decorated'
  });

  const contourReferenceWsServer = createLayerContourReferenceWsServer(samplePngBase64);
  const noDetectionOrchestrator = new ShapeMorphingOrchestrator(
    contourReferenceWsServer,
    createNoDetectionMattingService()
  );

  const layerContourReferenceAlignment = await noDetectionOrchestrator.executeAlignment({
    referenceShapeId: 301,
    productLayerIds: [401],
    step: 'align',
    preAlign: true
  });

  const rectangularUncutProduct = await noDetectionOrchestrator.executeAlignment({
    referenceShapeId: 301,
    productLayerIds: [402],
    step: 'align',
    preAlign: true
  });

  const mattingContourWsServer = createMattingContourReferenceWsServer(samplePngBase64);
  const maskContourMattingService = createMaskContourMattingService();
  const mattingContourOrchestrator = new ShapeMorphingOrchestrator(
    mattingContourWsServer,
    maskContourMattingService
  );

  const mattingContourAlignment = await mattingContourOrchestrator.executeAlignment({
    referenceShapeId: 501,
    productLayerIds: [601],
    step: 'align',
    preAlign: true
  });

  const summary = {
    alignment: {
      success: alignment.success,
      successCount: alignment.results.filter((item) => item.success).length,
      total: alignment.results.length,
      methods: alignment.results.map((item) => item.method || 'none')
    },
    morph: {
      success: morph.success,
      successCount: morph.results.filter((item) => item.success).length,
      total: morph.results.length,
      methods: morph.results.map((item) => item.method || 'none')
    },
    fastQualityMorph: {
      success: fastQualityMorph.success,
      method: fastQualityMorph.results[0]?.method || 'none',
      requestedQuality: fastQualityMorph.diagnostics?.requestedQuality || null,
      requestedSelectedRegions: fastQualityMorph.diagnostics?.requestedSelectedRegions || []
    },
    rejection: {
      success: rejected.success,
      rejectedCount: rejected.results.filter((item) => !item.success).length + (rejected.error ? 1 : 0),
      firstError: rejected.results.find((item) => !item.success)?.error || rejected.error || null
    },
    layerContourReference: {
      success: layerContourReferenceAlignment.success,
      method: layerContourReferenceAlignment.results[0]?.method || 'none',
      extractShapePathFailed: contourReferenceWsServer.calls.some((call) =>
        call.method === 'extractShapePath' && call.params?.layerId === 301
      ),
      referenceContourRead: contourReferenceWsServer.calls.some((call) =>
        call.method === 'getLayerContour' && call.params?.layerId === 301
      ),
      productContourSubjectAccepted: !String(layerContourReferenceAlignment.results[0]?.error || '').includes('主体检测失败')
    },
    rectangularUncutProduct: {
      success: rectangularUncutProduct.success,
      firstError: rectangularUncutProduct.results.find((item) => !item.success)?.error || rectangularUncutProduct.error || null
    },
    mattingContour: {
      success: mattingContourAlignment.success,
      method: mattingContourAlignment.results[0]?.method || 'none',
      mattingCalls: maskContourMattingService.calls.length,
      alphaReferenceContourRead: mattingContourWsServer.calls.some((call) =>
        call.method === 'getLayerContour' && call.params?.layerId === 501
      ),
      alphaProductContourRead: mattingContourWsServer.calls.some((call) =>
        call.method === 'getLayerContour' && call.params?.layerId === 601
      )
    }
  };

  const tmpDir = ensureTmpDir();
  const jsonPath = path.join(tmpDir, 'shape-morphing-pipeline-smoke.json');
  const mdPath = path.join(tmpDir, 'shape-morphing-pipeline-smoke.md');

  fs.writeFileSync(jsonPath, JSON.stringify({ alignment, morph, fastQualityMorph, summary }, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Shape Morphing Pipeline Smoke',
      '',
      `- alignment: ${summary.alignment.success ? 'pass' : 'fail'} (${summary.alignment.successCount}/${summary.alignment.total})`,
      `- alignment methods: ${summary.alignment.methods.join(', ')}`,
      `- morph: ${summary.morph.success ? 'pass' : 'fail'} (${summary.morph.successCount}/${summary.morph.total})`,
      `- methods: ${summary.morph.methods.join(', ')}`,
      `- fast quality morph: ${summary.fastQualityMorph.success ? 'pass' : 'fail'} (${summary.fastQualityMorph.method}, quality=${summary.fastQualityMorph.requestedQuality}, regions=${summary.fastQualityMorph.requestedSelectedRegions.join(',')})`,
      `- rejection gate: ${summary.rejection.rejectedCount > 0 && !summary.rejection.success ? 'pass' : 'fail'} (${summary.rejection.firstError || 'none'})`,
      `- layer contour reference: ${summary.layerContourReference.success ? 'pass' : 'fail'} (${summary.layerContourReference.method})`,
      `- matting contour from opaque layer: ${summary.mattingContour.success ? 'pass' : 'fail'} (${summary.mattingContour.method}, maskCalls=${summary.mattingContour.mattingCalls})`,
      `- rectangular product gate after mask failure: ${!summary.rectangularUncutProduct.success && String(summary.rectangularUncutProduct.firstError || '').includes('主体') ? 'pass' : 'fail'} (${summary.rectangularUncutProduct.firstError || 'none'})`
    ].join('\n'),
    'utf8'
  );

  console.log(JSON.stringify(summary, null, 2));

  if (
    !summary.alignment.success ||
    !summary.alignment.methods.every((method) => method === 'skeleton-axis') ||
    !summary.morph.success ||
    !summary.morph.methods.every((method) => method.includes(':region-aware+skeleton') || method.includes(':contour')) ||
    !summary.fastQualityMorph.success ||
    !summary.fastQualityMorph.method.startsWith('optimized-morphing:fast:region-aware+skeleton') ||
    summary.fastQualityMorph.requestedQuality !== 'fast' ||
    summary.fastQualityMorph.requestedSelectedRegions.join(',') !== 'body,toe' ||
    !(summary.rejection.rejectedCount > 0 && !summary.rejection.success) ||
    !summary.layerContourReference.success ||
    !summary.layerContourReference.extractShapePathFailed ||
    !summary.layerContourReference.referenceContourRead ||
    !summary.layerContourReference.productContourSubjectAccepted ||
    !summary.mattingContour.success ||
    summary.mattingContour.mattingCalls < 2 ||
    !summary.mattingContour.alphaReferenceContourRead ||
    !summary.mattingContour.alphaProductContourRead ||
    summary.rectangularUncutProduct.success ||
    !String(summary.rectangularUncutProduct.firstError || '').includes('主体')
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[smoke-shape-morphing-pipeline] failed:', error);
  process.exit(1);
});
