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
  
  // Find header row
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    if (data[i] && data[i].includes('item code')) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) return {};
  const headers = data[headerRowIdx];
  const itemCodeIdx = headers.findIndex(h => h && h.toString().toLowerCase() === 'item code');
  const weightCaseIdx = headers.findIndex(h => h && h.toString().toLowerCase() === 'weight case');
  const pcsPalletIdx = headers.findIndex(h => h && h.toString().toLowerCase() === 'pcs/pallet');
  const casePalletIdx = headers.findIndex(h => h && h.toString().toLowerCase() === 'case/pallet');
  const pcsCaseIdx = headers.findIndex(h => h && h.toString().toLowerCase() === 'pcs/case');

  const spec = {};
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0 || !row[itemCodeIdx]) continue;
    
    const code = row[itemCodeIdx].toString().trim();
    spec[code] = {
      weightCase: parseFloat(row[weightCaseIdx]) || 0,
      pcsPallet: parseFloat(row[pcsPalletIdx]) || 0,
      casePallet: parseFloat(row[casePalletIdx]) || 0,
      pcsCase: parseFloat(row[pcsCaseIdx]) || 1
    };
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

    const posMap = {};

    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[poIdx]) continue;

      const poName = row[poIdx].toString().trim();
      if (!posMap[poName]) {
        posMap[poName] = {
          poName,
          skus: new Set(),
          batches: new Set(),
          totalCartons: 0,
          totalWeight: 0
        };
      }

      if (skuIdx !== -1 && row[skuIdx]) posMap[poName].skus.add(row[skuIdx].toString().trim());
      if (batchIdx !== -1 && row[batchIdx]) posMap[poName].batches.add(row[batchIdx].toString().trim());
      
      const cartons = parseFloat(row[cartonIdx]) || 0;
      const weightPerCarton = parseFloat(row[weightIdx]) || 0;
      posMap[poName].totalCartons += cartons;
      posMap[poName].totalWeight += (cartons * weightPerCarton);
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

function execute(obBuffer, goodsSpecBuffer, config) {
  try {
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

    const outWb = XLSX.utils.book_new();

    // Process each PO from config
    for (const poConfig of config) {
      const { poName, trucks, prioritySku, priorityBatch } = poConfig;
      
      // Filter lines for this PO
      let lines = [];
      for (let i = headerRowIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (row && row[poIdx] && row[poIdx].toString().trim() === poName) {
          const sku = row[skuIdx] ? row[skuIdx].toString().trim() : '';
          const batch = row[batchIdx] ? row[batchIdx].toString().trim() : '';
          const pcs = parseFloat(row[pcsIdx]) || 0;
          const cartons = parseFloat(row[cartonIdx]) || 0;
          const weightPerCarton = parseFloat(row[weightIdx]) || (spec[sku] ? spec[sku].weightCase : 0);
          const totalWeight = cartons * weightPerCarton;
          
          let priorityScore = 0;
          if (prioritySku && sku === prioritySku) priorityScore += 10;
          if (priorityBatch && batch === priorityBatch) priorityScore += 10;
          
          lines.push({ row, sku, batch, pcs, cartons, weightPerCarton, totalWeight, priorityScore });
        }
      }

      // Sort by priority (descending)
      lines.sort((a, b) => b.priorityScore - a.priorityScore);

      // Create trucks pool
      const truckPool = [];
      let truckIdCounter = 1;
      for (const [type, count] of Object.entries(trucks)) {
        const cap = TRUCK_CAPACITY[type];
        for (let i = 0; i < count; i++) {
          truckPool.push({ id: truckIdCounter++, type, capacity: cap, currentWeight: 0, items: [] });
        }
      }

      // Allocate lines to trucks
      for (const line of lines) {
        let remainingCartons = line.cartons;
        let remainingPcs = line.pcs;
        
        while (remainingCartons > 0 && truckPool.length > 0) {
          // Find first truck with space
          const truck = truckPool.find(t => t.currentWeight < t.capacity);
          if (!truck) break; // All trucks full!
          
          const availableWeight = truck.capacity - truck.currentWeight;
          const maxCartonsCanFit = availableWeight / (line.weightPerCarton || 1);
          
          let cartonsToLoad = Math.min(remainingCartons, maxCartonsCanFit);
          
          // Pallet rounding logic
          const skuSpec = spec[line.sku];
          if (skuSpec && skuSpec.casePallet && cartonsToLoad < remainingCartons) {
            // We need to split. Try to snap to full pallets
            const fullPalletsCanFit = Math.floor(cartonsToLoad / skuSpec.casePallet);
            if (fullPalletsCanFit > 0) {
              cartonsToLoad = fullPalletsCanFit * skuSpec.casePallet;
            }
            // If even 1 full pallet doesn't fit, just load what we can (odd pallet)
          }

          const pcsToLoad = (cartonsToLoad / line.cartons) * line.pcs;
          const weightToLoad = cartonsToLoad * line.weightPerCarton;

          if (cartonsToLoad > 0) {
            truck.items.push({
              ...line,
              cartons: cartonsToLoad,
              pcs: pcsToLoad,
              totalWeight: weightToLoad
            });
            truck.currentWeight += weightToLoad;
            
            remainingCartons -= cartonsToLoad;
            remainingPcs -= pcsToLoad;
          } else {
             // Edge case: carton is too heavy for remaining space
             break;
          }
        }
      }

      // Generate Sheet for this PO
      const sheetData = [];
      // Empty row
      sheetData.push([]);
      // Headers
      const outHeaders = [...headers.slice(0, 15), 'Size Truck'];
      sheetData.push(outHeaders);
      
      // Original lines
      for (let i = headerRowIdx + 1; i < data.length; i++) {
        if (data[i] && data[i][poIdx] && data[i][poIdx].toString().trim() === poName) {
           const row = [...data[i]];
           const cartons = parseFloat(row[cartonIdx]) || 0;
           const kg = parseFloat(row[weightIdx]) || 0;
           row[15] = cartons * kg; // Size Truck column (Weight)
           sheetData.push(row);
        }
      }
      
      sheetData.push([]);
      
      // Truck Allocations
      for (const truck of truckPool) {
        if (truck.items.length === 0) continue;
        
        sheetData.push([]);
        sheetData.push(outHeaders);
        
        for (const item of truck.items) {
          const row = [...item.row];
          row[poIdx] = `${poName}_T${truck.id}`; // Append truck ID
          row[pcsIdx] = item.pcs;
          row[cartonIdx] = item.cartons;
          row[15] = item.totalWeight;
          sheetData.push(row);
        }
        
        // Subtotal row
        const subtotalRow = new Array(16).fill('');
        subtotalRow[14] = `XE ${truck.id}`;
        subtotalRow[15] = truck.currentWeight;
        sheetData.push(subtotalRow);
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(outWb, ws, poName);
    }

    if (outWb.SheetNames.length === 0) {
      return { success: false, error: 'No POs generated. Ensure trucks were allocated and POs match.' };
    }

    const outputBuffer = XLSX.write(outWb, { type: 'buffer', bookType: 'xlsx' });
    return { success: true, posCount: config.length, outputBuffer };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  preview,
  execute
};
