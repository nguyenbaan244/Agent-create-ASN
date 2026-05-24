const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const PATHS = {
  inventory: path.join(BASE_DIR, 'Input', 'Inventory'),
  output: path.join(BASE_DIR, 'Output', 'Inventory Analyze'),
};

function analyzeInventory() {
  try {
    // 1. Find the latest inventory file
    const invFiles = fs.readdirSync(PATHS.inventory).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    if (invFiles.length === 0) {
      return { success: false, error: 'No inventory file found in Input/Inventory' };
    }
    
    // Sort by modified time descending to get the latest
    invFiles.sort((a, b) => {
      const statA = fs.statSync(path.join(PATHS.inventory, a));
      const statB = fs.statSync(path.join(PATHS.inventory, b));
      return statB.mtime - statA.mtime;
    });

    const inventoryFile = invFiles[0];
    const inventoryPath = path.join(PATHS.inventory, inventoryFile);
    
    // 2. Read the file
    const wb = XLSX.readFile(inventoryPath, { cellStyles: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (data.length < 2) {
      return { success: false, error: 'Inventory file is empty or missing data' };
    }

    const headers = data[0];
    
    // 3. Find necessary columns
    const locIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'loc');
    const skuIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'sku');
    const batchIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'lottable01');

    if (locIdx === -1 || skuIdx === -1 || batchIdx === -1) {
      return { success: false, error: 'Missing required columns in inventory file: Loc, SKU, or Lottable01' };
    }

    // 4. Group rows by Loc
    const locGroups = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Skip empty trailing rows
      if (row.every(cell => cell === '')) continue;
      
      const loc = String(row[locIdx] || '').trim();
      const sku = String(row[skuIdx] || '').trim();
      const batch = String(row[batchIdx] || '').trim();

      if (!loc) continue; // Skip empty locations
      
      if (!locGroups[loc]) {
        locGroups[loc] = {
          skus: new Set(),
          batches: new Set(),
          rows: []
        };
      }
      
      if (sku) locGroups[loc].skus.add(sku);
      if (batch) locGroups[loc].batches.add(batch);
      locGroups[loc].rows.push(row);
    }

    // 5. Find wrong locations
    const wrongRows = [];
    let wrongLocCount = 0;

    for (const [loc, group] of Object.entries(locGroups)) {
      if (group.skus.size > 1 || group.batches.size > 1) {
        wrongLocCount++;
        wrongRows.push(...group.rows);
      }
    }

    if (wrongRows.length === 0) {
      return { 
        success: true, 
        message: 'All pallets are placed correctly. No wrong locations found.',
        wrongLocCount: 0,
        wrongPalletCount: 0
      };
    }

    // 6. Create output Excel
    if (!fs.existsSync(PATHS.output)) {
      fs.mkdirSync(PATHS.output, { recursive: true });
    }

    const outputPath = path.join(PATHS.output, 'Wrong Location.xlsx');
    const outputData = [headers, ...wrongRows];
    
    const outputWs = XLSX.utils.aoa_to_sheet(outputData);
    
    // Copy column widths if available
    if (ws['!cols']) {
      outputWs['!cols'] = ws['!cols'];
    }

    // Copy header styles
    for (let c = 0; c < headers.length; c++) {
      const srcRef = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[srcRef] && ws[srcRef].s) {
         if (!outputWs[srcRef]) outputWs[srcRef] = {};
         outputWs[srcRef].s = ws[srcRef].s;
      }
    }

    const outputWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outputWb, outputWs, 'Wrong Locations');
    XLSX.writeFile(outputWb, outputPath);

    return {
      success: true,
      message: `Analysis complete. Found ${wrongLocCount} wrong locations affecting ${wrongRows.length} pallets.`,
      wrongLocCount: wrongLocCount,
      wrongPalletCount: wrongRows.length,
      outputFile: 'Wrong Location.xlsx'
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  analyzeInventory,
  PATHS
};
