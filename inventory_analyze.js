const XLSX = require('xlsx');

/**
 * Analyze inventory for wrong locations.
 * @param {Buffer} inventoryBuffer - The inventory Excel file as a buffer
 * @returns {Object} - Analysis results with optional output buffer
 */
function analyzeInventory(inventoryBuffer) {
  try {
    if (!inventoryBuffer) {
      return { success: false, error: 'No inventory file provided. Please upload an inventory file first.' };
    }

    // Read the buffer
    const wb = XLSX.read(inventoryBuffer, { type: 'buffer', cellStyles: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (data.length < 2) {
      return { success: false, error: 'Inventory file is empty or missing data' };
    }

    const headers = data[0];
    
    // Find necessary columns
    const locIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'loc');
    const skuIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'sku');
    const batchIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'lottable01');
    const idIdx = headers.findIndex(h => String(h).trim().toLowerCase() === 'id');

    if (locIdx === -1 || skuIdx === -1 || batchIdx === -1 || idIdx === -1) {
      return { success: false, error: 'Missing required columns in inventory file: Loc, SKU, Lottable01, or ID' };
    }

    // Group rows by Loc
    const locGroups = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.every(cell => cell === '')) continue;
      
      const loc = String(row[locIdx] || '').trim();
      const sku = String(row[skuIdx] || '').trim();
      const batch = String(row[batchIdx] || '').trim();
      const id = String(row[idIdx] || '').trim();

      if (!loc) continue;
      
      // Rule: Exclude if ID starts with MIXD or POSM
      if (id.startsWith('MIXD') || id.startsWith('POSM')) continue;
      
      if (!locGroups[loc]) {
        locGroups[loc] = { skus: new Set(), batches: new Set(), rows: [] };
      }
      
      if (sku) locGroups[loc].skus.add(sku);
      if (batch) locGroups[loc].batches.add(batch);
      locGroups[loc].rows.push(row);
    }

    // Find wrong locations
    let wrongRows = [];
    let wrongLocCount = 0;
    const sortedLocs = Object.keys(locGroups).sort();

    for (const loc of sortedLocs) {
      const group = locGroups[loc];
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

    // Prepare preview data for UI
    const preview = wrongRows.slice(0, 5).map(r => ({
      loc: String(r[locIdx] || '').trim(),
      id: String(r[idIdx] || '').trim(),
      sku: String(r[skuIdx] || '').trim(),
      batch: String(r[batchIdx] || '').trim()
    }));

    // Create output Excel as buffer (not file)
    const outputData = [headers, ...wrongRows];
    const outputWs = XLSX.utils.aoa_to_sheet(outputData);
    
    if (ws['!cols']) {
      outputWs['!cols'] = ws['!cols'];
    }

    for (let c = 0; c < headers.length; c++) {
      const srcRef = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[srcRef] && ws[srcRef].s) {
         if (!outputWs[srcRef]) outputWs[srcRef] = {};
         outputWs[srcRef].s = ws[srcRef].s;
      }
    }

    const outputWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outputWb, outputWs, 'Wrong Locations');
    const outputBuffer = XLSX.write(outputWb, { type: 'buffer', bookType: 'xlsx' });

    return {
      success: true,
      message: `Analysis complete. Found ${wrongLocCount} wrong locations affecting ${wrongRows.length} pallets.`,
      wrongLocCount: wrongLocCount,
      wrongPalletCount: wrongRows.length,
      outputBuffer: outputBuffer,
      preview: preview
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { analyzeInventory };
