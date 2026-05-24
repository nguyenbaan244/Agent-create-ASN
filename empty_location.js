const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const PATHS = {
  inventory: path.join(BASE_DIR, 'Input', 'Inventory'),
  masterLoc: path.join(BASE_DIR, 'Master Data', 'Master Location', 'Master Location.xlsx'),
  nonUseLoc: path.join(BASE_DIR, 'Master Data', 'Location - Non use', 'Location Non use.xlsx'),
  asnOutput: path.join(BASE_DIR, 'Output', 'ASN Output'),
  output: path.join(BASE_DIR, 'Output', 'Empty Location'),
};

function getEmptyLocations() {
  try {
    // 1. Master locations
    const masterWB = XLSX.readFile(PATHS.masterLoc);
    const masterData = XLSX.utils.sheet_to_json(masterWB.Sheets[masterWB.SheetNames[0]], { header: 1, defval: '' });
    const allLocs = new Set();
    for (let i = 1; i < masterData.length; i++) {
      if (masterData[i][0]) allLocs.add(masterData[i][0]);
    }

    // 2. Non-use locations
    const nonUseWB = XLSX.readFile(PATHS.nonUseLoc);
    const nonUseData = XLSX.utils.sheet_to_json(nonUseWB.Sheets[nonUseWB.SheetNames[0]], { header: 1, defval: '' });
    const nonUseLocs = new Set();
    for (let i = 1; i < nonUseData.length; i++) {
      if (nonUseData[i][0]) nonUseLocs.add(nonUseData[i][0]);
    }

    // 3. Inventory locations
    const invFiles = fs.readdirSync(PATHS.inventory).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    const invLocs = new Set();
    if (invFiles.length > 0) {
      // Sort to get the latest
      invFiles.sort((a, b) => {
        const statA = fs.statSync(path.join(PATHS.inventory, a));
        const statB = fs.statSync(path.join(PATHS.inventory, b));
        return statB.mtime - statA.mtime;
      });
      const invWB = XLSX.readFile(path.join(PATHS.inventory, invFiles[0]));
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
    if (fs.existsSync(PATHS.asnOutput)) {
      const asnFiles = fs.readdirSync(PATHS.asnOutput).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
      for (const f of asnFiles) {
        try {
          const wb = XLSX.readFile(path.join(PATHS.asnOutput, f));
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
      .sort(); // Sort alphabetically

    // 6. Export to Excel
    if (!fs.existsSync(PATHS.output)) {
      fs.mkdirSync(PATHS.output, { recursive: true });
    }

    const outputPath = path.join(PATHS.output, 'Empty Location.xlsx');
    
    // Create data array (header + rows)
    const outputData = [['Empty Locations'], ...available.map(loc => [loc])];
    
    const outputWs = XLSX.utils.aoa_to_sheet(outputData);
    
    // Style the header
    const headerRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
    outputWs[headerRef].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "4F81BD" } }
    };
    outputWs['!cols'] = [{ wch: 20 }]; // Set column width

    const outputWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outputWb, outputWs, 'Empty Locations');
    XLSX.writeFile(outputWb, outputPath);

    return {
      success: true,
      message: `Tìm thấy ${available.length} location trống. Đã xuất ra file Empty Location.xlsx`,
      emptyCount: available.length,
      outputFile: 'Empty Location.xlsx'
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// If run directly
if (require.main === module) {
  console.log("Running Empty Location skill...");
  const result = getEmptyLocations();
  console.log(result);
}

module.exports = {
  getEmptyLocations,
  PATHS
};
