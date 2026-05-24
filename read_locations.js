const XLSX = require('xlsx');
const path = require('path');

// Read master location - just get all location names
const wb = XLSX.readFile(path.join(__dirname, 'Master Data', 'Master Location', 'Master Location.xlsx'));
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

// Show header
console.log("Header:", JSON.stringify(data[0]));
console.log(`Total rows: ${data.length}`);

// Collect all location names (column 0)
const allLocs = [];
for (let i = 1; i < data.length; i++) {
  if (data[i][0]) allLocs.push(data[i][0]);
}
console.log(`\nAll locations (${allLocs.length}):`);
console.log(allLocs.join(', '));

// Read inventory header
console.log("\n\n=== INVENTORY HEADER ===");
const invWB = XLSX.readFile(path.join(__dirname, 'Input', 'Inventory', 'Inventory 18-May.xlsx'));
const invSheet = invWB.Sheets[invWB.SheetNames[0]];
const invData = XLSX.utils.sheet_to_json(invSheet, { header: 1, defval: '' });
console.log("Header:", JSON.stringify(invData[0]));
console.log(`Total rows: ${invData.length}`);

// Get used locations from inventory (column index for Location)
const locColIdx = invData[0].indexOf('LOC');
const locColIdx2 = invData[0].findIndex(h => String(h).toLowerCase().includes('loc'));
console.log(`Location column index: ${locColIdx}, alt: ${locColIdx2}`);

// If found, collect all locations used in inventory
if (locColIdx2 >= 0) {
  const usedLocs = new Set();
  for (let i = 1; i < invData.length; i++) {
    if (invData[i][locColIdx2]) usedLocs.add(invData[i][locColIdx2]);
  }
  console.log(`\nUsed locations in inventory (${usedLocs.size}):`);
  console.log([...usedLocs].sort().join(', '));
}
