const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

async function main() {
  // 1. Read Mapping.xlsx
  console.log("=== MAPPING.XLSX ===");
  const mappingWB = XLSX.readFile(path.join(__dirname, 'Mapping', 'Mapping.xlsx'));
  for (const sheetName of mappingWB.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = mappingWB.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    data.forEach((row, i) => console.log(`Row ${i}: ${JSON.stringify(row)}`));
  }

  // 2. Read Template ASN.xlsx
  console.log("\n\n=== TEMPLATE ASN.XLSX ===");
  const templateWB = XLSX.readFile(path.join(__dirname, 'Template', 'Template ASN.xlsx'));
  for (const sheetName of templateWB.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = templateWB.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    data.forEach((row, i) => console.log(`Row ${i}: ${JSON.stringify(row)}`));
  }

  // 3. Read PDFs
  const pdfDir = path.join(__dirname, 'Input', 'Data Customer');
  const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
  for (const pdfFile of pdfFiles) {
    console.log(`\n\n=== PDF: ${pdfFile} ===`);
    const pdfBuffer = fs.readFileSync(path.join(pdfDir, pdfFile));
    const pdfData = await pdfParse(pdfBuffer);
    console.log(pdfData.text);
  }

  // 4. Read Goods specification.xlsx
  console.log("\n\n=== GOODS SPECIFICATION.XLSX ===");
  const goodsWB = XLSX.readFile(path.join(__dirname, 'Master Data', 'Goods specification', 'Goods specification.xlsx'));
  for (const sheetName of goodsWB.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = goodsWB.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    data.forEach((row, i) => console.log(`Row ${i}: ${JSON.stringify(row)}`));
  }

  // 5. Read Master Location.xlsx
  console.log("\n\n=== MASTER LOCATION.XLSX ===");
  const locWB = XLSX.readFile(path.join(__dirname, 'Master Data', 'Master Location', 'Master Location.xlsx'));
  for (const sheetName of locWB.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = locWB.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    // Only show first 50 rows to avoid too much output
    const limit = Math.min(data.length, 50);
    for (let i = 0; i < limit; i++) {
      console.log(`Row ${i}: ${JSON.stringify(data[i])}`);
    }
    if (data.length > 50) console.log(`... (${data.length - 50} more rows)`);
  }

  // 6. Read Location Non use.xlsx
  console.log("\n\n=== LOCATION NON USE.XLSX ===");
  const nonUseWB = XLSX.readFile(path.join(__dirname, 'Master Data', 'Location - Non use', 'Location Non use.xlsx'));
  for (const sheetName of nonUseWB.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = nonUseWB.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    data.forEach((row, i) => console.log(`Row ${i}: ${JSON.stringify(row)}`));
  }

  // 7. Read Inventory
  console.log("\n\n=== INVENTORY 18-MAY.XLSX ===");
  const invWB = XLSX.readFile(path.join(__dirname, 'Input', 'Inventory', 'Inventory 18-May.xlsx'));
  for (const sheetName of invWB.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = invWB.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    // Show header + first 30 rows
    const limit = Math.min(data.length, 31);
    for (let i = 0; i < limit; i++) {
      console.log(`Row ${i}: ${JSON.stringify(data[i])}`);
    }
    if (data.length > 31) console.log(`... (${data.length - 31} more rows, total: ${data.length})`);
  }
}

main().catch(console.error);
