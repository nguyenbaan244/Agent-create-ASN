const XLSX = require('xlsx');

/**
 * Get empty locations.
 * @param {Object} params - All data as buffers
 * @param {Buffer} params.masterLocBuffer
 * @param {Buffer} params.nonUseLocBuffer
 * @param {Buffer} [params.inventoryBuffer]
 * @param {Buffer[]} [params.asnOutputBuffers]
 * @returns {Object} - Results with optional output buffer
 */
function getEmptyLocations({ masterLocBuffer, nonUseLocBuffer, inventoryBuffer, asnOutputBuffers }) {
  try {
    // 1. Master locations
    const masterWB = XLSX.read(masterLocBuffer, { type: 'buffer' });
    const masterData = XLSX.utils.sheet_to_json(masterWB.Sheets[masterWB.SheetNames[0]], { header: 1, defval: '' });
    const allLocs = new Set();
    for (let i = 1; i < masterData.length; i++) {
      if (masterData[i][0]) allLocs.add(masterData[i][0]);
    }

    // 2. Non-use locations
    const nonUseWB = XLSX.read(nonUseLocBuffer, { type: 'buffer' });
    const nonUseData = XLSX.utils.sheet_to_json(nonUseWB.Sheets[nonUseWB.SheetNames[0]], { header: 1, defval: '' });
    const nonUseLocs = new Set();
    for (let i = 1; i < nonUseData.length; i++) {
      if (nonUseData[i][0]) nonUseLocs.add(nonUseData[i][0]);
    }

    // 3. Inventory locations
    const invLocs = new Set();
    if (inventoryBuffer) {
      const invWB = XLSX.read(inventoryBuffer, { type: 'buffer' });
      const invData = XLSX.utils.sheet_to_json(invWB.Sheets[invWB.SheetNames[0]], { header: 1, defval: '' });
      const locIdx = invData[0].findIndex(h => String(h).toLowerCase() === 'loc');
      if (locIdx >= 0) {
        for (let i = 1; i < invData.length; i++) {
          if (invData[i][locIdx]) invLocs.add(invData[i][locIdx]);
        }
      }
    }

    // 4. ASN blocked locations
    const asnLocs = new Set();
    if (asnOutputBuffers && asnOutputBuffers.length > 0) {
      for (const buf of asnOutputBuffers) {
        try {
          const wb = XLSX.read(buf, { type: 'buffer' });
          const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
          const locIdx = data[0].indexOf('ToLoc');
          if (locIdx >= 0) {
            for (let i = 1; i < data.length; i++) {
              if (data[i][locIdx]) asnLocs.add(data[i][locIdx]);
            }
          }
        } catch (e) { /* skip locked files */ }
      }
    }

    // 5. Calculate available
    const available = [...allLocs]
      .filter(l => !nonUseLocs.has(l) && !invLocs.has(l) && !asnLocs.has(l))
      .sort();

    // 6. Export to Excel buffer
    const outputData = [['Empty Locations'], ...available.map(loc => [loc])];
    const outputWs = XLSX.utils.aoa_to_sheet(outputData);
    
    const headerRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
    outputWs[headerRef].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "4F81BD" } }
    };
    outputWs['!cols'] = [{ wch: 20 }];

    const outputWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outputWb, outputWs, 'Empty Locations');
    const outputBuffer = XLSX.write(outputWb, { type: 'buffer', bookType: 'xlsx' });

    return {
      success: true,
      message: `Found ${available.length} empty locations.`,
      emptyCount: available.length,
      outputBuffer: outputBuffer,
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { getEmptyLocations };
