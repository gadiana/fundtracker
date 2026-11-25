/**
 * Stops the page behind a dialog or the phone menu from scrolling. Every open one holds a lock,
 * and the page scrolls again once the last is released, whatever order they close in.
 */
let locks = 0;

export function lockScroll() {
  if (locks++ === 0) document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = '';
  };
}
