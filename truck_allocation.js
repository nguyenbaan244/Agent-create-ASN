/**
 * ===================================================================
 * TRUCK LOAD ALLOCATION ENGINE
 * ===================================================================
 * 
 * Version 1 (v1) — "Pallet-First Bin Packing"
 *   Strategy: Pre-split → Full-Pallet allocation → Odd-Carton consolidation
 *   - STEP 0: Force-assign priority items with specified truck type
 *   - STEP 1: Split each SKU into full-pallet units + odd-carton remainder
 *   - STEP 2: Allocate full pallets across trucks (best-fit descending)
 *   - STEP 3: Consolidate all odd cartons per SKU into ONE truck (best-fit)
 * 
 * Version 2 (v2) — "Volume-Priority Assignment"
 *   Strategy: Assign lines biggest→smallest to truck with most space
 *   - B1: Each line goes to truck with most space. If exceeds, only full pallets.
 *   - Rebalance: Move <1 pallet items to other trucks to reduce pick lines.
 *   - B2: Remaining → full pallets first, then odd cartons
 *   - Constraint: Max 2 splits (trucks) per SKU
 * 
 * Active Version: selectable via UI (V1 / V2)
 * ===================================================================
 */

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
  const cbmCaseIdx = headers.findIndex(h => h && h.toString().toLowerCase().trim().includes('cbm'));

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
      pcsCase: parseFloat(row[pcsCaseIdx]) || 1,
      cbmCase: cbmCaseIdx !== -1 ? (parseFloat(row[cbmCaseIdx]) || 0) : 0
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

      // Keep each original row as-is (no aggregation)
      const rowData = {};
      for (let c = 0; c < headers.length; c++) {
        if (headers[c]) rowData[headers[c].toString().trim()] = row[c] !== undefined ? row[c] : '';
      }
      posMap[poName].items.push(rowData);
    }

    const headersList = headers.filter(h => h).map(h => h.toString().trim());

    const pos = Object.values(posMap).map(p => ({
      ...p,
      skus: Array.from(p.skus),
      batches: Array.from(p.batches)
    }));

    return { success: true, pos, headers: headersList };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function execute(obBuffer, goodsSpecBuffer, config, version = 'v1') {
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
    const typeIdx = headers.findIndex(h => h && h.toString().trim() === 'Type');

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

    // Insert CBM column right after the Pallet column
    let cbmColIdx = -1;
    if (palletColIdx !== -1 && headerRowIdxJS !== -1) {
      cbmColIdx = palletColIdx + 1;
      templateSheet.spliceColumns(cbmColIdx, 0, []);
      const cbmHeader = templateSheet.getCell(headerRowIdxJS, cbmColIdx);
      cbmHeader.value = 'CBM';
      const refCell = templateSheet.getCell(headerRowIdxJS, palletColIdx);
      cbmHeader.style = refCell ? refCell.style : {};
      templateSheet.getColumn(cbmColIdx).width = 12;
    }

    const generatedSheets = [];
    const allocationSummary = [];

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
          
          const itemType = typeIdx !== -1 && row[typeIdx] ? row[typeIdx].toString().trim() : '';
          
          lines.push({ row, sku, batch, pcs, cartons, weightPerCarton, totalWeight, priorityScore, itemType });
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
        const cbmCap = (truckSpec.cbm) || TRUCK_CBM[type] || 0;
        for (let i = 0; i < count; i++) {
          truckPool.push({ id: truckIdCounter++, type, capacity: cap, cbmCapacity: cbmCap, currentWeight: 0, items: [] });
        }
      }

      // === STEP 0: Force-assign priority items with specified truck type ===
      if (priorities && priorities.length > 0) {
        for (const prio of priorities) {
          if (!prio.truckType) continue; // No truck specified, skip (handled by normal priority scoring)
          
          // Find matching lines
          const matchingLines = lines.filter(line => {
            const skuMatch = !prio.sku || line.sku === prio.sku;
            const batchMatch = !prio.batch || line.batch === prio.batch;
            return skuMatch && batchMatch;
          });
          
          if (matchingLines.length === 0) continue;
          
          // Find the first truck of the specified type with available space
          const targetTruck = truckPool.find(t => t.type === prio.truckType);
          if (!targetTruck) continue;
          
          // Force-load ALL cartons of matching lines into this truck
          for (const line of matchingLines) {
            const weightToLoad = line.cartons * line.weightPerCarton;
            
            targetTruck.items.push({
              ...line,
              cartons: line.cartons,
              pcs: line.pcs,
              totalWeight: weightToLoad
            });
            targetTruck.currentWeight += weightToLoad;
            
            // Mark line as fully allocated so it's excluded from normal flow
            line.cartons = 0;
            line.pcs = 0;
            line.totalWeight = 0;
          }
        }
        
        // Remove fully allocated lines
        lines = lines.filter(l => l.cartons > 0);
      }

      if (version === 'v1') {
      // ============================================================
      // ALLOCATION LOGIC — VERSION 1: Pallet-First Bin Packing
      // ============================================================

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
      // Each odd item MUST go to exactly ONE truck — never split the odd portion
      for (const item of oddCartonItems) {
        const totalOddWeight = item.cartons * (item.weightPerCarton || 1);
        
        // Best fit: find truck with LEAST space that can hold ALL odd cartons
        let candidates = truckPool.filter(t => (t.capacity - t.currentWeight) >= totalOddWeight);
        let truck = null;
        
        if (candidates.length > 0) {
           candidates.sort((a, b) => (a.capacity - a.currentWeight) - (b.capacity - b.currentWeight));
           truck = candidates[0];
        } else {
           // No truck can fit all odd cartons — last resort, pick truck with most space
           truckPool.sort((a, b) => (b.capacity - b.currentWeight) - (a.capacity - a.currentWeight));
           truck = truckPool.find(t => (t.capacity - t.currentWeight) >= (item.weightPerCarton || 1));
        }
        
        if (!truck) continue;
        
        const cartonsToLoad = Math.min(item.cartons, Math.floor((truck.capacity - truck.currentWeight) / (item.weightPerCarton || 1)));
        if (cartonsToLoad <= 0) continue;
        
        const weightToLoad = cartonsToLoad * (item.weightPerCarton || 1);
        
        const existing = truck.items.find(i => i.row === item.row);
        if (existing) {
           existing.cartons += cartonsToLoad;
           existing.pcs += item.pcs;
           existing.totalWeight += weightToLoad;
        } else {
           truck.items.push({
              ...item,
              cartons: cartonsToLoad,
              pcs: item.pcs,
              totalWeight: weightToLoad
           });
        }
        truck.currentWeight += weightToLoad;
      }

      } else {
      // ============================================================
      // ALLOCATION LOGIC — VERSION 2: Volume-Priority Pairing
      // ============================================================
      // B1: Large volume → large truck, pair large+small, fill with full pallets
      // B2: Remaining → full pallets first, then odd cartons
      // Constraint: Max 2 splits (trucks) per SKU
      
      const skuTruckMap = {}; // { sku: Set<truckId> } — track split count
      
      function canAssignToTruck(sku, truckId) {
        if (!skuTruckMap[sku]) return true;
        if (skuTruckMap[sku].has(truckId)) return true; // already in this truck
        return skuTruckMap[sku].size < 2; // max 2 different trucks
      }
      function recordAssignment(sku, truckId) {
        if (!skuTruckMap[sku]) skuTruckMap[sku] = new Set();
        skuTruckMap[sku].add(truckId);
      }
      function getExistingTrucks(sku) {
        if (!skuTruckMap[sku]) return [];
        return Array.from(skuTruckMap[sku]);
      }
      
      // Sort lines by totalWeight DESCENDING (biggest volume first)
      lines.sort((a, b) => b.totalWeight - a.totalWeight);
      
      // Sort truck pool by capacity DESCENDING (biggest truck first)
      truckPool.sort((a, b) => b.capacity - a.capacity);
      
      // Track which lines still have cartons to assign
      const remaining = lines.map(l => ({ ...l, remainCartons: l.cartons, remainPcs: l.pcs }));
      
      // === B1: Volume-Priority Assignment (multi-pass) ===
      // Assign each line (biggest→smallest) to the LARGEST truck first (most space).
      // LOOP until all cartons assigned or no more trucks can accept.
      // If a line exceeds one truck, split across multiple trucks using full pallets.
      
      let assignedSomething = true;
      while (assignedSomething) {
        assignedSomething = false;
        
        for (const r of remaining) {
          if (r.remainCartons <= 0) continue;
          
          const skuSpec = spec.items[r.sku] || {};
          const casePallet = skuSpec.casePallet || 0;
          const totalWeight = r.remainCartons * (r.weightPerCarton || 1);
          
          // Find truck with MOST remaining space (prioritize large trucks)
          let eligibleTrucks = truckPool
            .filter(t => canAssignToTruck(r.sku, t.id) && (t.capacity - t.currentWeight) >= (r.weightPerCarton || 1))
            .sort((a, b) => (b.capacity - b.currentWeight) - (a.capacity - a.currentWeight));
          
          // Fallback: if SKU split limit blocks all trucks, relax constraint
          if (eligibleTrucks.length === 0) {
            eligibleTrucks = truckPool
              .filter(t => (t.capacity - t.currentWeight) >= (r.weightPerCarton || 1))
              .sort((a, b) => (b.capacity - b.currentWeight) - (a.capacity - a.currentWeight));
          }
          
          if (eligibleTrucks.length === 0) continue;
          const truck = eligibleTrucks[0];
          const space = truck.capacity - truck.currentWeight;
          
          if (totalWeight <= space) {
            // Entire remaining line fits — assign all
            truck.items.push({
              ...r,
              cartons: r.remainCartons,
              pcs: r.remainPcs,
              totalWeight: totalWeight
            });
            truck.currentWeight += totalWeight;
            recordAssignment(r.sku, truck.id);
            r.remainCartons = 0;
            r.remainPcs = 0;
            assignedSomething = true;
          } else if (casePallet > 0) {
            // Line exceeds capacity — only take FULL PALLETS that fit
            const palletWeight = casePallet * (r.weightPerCarton || 1);
            const palletsCanFit = Math.floor(space / palletWeight);
            if (palletsCanFit > 0) {
              const cartonsToLoad = palletsCanFit * casePallet;
              const pcsToLoad = cartonsToLoad >= r.remainCartons 
                ? r.remainPcs 
                : Math.round((cartonsToLoad / r.cartons) * r.pcs);
              const wt = cartonsToLoad * (r.weightPerCarton || 1);
              
              const existing = truck.items.find(i => i.row === r.row);
              if (existing) {
                existing.cartons += cartonsToLoad;
                existing.pcs += pcsToLoad;
                existing.totalWeight += wt;
              } else {
                truck.items.push({
                  ...r,
                  cartons: cartonsToLoad,
                  pcs: pcsToLoad,
                  totalWeight: wt
                });
              }
              truck.currentWeight += wt;
              recordAssignment(r.sku, truck.id);
              r.remainCartons -= cartonsToLoad;
              r.remainPcs -= pcsToLoad;
              assignedSomething = true;
            }
          }
        }
      }
      
      // === Rebalance: Move small items from heavy trucks to lighter/smaller trucks ===
      // Process trucks from heaviest to lightest.
      // Move any item that a lighter truck can absorb — reduce pick lines on heavy trucks.
      const sortedByLoad = [...truckPool].sort((a, b) => b.currentWeight - a.currentWeight);
      
      for (const truck of sortedByLoad) {
        if (truck.items.length <= 1) continue;
        
        // Sort items by weight ascending — try to move lightest items first
        const itemsByWeight = truck.items
          .map((item, idx) => ({ item, idx, wt: item.totalWeight }))
          .sort((a, b) => a.wt - b.wt);
        
        const indicesToRemove = [];
        
        for (const { item, idx } of itemsByWeight) {
          // Find the LIGHTEST truck (other than this one) that can absorb this item
          // Prefer: 1) truck that already has same SKU, 2) lightest truck
          const candidates = truckPool
            .filter(t => 
              t.id !== truck.id && 
              canAssignToTruck(item.sku, t.id) &&
              (t.capacity - t.currentWeight) >= item.totalWeight
            )
            .sort((a, b) => {
              const aHasSku = a.items.some(i => i.sku === item.sku) ? 0 : 1;
              const bHasSku = b.items.some(i => i.sku === item.sku) ? 0 : 1;
              if (aHasSku !== bHasSku) return aHasSku - bHasSku;
              return a.currentWeight - b.currentWeight;
            });
          
          if (candidates.length === 0) continue;
          const target = candidates[0];
          
          // Only move if target truck is lighter than source (avoid ping-pong)
          if (target.currentWeight >= truck.currentWeight) continue;
          
          const existing = target.items.find(i => i.row === item.row);
          if (existing) {
            existing.cartons += item.cartons;
            existing.pcs += item.pcs;
            existing.totalWeight += item.totalWeight;
          } else {
            target.items.push({ ...item });
          }
          target.currentWeight += item.totalWeight;
          recordAssignment(item.sku, target.id);
          
          truck.currentWeight -= item.totalWeight;
          indicesToRemove.push(idx);
        }
        
        // Remove moved items (highest index first to preserve ordering)
        indicesToRemove.sort((a, b) => b - a);
        for (const idx of indicesToRemove) {
          truck.items.splice(idx, 1);
        }
      }
      
      // === B2: Remaining volume — full pallets first, then odd ===
      const leftover = remaining.filter(r => r.remainCartons > 0);
      
      // Split leftover into full-pallet + odd
      const fullPalletLeft = [];
      const oddLeft = [];
      
      for (const r of leftover) {
        const skuSpec = spec.items[r.sku] || {};
        const casePallet = skuSpec.casePallet || 0;
        
        if (casePallet > 0) {
          const fullPallets = Math.floor(r.remainCartons / casePallet);
          const fullCartons = fullPallets * casePallet;
          const oddCartons = r.remainCartons - fullCartons;
          
          if (fullCartons > 0) {
            const pcs = fullCartons >= r.remainCartons ? r.remainPcs : Math.round((fullCartons / r.cartons) * r.pcs);
            fullPalletLeft.push({
              ...r, cartons: fullCartons, remainCartons: fullCartons, pcs, remainPcs: pcs,
              totalWeight: fullCartons * r.weightPerCarton, casePallet
            });
          }
          if (oddCartons > 0) {
            const pcs = r.remainPcs - (fullCartons > 0 ? Math.round((fullCartons / r.cartons) * r.pcs) : 0);
            oddLeft.push({
              ...r, cartons: oddCartons, remainCartons: oddCartons, pcs, remainPcs: pcs,
              totalWeight: oddCartons * r.weightPerCarton, casePallet
            });
          }
        } else {
          oddLeft.push({ ...r, casePallet: 0 });
        }
      }
      
      // Assign full pallets (best-fit, respecting max split)
      fullPalletLeft.sort((a, b) => b.totalWeight - a.totalWeight);
      for (const item of fullPalletLeft) {
        let rem = item.remainCartons;
        let remPcs = item.remainPcs;
        const cp = item.casePallet;
        
        while (rem >= cp) {
          const palletWt = cp * (item.weightPerCarton || 1);
          
          // Find trucks this SKU can go to
          let fitTrucks;
          if (skuTruckMap[item.sku] && skuTruckMap[item.sku].size >= 2) {
            const existingIds = getExistingTrucks(item.sku);
            fitTrucks = truckPool.filter(t => existingIds.includes(t.id) && (t.capacity - t.currentWeight) >= palletWt);
          } else {
            fitTrucks = truckPool.filter(t => (t.capacity - t.currentWeight) >= palletWt);
          }
          // Fallback: relax SKU constraint if no trucks available
          if (fitTrucks.length === 0) {
            fitTrucks = truckPool.filter(t => (t.capacity - t.currentWeight) >= palletWt);
          }
          if (fitTrucks.length === 0) break;
          
          fitTrucks.sort((a, b) => (a.capacity - a.currentWeight) - (b.capacity - b.currentWeight));
          const truck = fitTrucks[0];
          
          const palletsCanFit = Math.floor((truck.capacity - truck.currentWeight) / palletWt);
          const palletsToLoad = Math.min(palletsCanFit, Math.floor(rem / cp));
          const cartonsToLoad = palletsToLoad * cp;
          const pcsToLoad = cartonsToLoad >= rem ? remPcs : Math.round((cartonsToLoad / item.cartons) * item.pcs);
          const wt = cartonsToLoad * (item.weightPerCarton || 1);
          
          const existing = truck.items.find(i => i.row === item.row);
          if (existing) { existing.cartons += cartonsToLoad; existing.pcs += pcsToLoad; existing.totalWeight += wt; }
          else { truck.items.push({ ...item, cartons: cartonsToLoad, pcs: pcsToLoad, totalWeight: wt }); }
          truck.currentWeight += wt;
          recordAssignment(item.sku, truck.id);
          rem -= cartonsToLoad;
          remPcs -= pcsToLoad;
        }
      }
      
      // Assign odd cartons (best-fit, respecting max split)
      for (const item of oddLeft) {
        if (item.remainCartons <= 0) continue;
        const oddWt = item.remainCartons * (item.weightPerCarton || 1);
        
        let fitTrucks;
        if (skuTruckMap[item.sku] && skuTruckMap[item.sku].size >= 2) {
          const existingIds = getExistingTrucks(item.sku);
          fitTrucks = truckPool.filter(t => existingIds.includes(t.id) && (t.capacity - t.currentWeight) >= oddWt);
        } else {
          fitTrucks = truckPool.filter(t => (t.capacity - t.currentWeight) >= oddWt);
        }
        
        if (fitTrucks.length === 0) {
          // Fallback: any truck with space
          fitTrucks = truckPool.filter(t => (t.capacity - t.currentWeight) >= (item.weightPerCarton || 1));
        }
        if (fitTrucks.length === 0) continue;
        
        fitTrucks.sort((a, b) => (a.capacity - a.currentWeight) - (b.capacity - b.currentWeight));
        const truck = fitTrucks[0];
        
        const cartonsToLoad = Math.min(item.remainCartons, Math.floor((truck.capacity - truck.currentWeight) / (item.weightPerCarton || 1)));
        if (cartonsToLoad <= 0) continue;
        const wt = cartonsToLoad * (item.weightPerCarton || 1);
        
        const existing = truck.items.find(i => i.row === item.row);
        if (existing) { existing.cartons += cartonsToLoad; existing.pcs += item.remainPcs; existing.totalWeight += wt; }
        else { truck.items.push({ ...item, cartons: cartonsToLoad, pcs: item.remainPcs, totalWeight: wt }); }
        truck.currentWeight += wt;
        recordAssignment(item.sku, truck.id);
      }

      } // end version check
      
      // Build allocation summary for frontend display
      const poSummary = {
        poName,
        trucks: truckPool.filter(t => t.items.length > 0).map(t => {
          // Calculate total CBM for this truck
          const truckCbm = t.items.reduce((sum, item) => {
            const cbmCase = spec.items[item.sku] ? spec.items[item.sku].cbmCase : 0;
            return sum + (cbmCase ? item.cartons * cbmCase : 0);
          }, 0);
          
          return {
          id: t.id,
          type: t.type,
          capacity: t.capacity,
          cbmCapacity: t.cbmCapacity,
          currentWeight: Math.round(t.currentWeight * 100) / 100,
          currentCbm: Math.round(truckCbm * 1000) / 1000,
          utilization: Math.round((t.currentWeight / t.capacity) * 100),
          cbmUtilization: t.cbmCapacity ? Math.round((truckCbm / t.cbmCapacity) * 100) : 0,
          items: t.items.map(item => {
            const casePallet = spec.items[item.sku] ? spec.items[item.sku].casePallet : 0;
            const pallets = casePallet ? Math.round((item.cartons / casePallet) * 100) / 100 : 0;
            const cbmCase = spec.items[item.sku] ? spec.items[item.sku].cbmCase : 0;
            const cbm = cbmCase ? Math.round(item.cartons * cbmCase * 1000) / 1000 : 0;
            return {
              sku: item.sku,
              desc: item.row[skuIdx + 1] || '',
              batch: item.batch,
              itemType: item.itemType || '',
              cartons: item.cartons,
              pcs: item.pcs,
              weight: Math.round(item.totalWeight * 100) / 100,
              pallets,
              cbm
            };
          })
        };})
      };
      allocationSummary.push(poSummary);

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
      if (cbmColIdx !== -1) {
         newSheet.getColumn(cbmColIdx).width = 12;
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
              } else if (colNumber === cbmColIdx) {
                 const sku = data[i][skuIdx];
                 const cartons = parseFloat(data[i][cartonIdx]) || 0;
                 const cbmCase = (spec.items[sku] && spec.items[sku].cbmCase) ? spec.items[sku].cbmCase : 0;
                 val = cbmCase ? parseFloat((cartons * cbmCase).toFixed(3)) : null;
              } else if (colNumber > (cbmColIdx !== -1 ? cbmColIdx : palletColIdx)) {
                 const offset = (cbmColIdx !== -1 ? 2 : 1);
                 val = data[i][colNumber - 1 - offset];
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
            } else if (colNumber === cbmColIdx) {
                // skip, computed below
            } else if (colNumber > (cbmColIdx !== -1 ? cbmColIdx : palletColIdx)) {
                const offset = (cbmColIdx !== -1 ? 2 : 1);
                val = item.row[colNumber - 1 - offset];
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
          if (cbmColIdx !== -1) {
             const cbmCase = spec.items[item.sku] ? spec.items[item.sku].cbmCase : 0;
             const cbm = cbmCase ? item.cartons * cbmCase : 0;
             const cCell = destRow.getCell(cbmColIdx);
             cCell.value = parseFloat(cbm.toFixed(3));
             const adjacentStyle = styleTemplateRow.getCell(palletColIdx - 1);
             cCell.style = adjacentStyle ? adjacentStyle.style : {};
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
        if (cbmColIdx !== -1) {
           subtotalRow.getCell(cbmColIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
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

    // Collect sheet IDs to hide (don't modify during iteration)
    const sheetsToHide = [];
    outWb.eachSheet((ws) => {
      const name = ws.name.toUpperCase();
      const isGenerated = generatedSheets.includes(ws.name);
      if (!isGenerated && (name.includes('MASTER DATA') || name.includes('LIST ADDRESS'))) {
        sheetsToHide.push(ws.id);
      }
    });
    
    // Only hide if we have at least 1 visible generated sheet
    if (generatedSheets.length > 0) {
      for (const sheetId of sheetsToHide) {
        const ws = outWb.getWorksheet(sheetId);
        if (ws) ws.state = 'veryHidden';
      }
    }

    // Set row height to 19 on all generated result sheets
    for (const sheetName of generatedSheets) {
      const ws = outWb.getWorksheet(sheetName);
      if (!ws) continue;
      // Ensure it's visible
      ws.state = 'visible';
      // Set all row heights to 19
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.height = 19;
      });
    }

    const outputBuffer = await outWb.xlsx.writeBuffer();
    return { success: true, posCount: config.length, outputBuffer, allocationSummary };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  preview,
  execute
};
