/**
 * Clean script - removes dist folder
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
  console.log('Cleaned dist folder');
} else {
  console.log('dist folder does not exist');
}
