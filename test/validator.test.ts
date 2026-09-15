import { describe, expect, it } from 'vitest';
import { SchemaError, Validator } from '../src/index.js';

function problemList(schema: unknown, options?: ConstructorParameters<typeof Validator>[1]): string[] {
  try {
    new Validator(schema, options);
  } catch (e) {
    if (e instanceof SchemaError) return e.errors.map((p) => `${p.schemaLocation}: ${p.message}`);
    throw e;
  }
  return [];
}

describe('Validator constructor', () => {
  it('rejects a schema that is not an object or boolean', () => {
    for (const bad of [null, [], 'x', undefined, 1]) {
      expect(() => new Validator(bad)).toThrow(SchemaError);
    }
  });

  it('accepts boolean schemas', () => {
    expect(new Validator(true).validate(1).valid).toBe(true);
    expect(new Validator(false).validate(1)).toEqual({
      valid: false,
      errors: [{ instanceLocation: '', keywordLocation: '', keyword: 'false', error: 'schema is false' }],
    });
  });

  it('reports every problem at once with a schema pointer', () => {
    const list = problemList({ type: 'strin', minimum: '1', required: 'name', properties: [], enum: {}, $ref: 3 });
    expect(list).toHaveLength(6);
    expect(list[0]).toMatch(/^#\/type: /);
    expect(list[5]).toMatch(/^#\/\$ref: /);
  });

  it('reports a non-schema in an in-place applicator as a SchemaError, alongside any cycle', () => {
    expect(problemList({ allOf: [[]] })).toEqual([expect.stringMatching(/^#\/allOf\/0: schema must be an object/)]);
    expect(problemList({ allOf: [[], { $ref: '#' }] })).toEqual([
      expect.stringMatching(/^#\/allOf\/0: /),
      expect.stringMatching(/^#\/allOf\/1\/\$ref: infinite recursion/),
    ]);
  });

  it('gives a schema object used at two locations a location each', () => {
    const shared = { type: 'string' };
    const v = new Validator({ $id: 'https://x/', properties: { a: shared, b: shared } });
    expect(v.validate({ b: 1 }).errors.map((e) => e.absoluteKeywordLocation)).toEqual([
      'https://x/#/properties/b/type',
    ]);
    expect(problemList({ properties: { a: { type: 1 }, b: { type: 1 } } })).toHaveLength(2);
    expect(problemList({ properties: { a: { $id: 'https://x/' }, b: { $id: 'https://x/' } } })).toEqual([
      '#/properties/b/$id: duplicate schema URI "https://x/"',
    ]);
  });

  it('rejects a schema object that contains itself', () => {
    const self: Record<string, unknown> = { type: 'object' };
    self['properties'] = { a: self };
    expect(problemList(self)).toEqual(['#/properties/a: schema object contains itself']);
  });

  it('rejects malformed regexes in pattern, patternProperties and treats u-flag as authoritative', () => {
    expect(problemList({ pattern: '(' })).toEqual([
      expect.stringMatching(/^#\/pattern: pattern is not a valid ECMA-262 regex/),
    ]);
    expect(problemList({ patternProperties: { '[': {} } })).toEqual([
      expect.stringMatching(/^#\/patternProperties\/\[: /),
    ]);
    expect(problemList({ pattern: '\\a' })).toHaveLength(1); // valid without u, invalid with u
  });

  it('rejects unresolvable $ref by pointer, anchor and external URI', () => {
    expect(problemList({ $ref: '#/$defs/missing' })).toEqual([
      '#/$ref: $ref "#/$defs/missing" cannot be resolved (#/$defs/missing)',
    ]);
    expect(problemList({ $ref: '#nope' })).toHaveLength(1);
    expect(problemList({ $ref: 'http://x.example/y' })).toEqual([expect.stringContaining('http://x.example/y')]);
    expect(problemList({ $ref: 'address.json' })).toEqual([
      '#/$ref: $ref "address.json" is relative but the schema has no base URI',
    ]);
  });

  it('resolves $ref to embedded $id, relative refs against the nearest $id, and refs under unknown keywords', () => {
    const v = new Validator({
      $id: 'http://ex/root.json',
      properties: {
        a: { $ref: 'http://ex/embedded' },
        b: { $ref: 'sub/x.json' },
        c: { $ref: '#/custom/inner' },
      },
      $defs: {
        e: { $id: 'http://ex/embedded', type: 'string' },
        s: { $id: 'sub/x.json', type: 'number', $defs: { deep: { $ref: '#/$defs/local' }, local: { type: 'null' } } },
      },
      custom: { inner: { type: 'boolean' } },
    });
    expect(v.validate({ a: 's', b: 1, c: true }).valid).toBe(true);
    expect(v.validate({ a: 1, b: 's', c: 1 }).errors.map((e) => e.absoluteKeywordLocation)).toEqual([
      'http://ex/embedded#/type',
      'http://ex/sub/x.json#/type',
      'http://ex/root.json#/custom/inner/type',
    ]);
  });

  it('rejects a ref target under an unknown keyword that is not a schema', () => {
    expect(problemList({ $ref: '#/custom', custom: 3 })).toEqual([expect.stringContaining('cannot be resolved')]);
    expect(problemList({ $ref: '#/custom', custom: { type: 1 } })).toEqual([
      expect.stringMatching(/^#\/custom\/type: /),
    ]);
  });

  it('rejects bad $id values', () => {
    expect(problemList({ $id: 'http://a/x#frag' })).toEqual(['#/$id: $id must not contain a fragment (use $anchor)']);
    expect(problemList({ $id: 'rel' })).toEqual([expect.stringContaining('does not resolve to an absolute URI')]);
    expect(problemList({ $id: 'http://a/', $defs: { x: { $id: 'http://a/' } } })).toEqual([
      'http://a/#/$defs/x/$id: duplicate schema URI "http://a/"',
    ]);
    expect(problemList({ $id: 1 })).toEqual(['#/$id: $id must be a valid URI-reference']);
  });

  it('resolves a relative root $id against the schemas key it is registered under', () => {
    const doc = { $id: 'child.json', type: 'string' };
    const v = new Validator({ $ref: 'http://ex/dir/child.json' }, { schemas: { 'http://ex/dir/parent.json': doc } });
    expect(v.validate(1).valid).toBe(false);
  });

  it('rejects duplicate and malformed anchors', () => {
    expect(problemList({ $id: 'http://a/', $defs: { x: { $anchor: 'q' }, y: { $dynamicAnchor: 'q' } } })).toEqual([
      'http://a/#/$defs/y/$dynamicAnchor: $dynamicAnchor "q" is already defined in http://a/',
    ]);
    expect(problemList({ $anchor: '1bad' })).toHaveLength(1);
    expect(problemList({ $anchor: 'ok-1._x' })).toEqual([]);
  });

  it('checks documents in schemas: keys must be absolute, documents must be valid, unreferenced is fine', () => {
    expect(problemList({}, { schemas: { relative: {} } })).toEqual([
      'relative#: schemas key "relative" is not an absolute URI',
    ]);
    expect(problemList({}, { schemas: { 'http://a/': { type: 1 } } })).toEqual([
      'http://a/#/type: type must be a type name or array of type names',
    ]);
    expect(problemList({}, { schemas: { 'http://a/': { type: 'string' } } })).toEqual([]);
    expect(problemList({}, { schemas: { 'http://a/': { $id: 'http://b/' }, 'http://b/': {} } })).toEqual([
      expect.stringContaining('duplicate schema URI "http://b/"'),
    ]);
  });

  it('allows a document without $id to be referenced by its key, and boolean documents', () => {
    const v = new Validator(
      { $ref: 'http://a/int.json' },
      { schemas: { 'http://a/int.json': { type: 'integer' }, 'http://a/no': false } },
    );
    expect(v.validate(1.5).valid).toBe(false);
    expect(new Validator({ $ref: 'http://a/no' }, { schemas: { 'http://a/no': false } }).validate(1).valid).toBe(false);
  });

  it('restricts $schema to 2020-12 at resource roots and ignores $vocabulary there only', () => {
    expect(problemList({ $schema: 'https://json-schema.org/draft/2020-12/schema#' })).toEqual([]);
    expect(problemList({ $schema: 'http://json-schema.org/draft-07/schema#' })).toEqual([
      expect.stringContaining('only https://json-schema.org/draft/2020-12/schema is'),
    ]);
    expect(problemList({ properties: { a: { $schema: 'https://json-schema.org/draft/2020-12/schema' } } })).toEqual([
      '#/properties/a/$schema: $schema is only allowed at the root of a schema resource',
    ]);
    expect(
      problemList({ properties: { a: { $id: 'http://x/', $schema: 'https://json-schema.org/draft/2020-12/schema' } } }),
    ).toEqual([]);
    expect(problemList({ $vocabulary: { 'http://v': true }, properties: { a: { $vocabulary: {} } } })).toEqual([
      '#/properties/a/$vocabulary: $vocabulary is only allowed at the root of a schema resource',
    ]);
    expect(problemList({ $vocabulary: { 'http://v': 'yes' } })).toHaveLength(1);
  });

  it('detects infinite recursion through in-place applicators only', () => {
    expect(problemList({ allOf: [{ $ref: '#' }] })).toEqual([
      '#/allOf/0/$ref: infinite recursion: $ref refers back to a schema that is still being applied',
    ]);
    expect(
      problemList({ $ref: '#/$defs/a', $defs: { a: { $ref: '#/$defs/b' }, b: { not: { $ref: '#/$defs/a' } } } }),
    ).toHaveLength(1);
    expect(problemList({ if: { $ref: '#' } })).toHaveLength(1);
    expect(problemList({ dependentSchemas: { a: { $ref: '#' } } })).toHaveLength(1);
    expect(problemList({ $ref: '#/$defs/a', $defs: { a: { $dynamicRef: '#/$defs/a' } } })).toHaveLength(1);
    expect(
      problemList({
        properties: { a: { $ref: '#' } },
        patternProperties: { a: { $ref: '#' } },
        additionalProperties: { $ref: '#' },
      }),
    ).toEqual([]);
    expect(
      problemList({
        items: { $ref: '#' },
        contains: { $ref: '#' },
        unevaluatedItems: { $ref: '#' },
        propertyNames: { $ref: '#' },
      }),
    ).toEqual([]);
  });

  it('applies the numeric and array keyword shape rules', () => {
    expect(problemList({ multipleOf: 0 })).toHaveLength(1);
    expect(problemList({ multipleOf: -1 })).toHaveLength(1);
    expect(problemList({ minLength: -1, maxItems: 1.5, minContains: 'x' })).toHaveLength(3);
    expect(problemList({ minLength: 1.0, minContains: 0, maxContains: 2, then: {}, else: {} })).toEqual([]);
    expect(problemList({ minimum: 5, maximum: 1, minLength: 5, maxLength: 1 })).toEqual([]);
    expect(problemList({ type: [] })).toHaveLength(1);
    expect(problemList({ type: ['string', 'string'] })).toHaveLength(1);
    expect(problemList({ type: ['string', 'any'] })).toHaveLength(1);
    expect(problemList({ allOf: [], anyOf: [], oneOf: [], prefixItems: [] })).toHaveLength(4);
    expect(problemList({ items: [{}] })).toEqual([expect.stringContaining('prefixItems')]);
    expect(problemList({ enum: [] })).toEqual([]);
    expect(problemList({ enum: [1, 1] })).toEqual([]);
    expect(problemList({ required: ['a', 'a'] })).toHaveLength(1);
    expect(problemList({ dependentRequired: { a: ['b', 'b'] } })).toHaveLength(1);
    expect(problemList({ dependentRequired: { a: 'b' } })).toHaveLength(1);
    expect(problemList({ uniqueItems: 'yes' })).toHaveLength(1);
  });

  it('type-checks annotation keywords and ignores unknown and legacy keywords', () => {
    expect(
      problemList({
        title: 1,
        description: 1,
        $comment: 1,
        deprecated: 'no',
        readOnly: 1,
        writeOnly: 1,
        examples: {},
        contentSchema: 3,
      }),
    ).toHaveLength(8);
    expect(problemList({ contentEncoding: 1, contentMediaType: 1, format: 1 })).toHaveLength(3);
    expect(problemList({ default: 'anything', title: 't', examples: [1], contentSchema: { type: 'string' } })).toEqual(
      [],
    );
    expect(
      problemList({ definitions: 3, dependencies: 3, additionalItems: 3, $recursiveRef: 3, id: 3, whatever: [1] }),
    ).toEqual([]);
    expect(problemList({ $ref: '#/definitions/a', definitions: { a: { type: 'string' } } })).toEqual([]);
  });

  it('treats a __proto__ key in the schema as an unknown keyword', () => {
    const schema = JSON.parse('{"__proto__": {"type": 1}, "type": "string"}') as unknown;
    expect(problemList(schema)).toEqual([]);
    expect(({} as Record<string, unknown>).type).toBeUndefined();
  });

  it('bundles the 2020-12 meta-schema so it can be referenced without being passed in', () => {
    const v = new Validator({ $ref: 'https://json-schema.org/draft/2020-12/schema' });
    expect(v.validate({ type: 'string' }).valid).toBe(true);
    expect(v.validate({ type: 12 }).valid).toBe(false);
    expect(
      new Validator({ $ref: 'https://json-schema.org/draft/2020-12/meta/validation' }).validate({ minimum: 'x' }).valid,
    ).toBe(false);
  });

  it('does not apply the meta-schema automatically', () => {
    expect(
      problemList({ $schema: 'https://json-schema.org/draft/2020-12/schema', unknownKeywordWithBadValue: NaN }),
    ).toEqual([]);
  });

  it('exposes the root schema as given', () => {
    const schema = { type: 'string' };
    expect(new Validator(schema).schema).toBe(schema);
  });
});

describe('Validator.validate', () => {
  it('returns every failing keyword in document order with basic-output fields', () => {
    const v = new Validator({ type: 'string', minLength: 3, pattern: '^a' });
    expect(v.validate('bb')).toEqual({
      valid: false,
      errors: [
        {
          instanceLocation: '',
          keywordLocation: '/minLength',
          keyword: 'minLength',
          error: 'must be at least 3 characters',
        },
        { instanceLocation: '', keywordLocation: '/pattern', keyword: 'pattern', error: 'must match pattern ^a' },
      ],
    });
    expect(v.validate('abc')).toEqual({ valid: true, errors: [] });
  });

  it('includes absoluteKeywordLocation only when the resource has a URI, and follows $ref hops', () => {
    const v = new Validator({
      $id: 'http://ex/s',
      properties: { a: { $ref: '#/$defs/t' } },
      $defs: { t: { type: 'string' } },
    });
    expect(v.validate({ a: 1 }).errors).toEqual([
      {
        instanceLocation: '/a',
        keywordLocation: '/properties/a/$ref/type',
        absoluteKeywordLocation: 'http://ex/s#/$defs/t/type',
        keyword: 'type',
        error: 'expected string, got number',
      },
    ]);
    expect(new Validator({ type: 'string' }).validate(1).errors[0]).not.toHaveProperty('absoluteKeywordLocation');
  });

  it('reports non-JSON values as a type failure at their location instead of throwing', () => {
    const v = new Validator({ properties: { a: { type: 'number' } }, items: { type: 'number' } });
    for (const bad of [undefined, () => 1, Symbol('s'), 10n, NaN, Infinity, -Infinity]) {
      expect(v.validate(bad).errors).toEqual([
        { instanceLocation: '', keywordLocation: '/type', keyword: 'type', error: 'instance is not a JSON value' },
      ]);
      expect(v.validate({ a: bad }).errors[0]!.instanceLocation).toBe('/a');
    }
    const holey = [1];
    holey[2] = 3;
    expect(v.validate(holey).errors[0]!.instanceLocation).toBe('/1');
  });

  it('treats non-plain objects as objects with their own enumerable keys', () => {
    const v = new Validator({ type: 'object', minProperties: 1 });
    expect(v.validate(new Date()).valid).toBe(false);
    expect(v.validate(new Map([['a', 1]])).valid).toBe(false);
    expect(v.validate(Object.assign(Object.create(null), { a: 1 })).valid).toBe(true);
    class Point {
      x = 1;
    }
    expect(v.validate(new Point()).valid).toBe(true);
  });

  it('handles numeric edge cases', () => {
    expect(new Validator({ const: 0 }).validate(-0).valid).toBe(true);
    expect(new Validator({ type: 'integer' }).validate(1.0).valid).toBe(true);
    expect(new Validator({ type: 'integer' }).validate(1e300).valid).toBe(true);
    expect(new Validator({ type: 'integer' }).validate(1.5).valid).toBe(false);
    expect(new Validator({ multipleOf: 0.01 }).validate(0.07).valid).toBe(true);
    expect(new Validator({ multipleOf: 0.1 }).validate(0.3).valid).toBe(true);
    expect(new Validator({ multipleOf: 1e-308 }).validate(1e308).valid).toBe(false);
    expect(new Validator({ multipleOf: 0.0001 }).validate(0.00751).valid).toBe(false);
  });

  it('counts string length in code points', () => {
    expect(new Validator({ maxLength: 2 }).validate('💩💩').valid).toBe(true);
    expect(new Validator({ minLength: 3 }).validate('💩💩').valid).toBe(false);
  });

  it('reports anyOf/oneOf/not/if-then-else as the plan describes', () => {
    const anyOf = new Validator({ anyOf: [{ type: 'string' }, { type: 'number' }] }).validate(null).errors;
    expect(anyOf.map((e) => e.keywordLocation)).toEqual(['/anyOf', '/anyOf/0/type', '/anyOf/1/type']);
    const oneOf = new Validator({ oneOf: [{ type: 'number' }, { type: 'integer' }] });
    expect(oneOf.validate(1).errors).toEqual([
      {
        instanceLocation: '',
        keywordLocation: '/oneOf',
        keyword: 'oneOf',
        error: 'must match exactly one schema, matched 2',
      },
    ]);
    expect(oneOf.validate('x').errors.map((e) => e.keyword)).toEqual(['oneOf', 'type', 'type']);
    expect(new Validator({ not: { type: 'string' } }).validate('x').errors).toEqual([
      { instanceLocation: '', keywordLocation: '/not', keyword: 'not', error: 'must not match the schema' },
    ]);
    const ite = new Validator({ if: { type: 'string' }, then: { minLength: 2 }, else: { minimum: 2 } });
    expect(ite.validate('a').errors.map((e) => e.keywordLocation)).toEqual(['/then/minLength']);
    expect(ite.validate(1).errors.map((e) => e.keywordLocation)).toEqual(['/else/minimum']);
    expect(ite.validate('ab').valid).toBe(true);
  });

  it('reports one error per disallowed property or item for false subschemas', () => {
    const v = new Validator({ properties: { a: {} }, unevaluatedProperties: false });
    expect(v.validate({ a: 1, b: 2, c: 3 }).errors).toEqual([
      {
        instanceLocation: '/b',
        keywordLocation: '/unevaluatedProperties',
        keyword: 'unevaluatedProperties',
        error: 'property "b" is not allowed',
      },
      {
        instanceLocation: '/c',
        keywordLocation: '/unevaluatedProperties',
        keyword: 'unevaluatedProperties',
        error: 'property "c" is not allowed',
      },
    ]);
    expect(new Validator({ additionalProperties: false }).validate({ x: 1 }).errors[0]!.keyword).toBe(
      'additionalProperties',
    );
    expect(new Validator({ prefixItems: [{}], items: false }).validate([1, 2]).errors).toEqual([
      { instanceLocation: '/1', keywordLocation: '/items', keyword: 'items', error: 'item 1 is not allowed' },
    ]);
    expect(new Validator({ unevaluatedItems: false }).validate([1]).errors[0]!.keyword).toBe('unevaluatedItems');
    expect(
      new Validator({ $id: 'http://x/', additionalProperties: false }).validate({ a: 1 }).errors[0]!
        .absoluteKeywordLocation,
    ).toBe('http://x/#/additionalProperties');
  });

  it('reports contains, minContains and maxContains', () => {
    expect(new Validator({ contains: { type: 'string' } }).validate([]).errors[0]!.keyword).toBe('contains');
    expect(new Validator({ contains: { type: 'string' }, minContains: 0 }).validate([]).valid).toBe(true);
    expect(new Validator({ contains: { type: 'string' }, minContains: 2 }).validate(['a']).errors[0]!.keyword).toBe(
      'minContains',
    );
    expect(
      new Validator({ contains: { type: 'string' }, maxContains: 1 }).validate(['a', 'b']).errors[0]!.keyword,
    ).toBe('maxContains');
  });

  it('names the key in propertyNames errors and keeps instanceLocation on the object', () => {
    const errors = new Validator({ propertyNames: { maxLength: 1 } }).validate({ ab: 1 }).errors;
    expect(errors[0]).toEqual({
      instanceLocation: '',
      keywordLocation: '/propertyNames',
      keyword: 'propertyNames',
      error: 'property name "ab" is invalid',
    });
    expect(errors[1]!.keywordLocation).toBe('/propertyNames/maxLength');
  });

  it('uses JSON equality for const, enum and uniqueItems', () => {
    expect(new Validator({ uniqueItems: true }).validate([1, 1.0]).valid).toBe(false);
    expect(
      new Validator({ uniqueItems: true }).validate([
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ]).valid,
    ).toBe(false);
    expect(new Validator({ enum: [{ a: [1] }] }).validate({ a: [1] }).valid).toBe(true);
    expect(new Validator({ const: 'x' }).validate('y').errors[0]!.error).toBe('must equal "x"');
  });

  it('keeps required and property lookups own-property only', () => {
    expect(new Validator({ required: ['constructor', '__proto__'] }).validate({}).errors).toHaveLength(2);
    expect(new Validator({ properties: { constructor: { type: 'string' } } }).validate({}).valid).toBe(true);
    expect(new Validator({ dependentRequired: { toString: ['x'] } }).validate({}).valid).toBe(true);
  });

  it('asserts format only when assertFormat is set, only on strings, and ignores unknown formats', () => {
    expect(new Validator({ format: 'email' }).validate('nope').valid).toBe(true);
    const strict = new Validator({ format: 'email' }, { assertFormat: true });
    expect(strict.validate('nope').errors[0]!.error).toBe('must be a valid email');
    expect(strict.validate(1).valid).toBe(true);
    expect(new Validator({ format: 'made-up' }, { assertFormat: true }).validate('x').valid).toBe(true);
  });

  it('falls back to the static target when $dynamicRef has no bookending anchor', () => {
    const v = new Validator({
      $id: 'http://ex/root',
      $dynamicAnchor: 'node',
      $ref: 'http://ex/list',
      $defs: {
        list: { $id: 'http://ex/list', items: { $dynamicRef: 'http://ex/plain#plain' } },
        plain: { $id: 'http://ex/plain', $anchor: 'plain', type: 'string' },
      },
    });
    expect(v.validate(['a']).valid).toBe(true);
    expect(v.validate([1]).valid).toBe(false);
  });

  it('is safe to use concurrently and produces stable error order', () => {
    const v = new Validator({ properties: { a: { type: 'string' } }, required: ['b'] });
    const first = v.validate({ a: 1 });
    const second = v.validate({ a: 1 });
    expect(first).toEqual(second);
    expect(first.errors.map((e) => e.keyword)).toEqual(['required', 'type']);
  });

  it('escapes JSON pointer tokens in locations', () => {
    const v = new Validator({ properties: { 'a/b': { type: 'string' }, 'c~d': { type: 'string' } } });
    expect(v.validate({ 'a/b': 1, 'c~d': 1 }).errors.map((e) => [e.instanceLocation, e.keywordLocation])).toEqual([
      ['/a~1b', '/properties/a~1b/type'],
      ['/c~0d', '/properties/c~0d/type'],
    ]);
  });

  it('surfaces a RangeError for a cycle that only exists after dynamic-scope resolution', () => {
    const v = new Validator({
      $id: 'http://ex/outer',
      $dynamicAnchor: 'x',
      allOf: [{ $ref: 'http://ex/inner' }],
      $defs: {
        inner: { $id: 'http://ex/inner', $defs: { loop: { $dynamicAnchor: 'x' } }, allOf: [{ $dynamicRef: '#x' }] },
      },
    });
    expect(() => v.validate(1)).toThrow(RangeError);
  });
});
