// Turns an uploaded resume (PDF, Word .docx, or text) into plain text, all inside the browser.
async function importResumeFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(txt|md)$/.test(name)) return file.text();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.docx')) return readDocx(buf);
  if (name.endsWith('.pdf')) return readPdf(buf);
  throw new Error('Please use a PDF, a Word (.docx) or a text file.');
}

async function readPdf(buf) {
  const pdfjs = await import(chrome.runtime.getURL('lib/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out += content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  return out.trim();
}

// A .docx is a zip file. We find word/document.xml inside it and unzip just that one file.
async function readDocx(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('This does not look like a .docx file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    if (name === 'word/document.xml') {
      const dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
      const slice = buf.slice(dataStart, dataStart + compSize);
      const xml = method === 8
        ? await new Response(new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
        : new TextDecoder().decode(slice);
      return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n').trim();
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Could not read text from this Word file.');
}
