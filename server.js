// Polyfill browser APIs required by pdf-parse/pdfjs-dist in Node.js serverless
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      const v = Array.isArray(init) ? init : (typeof init === 'string' ? init.split(/[\s,]+/).map(Number) : []);
      this.a = v[0] ?? 1; this.b = v[1] ?? 0;
      this.c = v[2] ?? 0; this.d = v[3] ?? 1;
      this.e = v[4] ?? 0; this.f = v[5] ?? 0;
      this.m11 = this.a; this.m12 = this.b;
      this.m21 = this.c; this.m22 = this.d;
      this.m41 = this.e; this.m42 = this.f;
      this.is2D = true; this.isIdentity = (this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0);
    }
    inverse() { return new DOMMatrix(); }
    multiply(other) { return new DOMMatrix(); }
    translate(tx, ty) { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e + tx, this.f + ty]); }
    scale(sx, sy) { return new DOMMatrix([this.a * sx, this.b, this.c, this.d * (sy ?? sx), this.e, this.f]); }
    transformPoint(p) { return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f }; }
    toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
  };
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D { constructor() {} addPath() {} closePath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} arc() {} arcTo() {} ellipse() {} rect() {} };
}

require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const asnAgent = require('./generate_asn');
const inventoryAnalyzer = require('./inventory_analyze');
const emptyLocation = require('./empty_location');
const storage = require('./supabase-storage');
const truckAllocation = require('./truck_allocation');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// HELPER: Download inventory from Supabase (latest file)
// ============================================================================
async function getInventoryBuffer() {
  try {
    const files = await storage.listFiles(storage.FOLDERS.inputInventory);
    const xlsxFiles = files.filter(f => f.name.endsWith('.xlsx'));
    if (xlsxFiles.length === 0) return null;
    return await storage.downloadFile(storage.FOLDERS.inputInventory, xlsxFiles[0].name);
  } catch { return null; }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// 1. Get location status
app.get('/api/locations/status', async (req, res) => {
  try {
    const masterData = await storage.downloadAllMasterData();
    const inventoryBuffer = await getInventoryBuffer();
    const asnOutputBuffers = await storage.downloadAllAsnOutputs();
    
    const status = asnAgent.getLocationStatusFromBuffers({
      ...masterData,
      inventoryBuffer,
      asnOutputBuffers,
    });
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. List PDF files in Supabase input
app.get('/api/pdfs', async (req, res) => {
  try {
    const files = await storage.listFiles(storage.FOLDERS.inputPdf);
    const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    res.json({ success: true, data: pdfFiles.map(f => f.name) });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

// 2b. List Inventory files in Supabase
app.get('/api/inventory-files', async (req, res) => {
  try {
    const files = await storage.listFiles(storage.FOLDERS.inputInventory);
    const xlsxFiles = files.filter(f => f.name.endsWith('.xlsx') && !f.name.startsWith('~$'));
    res.json({ success: true, data: xlsxFiles.map(f => f.name) });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

// 3. Upload input files (PDF or Inventory)
app.post('/api/upload/:type', upload.array('files', 20), async (req, res) => {
  try {
    const type = req.params.type;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    let folder = '';
    if (type === 'pdf') {
      folder = storage.FOLDERS.inputPdf;
    } else if (type === 'inventory') {
      folder = storage.FOLDERS.inputInventory;
    } else {
      return res.status(400).json({ success: false, error: 'Invalid type' });
    }

    for (const file of req.files) {
      await storage.uploadFile(folder, file.originalname, file.buffer, file.mimetype);
    }

    res.json({ success: true, message: `${req.files.length} file(s) uploaded successfully` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Delete input file
app.delete('/api/delete/:type/:filename', async (req, res) => {
  try {
    const type = req.params.type;
    const filename = req.params.filename;
    
    let folder = '';
    if (type === 'pdf') folder = storage.FOLDERS.inputPdf;
    else if (type === 'inventory') folder = storage.FOLDERS.inputInventory;
    else return res.status(400).json({ success: false, error: 'Invalid type' });

    await storage.deleteFile(folder, filename);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. List ASN output files
app.get('/api/asn-files', async (req, res) => {
  try {
    const files = await storage.listFiles(storage.FOLDERS.asnOutput);
    const asnFiles = files
      .filter(f => f.name.endsWith('.xlsx') && !f.name.startsWith('~$'))
      .map(f => ({
        name: f.name,
        size: f.metadata?.size || 0,
        modified: f.updated_at || f.created_at,
      }));
    res.json({ success: true, data: asnFiles });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

// 6. Generate ASN
app.post('/api/generate', async (req, res) => {
  try {
    // 1. Get PDF buffers from Supabase
    const pdfFileList = await storage.listFiles(storage.FOLDERS.inputPdf);
    const pdfNames = pdfFileList.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfNames.length === 0) {
      return res.json({ success: false, error: 'No PDF files found. Please upload PDFs first.' });
    }

    const pdfBuffers = [];
    for (const f of pdfNames) {
      const buffer = await storage.downloadFile(storage.FOLDERS.inputPdf, f.name);
      pdfBuffers.push({ filename: f.name, buffer });
    }

    // 2. Get inventory buffer
    const inventoryBuffer = await getInventoryBuffer();

    // 3. Get master data
    const masterData = await storage.downloadAllMasterData();

    // 4. Get existing ASN outputs (for location blocking)
    const asnOutputBuffers = await storage.downloadAllAsnOutputs();

    // 5. Generate
    const result = await asnAgent.generateASN({
      pdfBuffers,
      inventoryBuffer,
      ...masterData,
      asnOutputBuffers,
    });

    if (result.success) {
      // Save output files to Supabase
      for (const file of result.files) {
        await storage.uploadFile(storage.FOLDERS.asnOutput, file.filename, file.buffer,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        // Remove buffer from response to keep it lightweight
        delete file.buffer;
      }

      // Save log to Supabase
      if (result.logText) {
        const containerName = result.files.map(f => f.container).join('_');
        const logFilename = `ASN_Log_${containerName}_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        await storage.uploadFile(storage.FOLDERS.logs, logFilename,
          Buffer.from(result.logText, 'utf8'), 'text/plain');
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Delete ASN file
app.delete('/api/asn/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    await storage.deleteFile(storage.FOLDERS.asnOutput, filename);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. Download ASN file
app.get('/api/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const buffer = await storage.downloadFile(storage.FOLDERS.asnOutput, filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(404).send('File not found');
  }
});

// 9. Get Logs
app.get('/api/logs', async (req, res) => {
  try {
    const files = await storage.listFiles(storage.FOLDERS.logs);
    const logFiles = files.filter(f => f.name.startsWith('ASN_Log_') && f.name.endsWith('.txt'));
    
    const logs = [];
    for (const f of logFiles.slice(0, 10)) { // Limit to 10 most recent
      try {
        const buffer = await storage.downloadFile(storage.FOLDERS.logs, f.name);
        logs.push({
          name: f.name,
          content: buffer.toString('utf8'),
          modified: f.updated_at || f.created_at,
        });
      } catch { /* skip */ }
    }
    res.json({ success: true, data: logs });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

// 10. Analyze Inventory
app.post('/api/inventory/analyze', async (req, res) => {
  try {
    const inventoryBuffer = await getInventoryBuffer();
    if (!inventoryBuffer) {
      return res.json({ success: false, error: 'No inventory file found. Please upload one first.' });
    }
    const result = inventoryAnalyzer.analyzeInventory(inventoryBuffer);
    
    // If there's an output buffer, save it temporarily and provide download endpoint
    if (result.outputBuffer) {
      // Store in Supabase for download
      await storage.uploadFile('output/wrong-location', 'Wrong location.xlsx', result.outputBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      delete result.outputBuffer; // Don't send buffer in JSON
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 11. Download Wrong Location file
app.get('/api/inventory/download-wrong-location', async (req, res) => {
  try {
    const buffer = await storage.downloadFile('output/wrong-location', 'Wrong location.xlsx');
    res.setHeader('Content-Disposition', 'attachment; filename="Wrong location.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(404).send('File not found. Please run the analysis first.');
  }
});

// 12. Extract Empty Locations
app.post('/api/empty-locations/generate', async (req, res) => {
  try {
    const masterData = await storage.downloadAllMasterData();
    const inventoryBuffer = await getInventoryBuffer();
    const asnOutputBuffers = await storage.downloadAllAsnOutputs();
    
    const result = emptyLocation.getEmptyLocations({
      ...masterData,
      inventoryBuffer,
      asnOutputBuffers,
    });

    if (result.outputBuffer) {
      await storage.uploadFile('output/empty-location', 'Empty Location.xlsx', result.outputBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      delete result.outputBuffer;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 13. Download Empty Location file
app.get('/api/empty-locations/download', async (req, res) => {
  try {
    const buffer = await storage.downloadFile('output/empty-location', 'Empty Location.xlsx');
    res.setHeader('Content-Disposition', 'attachment; filename="Empty Location.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(404).send('File not found. Please run the extraction first.');
  }
});

// ============================================================================
// TRUCK ALLOCATION APIs
// ============================================================================

// 14. Preview OB Request
app.post('/api/truck-allocation/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    
    // Save the file to Supabase (temporary input)
    const filename = `TA_${Date.now()}_${req.file.originalname}`;
    await storage.uploadFile(storage.FOLDERS.inputOutbound || 'input/outbound', filename, req.file.buffer, req.file.mimetype);
    
    const result = truckAllocation.preview(req.file.buffer);
    result.filename = filename; // send filename to UI for execute
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 15. Execute Truck Allocation
app.post('/api/truck-allocation/execute', async (req, res) => {
  try {
    const { filename, config, version } = req.body;
    if (!filename || !config) return res.status(400).json({ success: false, error: 'Missing configuration or filename' });

    // Download OB Request
    const obBuffer = await storage.downloadFile(storage.FOLDERS.inputOutbound || 'input/outbound', filename);
    
    // Download Goods Spec
    const masterData = await storage.downloadAllMasterData();
    const goodsSpecBuffer = masterData.goodsSpecBuffer; // Might be null if missing, that's handled in logic

    const result = await truckAllocation.execute(obBuffer, goodsSpecBuffer, config, version || 'v2');
    
    if (result.success && result.outputBuffer) {
      // Extract date from OB Request filename (e.g. "03. Total OB request - 05.06.2026.xlsx")
      const dateMatch = filename.match(/(\d{2}\.\d{2}\.\d{4})\.xlsx$/i);
      const dateStr = dateMatch ? dateMatch[1] : (() => {
        const now = new Date();
        return `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;
      })();
      const outputFilename = `Truck Allocation ${dateStr}.xlsx`;
      await storage.uploadFile('output/truck-allocation', outputFilename, result.outputBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      delete result.outputBuffer;
      result.outputFile = outputFilename;
      // allocationSummary is kept in result for frontend display
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download Truck Allocation output file
app.get('/api/truck-allocation/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const buffer = await storage.downloadFile('output/truck-allocation', filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(404).send('File not found');
  }
});

// ============================================================================
// MASTER DATA MANAGEMENT APIs
// ============================================================================

// 14. Get Master Data status
app.get('/api/master-data/status', async (req, res) => {
  try {
    const status = {};
    for (const [key, filename] of Object.entries(storage.MASTER_DATA_FILES)) {
      const exists = await storage.fileExists(storage.FOLDERS.masterData, filename);
      status[key] = { filename, exists };
    }
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 15. Upload Master Data
app.post('/api/master-data/:type', upload.single('file'), async (req, res) => {
  try {
    const type = req.params.type;
    const filename = storage.MASTER_DATA_FILES[type];
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Invalid master data type' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    await storage.uploadFile(storage.FOLDERS.masterData, filename, req.file.buffer, req.file.mimetype);
    res.json({ success: true, message: `${filename} uploaded successfully` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 16. Download Master Data
app.get('/api/master-data/:type', async (req, res) => {
  try {
    const type = req.params.type;
    const filename = storage.MASTER_DATA_FILES[type];
    if (!filename) {
      return res.status(400).send('Invalid master data type');
    }

    const buffer = await storage.downloadFile(storage.FOLDERS.masterData, filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(404).send('Master data file not found. Please upload it first.');
  }
});

// Start Server
const server = app.listen(PORT);
server.on('listening', () => {
  console.log(`🚀 ASN Agent Hub running at http://localhost:${PORT}`);
  console.log(`📦 Storage: Supabase (${process.env.SUPABASE_URL ? 'configured' : '⚠️ NOT configured'})`);
});
