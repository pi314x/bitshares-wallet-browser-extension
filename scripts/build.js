/**
 * Build script - copies source files to dist folder
 * Usage: node scripts/build.js [chrome|firefox|all]
 * Default: chrome
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const target = process.argv[2] || 'chrome';

// Shared files for both browsers
const SHARED_FILES = [
  'src/popup/popup.html',
  'src/popup/popup.css',
  'src/popup/popup.js',
  'src/lib/wallet-manager.js',
  'src/lib/bitshares-api.js',
  'src/lib/crypto-utils.js',
  'src/lib/qr-generator.js',
  'src/lib/identicon.js',
  'src/background/service-worker.js',
  'src/content/inject.js',
  'src/content/inpage.js'
];

const FOLDERS_TO_COPY = [
  'src/assets'
];

// Browser-specific config
const BUILDS = {
  chrome: {
    dist: path.join(ROOT, 'dist'),
    manifest: 'manifest.json',
    extraFiles: []
  },
  firefox: {
    dist: path.join(ROOT, 'dist-firefox'),
    manifest: 'manifest.firefox.json',
    extraFiles: ['src/background/background-firefox.html']
  }
};

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
  console.log(`  Copied: ${path.relative(ROOT, src)}`);
}

function copyFolder(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`  Skipped (not found): ${path.relative(ROOT, src)}`);
    return;
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyFolder(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  console.log(`  Copied folder: ${path.relative(ROOT, src)}`);
}

function build(browser) {
  const config = BUILDS[browser];
  console.log(`\n=== Building for ${browser.toUpperCase()} ===\n`);

  console.log('Cleaning output folder...');
  cleanDir(config.dist);

  // Copy manifest (always as manifest.json in output)
  console.log('\nCopying manifest...');
  const manifestSrc = path.join(ROOT, config.manifest);
  const manifestDest = path.join(config.dist, 'manifest.json');
  copyFile(manifestSrc, manifestDest);

  // Copy shared files
  console.log('\nCopying shared files...');
  for (const file of SHARED_FILES) {
    const src = path.join(ROOT, file);
    const dest = path.join(config.dist, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    } else {
      console.log(`  Warning: ${file} not found`);
    }
  }

  // Copy browser-specific extra files
  for (const file of config.extraFiles) {
    const src = path.join(ROOT, file);
    const dest = path.join(config.dist, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    }
  }

  // Copy shared folders
  console.log('\nCopying folders...');
  for (const folder of FOLDERS_TO_COPY) {
    const src = path.join(ROOT, folder);
    const dest = path.join(config.dist, folder);
    copyFolder(src, dest);
  }

  console.log(`\n${browser.toUpperCase()} build complete! Output: ${path.relative(ROOT, config.dist)}/`);
}

// Run builds
if (target === 'all') {
  build('chrome');
  build('firefox');
} else if (BUILDS[target]) {
  build(target);
} else {
  console.error(`Unknown target: ${target}. Use: chrome, firefox, or all`);
  process.exit(1);
}
