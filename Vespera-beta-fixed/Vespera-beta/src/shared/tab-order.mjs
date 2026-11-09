/**
 * Pure tab-strip ordering helpers, shared by the renderer and the test suite.
 * Keeping this logic DOM-free makes drag-and-drop behaviour reproducible.
 */

/** Fraction of a row's extent where a drop means "group with this tab". */
export const GROUP_ZONE = { start: 0.32, end: 0.68 };

/**
 * Decide what dropping at `coord` (pixels along the strip axis) should do.
 *
 * @param {{id:string,start:number,extent:number}[]} rows visible rows in visual order
 * @param {number} coord pointer position on the same axis
 * @param {{allowGroup?: boolean}} [options] allowGroup=false turns the centre "group" zone into plain reordering
 * @returns {{mode:'group',id:string}|{mode:'move',index:number}}
 *   For `move`, `index` is the insertion index expressed against `rows`
 *   *before* the dragged row is removed (use `clampedInsertion` to convert).
 */
export function computeDrop(rows, coord, { allowGroup = true } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { mode: 'move', index: 0 };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const extent = Math.max(1, Number(row.extent) || 0);
    if (coord < row.start) return { mode: 'move', index: i };
    const ratio = (coord - row.start) / extent;
    if (allowGroup) {
      if (ratio < GROUP_ZONE.start) return { mode: 'move', index: i };
      if (ratio <= GROUP_ZONE.end) return { mode: 'group', id: row.id };
    } else if (ratio < 0.5) {
      // Plain drags only reorder: the leading half inserts before, the trailing half after.
      return { mode: 'move', index: i };
    }
    if (i === rows.length - 1) return { mode: 'move', index: rows.length };
    // Trailing edge of a middle row: the next iteration resolves the exact slot.
  }
  return { mode: 'move', index: rows.length };
}

/**
 * Convert a pre-removal insertion index into the final splice index for
 * `fromId`, keeping pinned tabs inside the pinned section. The pinned
 * section is an invariant of the strip: pinned tabs always come first.
 *
 * @param {{id:string,pinned:boolean}[]} tabs current tab order
 * @param {string} fromId id of the tab being moved
 * @param {number} index insertion index before removal (0..tabs.length)
 * @returns {number} index to splice at after the tab has been removed
 */
export function clampedInsertion(tabs, fromId, index) {
  const fromIdx = tabs.findIndex((t) => t.id === fromId);
  if (fromIdx < 0) return tabs.length - 1 < 0 ? 0 : tabs.length;
  const from = tabs[fromIdx];
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  let ins = Math.max(0, Math.min(Number(index) || 0, tabs.length));
  if (ins > fromIdx) ins -= 1; // account for the removal shift
  if (from.pinned) ins = Math.min(ins, Math.max(0, pinnedCount - 1));
  else ins = Math.max(ins, pinnedCount);
  return Math.max(0, Math.min(ins, tabs.length - 1));
}

/**
 * Return a new array with `fromId` moved to `index` (pre-removal
 * coordinates, as produced by `computeDrop`), respecting pinned sections.
 */
export function moveTabTo(tabs, fromId, index) {
  const from = tabs.findIndex((t) => t.id === fromId);
  if (from < 0) return tabs.slice();
  const ins = clampedInsertion(tabs, fromId, index);
  const next = tabs.slice();
  const [item] = next.splice(from, 1);
  next.splice(ins, 0, item);
  return next;
}

/**
 * Return a new array with `fromId` placed directly after `toId`
 * (used when a drag drops a tab into a group).
 */
export function moveTabAfter(tabs, fromId, toId) {
  const from = tabs.findIndex((t) => t.id === fromId);
  if (from < 0 || fromId === toId) return tabs.slice();
  const next = tabs.slice();
  const [item] = next.splice(from, 1);
  const to = next.findIndex((t) => t.id === toId);
  if (to < 0) return tabs.slice();
  next.splice(to + 1, 0, item);
  return next;
}

/** Stable partition keeping pinned tabs first without reordering sections. */
export function pinnedFirst(tabs) {
  const pinned = tabs.filter((t) => t.pinned);
  const rest = tabs.filter((t) => !t.pinned);
  return [...pinned, ...rest];
}

/**
 * Move `id` to sit directly after the last tab of `groupId` (so a tab added to a group joins it visibly).
 * Pinned tabs stay in the pinned section. Returns a new array.
 */
export function moveIntoGroup(tabs, id, groupId) {
  const from = tabs.findIndex((t) => t.id === id);
  if (from < 0) return tabs.slice();
  const next = tabs.slice();
  const [item] = next.splice(from, 1);
  let last = -1;
  next.forEach((t, i) => { if (t.groupId === groupId) last = i; });
  if (last < 0) return tabs.slice();
  next.splice(last + 1, 0, item);
  return pinnedFirst(next);
}
