const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve(__dirname, '..', 'src', 'tools', 'image', 'export-layer.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

const checks = [
  {
    name: 'has 8-bit encode boundary helper',
    pass: source.includes('function encodeImageDataToBase64')
  },
  {
    name: 'creates explicit 8-bit RGB image data before fallback encoding',
    pass: source.includes('imaging.createImageDataFromBuffer')
      && source.includes("components: 3")
      && source.includes("colorSpace: 'RGB'")
  },
  {
    name: 'normalizes 16-bit and 32-bit Photoshop pixel buffers',
    pass: source.includes('function normalizeTypedPixelData')
      && source.includes('function sampleTo8Bit')
      && source.includes('function normalizePixelsToRgba8')
  },
  {
    name: 'layer imaging path uses normalized encode helper',
    pass: source.includes('encodeImageDataToBase64(rgbPixelData.imageData, targetWidth, targetHeight)')
  },
  {
    name: 'batch fallback path uses normalized encode helper',
    pass: source.includes('encodeImageDataToBase64(pixelData.imageData, targetWidth, targetHeight)')
  },
  {
    name: 'old direct encode calls are removed from layer export paths',
    pass: !source.includes('imageData: rgbPixelData.imageData')
      && !source.includes('imageData: pixelData.imageData')
  }
];

const failed = checks.filter((check) => !check.pass);
const result = {
  success: failed.length === 0,
  checks
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  process.exit(1);
}
