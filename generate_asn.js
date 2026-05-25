const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
// Template and Mapping are part of source code (read-only on Vercel)
const STATIC_PATHS = {
  template: path.join(BASE_DIR, 'Template', 'Template ASN.xlsx'),
  mapping: path.join(BASE_DIR, 'Mapping', 'Mapping.xlsx'),
};

// ============================================================
// LOG SYSTEM
// ============================================================
function createLogger() {
  const entries = [];
  return {
    log(action, detail) {
      const entry = { time: new Date().toISOString(), action, detail };
      entries.push(entry);
      console.log(`[${entry.time}] ${action}: ${detail}`);
      return entry;
    },
    getEntries() { return entries; },
    toText() {
      return entries.map(e => `[${e.time}] ${e.action}: ${e.detail}`).join('\n');
    }
  };
}

// ============================================================
// READ GOODS SPECIFICATION (from buffer)
// ============================================================
function loadGoodsSpecFromBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const spec = {};
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (row[0]) {
      spec[String(row[0])] = {
        name: row[1],
        pcsPerCase: row[2],
        pcsPerPallet: row[3],
        casePerPallet: row[5],
      };
    }
  }
  return spec;
}

// ============================================================
// READ MAPPING RULES (from source code - read-only)
// ============================================================
function loadMappingRules() {
  const wb = XLSX.readFile(STATIC_PATHS.mapping);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const rules = [];
  for (let i = 1; i < data.length; i++) {
    rules.push({
      pdfField: data[i][0],
      asnField: data[i][1],
      defaultValue: data[i][2],
      rule: data[i][3],
    });
  }
  return rules;
}

// ============================================================
// EXTRACT PDF DATA (from buffers)
// ============================================================
async function extractPDFData(pdfBuffers, logger) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  if (pdfBuffers.length === 0) {
    throw new Error('No PDF files provided');
  }

  logger.log('EXTRACT_PDF', `Processing ${pdfBuffers.length} PDF files`);

  // Group by container (files are named: CONTAINER - CODE.pdf)
  const containers = {};
  for (const { filename, buffer } of pdfBuffers) {
    const containerNo = filename.split(' - ')[0].trim();
    if (!containers[containerNo]) containers[containerNo] = [];
    containers[containerNo].push({ filename, buffer });
  }

  const results = [];

  for (const [containerNo, files] of Object.entries(containers)) {
    logger.log('EXTRACT_PDF', `Processing container: ${containerNo}`);
    
    let pdfAText = '';
    let pdfBText = '';
    
    for (const { filename, buffer } of files.sort((a, b) => a.filename.localeCompare(b.filename))) {
      const data = new Uint8Array(buffer);
      const doc = await getDocument({ data }).promise;
      
      let fullText = '';
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        fullText += tc.items.map(item => item.str).join(' ') + '\n';
      }
      
      if (filename.includes('A.pdf') || filename.endsWith('A.pdf')) {
        pdfAText = fullText;
        logger.log('EXTRACT_PDF', `Read PDF A: ${filename}`);
      } else if (filename.includes('B.pdf') || filename.endsWith('B.pdf')) {
        pdfBText = fullText;
        logger.log('EXTRACT_PDF', `Read PDF B: ${filename}`);
      }
    }

    const headerData = parsePDFA(pdfAText, logger);
    headerData.containerNo = containerNo;
    const pallets = parsePDFB(pdfBText, headerData, logger);
    results.push({ headerData, pallets, containerNo });
  }

  return results;
}

// ============================================================
// PARSE PDF A (summary/header)
// ============================================================
function parsePDFA(text, logger) {
  const result = {
    motherDNNo: '',
    licensePlate: '',
    poStoNo: '',
    products: [],
  };

  const motherDNMatch = text.match(/(\d{10,})\s+TU Id/);
  if (motherDNMatch) {
    result.motherDNNo = motherDNMatch[1];
    logger.log('EXTRACT_PDF', `Mother DN No: ${result.motherDNNo}`);
  }

  const conMatch = text.match(/Con#(\w+)/);
  if (conMatch) {
    result.licensePlate = conMatch[1];
    logger.log('EXTRACT_PDF', `License Plate: ${result.licensePlate}`);
  }

  const poMatch = text.match(/PO\/STO No.*?(\d{10,})/s);
  if (poMatch) {
    result.poStoNo = poMatch[1];
    logger.log('EXTRACT_PDF', `PO/STO No: ${result.poStoNo}`);
  }

  const productPattern = /00(\d{6})\s+([A-Z\s,\d]+?)\s+\d+\s+([\d\s]+)\s*TR\s+([\d.]+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)/g;
  let match;
  while ((match = productPattern.exec(text)) !== null) {
    const qty = parseInt(match[3].replace(/\s/g, ''));
    const product = {
      sku: match[1],
      name: match[2].trim(),
      quantity: qty,
      batch: match[4],
      expiry: match[5],
      prodDate: match[6],
      prodOrder: match[7],
    };
    result.products.push(product);
    logger.log('EXTRACT_PDF', `Product: SKU=${product.sku}, Qty=${product.quantity}, Batch=${product.batch}`);
  }

  return result;
}

// ============================================================
// PARSE PDF B (pallet details)
// ============================================================
function parsePDFB(text, headerData, logger) {
  const pallets = [];
  const sections = text.split(/(?=00\d{6}\s+[A-Z])/);
  let currentSku = '';

  for (const section of sections) {
    const skuHeaderMatch = section.match(/^00(\d{6})\s+/);
    if (skuHeaderMatch) {
      currentSku = skuHeaderMatch[1];
    }
    if (!currentSku) continue;

    const ssccPattern = /(\d{18})\s+(\d{2}\/\d{2}\/\d{4})\s+1\s+([\d.]+)\s*KG\s+(\d+)\s*TR\s+([\d.]+)\s+(\d+)/g;
    let palletMatch;
    while ((palletMatch = ssccPattern.exec(section)) !== null) {
      const batch = palletMatch[5];
      const headerProduct = headerData.products.find(p => p.sku === currentSku && p.batch === batch);
      pallets.push({
        sku: currentSku,
        sscc: palletMatch[1],
        expiry: palletMatch[2],
        qty: parseInt(palletMatch[4]),
        batch: batch,
        prodDate: headerProduct ? headerProduct.prodDate : '',
        prodOrder: palletMatch[6],
      });
    }
  }

  logger.log('EXTRACT_PDF', `Total pallets extracted: ${pallets.length}`);
  const groups = {};
  pallets.forEach(p => {
    const key = `${p.sku}_${p.batch}`;
    if (!groups[key]) groups[key] = { count: 0, totalQty: 0 };
    groups[key].count++;
    groups[key].totalQty += p.qty;
  });
  for (const [key, val] of Object.entries(groups)) {
    logger.log('VERIFY', `${key}: ${val.count} pallets, ${val.totalQty} cases`);
  }

  return pallets;
}

// ============================================================
// ASSIGN LOCATIONS (from buffers)
// ============================================================
function assignLocations(pallets, logger, { masterLocBuffer, nonUseLocBuffer, inventoryBuffer, asnOutputBuffers }) {
  // Master locations
  const masterWB = XLSX.read(masterLocBuffer, { type: 'buffer' });
  const masterData = XLSX.utils.sheet_to_json(masterWB.Sheets[masterWB.SheetNames[0]], { header: 1, defval: '' });
  const allLocs = new Set();
  for (let i = 1; i < masterData.length; i++) {
    if (masterData[i][0]) allLocs.add(masterData[i][0]);
  }

  // Non-use
  const nonUseWB = XLSX.read(nonUseLocBuffer, { type: 'buffer' });
  const nonUseData = XLSX.utils.sheet_to_json(nonUseWB.Sheets[nonUseWB.SheetNames[0]], { header: 1, defval: '' });
  const nonUseLocs = new Set();
  for (let i = 1; i < nonUseData.length; i++) {
    if (nonUseData[i][0]) nonUseLocs.add(nonUseData[i][0]);
  }

  // Inventory
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

  // ASN output locations
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
      } catch (e) { /* skip */ }
    }
  }

  logger.log('LOCATION', `Master: ${allLocs.size}, Non-use: ${nonUseLocs.size}, Inventory: ${invLocs.size}, ASN-blocked: ${asnLocs.size}`);

  const availableLocs = [...allLocs]
    .filter(l => !nonUseLocs.has(l) && !invLocs.has(l) && !asnLocs.has(l))
    .sort();

  logger.log('LOCATION', `Available locations: ${availableLocs.length}`);

  // Group pallets by (SKU, Batch) for double-deep
  const groups = {};
  pallets.forEach((p, idx) => {
    const key = `${p.sku}_${p.batch}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(idx);
  });

  const palletLocations = new Array(pallets.length).fill('');
  let locPointer = 0;
  let insufficientLocs = false;

  for (const [groupKey, indices] of Object.entries(groups)) {
    for (let i = 0; i < indices.length; i += 2) {
      if (locPointer >= availableLocs.length) {
        logger.log('WARNING', `Not enough locations for group ${groupKey}`);
        insufficientLocs = true;
        break;
      }
      const loc = availableLocs[locPointer];
      palletLocations[indices[i]] = loc;
      if (i + 1 < indices.length) {
        palletLocations[indices[i + 1]] = loc;
        logger.log('LOCATION', `${loc} <- pallets ${indices[i]+1} & ${indices[i+1]+1} (${groupKey})`);
      } else {
        logger.log('LOCATION', `${loc} <- pallet ${indices[i]+1} (${groupKey}, single)`);
      }
      locPointer++;
    }
  }

  const usedCount = new Set(palletLocations.filter(l => l)).size;
  logger.log('LOCATION', `Total locations assigned: ${usedCount}`);
  return { palletLocations, insufficientLocs };
}

// ============================================================
// GET LOCATION STATUS (from buffers)
// ============================================================
function getLocationStatusFromBuffers({ masterLocBuffer, nonUseLocBuffer, inventoryBuffer, asnOutputBuffers }) {
  const masterWB = XLSX.read(masterLocBuffer, { type: 'buffer' });
  const masterData = XLSX.utils.sheet_to_json(masterWB.Sheets[masterWB.SheetNames[0]], { header: 1, defval: '' });
  const allLocs = new Set();
  for (let i = 1; i < masterData.length; i++) {
    if (masterData[i][0]) allLocs.add(masterData[i][0]);
  }

  const nonUseWB = XLSX.read(nonUseLocBuffer, { type: 'buffer' });
  const nonUseData = XLSX.utils.sheet_to_json(nonUseWB.Sheets[nonUseWB.SheetNames[0]], { header: 1, defval: '' });
  const nonUseLocs = new Set();
  for (let i = 1; i < nonUseData.length; i++) {
    if (nonUseData[i][0]) nonUseLocs.add(nonUseData[i][0]);
  }

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
      } catch (e) { /* skip */ }
    }
  }

  const available = [...allLocs]
    .filter(l => !nonUseLocs.has(l) && !invLocs.has(l) && !asnLocs.has(l));

  return {
    total: allLocs.size,
    nonUse: nonUseLocs.size,
    inventory: invLocs.size,
    asnBlocked: asnLocs.size,
    available: available.length,
  };
}

// ============================================================
// GENERATE ASN (buffer-based)
// ============================================================
async function generateASN({ pdfBuffers, inventoryBuffer, goodsSpecBuffer, masterLocBuffer, nonUseLocBuffer, asnOutputBuffers }) {
  const logger = createLogger();
  
  try {
    const goodsSpec = loadGoodsSpecFromBuffer(goodsSpecBuffer);
    logger.log('GOODS_SPEC', `Loaded ${Object.keys(goodsSpec).length} items`);

    const containers = await extractPDFData(pdfBuffers, logger);
    const outputFiles = [];

    for (const container of containers) {
      const { headerData, pallets, containerNo } = container;
      
      const { palletLocations, insufficientLocs } = assignLocations(pallets, logger, {
        masterLocBuffer, nonUseLocBuffer, inventoryBuffer, asnOutputBuffers,
      });
      
      // Read template from source code (read-only)
      const templateWB = XLSX.readFile(STATIC_PATHS.template, { cellStyles: true });
      const templateWS = templateWB.Sheets[templateWB.SheetNames[0]];
      const headers = XLSX.utils.sheet_to_json(templateWS, { header: 1, defval: '' })[0];

      const headerStyles = {};
      for (let c = 0; c < headers.length; c++) {
        const ref = XLSX.utils.encode_cell({ r: 0, c });
        if (templateWS[ref] && templateWS[ref].s) headerStyles[c] = templateWS[ref].s;
      }

      const rows = [];
      for (let i = 0; i < pallets.length; i++) {
        const p = pallets[i];
        const spec = goodsSpec[p.sku];
        if (!spec) {
          logger.log('ERROR', `SKU ${p.sku} not found in Goods Specification!`);
          continue;
        }
        
        const row = new Array(headers.length).fill('');
        const set = (field, val) => {
          const idx = headers.indexOf(field);
          if (idx >= 0) row[idx] = val;
        };
        const cvt = (d) => { const p = d.split('/'); return `${p[2]}/${p[1]}/${p[0]}`; };
        
        set('ExternReceiptkey', headerData.motherDNNo);
        set('Storerkey', 'DANONE');
        set('ContainerKey', headerData.licensePlate);
        set('Signatory', headerData.poStoNo);
        set('RECType', 'Normal');
        set('Facility', 'DAN1');
        set('DOCTYPE', 'A');
        set('ExternLineNo', i + 1);
        set('SKU', p.sku);
        set('QtyExpected', p.qty * spec.pcsPerCase);
        set('BeforeReceivedQty', p.qty * spec.pcsPerCase);
        set('UOM', 'EA');
        set('ToLoc', palletLocations[i]);
        set('ToID', p.sscc);
        set('Lottable01', p.batch);
        set('Lottable02', 'QI');
        set('Lottable04', cvt(p.expiry));
        set('Lottable13', p.prodDate ? cvt(p.prodDate) : '');
        set('SellerCompany', 'DANONE NUTRICIA NZ LTD');
        set('SellerAddress1', '42 Aintree Avenue, NZ, Mangere Auckland');
        
        rows.push(row);
      }

      const outputData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(outputData);
      if (templateWS['!cols']) ws['!cols'] = templateWS['!cols'];
      for (let c = 0; c < headers.length; c++) {
        const ref = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[ref] && headerStyles[c]) ws[ref].s = headerStyles[c];
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, templateWB.SheetNames[0]);

      const filename = `ASN - Danone - ${headerData.licensePlate}.xlsx`;
      // Return buffer instead of writing to file
      const outputBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      logger.log('GENERATE', `✅ Created: ${filename}`);
      logger.log('VERIFY', `Rows: ${rows.length}, Locations: ${new Set(palletLocations.filter(l => l)).size}`);

      const qtyBySku = {};
      rows.forEach(row => {
        const sku = row[headers.indexOf('SKU')];
        const qty = Number(row[headers.indexOf('QtyExpected')]) || 0;
        if (!qtyBySku[sku]) qtyBySku[sku] = 0;
        qtyBySku[sku] += qty;
      });
      for (const [sku, total] of Object.entries(qtyBySku)) {
        const sp = goodsSpec[sku];
        logger.log('VERIFY', `SKU ${sku}: ${total} EA = ${total / sp.pcsPerCase} cases`);
      }

      outputFiles.push({
        filename,
        buffer: outputBuffer,
        container: headerData.licensePlate,
        motherDN: headerData.motherDNNo,
        poStoNo: headerData.poStoNo,
        palletCount: rows.length,
        locationCount: new Set(palletLocations.filter(l => l)).size,
        insufficientLocs,
        products: Object.entries(qtyBySku).map(([sku, total]) => ({
          sku,
          totalEA: total,
          totalCases: total / goodsSpec[sku].pcsPerCase,
          name: goodsSpec[sku].name,
        })),
      });
    }

    return {
      success: true,
      files: outputFiles,
      logs: logger.getEntries(),
      logText: logger.toText(),
    };
  } catch (error) {
    logger.log('ERROR', error.message);
    return {
      success: false,
      error: error.message,
      logs: logger.getEntries(),
    };
  }
}

module.exports = {
  generateASN,
  getLocationStatusFromBuffers,
  loadGoodsSpecFromBuffer,
  loadMappingRules,
  createLogger,
  STATIC_PATHS,
};
