/* eslint-disable no-console */

'use strict';

const fs = require('fs');
const path = require('path');

// Konfigurera sökvägar
const sourceDir = path.join(__dirname, '../documentation');
const backupDir = path.join(__dirname, '../../viessmann-documentation-backup');

function moveFiles(from, to) {
  // Skapa målmappen om den inte finns
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }

  // Kontrollera om källmappen finns
  if (!fs.existsSync(from)) {
    console.log(`Source directory ${from} does not exist`);
    return;
  }

  // Flytta alla filer och mappar
  const items = fs.readdirSync(from, { withFileTypes: true });
  for (const item of items) {
    const sourcePath = path.join(from, item.name);
    const targetPath = path.join(to, item.name);

    if (item.isDirectory()) {
      // Rekursivt flytta undermappar
      moveFiles(sourcePath, targetPath);
      fs.rmdirSync(sourcePath);
    } else {
      // Flytta filer
      fs.renameSync(sourcePath, targetPath);
    }
  }
}

// Exportera funktioner för att kunna användas från andra script
module.exports = {
  backup: () => moveFiles(sourceDir, backupDir),
  restore: () => moveFiles(backupDir, sourceDir),
};

// Om scriptet körs direkt (inte importerat), gör backup
if (require.main === module) {
  console.log('Moving documentation to backup location...');
  module.exports.backup();
  console.log('Done!');
}
