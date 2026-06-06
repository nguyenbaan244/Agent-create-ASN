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

      // Sort by priority (descending)
      lines.sort((a, b) => b.priorityScore - a.priorityScore);

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
          
          let cartonsToLoad = Math.floor(maxCartonsCanFit); // Must be whole cartons
          cartonsToLoad = Math.min(remainingCartons, cartonsToLoad);
          
          // Pallet rounding logic
          const skuSpec = spec.items[line.sku];
          if (skuSpec && skuSpec.casePallet && cartonsToLoad < remainingCartons) {
            // We need to split. Try to snap to full pallets
            const fullPalletsCanFit = Math.floor(cartonsToLoad / skuSpec.casePallet);
            if (fullPalletsCanFit > 0) {
              cartonsToLoad = fullPalletsCanFit * skuSpec.casePallet;
            }
            // If even 1 full pallet doesn't fit, just load what we can (odd cartons, but guaranteed integer)
          }

          const pcsToLoad = Math.round((cartonsToLoad / line.cartons) * line.pcs);
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
