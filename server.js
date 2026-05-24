const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const asnAgent = require('./generate_asn');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// API ENDPOINTS
// ============================================================================

// 1. Get status of locations
app.get('/api/locations/status', (req, res) => {
  try {
    const status = asnAgent.getLocationStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. List PDF files in Input folder
app.get('/api/pdfs', (req, res) => {
  try {
    const files = asnAgent.listPDFs();
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2b. List Inventory files
app.get('/api/inventory-files', (req, res) => {
  try {
    const inventoryDir = path.join(__dirname, 'Input', 'Inventory');
    if (!fs.existsSync(inventoryDir)) {
      res.json({ success: true, data: [] });
      return;
    }
    const files = fs.readdirSync(inventoryDir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2c. Open Folder
app.post('/api/open-folder/:type', (req, res) => {
  try {
    const type = req.params.type;
    let folderPath = '';
    
    if (type === 'pdf') {
      folderPath = path.join(__dirname, 'Input', 'Data Customer');
    } else if (type === 'inventory') {
      folderPath = path.join(__dirname, 'Input', 'Inventory');
    } else if (type === 'asn') {
      folderPath = path.join(__dirname, 'Output', 'ASN Output');
    } else if (type === 'md-goods-spec') {
      folderPath = path.join(__dirname, 'Master Data', 'Goods specification');
    } else if (type === 'md-master-loc') {
      folderPath = path.join(__dirname, 'Master Data', 'Master Location');
    } else if (type === 'md-non-use-loc') {
      folderPath = path.join(__dirname, 'Master Data', 'Location - Non use');
    } else {
      return res.status(400).json({ success: false, error: 'Invalid folder type' });
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Windows specific command to open folder
    const command = `start "" "${folderPath}"`;
    exec(command, (error) => {
      if (error) {
        console.error(`Error opening folder: ${error}`);
        return res.status(500).json({ success: false, error: 'Failed to open folder' });
      }
      res.json({ success: true });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2d. Upload File
app.post('/api/upload/:type', (req, res) => {
  try {
    const type = req.params.type;
    const { filename, content } = req.body;
    
    if (!filename || !content) {
      return res.status(400).json({ success: false, error: 'Missing filename or content' });
    }

    let folderPath = '';
    if (type === 'pdf') {
      folderPath = path.join(__dirname, 'Input', 'Data Customer');
    } else if (type === 'inventory') {
      folderPath = path.join(__dirname, 'Input', 'Inventory');
    } else {
      return res.status(400).json({ success: false, error: 'Invalid folder type' });
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Decode base64 and save
    const base64Data = content.replace(/^data:.*?;base64,/, "");
    const filePath = path.join(folderPath, filename);
    fs.writeFileSync(filePath, base64Data, 'base64');
    
    res.json({ success: true, message: 'File uploaded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2e. Delete Input File
app.delete('/api/delete/:type/:filename', (req, res) => {
  try {
    const type = req.params.type;
    const filename = req.params.filename;
    
    let folderPath = '';
    if (type === 'pdf') {
      folderPath = path.join(__dirname, 'Input', 'Data Customer');
    } else if (type === 'inventory') {
      folderPath = path.join(__dirname, 'Input', 'Inventory');
    } else {
      return res.status(400).json({ success: false, error: 'Invalid folder type' });
    }

    const filePath = path.join(folderPath, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. List ASN files in Output folder
app.get('/api/asn-files', (req, res) => {
  try {
    const files = asnAgent.listASNFiles();
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Generate ASN
app.post('/api/generate', async (req, res) => {
  try {
    const result = await asnAgent.generateASN();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Delete ASN file (free up locations)
app.delete('/api/asn/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const success = asnAgent.deleteASNFile(filename);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Download ASN file
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(asnAgent.PATHS.asnOutput, filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// 7. Get Logs
app.get('/api/logs', (req, res) => {
  try {
    const logs = asnAgent.getLogs();
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const inventoryAnalyzer = require('./inventory_analyze');

// 8. Analyze Inventory
app.post('/api/inventory/analyze', (req, res) => {
  try {
    const result = inventoryAnalyzer.analyzeInventory();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 9. Download Wrong Location file
app.get('/api/inventory/download-wrong-location', (req, res) => {
  const filePath = path.join(inventoryAnalyzer.PATHS.output, 'Wrong Location.xlsx');
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

const emptyLocation = require('./empty_location');

// 10. Extract Empty Locations
app.post('/api/empty-locations/generate', (req, res) => {
  try {
    const result = emptyLocation.getEmptyLocations();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 11. Download Empty Location file
app.get('/api/empty-locations/download', (req, res) => {
  const filePath = path.join(emptyLocation.PATHS.output, 'Empty Location.xlsx');
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// 12. Shutdown Server
app.post('/api/shutdown', (req, res) => {
  res.json({ success: true, message: 'Server is shutting down.' });
  console.log('Shutdown requested from UI. Exiting in 1 second...');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 ASN Agent Dashboard running at http://localhost:${PORT}`);
});
