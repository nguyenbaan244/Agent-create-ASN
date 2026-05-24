const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');
const path = require('path');

async function extractPDF(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  return fullText;
}

async function main() {
  const pdfDir = path.join(__dirname, 'Input', 'Data Customer');
  const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
  
  for (const pdfFile of pdfFiles) {
    console.log(`\n=== PDF: ${pdfFile} ===`);
    try {
      const text = await extractPDF(path.join(pdfDir, pdfFile));
      console.log(text);
    } catch (e) {
      console.error(`Error: ${e.message}`);
    }
  }
}

main().catch(console.error);
