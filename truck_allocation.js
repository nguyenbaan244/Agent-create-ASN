const XLSX = require('xlsx');

// Standard Truck Capacities (kg)
const TRUCK_CAPACITY = {
  '2T': 2000,
  '5T': 5000,
  '8T': 8000,
  '15T': 15000,
  'Cont40': 26000
};

// CBM limits (optional if CBM is provided in goods spec, but for now we rely on weight)
const TRUCK_CBM = {
  '2T': 10,
  '5T': 22,
  '8T': 32,
  '15T': 45,
  'Cont40': 67
};

function parseGoodsSpec(buffer) {
  if (!buffer) return {};
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = 'Data';
  if (!wb.Sheets[sheetName]) return {};

  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    if (data[i] && data[i].some(c => c && String(c).toLowerCase().trim() === 'item code')) {
      headerRowIdx = i;
      break;
    }
  }

  const spec = { items: {}, trucks: {} };
  if (headerRowIdx === -1) return spec;
  const headers = data[headerRowIdx];
  const itemCodeIdx = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'item code');
  const weightCaseIdx = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'weight case');
  const pcsPalletIdx = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'pcs/pallet');
  const casePalletIdx = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'case/pallet');
  const pcsCaseIdx = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'pcs/case');

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0 || !row[itemCodeIdx]) continue;
    
    // Stop if we hit the truck master data section
    if (row.some(c => c && String(c).toLowerCase().includes('master data of truck'))) break;
    
    const code = row[itemCodeIdx].toString().trim();
    spec.items[code] = {
      weightCase: parseFloat(row[weightCaseIdx]) || 0,
      pcsPallet: parseFloat(row[pcsPalletIdx]) || 0,
      casePallet: parseFloat(row[casePalletIdx]) || 0,
      pcsCase: parseFloat(row[pcsCaseIdx]) || 1
    };
  }

  // Parse Trucks
  let truckHeaderIdx = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] && data[i].includes('Type Truck')) {
      truckHeaderIdx = i;
      break;
    }
  }

  if (truckHeaderIdx !== -1) {
    const tHeaders = data[truckHeaderIdx];
    const typeIdx = tHeaders.findIndex(h => h && h.toString().trim() === 'Type Truck');
    const loadIdx = tHeaders.findIndex(h => h && h.toString().trim() === 'Max load (Kg)');
    const cbmIdx = tHeaders.findIndex(h => h && h.toString().trim() === 'CBM');
    
    for (let i = truckHeaderIdx + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[typeIdx]) continue;
      const typeStr = row[typeIdx].toString().toLowerCase();
      let key = '';
      if (typeStr.includes('2')) key = '2T';
      else if (typeStr.includes('5')) key = '5T';
      else if (typeStr.includes('8')) key = '8T';
      else if (typeStr.includes('15')) key = '15T';
      else if (typeStr.includes('40')) key = 'Cont40';
      
      if (key) {
        spec.trucks[key] = {
          maxLoad: parseFloat(row[loadIdx]) || TRUCK_CAPACITY[key],
          cbm: parseFloat(row[cbmIdx]) || TRUCK_CBM[key]
        };
      }
    }
  }

  return spec;
}

function preview(obBuffer) {
  try {
    const wb = XLSX.read(obBuffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0]; // Assume first sheet is the OB request
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      if (data[i] && data[i].includes('Customer PO')) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) return { success: false, error: 'Could not find Customer PO header' };

    const headers = data[headerRowIdx];
    const poIdx = headers.findIndex(h => h && h.toString().trim() === 'Customer PO');
    const skuIdx = headers.findIndex(h => h && h.toString().trim() === 'SAP Code');
    const batchIdx = headers.findIndex(h => h && h.toString().includes('Batch'));
    const cartonIdx = headers.findIndex(h => h && h.toString().includes('Carton'));
    const weightIdx = headers.findIndex(h => h && h.toString().includes('Kg/Car'));
    const descIdx = headers.findIndex(h => h && h.toString().trim() === 'Desc');

    const posMap = {};

    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[poIdx]) continue;

      const poName = row[poIdx].toString().trim();
      if (!poName || poName.toLowerCase() === 'customer po') continue;

      if (!posMap[poName]) {
        posMap[poName] = {
          poName,
          skus: new Set(),
          batches: new Set(),
          totalCartons: 0,
          totalWeight: 0,
          items: []
        };
      }

      const skuStr = skuIdx !== -1 && row[skuIdx] ? row[skuIdx].toString().trim() : '';
      const batchStr = batchIdx !== -1 && row[batchIdx] ? row[batchIdx].toString().trim() : '';
      const descStr = descIdx !== -1 && row[descIdx] ? row[descIdx].toString().trim() : '';

      if (skuStr) posMap[poName].skus.add(skuStr);
      if (batchStr) posMap[poName].batches.add(batchStr);
      
      const cartons = parseFloat(row[cartonIdx]) || 0;
      const weightPerCarton = parseFloat(row[weightIdx]) || 0;
      const itemWeight = cartons * weightPerCarton;
      posMap[poName].totalCartons += cartons;
      posMap[poName].totalWeight += itemWeight;

      // Aggregate items for UI display
      const existingItem = posMap[poName].items.find(i => i.sku === skuStr && i.batch === batchStr);
      if (existingItem) {
         existingItem.cartons += cartons;
         existingItem.weight += itemWeight;
      } else {
         posMap[poName].items.push({ sku: skuStr, desc: descStr, batch: batchStr, cartons, weight: itemWeight });
      }
    }

    const pos = Object.values(posMap).map(p => ({
      ...p,
      skus: Array.from(p.skus),
      batches: Array.from(p.batches)
    }));

    return { success: true, pos };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function execute(obBuffer, goodsSpecBuffer, config) {
  try {
    let ExcelJS;
    try {
      ExcelJS = require('exceljs');
    } catch(e) {
      ExcelJS = require('C:/Users/Admin/.gemini/antigravity/scratch_npm/node_modules/exceljs');
    }

    const spec = parseGoodsSpec(goodsSpecBuffer);
    const wb = XLSX.read(obBuffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      if (data[i] && data[i].includes('Customer PO')) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) return { success: false, error: 'Invalid OB Request file format.' };
    const headers = data[headerRowIdx];
    const poIdx = headers.findIndex(h => h && h.toString().trim() === 'Customer PO');
    const skuIdx = headers.findIndex(h => h && h.toString().trim() === 'SAP Code');
    const batchIdx = headers.findIndex(h => h && h.toString().includes('Batch'));
    const pcsIdx = headers.findIndex(h => h && h.toString().includes('PCS'));
    const cartonIdx = headers.findIndex(h => h && h.toString().includes('Carton'));
    const weightIdx = headers.findIndex(h => h && h.toString().includes('Kg/Car'));

    // Load ExcelJS for formatting preservation
    const outWb = new ExcelJS.Workbook();
    await outWb.xlsx.load(obBuffer);
    
    // Clean up sheets as requested
    outWb.eachSheet((ws, id) => {
      const name = ws.name.toUpperCase();
      if ((ws.state === 'hidden' || ws.state === 'veryHidden') && name.includes('PO')) {
        outWb.removeWorksheet(id);
      }
      if (name.includes('MASTER DATA') || name.includes('LIST ADDRESS')) {
        ws.state = 'hidden';
      }
    });

    let templateSheet = outWb.worksheets[0];

    templateSheet.name = `Template_Temp_${Date.now()}`;
    
    let headerRowIdxJS = -1;
    let palletColIdx = -1;
    let cartonColIdx = -1;
    let pcsColIdx = -1;
    let poColIdx = -1;
    let weightColIdx = -1;
    let truckColIdx = -1;
    
    templateSheet.eachRow((row, rowNumber) => {
      if (headerRowIdxJS !== -1) return;
      row.eachCell((cell, colNumber) => {
        const val = cell.value ? String(cell.value).toLowerCase().trim() : '';
        if (val.includes('customer po')) headerRowIdxJS = rowNumber;
      });
      
      if (headerRowIdxJS !== -1) {
        row.eachCell((cell, colNumber) => {
          const val = cell.value ? String(cell.value).toLowerCase().trim() : '';
          if (val.includes('customer po')) poColIdx = colNumber;
          if (val.includes('thùng') || val.includes('carton')) cartonColIdx = colNumber;
          if (val.includes('lon') || val.includes('pcs')) pcsColIdx = colNumber;
          if (val.includes('pallet')) palletColIdx = colNumber;
          if (val.includes('kg/car')) weightColIdx = colNumber;
          if (val.includes('size truck')) truckColIdx = colNumber;
        });
      }
    });

    if (palletColIdx === -1 && headerRowIdxJS !== -1) {
      if (truckColIdx !== -1) {
        palletColIdx = truckColIdx + 1;
        templateSheet.spliceColumns(palletColIdx, 0, []); // Insert empty column after Size Truck
        const hCell = templateSheet.getCell(headerRowIdxJS, palletColIdx);
        hCell.value = 'Số lượng pallet';
        const adjacentCell = templateSheet.getCell(headerRowIdxJS, truckColIdx);
        hCell.style = adjacentCell ? adjacentCell.style : {};
        templateSheet.getColumn(palletColIdx).width = 15;
      } else {
        palletColIdx = templateSheet.columnCount + 1;
        const hCell = templateSheet.getCell(headerRowIdxJS, palletColIdx);
        hCell.value = 'Số lượng pallet';
        const adjacentCell = templateSheet.getCell(headerRowIdxJS, palletColIdx - 1);
        hCell.style = adjacentCell ? adjacentCell.style : {};
        templateSheet.getColumn(palletColIdx).width = 15;
      }
    }

    const generatedSheets = [];

    // Process each PO from config
    for (const poConfig of config) {
      const { poName, trucks, priorities } = poConfig;
      
      // Filter lines for this PO
      let lines = [];
      for (let i = headerRowIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (row && row[poIdx] && row[poIdx].toString().trim() === poName) {
          const sku = row[skuIdx] ? row[skuIdx].toString().trim() : '';
          const batch = row[batchIdx] ? row[batchIdx].toString().trim() : '';
          const pcs = parseFloat(row[pcsIdx]) || 0;
          const cartons = parseFloat(row[cartonIdx]) || 0;
          const itemSpec = spec.items[sku] || {};
          const weightPerCarton = parseFloat(row[weightIdx]) || itemSpec.weightCase || 0;
          const totalWeight = cartons * weightPerCarton;
          
          let priorityScore = 0;
          if (priorities && priorities.length > 0) {
            if (priorities[0] && priorities[0].sku && sku === priorities[0].sku) priorityScore += 30;
            if (priorities[0] && priorities[0].batch && batch === priorities[0].batch) priorityScore += 30;
            
            if (priorities[1] && priorities[1].sku && sku === priorities[1].sku) priorityScore += 20;
            if (priorities[1] && priorities[1].batch && batch === priorities[1].batch) priorityScore += 20;
            
            if (priorities[2] && priorities[2].sku && sku === priorities[2].sku) priorityScore += 10;
            if (priorities[2] && priorities[2].batch && batch === priorities[2].batch) priorityScore += 10;
          }
          
          lines.push({ row, sku, batch, pcs, cartons, weightPerCarton, totalWeight, priorityScore });
        }
      }

      // Sort by priority (descending), then by weight (descending) for optimal Bin Packing
      lines.sort((a, b) => {
         if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
         return b.totalWeight - a.totalWeight;
      });

      // Create trucks pool
      const truckPool = [];
      let truckIdCounter = 1;
      for (const [type, count] of Object.entries(trucks)) {
        const truckSpec = spec.trucks[type] || { maxLoad: TRUCK_CAPACITY[type] };
        const cap = truckSpec.maxLoad;
        for (let i = 0; i < count; i++) {
          truckPool.push({ id: truckIdCounter++, type, capacity: cap, currentWeight: 0, items: [] });
        }
      }

      // === STEP 1: Pre-split every SKU into full-pallet items and odd-carton items ===
      const fullPalletItems = [];
      const oddCartonItems = [];
      
      for (const line of lines) {
        const skuSpec = spec.items[line.sku] || {};
        const casePallet = skuSpec.casePallet || 0;
        
        if (casePallet > 0) {
           const fullPallets = Math.floor(line.cartons / casePallet);
           const fullCartons = fullPallets * casePallet;
           const oddCartons = line.cartons - fullCartons;
           
           if (fullCartons > 0) {
              const fullPcs = Math.round((fullCartons / line.cartons) * line.pcs);
              fullPalletItems.push({
                 ...line,
                 cartons: fullCartons,
                 pcs: fullPcs,
                 totalWeight: fullCartons * line.weightPerCarton,
                 pallets: fullPallets,
                 casePallet: casePallet
              });
           }
           if (oddCartons > 0) {
              const oddPcs = line.pcs - (fullCartons > 0 ? Math.round((fullCartons / line.cartons) * line.pcs) : 0);
              oddCartonItems.push({
                 ...line,
                 cartons: oddCartons,
                 pcs: oddPcs,
                 totalWeight: oddCartons * line.weightPerCarton,
                 pallets: 0,
                 casePallet: casePallet
              });
           }
        } else {
           // No pallet info — treat entire line as odd
           oddCartonItems.push({
              ...line,
              pallets: 0,
              casePallet: 0
           });
        }
      }
      
      // Sort full-pallet items by weight descending (heaviest first for best bin packing)
      fullPalletItems.sort((a, b) => b.totalWeight - a.totalWeight);
      
      // === STEP 2: Allocate ALL full-pallet items to trucks ===
      for (const item of fullPalletItems) {
        let remaining = item.cartons;
        let remainPcs = item.pcs;
        const casePallet = item.casePallet;
        
        // Try to fit the ENTIRE full-pallet block into one truck
        const weightNeeded = remaining * (item.weightPerCarton || 1);
        let candidates = truckPool.filter(t => (t.capacity - t.currentWeight) >= weightNeeded);
        
        if (candidates.length > 0) {
           // BEST FIT: pick truck with LEAST available space that still fits
           // This keeps bigger trucks free for larger items later
           candidates.sort((a, b) => (a.capacity - a.currentWeight) - (b.capacity - b.currentWeight));
           const truck = candidates[0];
           truck.items.push({
               ...item,
               cartons: remaining,
               pcs: remainPcs,
               totalWeight: remaining * item.weightPerCarton
           });
           truck.currentWeight += remaining * item.weightPerCarton;
           continue;
        }
        
        // Must split across trucks — always in full-pallet increments
        // Pick the truck with LEAST space that can fit at least 1 full pallet
        while (remaining >= casePallet) {
           
           const palletWeight = casePallet * (item.weightPerCarton || 1);
           // Best fit: pick truck with LEAST space that can still fit 1+ pallet
           let fitTrucks = truckPool.filter(t => (t.capacity - t.currentWeight) >= palletWeight);
           if (fitTrucks.length === 0) break;
           fitTrucks.sort((a, b) => (a.capacity - a.currentWeight) - (b.capacity - b.currentWeight));
           let truck = fitTrucks[0];

           const space = truck.capacity - truck.currentWeight;
           const palletsCanFit = Math.floor(space / palletWeight);
           const palletsRemaining = Math.floor(remaining / casePallet);
           const palletsToLoad = Math.min(palletsCanFit, palletsRemaining);
           
           const cartonsToLoad = palletsToLoad * casePallet;
           let pcsToLoad;
           if (cartonsToLoad >= remaining) {
              pcsToLoad = remainPcs;
           } else {
              pcsToLoad = Math.round((cartonsToLoad / item.cartons) * item.pcs);
           }
           const weightToLoad = cartonsToLoad * item.weightPerCarton;
           
           const existing = truck.items.find(i => i.row === item.row);
           if (existing) {
              existing.cartons += cartonsToLoad;
              existing.pcs += pcsToLoad;
              existing.totalWeight += weightToLoad;
           } else {
              truck.items.push({
                 ...item,
                 cartons: cartonsToLoad,
                 pcs: pcsToLoad,
                 totalWeight: weightToLoad
              });
           }
           truck.currentWeight += weightToLoad;
           remaining -= cartonsToLoad;
           remainPcs -= pcsToLoad;
        }
      }
      
      // === STEP 3: Allocate ALL odd-carton items to trucks ===
      for (const item of oddCartonItems) {
        let remaining = item.cartons;
        let remainPcs = item.pcs;
        
        while (remaining > 0) {
           const requiredWeight = item.weightPerCarton || 1;
           
           // Prefer a truck that ALREADY carries this SKU
           let truck = truckPool.find(t => t.items.some(i => i.row === item.row) && (t.capacity - t.currentWeight) >= requiredWeight);
           
           // Otherwise pick truck with most space
           if (!truck) {
               truckPool.sort((a, b) => (b.capacity - b.currentWeight) - (a.capacity - a.currentWeight));
               truck = truckPool.find(t => (t.capacity - t.currentWeight) >= requiredWeight);
           }
           if (!truck) break;
           
           const space = truck.capacity - truck.currentWeight;
           let cartonsToLoad = Math.floor(space / requiredWeight);
           cartonsToLoad = Math.min(remaining, cartonsToLoad);
           if (cartonsToLoad <= 0) break;
           
           let pcsToLoad;
           if (cartonsToLoad >= remaining) {
              pcsToLoad = remainPcs;
           } else {
              pcsToLoad = Math.round((cartonsToLoad / item.cartons) * item.pcs);
           }
           const weightToLoad = cartonsToLoad * requiredWeight;
           
           const existing = truck.items.find(i => i.row === item.row);
           if (existing) {
              existing.cartons += cartonsToLoad;
              existing.pcs += pcsToLoad;
              existing.totalWeight += weightToLoad;
           } else {
              truck.items.push({
                 ...item,
                 cartons: cartonsToLoad,
                 pcs: pcsToLoad,
                 totalWeight: weightToLoad
              });
           }
           truck.currentWeight += weightToLoad;
           remaining -= cartonsToLoad;
           remainPcs -= pcsToLoad;
        }
      }
      
      // Sort truckPool back by ID to preserve display order in the Excel sheet
      truckPool.sort((a, b) => a.id - b.id);

      // Remove existing sheet with the same name if it exists in the original workbook
      const existingSheet = outWb.getWorksheet(poName);
      if (existingSheet) {
        outWb.removeWorksheet(existingSheet.id);
      }

      // Generate Sheet for this PO using ExcelJS to preserve formatting
      const newSheet = outWb.addWorksheet(poName);
      generatedSheets.push(poName);
      
      // Clone columns width
      newSheet.columns = templateSheet.columns.map(c => ({ width: c.width }));
      if (templateSheet.getColumn(palletColIdx)) {
         newSheet.getColumn(palletColIdx).width = templateSheet.getColumn(palletColIdx).width || 15;
      }
      
      // Clone header and rows above
      for (let r = 1; r <= headerRowIdxJS; r++) {
        const srcRow = templateSheet.getRow(r);
        const destRow = newSheet.getRow(r);
        destRow.height = srcRow.height;
        srcRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const destCell = destRow.getCell(colNumber);
          destCell.value = cell.value;
          destCell.style = cell.style;
        });
      }
      
      const styleTemplateRow = templateSheet.getRow(headerRowIdxJS + 1);
      let currentRow = headerRowIdxJS + 1;
      
      let originalTotalWeight = 0;
      let originalTotalCartons = 0;
      let originalTotalPcs = 0;

      // 1. Output Original PO lines (Đề bài)
      for (let i = headerRowIdx + 1; i < data.length; i++) {
        if (data[i] && data[i][poIdx] && data[i][poIdx].toString().trim() === poName) {
           const destRow = newSheet.getRow(currentRow++);
           destRow.height = styleTemplateRow.height;
           
           styleTemplateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
             const destCell = destRow.getCell(colNumber);
             destCell.style = cell.style;
             
             let val;
             if (colNumber === palletColIdx) {
                const sku = data[i][skuIdx];
                const cartons = parseFloat(data[i][cartonIdx]) || 0;
                const casePallet = (spec.items[sku] && spec.items[sku].casePallet) ? spec.items[sku].casePallet : 0;
                const pallets = casePallet ? (cartons / casePallet) : 0;
                val = pallets ? parseFloat(pallets.toFixed(2)) : null;
             } else if (colNumber > palletColIdx) {
                val = data[i][colNumber - 2];
             } else {
                val = data[i][colNumber - 1];
             }
             destCell.value = val !== undefined ? val : null;
           });
           
           const cartons = parseFloat(data[i][cartonIdx]) || 0;
           const sku = data[i][skuIdx] ? data[i][skuIdx].toString().trim() : '';
           const itemSpec = spec.items[sku] || {};
           const weightPerCarton = parseFloat(data[i][weightIdx]) || itemSpec.weightCase || 0;
           const weight = cartons * weightPerCarton;
           
           if (truckColIdx !== -1) destRow.getCell(truckColIdx).value = weight;
           
           originalTotalWeight += weight;
           originalTotalCartons += cartons;
           originalTotalPcs += parseFloat(data[i][pcsIdx]) || 0;
        }
      }

      // Total row for original lines
      const totalRow = newSheet.getRow(currentRow++);
      const tLabelCol = truckColIdx !== -1 ? truckColIdx - 3 : 1;
      totalRow.getCell(tLabelCol).value = 'Total';
      if (pcsColIdx !== -1) totalRow.getCell(pcsColIdx).value = originalTotalPcs;
      if (cartonColIdx !== -1) totalRow.getCell(cartonColIdx).value = originalTotalCartons;
      if (truckColIdx !== -1) totalRow.getCell(truckColIdx).value = (originalTotalWeight / 1000).toFixed(2) + ' Ton';
      
      totalRow.eachCell(c => {
         c.font = { bold: true, color: { argb: 'FFFF0000' } }; // Red font
      });
      if (truckColIdx !== -1) {
         totalRow.getCell(truckColIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
         totalRow.getCell(palletColIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      }

      currentRow++; // Blank row separator
      
      // 2. Output Truck Allocations
      for (const truck of truckPool) {
        if (truck.items.length === 0) continue;
        
        for (const item of truck.items) {
          const destRow = newSheet.getRow(currentRow++);
          destRow.height = styleTemplateRow.height;
          
          styleTemplateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const destCell = destRow.getCell(colNumber);
            destCell.style = cell.style;
            let val;
            if (colNumber === palletColIdx) {
                // skip, computed below
            } else if (colNumber > palletColIdx) {
                val = item.row[colNumber - 2];
            } else {
                val = item.row[colNumber - 1];
            }
            destCell.value = val !== undefined ? val : null;
          });
          
          if (poColIdx !== -1) destRow.getCell(poColIdx).value = `${poName}_T${truck.id}`;
          if (pcsColIdx !== -1) destRow.getCell(pcsColIdx).value = item.pcs;
          if (cartonColIdx !== -1) destRow.getCell(cartonColIdx).value = item.cartons;
          if (weightColIdx !== -1) destRow.getCell(weightColIdx).value = item.weightPerCarton;
          if (truckColIdx !== -1) destRow.getCell(truckColIdx).value = item.totalWeight;
          
          if (palletColIdx !== -1) {
             const casePallet = spec.items[item.sku] ? spec.items[item.sku].casePallet : 0;
             const pallets = casePallet ? (item.cartons / casePallet) : 0;
             const pCell = destRow.getCell(palletColIdx);
             pCell.value = parseFloat(pallets.toFixed(2));
             const adjacentStyle = styleTemplateRow.getCell(palletColIdx - 1);
             pCell.style = adjacentStyle ? adjacentStyle.style : {};
          }
        }
        
        // Add subtotal row for truck
        const subtotalRow = newSheet.getRow(currentRow++);
        const targetLabelCol = truckColIdx !== -1 ? truckColIdx - 1 : 1;
        const targetValCol = truckColIdx !== -1 ? truckColIdx : 2;
        
        subtotalRow.getCell(targetLabelCol).value = `XE ${truck.id}`;
        subtotalRow.getCell(targetValCol).value = truck.currentWeight;
        
        // Bold formatting and yellow BG for subtotal
        subtotalRow.eachCell(c => c.font = { bold: true });
        subtotalRow.getCell(targetValCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        if (palletColIdx !== -1) {
           subtotalRow.getCell(palletColIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        }
        
        currentRow++; // Empty row separation
      }
    }

    if (generatedSheets.length === 0) {
      return { success: false, error: 'No POs generated. Ensure trucks were allocated and POs match.' };
    }

    // Remove the original template sheet so only allocated POs remain
    if (templateSheet.id) {
       outWb.removeWorksheet(templateSheet.id);
    }

    const outputBuffer = await outWb.xlsx.writeBuffer();
    return { success: true, posCount: config.length, outputBuffer };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  preview,
  execute
};
