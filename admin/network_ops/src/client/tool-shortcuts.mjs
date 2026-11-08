export const WORLD_SLOTS = ['hand', 'certifier', 'toner', 'console'];
export const BENCH_SLOTS = ['hand', 'cutter', 'stripper', 'crimper', 'tester'];
export function toolShortcut(event, { mode, blocked, dragging, target }) {
  if (blocked || dragging || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return null;
  const match = /^(?:Digit|Numpad)([1-5])$/.exec(event.code);
  return match ? (mode === 'bench' ? BENCH_SLOTS : WORLD_SLOTS)[Number(match[1]) - 1] : null;
}
