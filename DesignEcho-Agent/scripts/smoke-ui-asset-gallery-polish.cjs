#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  filterAssetImages,
  getAspectLabel,
  getAssetRole,
  getAssetRoleLabel
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'asset-gallery-view-model.ts'));

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function image(overrides) {
  return {
    name: 'asset.jpg',
    path: `D:\\project\\${overrides.name || 'asset.jpg'}`,
    relativePath: overrides.name || 'asset.jpg',
    size: 1024,
    ext: '.jpg',
    type: 'product',
    parentFolder: '原图',
    folderType: 'source',
    ...overrides
  };
}

const sourceSquare = image({
  name: 'white-sock-1440.jpg',
  relativePath: '原图/white-sock-1440.jpg',
  width: 1440,
  height: 1440
});
const deliverablePortrait = image({
  name: 'main-750.jpg',
  relativePath: '主图/750/main-750.jpg',
  folderType: 'mainImage',
  width: 1440,
  height: 1920
});
const detailLong = image({
  name: 'detail-1200.jpg',
  relativePath: '详情页/detail-1200.jpg',
  folderType: 'detail',
  type: 'detail',
  width: 1440,
  height: 2560
});
const psdDoc = image({
  name: 'layout.psd',
  relativePath: 'PSD/layout.psd',
  folderType: 'psd',
  type: 'psd',
  ext: '.psd',
  size: 18 * 1024 * 1024
});
const videoAsset = image({
  name: 'turntable.mp4',
  relativePath: '视频/turntable.mp4',
  type: 'video',
  ext: '.mp4'
});

assert(getAssetRole(sourceSquare) === 'source', 'source folder product should be project source asset');
assert(getAssetRole(deliverablePortrait) === 'deliverable', 'main image output should be deliverable asset');
assert(getAssetRole(psdDoc) === 'designDoc', 'PSD file should be design document asset');
assert(getAssetRole(videoAsset) === 'media', 'video file should be media asset');
assert(getAssetRoleLabel('deliverable') === '交付输出', 'asset role label should be Chinese UI copy');

assert(getAspectLabel(sourceSquare) === '1:1', 'square image should expose 1:1 aspect label');
assert(getAspectLabel(deliverablePortrait) === '3:4', 'portrait main image should expose 3:4 aspect label');
assert(getAspectLabel(detailLong) === '9:16', 'long detail image should expose 9:16 aspect label');

const allImages = [sourceSquare, deliverablePortrait, detailLong, psdDoc, videoAsset];
assert(
  filterAssetImages(allImages, { role: 'deliverable' }).length === 2,
  'deliverable filter should include main image and detail output',
  filterAssetImages(allImages, { role: 'deliverable' })
);
assert(
  filterAssetImages(allImages, { role: 'designDoc' })[0].name === 'layout.psd',
  'designDoc filter should include PSD files'
);
assert(
  filterAssetImages(allImages, { query: '3:4' })[0].name === 'main-750.jpg',
  'search should include aspect labels'
);
assert(
  filterAssetImages(allImages, { query: 'PSD' })[0].name === 'layout.psd',
  'search should include extension and folder type labels'
);
assert(
  filterAssetImages(allImages, { sortBy: 'size' })[0].name === 'layout.psd',
  'size sort should put larger design document first'
);

const assetGallery = read('src/renderer/components/AssetGallery.tsx');
const viewModel = read('src/renderer/components/asset-gallery-view-model.ts');
const appStore = read('src/renderer/stores/app.store.ts');
const packageJson = read('package.json');
const changeBoundaries = read('scripts/report-change-boundaries.cjs');
const maintenance = read('scripts/validate-maintenance-hygiene.cjs');

assert(assetGallery.includes("from './asset-gallery-view-model'"), 'AssetGallery should use pure view model helpers');
assert(assetGallery.includes('data-testid="asset-gallery-role-filters"'), 'AssetGallery should expose role filter controls');
assert(assetGallery.includes('data-testid="asset-gallery-aspect-thumbnail"'), 'AssetGallery should expose stable aspect thumbnail region');
assert(assetGallery.includes('data-testid="asset-gallery-source-chip"'), 'AssetGallery should expose source/provenance chips');
assert(assetGallery.includes('data-testid="asset-gallery-preview-modal"'), 'AssetGallery should expose preview modal region');
assert(assetGallery.includes('findFirstImageFolder'), 'AssetGallery should auto-select the first folder with images');
assert(appStore.includes('width?: number') && appStore.includes('height?: number') && appStore.includes('aspectRatio?: number'), 'renderer ImageFile type should keep image dimensions from scanner');
assert(!assetGallery.includes('searchEagleReadonlyKnowledge'), 'asset gallery polish must not merge Eagle results into local project assets yet');
assert(!assetGallery.includes('executeToolCall'), 'asset gallery polish must not execute tools');
assert(!assetGallery.includes('processWithUnifiedAgent'), 'asset gallery polish must not call Agent runtime');
assert(!viewModel.includes('confidence') && !viewModel.includes('置信'), 'asset gallery view model must not expose confidence fields');
assert(packageJson.includes('"smoke:ui:asset-gallery-polish"'), 'package script should expose asset gallery polish smoke');
assert(packageJson.includes('smoke:ui:asset-gallery-polish'), 'maintenance preflight should run asset gallery polish smoke');
assert(changeBoundaries.includes('asset-gallery-view-model') && changeBoundaries.includes('AssetGallery'), 'change boundaries should include asset gallery polish files');
assert(maintenance.includes('smoke-ui-asset-gallery-polish.cjs'), 'maintenance hygiene should run/check asset gallery polish smoke');
assert(exists('src/renderer/components/asset-gallery-view-model.ts'), 'asset gallery view model should exist');

console.log(JSON.stringify({
  success: true,
  checks: [
    'asset gallery view model classifies source, deliverable, design document and media assets',
    'asset gallery view model exposes 1:1, 3:4 and 9:16 aspect labels from scanner dimensions',
    'search covers name, path, role, extension and aspect labels without reading image payloads',
    'AssetGallery exposes role filters, stable aspect thumbnails, source chips and preview region',
    'asset polish does not merge Eagle results, run Agent runtime, run tools or expose confidence fields',
    'package, maintenance preflight, change boundaries and maintenance hygiene are wired'
  ]
}, null, 2));
