const XLSX = require('xlsx');
const path = require('path');

const wb = XLSX.readFile(path.join(__dirname, 'Template', 'Template ASN.xlsx'), { cellStyles: true });
const ws = wb.Sheets[wb.SheetNames[0]];

// Check for hidden columns
console.log("=== SHEET PROPERTIES ===");
if (ws['!cols']) {
  console.log("Column properties:");
  ws['!cols'].forEach((col, i) => {
    if (col && (col.hidden || col.width !== undefined)) {
      // Get column letter
      const letter = XLSX.utils.encode_col(i);
      console.log(`  Col ${letter} (${i}): hidden=${col.hidden}, width=${col.width}, wpx=${col.wpx}`);
    }
  });
} else {
  console.log("No column properties found");
}

// Check for cell styles (first few columns of header row)
console.log("\n=== CELL STYLES (Row 1 Header) ===");
const range = XLSX.utils.decode_range(ws['!ref']);
for (let c = range.s.c; c <= Math.min(range.e.c, 10); c++) {
  const cellRef = XLSX.utils.encode_cell({ r: 0, c: c });
  const cell = ws[cellRef];
  if (cell) {
    console.log(`${cellRef}: value="${cell.v}", type=${cell.t}, style=${JSON.stringify(cell.s || {})}`);
  }
}

// Check sheet ref
console.log("\n=== SHEET REF ===");
console.log("Ref:", ws['!ref']);
console.log("Sheet names:", wb.SheetNames);

// Check all hidden columns
if (ws['!cols']) {
  const hiddenCols = [];
  ws['!cols'].forEach((col, i) => {
    if (col && col.hidden) {
      hiddenCols.push(XLSX.utils.encode_col(i));
    }
  });
  console.log("\nHidden columns:", hiddenCols.join(', '));
}

// Print all column headers with their index
const headers = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0];
console.log("\n=== ALL COLUMNS ===");
headers.forEach((h, i) => {
  const colLetter = XLSX.utils.encode_col(i);
  const colProps = ws['!cols'] ? ws['!cols'][i] : null;
  const hidden = colProps && colProps.hidden ? ' [HIDDEN]' : '';
  console.log(`  ${colLetter} (${i}): "${h}"${hidden}`);
});
