const fs = require('fs');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const path = require('path');

/**
 * Maps truck allocation results to Template SO format
 * @param {Array} allocationSummary - Output from truck_allocation execute()
 * @param {Buffer} obBuffer - Original Outbound Request Excel buffer
 * @returns {Array} - Array of { filename, buffer } for each truck
 */
async function generateSO(allocationSummary, obBuffer) {
  const generatedFiles = [];

  // 1. Read Template SO and Mapping SO locally
  const templatePath = path.join(__dirname, 'Template', 'Template SO - PO.xlsx');
  const mappingPath = path.join(__dirname, 'Mapping', 'Mapping SO.xlsx');

  if (!fs.existsSync(templatePath)) throw new Error('Template SO - PO.xlsx not found in Template folder');
  if (!fs.existsSync(mappingPath)) throw new Error('Mapping SO.xlsx not found in Mapping folder');

  // Load Mapping SO to build NPP Lookup table
  const mapWb = XLSX.readFile(mappingPath);
  const mapWs = mapWb.Sheets[mapWb.SheetNames[0]];
  const mapData = XLSX.utils.sheet_to_json(mapWs, { header: 1 });
  
  // Build NPP lookup table (from Mapping SO sheet)
  // Structure: Region -> Distributor -> { Code, Address1, Address2 }
  const nppLookup = {};
  
  // In Mapping SO, NPP list usually starts around row 3 (0-indexed: row 2).
  // Column 7: Code, 8: Distributor, 9: Region, 11: Address 1, 12: Address 2
  // Let's find the header row dynamically
  let headerRowIdx = -1;
  let codeCol = -1, distCol = -1, regionCol = -1, addr1Col = -1, addr2Col = -1;
  
  for (let i = 0; i < 20; i++) {
    const row = mapData[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cellVal = String(row[j] || '').toLowerCase().trim();
      if (cellVal === 'code' && codeCol === -1) codeCol = j;
      if (cellVal === 'distributor' && distCol === -1) distCol = j;
      if (cellVal === 'region' && regionCol === -1) regionCol = j;
      if (cellVal === 'address 1' && addr1Col === -1) addr1Col = j;
      if (cellVal === 'address 2' && addr2Col === -1) addr2Col = j;
    }
    if (codeCol !== -1 && distCol !== -1 && regionCol !== -1) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx !== -1) {
    for (let i = headerRowIdx + 1; i < mapData.length; i++) {
      const row = mapData[i];
      if (!row || !row[codeCol]) continue;
      const region = String(row[regionCol] || '').trim();
      const dist = String(row[distCol] || '').trim();
      if (!region || !dist) continue;
      
      if (!nppLookup[region]) nppLookup[region] = {};
      nppLookup[region][dist] = {
        code: row[codeCol] || '',
        addr1: row[addr1Col] || '',
        addr2: row[addr2Col] || ''
      };
    }
  }

  // 2. Extract extra info (Region, Distributor, Delivery Date, SO number) from OB Buffer
  const obWb = XLSX.read(obBuffer, { type: 'buffer' });
  const obWs = obWb.Sheets[obWb.SheetNames[0]]; // first sheet
  const obData = XLSX.utils.sheet_to_json(obWs, { header: 1 });
  
  // Find OB headers
  let obHeaderRow = -1;
  for (let i = 0; i < 20; i++) {
    const row = obData[i];
    if (!row) continue;
    const hasRegion = row.some(c => String(c).toLowerCase().trim() === 'region');
    const hasSO = row.some(c => String(c).toLowerCase().trim() === 'so');
    if (hasRegion && hasSO) {
      obHeaderRow = i;
      break;
    }
  }

  const obHeaders = {};
  if (obHeaderRow !== -1) {
    obData[obHeaderRow].forEach((h, idx) => {
      if (h) obHeaders[String(h).toLowerCase().trim()] = idx;
    });
  }

  // Build PO info lookup from OB data
  const poInfoLookup = {};
  if (obHeaderRow !== -1) {
    for (let i = obHeaderRow + 1; i < obData.length; i++) {
      const row = obData[i];
      if (!row || row.length === 0) continue;
      
      const poName = row[obHeaders['customer po']];
      if (!poName) continue;
      
      if (!poInfoLookup[poName]) {
        let deliveryDate = row[obHeaders['delivery date']];
        // Ensure DeliveryDate is an Excel serial number if possible
        if (typeof deliveryDate === 'string' && deliveryDate.match(/^\d{4}\.\d{2}\.\d{2}$/)) {
          // Convert "YYYY.MM.DD" to JS Date to Excel Serial
          const parts = deliveryDate.split('.');
          const jsDate = new Date(parts[0], parseInt(parts[1])-1, parts[2]);
          deliveryDate = 25569.0 + ((jsDate.getTime() - jsDate.getTimezoneOffset() * 60 * 1000) / (1000 * 60 * 60 * 24));
        }

        poInfoLookup[poName] = {
          region: row[obHeaders['region']] || '',
          distributor: row[obHeaders['distributor']] || '',
          deliveryDate: deliveryDate || '',
          so: row[obHeaders['so']] || ''
        };
      }
    }
  }

  // 3. Process each truck and generate its SO file
  for (const po of allocationSummary) {
    const poName = po.poName;
    const info = poInfoLookup[poName] || { region: '', distributor: '', deliveryDate: '', so: '' };
    
    // Lookup NPP details
    let npp = { code: '', addr1: '', addr2: '' };
    if (nppLookup[info.region] && nppLookup[info.region][info.distributor]) {
      npp = nppLookup[info.region][info.distributor];
    }

    const multiTruck = po.trucks.length > 1;

    for (let t = 0; t < po.trucks.length; t++) {
      const truck = po.trucks[t];
      if (!truck.items || truck.items.length === 0) continue;

      const suffix = multiTruck ? `_T${t + 1}` : '';
      const orderKey = `${poName}${suffix}`;
      const filename = `Template SO ${orderKey}.xlsx`;

      // Load Template SO using ExcelJS to preserve formatting
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(templatePath);
      const ws = wb.worksheets[0]; // First sheet
      
      // Delete existing data rows (from row 2 downwards) if any, but keep styling
      // In Template SO, data starts at row 2
      const lastRow = ws.rowCount;
      if (lastRow >= 2) {
        ws.spliceRows(2, lastRow - 1);
      }

      // Copy formatting from original row 2 to new rows
      let rowIdx = 2;
      for (let i = 0; i < truck.items.length; i++) {
        const item = truck.items[i];
        const row = ws.getRow(rowIdx);
        
        // Col mapping (1-indexed in ExcelJS)
        row.getCell('A').value = orderKey; // ExternOrderkey
        row.getCell('B').value = 'DANONE'; // Storerkey
        row.getCell('E').value = info.deliveryDate; // DeliveryDate
        row.getCell('G').value = npp.code; // Consigneekey
        row.getCell('J').value = npp.code; // C_Company
        row.getCell('K').value = npp.addr1; // C_Address1
        row.getCell('L').value = npp.addr2; // C_Address2
        row.getCell('P').value = info.region; // C_State
        row.getCell('AZ').value = 'DAN1_SO'; // Type
        row.getCell('BE').value = 'Loose'; // Notes
        row.getCell('BQ').value = 'DAN1'; // Facility
        row.getCell('BT').value = info.so; // ExternPOKey
        row.getCell('CO').value = i + 1; // ExternLineNo
        row.getCell('CP').value = item.sku; // SKU
        row.getCell('CW').value = item.pcs; // OpenQty (PCS)
        row.getCell('CX').value = 'EA'; // UOM
        row.getCell('DG').value = item.batch; // Lottable01
        row.getCell('DH').value = item.itemType || 'AB'; // Lottable02
        row.getCell('FK').value = 'N'; // DocType
        
        row.commit();
        rowIdx++;
      }

      const buffer = await wb.xlsx.writeBuffer();
      generatedFiles.push({ filename, buffer });
    }
  }

  return generatedFiles;
}

module.exports = {
  generateSO
};
