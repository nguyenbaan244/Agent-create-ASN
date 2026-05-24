const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const PATHS = {
  pdfInput: path.join(BASE_DIR, 'Input', 'Data Customer'),
  inventory: path.join(BASE_DIR, 'Input', 'Inventory'),
  template: path.join(BASE_DIR, 'Template', 'Template ASN.xlsx'),
  mapping: path.join(BASE_DIR, 'Mapping', 'Mapping.xlsx'),
  goodsSpec: path.join(BASE_DIR, 'Master Data', 'Goods specification', 'Goods specification.xlsx'),
  masterLoc: path.join(BASE_DIR, 'Master Data', 'Master Location', 'Master Location.xlsx'),
  nonUseLoc: path.join(BASE_DIR, 'Master Data', 'Location - Non use', 'Location Non use.xlsx'),
  asnOutput: path.join(BASE_DIR, 'Output', 'ASN Output'),
  logs: path.join(BASE_DIR, 'Output', 'Logs'),
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
    save(containerNo) {
      const logPath = path.join(PATHS.logs, `ASN_Log_${containerNo}_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
      const content = entries.map(e => `[${e.time}] ${e.action}: ${e.detail}`).join('\n');
      fs.writeFileSync(logPath, content, 'utf8');
      return logPath;
    }
  };
}

// ============================================================
// READ GOODS SPECIFICATION
// ============================================================
function loadGoodsSpec() {
  const wb = XLSX.readFile(PATHS.goodsSpec);
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
// READ MAPPING RULES
// ============================================================
function loadMappingRules() {
  const wb = XLSX.readFile(PATHS.mapping);
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
// LIST PDF FILES
// ============================================================
function listPDFs() {
  if (!fs.existsSync(PATHS.pdfInput)) return [];
  return fs.readdirSync(PATHS.pdfInput).filter(f => f.toLowerCase().endsWith('.pdf'));
}

// ============================================================
// LIST ASN OUTPUT FILES
// ============================================================
function listASNFiles() {
  if (!fs.existsSync(PATHS.asnOutput)) return [];
  return fs.readdirSync(PATHS.asnOutput)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
    .map(f => {
      const stat = fs.statSync(path.join(PATHS.asnOutput, f));
      return { name: f, size: stat.size, modified: stat.mtime };
    });
}

// ============================================================
// DELETE ASN FILE (release locations)
// ============================================================
function deleteASNFile(filename) {
  const filePath = path.join(PATHS.asnOutput, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

// ============================================================
// GET LOCATION STATUS
// ============================================================
function getLocationStatus() {
  // Master locations
  const masterWB = XLSX.readFile(PATHS.masterLoc);
  const masterData = XLSX.utils.sheet_to_json(masterWB.Sheets[masterWB.SheetNames[0]], { header: 1, defval: '' });
  const allLocs = new Set();
  for (let i = 1; i < masterData.length; i++) {
    if (masterData[i][0]) allLocs.add(masterData[i][0]);
  }

  // Non-use
  const nonUseWB = XLSX.readFile(PATHS.nonUseLoc);
  const nonUseData = XLSX.utils.sheet_to_json(nonUseWB.Sheets[nonUseWB.SheetNames[0]], { header: 1, defval: '' });
  const nonUseLocs = new Set();
  for (let i = 1; i < nonUseData.length; i++) {
    if (nonUseData[i][0]) nonUseLocs.add(nonUseData[i][0]);
  }

  // Inventory
  const invFiles = fs.readdirSync(PATHS.inventory).filter(f => f.endsWith('.xlsx'));
  const invLocs = new Set();
  if (invFiles.length > 0) {
    const invWB = XLSX.readFile(path.join(PATHS.inventory, invFiles[0]));
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
  const asnFiles = listASNFiles();
  for (const f of asnFiles) {
    try {
      const wb = XLSX.readFile(path.join(PATHS.asnOutput, f.name));
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const locIdx = data[0].indexOf('ToLoc');
      if (locIdx >= 0) {
        for (let i = 1; i < data.length; i++) {
          if (data[i][locIdx]) asnLocs.add(data[i][locIdx]);
        }
      }
    } catch (e) { /* skip locked files */ }
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
// EXTRACT PDF DATA (using pdfjs-dist)
// ============================================================
async function extractPDFData(logger) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  const pdfFiles = listPDFs();
  if (pdfFiles.length === 0) {
    throw new Error('No PDF files found in Input/Data Customer folder');
  }

  logger.log('EXTRACT_PDF', `Found ${pdfFiles.length} PDF files`);

  // Group by container (files are named: CONTAINER - CODE.pdf)
  const containers = {};
  for (const f of pdfFiles) {
    const containerNo = f.split(' - ')[0].trim();
    if (!containers[containerNo]) containers[containerNo] = [];
    containers[containerNo].push(f);
  }

  const results = [];

  for (const [containerNo, files] of Object.entries(containers)) {
    logger.log('EXTRACT_PDF', `Processing container: ${containerNo}`);
    
    let pdfAText = '';
    let pdfBText = '';
    
    for (const file of files.sort()) {
      const filePath = path.join(PATHS.pdfInput, file);
      const data = new Uint8Array(fs.readFileSync(filePath));
      const doc = await getDocument({ data }).promise;
      
      let fullText = '';
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        fullText += tc.items.map(item => item.str).join(' ') + '\n';
      }
      
      if (file.includes('A.pdf') || file.endsWith('A.pdf')) {
        pdfAText = fullText;
        logger.log('EXTRACT_PDF', `Read PDF A: ${file}`);
      } else if (file.includes('B.pdf') || file.endsWith('B.pdf')) {
        pdfBText = fullText;
        logger.log('EXTRACT_PDF', `Read PDF B: ${file}`);
      }
    }

    // Parse PDF A - header data
    const headerData = parsePDFA(pdfAText, logger);
    headerData.containerNo = containerNo;
    
    // Parse PDF B - pallet details
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

  // Extract Mother DN No (pattern: digits after "2803" prefix following DN data)
  const motherDNMatch = text.match(/(\d{10,})\s+TU Id/);
  if (motherDNMatch) {
    result.motherDNNo = motherDNMatch[1];
    logger.log('EXTRACT_PDF', `Mother DN No: ${result.motherDNNo}`);
  }

  // Extract Container number (Con#XXXXX)
  const conMatch = text.match(/Con#(\w+)/);
  if (conMatch) {
    result.licensePlate = conMatch[1];
    logger.log('EXTRACT_PDF', `License Plate: ${result.licensePlate}`);
  }

  // Extract PO/STO No
  const poMatch = text.match(/PO\/STO No.*?(\d{10,})/s);
  if (poMatch) {
    result.poStoNo = poMatch[1];
    logger.log('EXTRACT_PDF', `PO/STO No: ${result.poStoNo}`);
  }

  // Extract product lines: SKU, quantity, batch, expiry, prod date
  // Pattern: 00XXXXXX followed by product name, then qty TR, batch, expiry, prod date
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
  
  // Split by SKU sections
  // Pattern: 00XXXXXX PRODUCT NAME QTY TR
  const sections = text.split(/(?=00\d{6}\s+[A-Z])/);
  
  let currentSku = '';
  
  for (const section of sections) {
    // Check if section starts with a SKU header
    const skuHeaderMatch = section.match(/^00(\d{6})\s+/);
    if (skuHeaderMatch) {
      currentSku = skuHeaderMatch[1];
    }
    
    if (!currentSku) continue;
    
    // Find all SSCC entries: 18-digit number followed by expiry, pallet count, weight, qty TR, batch, prod order
    const ssccPattern = /(\d{18})\s+(\d{2}\/\d{2}\/\d{4})\s+1\s+([\d.]+)\s*KG\s+(\d+)\s*TR\s+([\d.]+)\s+(\d+)/g;
    let palletMatch;
    
    while ((palletMatch = ssccPattern.exec(section)) !== null) {
      // Find the corresponding product from header data to get prod date
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
  
  // Log breakdown
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
// ASSIGN LOCATIONS
// ============================================================
function assignLocations(pallets, logger) {
  // Read Master Location
  const masterWB = XLSX.readFile(PATHS.masterLoc);
  const masterData = XLSX.utils.sheet_to_json(masterWB.Sheets[masterWB.SheetNames[0]], { header: 1, defval: '' });
  const allLocs = new Set();
  for (let i = 1; i < masterData.length; i++) {
    if (masterData[i][0]) allLocs.add(masterData[i][0]);
  }

  // Read Non-use
  const nonUseWB = XLSX.readFile(PATHS.nonUseLoc);
  const nonUseData = XLSX.utils.sheet_to_json(nonUseWB.Sheets[nonUseWB.SheetNames[0]], { header: 1, defval: '' });
  const nonUseLocs = new Set();
  for (let i = 1; i < nonUseData.length; i++) {
    if (nonUseData[i][0]) nonUseLocs.add(nonUseData[i][0]);
  }

  // Read Inventory
  const invFiles = fs.readdirSync(PATHS.inventory).filter(f => f.endsWith('.xlsx'));
  const invLocs = new Set();
  if (invFiles.length > 0) {
    const invWB = XLSX.readFile(path.join(PATHS.inventory, invFiles[0]));
    const invData = XLSX.utils.sheet_to_json(invWB.Sheets[invWB.SheetNames[0]], { header: 1, defval: '' });
    const locIdx = invData[0].findIndex(h => String(h).toLowerCase() === 'loc');
    if (locIdx >= 0) {
      for (let i = 1; i < invData.length; i++) {
        if (invData[i][locIdx]) invLocs.add(invData[i][locIdx]);
      }
    }
  }

  // Read ASN output locations (Rule #7)
  const asnLocs = new Set();
  const asnFiles = fs.readdirSync(PATHS.asnOutput)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
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

  logger.log('LOCATION', `Master: ${allLocs.size}, Non-use: ${nonUseLocs.size}, Inventory: ${invLocs.size}, ASN-blocked: ${asnLocs.size}`);

  // Filter
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
// GENERATE ASN FILE
// ============================================================
async function generateASN() {
  const logger = createLogger();
  
  try {
    // Load goods spec
    const goodsSpec = loadGoodsSpec();
    logger.log('GOODS_SPEC', `Loaded ${Object.keys(goodsSpec).length} items`);

    // Extract PDF data
    const containers = await extractPDFData(logger);
    
    const outputFiles = [];

    for (const container of containers) {
      const { headerData, pallets, containerNo } = container;
      
      // Assign locations
      const { palletLocations, insufficientLocs } = assignLocations(pallets, logger);
      
      // Read template with format
      const templateWB = XLSX.readFile(PATHS.template, { cellStyles: true });
      const templateWS = templateWB.Sheets[templateWB.SheetNames[0]];
      const headers = XLSX.utils.sheet_to_json(templateWS, { header: 1, defval: '' })[0];

      // Get header styles
      const headerStyles = {};
      for (let c = 0; c < headers.length; c++) {
        const ref = XLSX.utils.encode_cell({ r: 0, c });
        if (templateWS[ref] && templateWS[ref].s) headerStyles[c] = templateWS[ref].s;
      }

      // Build rows
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

        // Convert date dd/mm/yyyy -> yyyy/mm/dd
        const cvt = (d) => { const p = d.split('/'); return `${p[2]}/${p[1]}/${p[0]}`; };
        
        set('ExternReceiptkey', headerData.motherDNNo);
        set('Storerkey', 'DANONE');
        set('ContainerKey', headerData.licensePlate);
        set('Signatory', headerData.poStoNo); // UPDATED: PO/STO No
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

      // Create workbook
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
      const outputPath = path.join(PATHS.asnOutput, filename);
      XLSX.writeFile(wb, outputPath);
      
      logger.log('GENERATE', `✅ Created: ${filename}`);
      logger.log('VERIFY', `Rows: ${rows.length}, Locations: ${new Set(palletLocations.filter(l => l)).size}`);

      // Verify quantities
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

    // Save logs
    const containerName = containers.map(c => c.containerNo).join('_');
    const logPath = logger.save(containerName);
    logger.log('LOG', `Saved to: ${logPath}`);

    return {
      success: true,
      files: outputFiles,
      logs: logger.getEntries(),
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

// ============================================================
// GET LOGS
// ============================================================
function getLogs() {
  const logFiles = fs.readdirSync(PATHS.logs)
    .filter(f => f.startsWith('ASN_Log_') && f.endsWith('.txt'))
    .sort().reverse();
  
  return logFiles.map(f => {
    const content = fs.readFileSync(path.join(PATHS.logs, f), 'utf8');
    return { name: f, content, modified: fs.statSync(path.join(PATHS.logs, f)).mtime };
  });
}

module.exports = {
  generateASN,
  listPDFs,
  listASNFiles,
  deleteASNFile,
  getLocationStatus,
  getLogs,
  loadGoodsSpec,
  loadMappingRules,
  PATHS,
};
