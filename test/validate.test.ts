import { describe, expect, it } from 'vitest';
import { SchemaError, validate } from '../src/index.js';

describe('validate', () => {
  it('constructs and validates in one call', () => {
    expect(validate({ type: 'string' }, 'a')).toEqual({ valid: true, errors: [] });
    expect(validate({ type: 'string' }, 1).valid).toBe(false);
  });

  it('passes options through', () => {
    expect(validate({ format: 'ipv4' }, 'x', { assertFormat: true }).valid).toBe(false);
    expect(validate({ $ref: 'http://a/s' }, 1, { schemas: { 'http://a/s': { type: 'string' } } }).valid).toBe(false);
  });

  it('throws SchemaError for an invalid schema', () => {
    expect(() => validate({ type: 1 }, 1)).toThrow(SchemaError);
  });
});
