import { describe, expect, it } from 'vitest';
import { jsonEqual } from '../src/equal.js';

describe('jsonEqual', () => {
  it('compares primitives by value, numbers numerically', () => {
    expect(jsonEqual(1, 1.0)).toBe(true);
    expect(jsonEqual(0, -0)).toBe(true);
    expect(jsonEqual('a', 'a')).toBe(true);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual(1, '1')).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual(true, 1)).toBe(false);
  });

  it('compares arrays element-wise and objects by key set regardless of order', () => {
    expect(jsonEqual([1, [2, { a: 3 }]], [1, [2, { a: 3 }]])).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual([1], [1, 2])).toBe(false);
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual({}, [])).toBe(false);
  });

  it('does not treat inherited properties as members', () => {
    expect(jsonEqual({ constructor: 1 }, {})).toBe(false);
    expect(jsonEqual({}, { constructor: 1 })).toBe(false);
  });
});
