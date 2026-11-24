/** An uploaded file shown as page images: a photo is one page, a PDF one image per page. */
export interface PageImage {
  src: string;
  /** page number inside a PDF */
  pdfPage?: number;
}

/** Each PDF page drawn as an image, so PDFs show on every device and print like photos. */
export async function pdfPageImages(url: string, name: string): Promise<PageImage[]> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${name} could not be opened.`);
  // a PDF never gets to run code here
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), isEvalSupported: false, enableXfa: false }).promise;
  const pages: PageImage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    // "print" draws in one go instead of per animation frame, so it also finishes in a background tab
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport, intent: 'print' }).promise;
    pages.push({ src: canvas.toDataURL('image/jpeg', 0.92), pdfPage: n });
  }
  await doc.destroy();
  return pages;
}

export const fileImages = (file: { url: string; name: string; mimeType: string }): Promise<PageImage[]> =>
  file.mimeType === 'application/pdf' ? pdfPageImages(file.url, file.name) : Promise.resolve([{ src: file.url }]);

/** Any image (URL or data URL) as a JPEG data URL with its size, for putting into a PDF. */
export async function asJpeg(src: string): Promise<{ data: string; width: number; height: number }> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  // photos with transparency get a white background instead of black
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return { data: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}
