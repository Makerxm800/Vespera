import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDrop, clampedInsertion, moveTabTo, moveTabAfter, moveIntoGroup, moveGroupRelative, pinnedFirst } from '../src/shared/tab-order.mjs';

const row = (id, start, extent) => ({ id, start, extent });
const rows3 = [row('a', 0, 100), row('b', 100, 100), row('c', 200, 100)];

test('computeDrop: left edge inserts before the row', () => {
  assert.deepEqual(computeDrop(rows3, 10), { mode: 'move', index: 0 });
  assert.deepEqual(computeDrop(rows3, 105), { mode: 'move', index: 1 });
  assert.deepEqual(computeDrop(rows3, 210), { mode: 'move', index: 2 });
});

test('computeDrop: centre of a row groups with that row', () => {
  assert.deepEqual(computeDrop(rows3, 50), { mode: 'group', id: 'a' });
  assert.deepEqual(computeDrop(rows3, 150), { mode: 'group', id: 'b' });
  assert.deepEqual(computeDrop(rows3, 250), { mode: 'group', id: 'c' });
});

test('computeDrop: right edge of the last row appends', () => {
  assert.deepEqual(computeDrop(rows3, 295), { mode: 'move', index: 3 });
  assert.deepEqual(computeDrop(rows3, 500), { mode: 'move', index: 3 });
});

test('computeDrop: before the first row and on an empty strip', () => {
  assert.deepEqual(computeDrop([row('a', 40, 100)], 5), { mode: 'move', index: 0 });
  assert.deepEqual(computeDrop([], 999), { mode: 'move', index: 0 });
});

const tabs = (spec) => spec.map(([id, pinned]) => ({ id, pinned }));

test('clampedInsertion converts pre-removal indexes to splice positions', () => {
  const list = tabs([['a', false], ['b', false], ['c', false]]);
  // Move 'a' after 'c' (pre-removal index 3) -> splice at 2.
  assert.equal(clampedInsertion(list, 'a', 3), 2);
  // Move 'c' before 'a' (index 0) -> splice at 0.
  assert.equal(clampedInsertion(list, 'c', 0), 0);
  // Out-of-range indexes are clamped.
  assert.equal(clampedInsertion(list, 'a', 99), 2);
  assert.equal(clampedInsertion(list, 'c', -5), 0);
});

test('clampedInsertion keeps pinned and unpinned sections separate', () => {
  const list = tabs([['p1', true], ['p2', true], ['n1', false], ['n2', false]]);
  // Dragging an unpinned tab to the very front still lands after the pins.
  assert.equal(clampedInsertion(list, 'n2', 0), 2);
  // Dragging a pinned tab to the very end still lands inside the pins.
  assert.equal(clampedInsertion(list, 'p1', 4), 1);
});

test('moveTabTo reorders without off-by-one drift', () => {
  const list = tabs([['a', false], ['b', false], ['c', false]]);
  assert.deepEqual(moveTabTo(list, 'a', 3).map((t) => t.id), ['b', 'c', 'a']);
  assert.deepEqual(moveTabTo(list, 'c', 0).map((t) => t.id), ['c', 'a', 'b']);
  assert.deepEqual(moveTabTo(list, 'b', 1).map((t) => t.id), ['a', 'b', 'c']);
  // Unknown ids leave the list untouched.
  assert.deepEqual(moveTabTo(list, 'zz', 0).map((t) => t.id), ['a', 'b', 'c']);
});

test('moveTabAfter places a tab directly behind its group target', () => {
  const list = tabs([['a', false], ['b', false], ['c', false], ['d', false]]);
  assert.deepEqual(moveTabAfter(list, 'd', 'a').map((t) => t.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveTabAfter(list, 'a', 'd').map((t) => t.id), ['b', 'c', 'd', 'a']);
});

test('pinnedFirst is a stable partition', () => {
  const list = tabs([['n1', false], ['p1', true], ['n2', false], ['p2', true]]);
  assert.deepEqual(pinnedFirst(list).map((t) => t.id), ['p1', 'p2', 'n1', 'n2']);
});

test('computeDrop without grouping only reorders: leading half before, trailing half after', () => {
  const opts = { allowGroup: false };
  assert.deepEqual(computeDrop(rows3, 140, opts), { mode: 'move', index: 1 });
  assert.deepEqual(computeDrop(rows3, 160, opts), { mode: 'move', index: 2 });
  assert.deepEqual(computeDrop(rows3, 290, opts), { mode: 'move', index: 3 });
  assert.deepEqual(computeDrop(rows3, 5, opts), { mode: 'move', index: 0 });
  for (let x = 0; x < 300; x += 7) assert.equal(computeDrop(rows3, x, opts).mode, 'move');
});

test('moveIntoGroup puts a tab right after the last tab of the group and keeps pins first', () => {
  const list = [{ id: 'p', pinned: true }, { id: 'a', groupId: 'g' }, { id: 'x' }, { id: 'b', groupId: 'g' }, { id: 'y' }];
  assert.deepEqual(moveIntoGroup(list, 'y', 'g').map((t) => t.id), ['p', 'a', 'x', 'b', 'y']);
  assert.deepEqual(moveIntoGroup(list, 'x', 'g').map((t) => t.id), ['p', 'a', 'b', 'x', 'y']);
  assert.deepEqual(moveIntoGroup(list, 'x', 'missing').map((t) => t.id), ['p', 'a', 'x', 'b', 'y']);
});

test('moveGroupRelative moves every group member as one block and keeps pinned tabs first', () => {
  const list = [
    { id: 'p', pinned: true }, { id: 'a1', groupId: 'a' }, { id: 'a2', groupId: 'a' },
    { id: 'loose' }, { id: 'b1', groupId: 'b' }, { id: 'b2', groupId: 'b' }, { id: 'tail' },
  ];
  assert.deepEqual(moveGroupRelative(list, 'a', 'b', true).map((t) => t.id), [
    'p', 'loose', 'b1', 'b2', 'a1', 'a2', 'tail',
  ]);
  // A member tab resolves to its whole group, not an insertion inside it.
  assert.deepEqual(moveGroupRelative(list, 'b', 'a2', false).map((t) => t.id), [
    'p', 'b1', 'b2', 'a1', 'a2', 'loose', 'tail',
  ]);
});

test('moveGroupRelative can place a group around ungrouped tabs and safely ignores no-op targets', () => {
  const list = [{ id: 'a', groupId: 'g1' }, { id: 'x' }, { id: 'b', groupId: 'g2' }, { id: 'y' }];
  assert.deepEqual(moveGroupRelative(list, 'g1', 'x', true).map((t) => t.id), ['x', 'a', 'b', 'y']);
  assert.deepEqual(moveGroupRelative(list, 'g1', 'missing').map((t) => t.id), list.map((t) => t.id));
  assert.deepEqual(moveGroupRelative(list, 'g1', 'a').map((t) => t.id), list.map((t) => t.id));
});
