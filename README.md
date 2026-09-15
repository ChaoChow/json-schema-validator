# @chaochow/json-schema-validator

Zero-dependency JSON Schema **2020-12** validator that is fast at both loading a JSON Schema and validating against
it — built for code that handles many JSON Schemas but validates each one only a few times (config files,
per-tenant request schemas, CLI input, tests).

- Fastest load + validate of the compared libraries: 1.5× cfworker, 30× zod, ~5,000× ajv — see
  [Size and speed](#size-and-speed)
- Zero runtime dependencies, 90 kB unpacked, ESM, Node ≥ 16.9
- Full 2020-12 core + validation vocabularies: `$ref`, `$dynamicRef`/`$dynamicAnchor`,
  `unevaluatedProperties`/`unevaluatedItems`
- Passes every required test of the official
  [JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) for 2020-12, plus every
  `optional/format/*` test
- Broken schemas fail at construction with a `SchemaError` listing every problem and its location
- `validate()` never throws and reports every failing keyword (no short-circuit) with the spec's "basic" output fields
- All 19 formats named by the 2020-12 spec, opt-in via `assertFormat: true`
- Bundles the 2020-12 meta-schema and its vocabulary meta-schemas, so `$ref`s to them resolve offline
- No code generation, no `new Function`, no network — safe under CSP
- Written in TypeScript, ships type declarations
- No mutable state between `validate()` calls — safe for concurrent use

## Install

```sh
npm install @chaochow/json-schema-validator
```

Requires Node ≥ 16.9. ESM only.

## Usage

```ts
import { Validator, validate, SchemaError } from '@chaochow/json-schema-validator';

const schema = {
  $id: 'https://example.com/person',
  type: 'object',
  properties: { name: { type: 'string' }, age: { type: 'integer', minimum: 0 } },
  required: ['name'],
};

// One-shot: check the schema, validate the instance, done. This is the case the package is built for —
// schema load + one validation is the fastest of the compared libraries (see Size and speed).
validate(schema, { name: 'Ada', age: 36 });
// { valid: true, errors: [] }

// Reuse: construct once when the same schema is validated more than a few times.
const validator = new Validator(schema);

validator.validate({ age: -1 });
// {
//   valid: false,
//   errors: [
//     { instanceLocation: '', keywordLocation: '/required', absoluteKeywordLocation: 'https://example.com/person#/required',
//       keyword: 'required', error: 'missing required property "name"' },
//     { instanceLocation: '/age', keywordLocation: '/properties/age/minimum', absoluteKeywordLocation: 'https://example.com/person#/properties/age/minimum',
//       keyword: 'minimum', error: 'must be >= 0' },
//   ],
// }

// validate(schema, instance, options) is new Validator(schema, options).validate(instance)

// A broken schema fails at construction, listing every problem
try {
  new Validator({ type: 'strin', minimum: '1' });
} catch (e) {
  if (e instanceof SchemaError) console.log(e.errors);
  // [ { schemaLocation: '#/type', message: 'type must be a type name or array of type names' },
  //   { schemaLocation: '#/minimum', message: 'minimum must be a number' } ]
}
```

### Options

```ts
new Validator(schema, {
  // Extra documents keyed by retrieval URI (must be absolute). A document needs no $id to be referenced by
  // its key; a relative root $id resolves against the key. Every document is checked, referenced or not.
  schemas: { 'https://example.com/address': { type: 'object', properties: { city: { type: 'string' } } } },
  // Make `format` an assertion. Off by default, as the spec requires.
  assertFormat: true,
});
```

With `assertFormat: true` all 19 formats named by the 2020-12 validation spec are checked: `date-time`, `date`, `time`,
`duration`, `email`, `idn-email`, `hostname`, `idn-hostname`, `ipv4`, `ipv6`, `uri`, `uri-reference`, `iri`,
`iri-reference`, `uuid`, `uri-template`, `json-pointer`, `relative-json-pointer`, `regex`. Unknown format names are
ignored. `format` only applies to strings.

### Errors

`validate()` returns `{ valid, errors }` with one entry per failing keyword (no short-circuit), in document order. Each
error carries the spec's "basic" output fields:

| Field                     | Meaning                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `instanceLocation`        | JSON pointer into the instance                                                 |
| `keywordLocation`         | JSON pointer to the keyword, including `$ref` hops (`/properties/a/$ref/type`) |
| `absoluteKeywordLocation` | URI of the keyword; omitted when the enclosing schema resource has no `$id`    |
| `keyword`                 | The failing keyword (`false` for a boolean `false` schema)                     |
| `error`                   | Human-readable message                                                         |

`anyOf`/`oneOf` report one error for the applicator followed by the errors of every failed branch. A literal `false`
under `additionalProperties`, `unevaluatedProperties`, `items` or `unevaluatedItems` is reported against that keyword
(`property "x" is not allowed`), one error per property or item.

`validate()` never throws. Non-JSON values (`undefined`, functions, symbols, `BigInt`, `NaN`, `±Infinity`, array holes)
fail with keyword `type` and message `instance is not a JSON value` at the location where a subschema meets them. The
only exception is a native `RangeError` from stack exhaustion on pathologically deep instances or the dynamic-scope
cycle described under Gaps.

## What the constructor checks

Every 2020-12 keyword with a wrong JSON type or shape is a `SchemaError` (`minimum: "1"`, `required: "name"`,
`items: [...]`, `pattern: "("`, empty `allOf`, `multipleOf: 0`, duplicate `required` names, …). Also rejected:

- `$schema` other than `https://json-schema.org/draft/2020-12/schema` (with or without `#`), or `$schema` /
  `$vocabulary` on a subschema that is not a resource root
- `$id` that is not a URI-reference, has a non-empty fragment, or cannot be resolved to an absolute URI
- Duplicate `$id`s or anchors (across all documents), malformed anchor names
- Unresolvable `$ref`/`$dynamicRef` — by JSON pointer, by anchor, or to a URI not in `schemas`
- Infinite recursion through in-place applicators (`allOf: [{ $ref: '#' }]`, `$ref` chains, `not`/`if` cycles).
  Recursion through `properties`, `items`, etc. is fine — it terminates on finite instances.

Keywords not defined by 2020-12 are ignored as annotations, with no warning. That includes pre-2020-12 keywords:
`definitions`, `dependencies`, `additionalItems`, `$recursiveRef`, `id`. `definitions` still works as a `$ref` target
by pointer.

Annotation keywords (`title`, `description`, `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`,
`contentMediaType`, `contentEncoding`, `contentSchema`) are type-checked where the spec gives a type and never affect
validation.

## Semantics worth knowing

- `pattern`, `patternProperties` and `format: regex` use ECMA-262 regexes with the `u` flag.
- `minLength`/`maxLength` count Unicode code points.
- `const`, `enum`, `uniqueItems` use JSON equality: key order ignored, `1` equals `1.0`, `-0` equals `0`.
- `multipleOf` tolerates floating-point error (`0.3` is a multiple of `0.1`).
- Instance property lookups are own-enumerable only; `__proto__`, `constructor` etc. are ordinary keys. `Date`, `Map`,
  class instances and `Object.create(null)` are treated as plain objects with their own enumerable string keys.
- `$dynamicRef` is `$ref` unless the statically resolved fragment is a `$dynamicAnchor` (bookending, core §8.2.3.2).
- A `Validator` shares no mutable state between `validate()` calls; interleaved/concurrent use is safe.
- The root schema is exposed as `validator.schema` and is neither cloned nor frozen — mutating it after construction is
  undefined behaviour.

## Not supported

- Drafts other than 2020-12 (a schema with no `$schema` is treated as 2020-12)
- Custom keywords, custom formats, plugins, custom meta-schemas / `$vocabulary` dialects
- Fetching remote schemas
- Arbitrary-precision numbers beyond JS `number`

## Gaps

- **Dynamic-scope cycles.** Infinite recursion is detected statically; a cycle that only exists after runtime
  `$dynamicRef` resolution surfaces as a `RangeError` from `validate()`.
- **IDN tables are approximated.** `hostname`/`idn-hostname` implement RFC 5891–5893 (contextual rules, bidi rule,
  Punycode round-trip) with ECMAScript `\p{…}` classes standing in for the RFC 5892 derived-property and bidi-class
  tables. Every `optional/format/idn-hostname` and `hostname` suite test passes, but exotic scripts may be
  misclassified.
- **Unvisited non-JSON values pass.** `{ a: undefined }` is valid against `{}` because no subschema is ever applied to
  `a`.

## Test suite

`npm test` runs the official suite (pinned as a git devDependency) against `tests/draft2020-12/**`. Skipped with a
stated reason: `vocabulary` (custom `$vocabulary` dialect), `optional/dependencies-compatibility` (pre-2020-12),
`optional/format-assertion` (custom vocabulary), `optional/cross-draft` (other drafts), `optional/bignum` and
`optional/float-overflow` (JS number precision). `remotes/**` is registered under `http://localhost:1234/`, minus the
draft-specific folders whose `$schema` is not 2020-12.

## Size and speed

`npm run size` prints what `npm pack` would publish (unminified `tsc` output, no source maps — same as cfworker).
Unpacked size from the npm registry for the others:

| Package                       | Unpacked |
| ----------------------------- | -------: |
| this package                  |  90.3 kB |
| `@cfworker/json-schema` 4.1.1 | 169.8 kB |
| `ajv` 8.20.0                  |  1.01 MB |
| `zod` 4.6.5                   |  6.14 MB |

cfworker ships duplicate `esm/` and `commonjs/` builds; this package is ESM only. Of our 90 kB, `hostname.js` (10 kB,
Punycode + IDNA rules) and `meta-schema.js` (10 kB, bundled 2020-12 meta-schema) back features cfworker does not have.

`npm run bench` compares against `@cfworker/json-schema`, `ajv` and `zod` (vitest bench on `dist/`, Node 22, Apple
Silicon; numbers are indicative, not gated):

| Case                          | this package |    cfworker |          ajv |         zod |
| ----------------------------- | -----------: | ----------: | -----------: | ----------: |
| small — construct + validate  |  1,244k op/s |   818k op/s |     254 op/s |    37k op/s |
| small — validate only         |  4,373k op/s | 1,749k op/s | 24,682k op/s | 8,469k op/s |
| medium — construct + validate |     57k op/s |    32k op/s |     216 op/s |   7.4k op/s |
| medium — validate only        |     94k op/s |    40k op/s |  2,567k op/s |   333k op/s |
| large — construct + validate  |    9.6k op/s |   6.1k op/s |      92 op/s |   1.4k op/s |
| large — validate only         |   18.0k op/s |   7.8k op/s |    265k op/s |    27k op/s |

Ajv compiles each schema to JavaScript, so construction costs milliseconds but the compiled validator is 5–30× faster
than either interpreter. Interpreters win when schemas are constructed often or once per request.

Rule of thumb (medium case): this package wins whenever a schema is loaded and validated fewer than ~450 times against
ajv or ~15 times against zod; past that, the other library's cheaper hot path pays back its construction cost.

Zod is not a JSON Schema validator; the bench converts each schema with `z.fromJSONSchema()` and validates with
`safeParse()`. The converted tree validates 1.5–3.5× faster than this package but costs 30× more to construct.

"small" is a three-keyword object schema, "medium" an order schema with `$ref`s, formats and patterns, "large" forty
properties mixing every keyword family. Validating a schema against the bundled meta-schema is not compared because
cfworker does not resolve `$dynamicRef` there and reports invalid schemas as valid.

## Scripts

| Script          | What it does                                       |
| --------------- | -------------------------------------------------- |
| `build`         | Compile `src/` to `dist/`                          |
| `clean`         | Remove `dist/` and `coverage/`                     |
| `typecheck`     | Type-check without emitting                        |
| `lint`          | Run ESLint                                         |
| `lint:fix`      | Run ESLint with auto-fix                           |
| `format`        | Format with Prettier                               |
| `format:check`  | Check formatting                                   |
| `test`          | Run tests once (unit tests + official suite)       |
| `test:watch`    | Run tests in watch mode                            |
| `test:coverage` | Run tests with coverage (80% threshold)            |
| `bench`         | Benchmark against cfworker, ajv and zod            |
| `size`          | Build and print what `npm pack` would publish      |
| `check`         | typecheck + lint + format:check + test:coverage    |
| `publish:npm`   | Publish to npm (runs `prepublishOnly` guard first) |

## Git hooks

Wired up by `npm install` via `.githooks/`:

- `pre-commit` — Prettier + ESLint fix on staged files
- `pre-push` — `npm run check`

## Contributing

Have an idea, found a bug, or hit a schema that validates wrong? Open an issue at
<https://github.com/ChaoChow/json-schema-validator/issues>. Pull requests are welcome too; `npm run check` must pass
(the `pre-push` hook runs it for you).
