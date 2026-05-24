const XLSX = require('xlsx');
const path = require('path');

// Read a specific file based on command line argument
const target = process.argv[2]; // mapping, template, goods, masterloc, nonuse, inventory

const files = {
  mapping: path.join(__dirname, 'Mapping', 'Mapping.xlsx'),
  template: path.join(__dirname, 'Template', 'Template ASN.xlsx'),
  goods: path.join(__dirname, 'Master Data', 'Goods specification', 'Goods specification.xlsx'),
  masterloc: path.join(__dirname, 'Master Data', 'Master Location', 'Master Location.xlsx'),
  nonuse: path.join(__dirname, 'Master Data', 'Location - Non use', 'Location Non use.xlsx'),
  inventory: path.join(__dirname, 'Input', 'Inventory', 'Inventory 18-May.xlsx'),
};

if (!files[target]) {
  console.log("Usage: node read_excel.js <mapping|template|goods|masterloc|nonuse|inventory>");
  process.exit(1);
}

const wb = XLSX.readFile(files[target]);
for (const sheetName of wb.SheetNames) {
  console.log(`\n--- Sheet: ${sheetName} ---`);
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const limit = target === 'masterloc' || target === 'inventory' ? Math.min(data.length, 60) : data.length;
  for (let i = 0; i < limit; i++) {
    // Filter out empty trailing cells
    let row = data[i];
    while (row.length > 0 && row[row.length - 1] === '') row = row.slice(0, -1);
    if (row.length > 0) console.log(`Row ${i}: ${JSON.stringify(row)}`);
  }
  if (data.length > limit) console.log(`... (${data.length - limit} more rows, total: ${data.length})`);
}
