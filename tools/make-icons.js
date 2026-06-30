/* tools/make-icons.js
 * PromptFarm now uses icons/promptfarm.png directly as its extension icon.
 * This script intentionally does not generate or overwrite icon assets.
 *
 * Run: node tools/make-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const iconPath = path.join(__dirname, '..', 'icons', 'promptfarm.png');

if (!fs.existsSync(iconPath)) {
  console.error('Missing icons/promptfarm.png');
  process.exit(1);
}

console.log('Using icons/promptfarm.png directly. No icon files were changed.');
