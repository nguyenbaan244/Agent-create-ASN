import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function extractPDF(filePath) {
  const data = new Uint8Array(readFileSync(filePath));
  const doc = await getDocument({ data }).promise;
  
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
  const pdfDir = join(__dirname, 'Input', 'Data Customer');
  const pdfFiles = readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
  
  for (const pdfFile of pdfFiles) {
    console.log(`\n=== PDF: ${pdfFile} ===`);
    try {
      const text = await extractPDF(join(pdfDir, pdfFile));
      console.log(text);
    } catch (e) {
      console.error(`Error: ${e.message}`);
    }
  }
}

main().catch(console.error);
