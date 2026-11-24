/**
 * The digital receipt (ReceiptCard) as an image or PDF. Used by the staff receipt page and by
 * the public QR page's payment history.
 */

/**
 * The card as a PNG. The card is centered with auto margins; those must be dropped in the
 * copy, or the image comes out shifted to one side and cut off.
 */
export async function receiptPng(el: HTMLElement) {
  const { toPng } = await import('html-to-image');
  return toPng(el, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true,
    width: el.offsetWidth,
    height: el.offsetHeight,
    style: { margin: '0', boxShadow: 'none' },
  });
}

export async function downloadReceiptPng(el: HTMLElement, transactionNo: string) {
  const a = document.createElement('a');
  a.href = await receiptPng(el);
  a.download = `receipt-${transactionNo}.png`;
  a.click();
}

export async function downloadReceiptPdf(el: HTMLElement, transactionNo: string) {
  const [png, { jsPDF }] = await Promise.all([receiptPng(el), import('jspdf')]);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const pdf = new jsPDF({ unit: 'px', format: [w, h], orientation: h >= w ? 'portrait' : 'landscape', hotfixes: ['px_scaling'] });
  // compressed, otherwise one receipt is a 4 MB file
  pdf.addImage(png, 'PNG', 0, 0, w, h, undefined, 'FAST');
  pdf.save(`receipt-${transactionNo}.pdf`);
}
