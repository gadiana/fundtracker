/**
 * Prints images (one per page, fitted to the page) from a hidden frame, so the printout is
 * exactly what is shown: no app menu, no lost background colors, no blank extra pages.
 */
export function printImages(sources: string[], { title, width = '100%' }: { title: string; width?: string }) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = `
    @page { margin: 10mm; }
    html, body { margin: 0; }
    .page { height: calc(100vh - 1px); display: flex; align-items: flex-start; justify-content: center; break-after: page; }
    .page:last-child { break-after: auto; }
    img { display: block; width: ${width}; max-width: 100%; max-height: 100%; object-fit: contain; }
  `;
  doc.head.appendChild(style);
  const images = sources.map((src) => {
    const page = doc.createElement('div');
    page.className = 'page';
    const img = doc.createElement('img');
    img.src = src;
    page.appendChild(img);
    doc.body.appendChild(page);
    return img;
  });
  const win = frame.contentWindow!;
  win.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 0));
  // in case a browser never reports that printing finished
  setTimeout(() => frame.remove(), 5 * 60_000);
  // wait for every image (decode() can stall in a hidden frame, so use load events), at most 10 s
  const loaded = (img: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      if (img.complete) return resolve();
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
  Promise.race([Promise.all(images.map(loaded)), timeout]).then(() => {
    win.focus();
    win.print();
  });
}
