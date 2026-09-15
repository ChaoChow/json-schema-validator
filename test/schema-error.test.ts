import { describe, expect, it } from 'vitest';
import { SchemaError } from '../src/index.js';

describe('SchemaError', () => {
  it('is an Error named SchemaError carrying every problem', () => {
    const e = new SchemaError([
      { schemaLocation: '#/type', message: 'type must be a type name' },
      { schemaLocation: 'http://a/#/$ref', message: 'unresolvable' },
    ]);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('SchemaError');
    expect(e.errors).toHaveLength(2);
    expect(e.message).toBe(
      'invalid schema (2 problems):\n  #/type: type must be a type name\n  http://a/#/$ref: unresolvable',
    );
  });

  it('uses the singular for one problem', () => {
    expect(new SchemaError([{ schemaLocation: '#', message: 'm' }]).message).toBe(
      'invalid schema (1 problem):\n  #: m',
    );
  });
});
