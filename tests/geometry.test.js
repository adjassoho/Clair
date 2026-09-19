import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRect } from '../extension/geometry.js';

test('normalizeRect handles normal selection without viewport scaling', () => {
  const result = normalizeRect({ x: 100, y: 50, width: 640, height: 360 }, 1920, 1080);
  assert.deepEqual(result, { x: 100, y: 50, width: 640, height: 360 });
});

test('normalizeRect scales viewport coordinates to video resolution', () => {
  const selected = { x: 100, y: 50, width: 400, height: 200, viewportWidth: 1000, viewportHeight: 500 };
  const result = normalizeRect(selected, 2000, 1000);
  assert.deepEqual(result, { x: 200, y: 100, width: 800, height: 400 });
});

test('normalizeRect normalizes inverted drag (negative width / height)', () => {
  const result = normalizeRect({ x: 500, y: 400, width: -200, height: -100 }, 1920, 1080);
  assert.deepEqual(result, { x: 300, y: 300, width: 200, height: 100 });
});

test('normalizeRect enforces even dimensions for video codecs', () => {
  const result = normalizeRect({ x: 10, y: 10, width: 101, height: 99 }, 1920, 1080);
  assert.equal(result.width % 2, 0);
  assert.equal(result.height % 2, 0);
  assert.deepEqual(result, { x: 10, y: 10, width: 100, height: 98 });
});

test('normalizeRect clamps selection overflowing video boundaries', () => {
  const result = normalizeRect({ x: 1800, y: 1000, width: 300, height: 200 }, 1920, 1080);
  assert.equal(result.x + result.width <= 1920, true);
  assert.equal(result.y + result.height <= 1080, true);
  assert.equal(result.width % 2, 0);
  assert.equal(result.height % 2, 0);
});

test('normalizeRect throws on invalid inputs or out of bounds', () => {
  assert.throws(() => normalizeRect(null, 1920, 1080), /objet/);
  assert.throws(() => normalizeRect({}, 0, 1080), /invalides/);
  assert.throws(() => normalizeRect({ x: 'a', y: 0, width: 100, height: 100 }, 1920, 1080), /nombres finis/);
  assert.throws(() => normalizeRect({ x: 2000, y: 2000, width: 100, height: 100 }, 1920, 1080), /en dehors/);
  assert.throws(() => normalizeRect({ x: 10, y: 10, width: 4, height: 4 }, 1920, 1080), /trop petite/);
});
