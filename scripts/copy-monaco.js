#!/usr/bin/env node
/**
 * Script to copy Monaco Editor files to public folder for offline/production use.
 * Run this before building for production: node scripts/copy-monaco.js
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min');
const DEST = path.join(__dirname, '..', 'public', 'monaco-editor', 'min');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source not found: ${src}`);
    return;
  }

  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const files = fs.readdirSync(src);
    for (const file of files) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Copying Monaco Editor files to public folder...');
console.log(`From: ${SOURCE}`);
console.log(`To: ${DEST}`);

// Clean destination
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true });
}

copyRecursive(SOURCE, DEST);

console.log('✓ Monaco Editor files copied successfully!');
console.log('  These files will be bundled with your app for offline use.');
