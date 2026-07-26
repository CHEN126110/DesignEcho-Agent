#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  project: require('path').resolve(__dirname, '..', 'tsconfig.main.json')
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const {
  ResourceManagerService
} = require('../src/main/services/resource-manager-service.ts');

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

async function makeImage(filePath, color, text) {
  const svg = Buffer.from(`
    <svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
      <rect width="320" height="240" fill="${color}"/>
      <text x="24" y="124" font-size="34" font-family="Arial" fill="#111111">${text}</text>
    </svg>
  `);
  await sharp(svg).jpeg({ quality: 90 }).toFile(filePath);
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-contact-sheet-'));
  const imageDir = path.join(tempRoot, 'source');
  fs.mkdirSync(imageDir, { recursive: true });

  const imagePaths = [
    path.join(imageDir, 'silk-wear.jpg'),
    path.join(imageDir, 'white-bg.jpg'),
    path.join(imageDir, 'detail.jpg'),
    path.join(imageDir, 'colors.jpg')
  ];
  await makeImage(imagePaths[0], '#f5efe5', 'wear');
  await makeImage(imagePaths[1], '#f8f8f8', 'white');
  await makeImage(imagePaths[2], '#dceff5', 'detail');
  await makeImage(imagePaths[3], '#e7e3f2', 'colors');

  const service = new ResourceManagerService();
  const result = await service.createProjectContactSheetOverview({
    projectPath: tempRoot,
    images: imagePaths.map((imagePath, index) => ({
      path: imagePath,
      relativePath: `source/${path.basename(imagePath)}`,
      labelHint: ['上脚', '白底', '细节', '多色'][index]
    })),
    columns: 2,
    tileWidth: 220,
    tileHeight: 260,
    maxImages: 4
  });

  assert(result.success === true, 'contact sheet overview should succeed', result);
  assert(result.sheet?.mediaType === 'image/jpeg', 'contact sheet should be a JPEG image', result);
  assert(typeof result.sheet?.imageData === 'string' && result.sheet.imageData.length > 1000, 'contact sheet should return base64 image data', result);
  assert(result.sheet.width > 300 && result.sheet.height > 300, 'contact sheet should expose actual sheet dimensions', result);
  assert(result.sheet.columns === 2 && result.sheet.rows === 2, 'contact sheet should respect requested grid columns', result);
  assert(result.items.length === 4, 'contact sheet should return one manifest item per image', result);
  assert(result.items[0].id === 'A01' && result.items[3].id === 'A04', 'contact sheet should assign stable visible ids', result);
  assert(result.items.every((item) => item.status === 'rendered'), 'all fixture images should render', result);
  assert(!JSON.stringify(result).includes('data:image'), 'result should not wrap imageData in a data URL', result);

  const buffer = Buffer.from(result.sheet.imageData, 'base64');
  const metadata = await sharp(buffer).metadata();
  assert(metadata.width === result.sheet.width && metadata.height === result.sheet.height, 'returned dimensions should match encoded image', {
    result,
    metadata
  });

  let receivedImage = '';
  let receivedPrompt = '';
  const analysis = await service.analyzeProjectContactSheetOverview({
    projectPath: tempRoot,
    images: imagePaths.map((imagePath, index) => ({
      path: imagePath,
      relativePath: `source/${path.basename(imagePath)}`,
      labelHint: ['上脚', '白底', '细节', '多色'][index]
    })),
    columns: 2,
    tileWidth: 220,
    tileHeight: 260,
    maxImages: 4,
    focus: 'style-and-selling-points',
    userIntent: '理解这个袜子项目，提炼后续详情页卖点。'
  }, async (imageBase64, prompt) => {
    receivedImage = imageBase64;
    receivedPrompt = prompt;
    return JSON.stringify({
      projectStyle: 'ins clean product photography',
      productUnderstanding: 'light socks with color variants',
      sellingPoints: ['轻薄透气', '多色可选'],
      imageRoles: [{ id: 'A01', role: 'wearing or product candidate' }],
      nextSingleImageChecks: ['A01', 'A03']
    });
  });

  assert(analysis.success === true, 'contact sheet analysis should succeed', analysis);
  assert(receivedImage.startsWith('data:image/jpeg;base64,'), 'vision model should receive contact sheet as image data URL', {
    receivedImagePrefix: receivedImage.slice(0, 32)
  });
  assert(receivedPrompt.includes('A01') && receivedPrompt.includes('source/silk-wear.jpg'), 'vision prompt should include numbered manifest', {
    receivedPrompt
  });
  assert(analysis.observation?.sellingPoints?.includes('轻薄透气'), 'analysis should parse JSON selling points', analysis);
  assert(analysis.contactSheet.items.length === 4, 'analysis should preserve contact sheet manifest', analysis);

  console.log(JSON.stringify({
    success: true,
    sheet: {
      width: result.sheet.width,
      height: result.sheet.height,
      columns: result.sheet.columns,
      rows: result.sheet.rows
    },
    ids: result.items.map((item) => item.id),
    observation: analysis.observation
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
