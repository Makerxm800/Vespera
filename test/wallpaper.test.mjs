import test from 'node:test';
import assert from 'node:assert/strict';
import { clampAdjust } from '../src/shared/wallpaper-adjust.mjs';

test('clampAdjust supplies finite defaults for missing, invalid, or null values', () => {
  assert.deepEqual(clampAdjust(), { zoom: 1, x: 50, y: 50, blur: 0, brightness: 100, saturation: 100 });
  assert.deepEqual(clampAdjust(null), { zoom: 1, x: 50, y: 50, blur: 0, brightness: 100, saturation: 100 });
  assert.deepEqual(clampAdjust({ x: null, y: '', blur: NaN, brightness: Infinity, saturation: undefined }), {
    zoom: 1, x: 50, y: 50, blur: 0, brightness: 100, saturation: 100,
  });
});

test('clampAdjust keeps every wallpaper adjustment inside its supported range', () => {
  assert.deepEqual(clampAdjust({ zoom: 9, x: -10, y: 140, blur: 90, brightness: 5, saturation: 250 }), {
    zoom: 4, x: 0, y: 100, blur: 40, brightness: 25, saturation: 200,
  });
});
