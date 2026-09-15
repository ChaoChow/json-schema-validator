import type { CompiledSchema, Resource, SchemaNode } from './compile.js';
import { jsonEqual } from './equal.js';
import { formatMap } from './format.js';
import type { SchemaObject, ValidationError } from './types.js';
import { escapePointerToken } from './uri.js';

/** Which properties / array indices the sibling and in-place keywords have already covered (core §11). */
interface Evaluated {
  propSet?: Set<string>;
  itemSet?: Set<number>;
}

type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

function jsonTypeOf(v: unknown): JsonType | undefined {
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isFinite(v) ? 'number' : undefined;
    case 'object':
      return v === null ? 'null' : Array.isArray(v) ? 'array' : 'object';
    default:
      return undefined;
  }
}

function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
    n++;
  }
  return n;
}

function isMultipleOf(value: number, divisor: number): boolean {
  const q = value / divisor;
  if (!Number.isFinite(q)) return false;
  return Math.abs(q - Math.round(q)) <= 1e-9 * Math.max(1, Math.abs(q));
}

function hasOwnEnumerable(o: object, key: string): boolean {
  return Object.prototype.propertyIsEnumerable.call(o, key);
}

function markProp(ev: Evaluated | undefined, key: string): void {
  if (ev !== undefined) (ev.propSet ??= new Set()).add(key);
}

function markItem(ev: Evaluated | undefined, index: number): void {
  if (ev !== undefined) (ev.itemSet ??= new Set()).add(index);
}

/** One `validate()` call. Holds the error list and the dynamic scope, so a `Validator` shares nothing between calls. */
class Run {
  private readonly errorList: ValidationError[] = [];
  /** Counts every failure, including ones not recorded while `muted`; validity is a count comparison. */
  private errorCount = 0;
  /** > 0 while only the pass/fail outcome matters (`not`, `if`, `contains`), so no error objects are built. */
  private muted = 0;
  /** Resource URIs entered so far, outermost first (core §7.1 dynamic scope). */
  private readonly scope: string[] = [];

  constructor(
    private readonly resourceMap: Map<string, Resource>,
    private readonly assertFormat: boolean,
  ) {}

  run(root: SchemaNode, inst: unknown): ValidationError[] {
    this.schema(root, inst, '', '', undefined);
    return this.errorList;
  }

  private error(
    instLoc: string,
    kwLoc: string,
    base: string,
    pointer: string,
    keyword: string,
    error: string,
    at?: number,
  ): void {
    this.errorCount++;
    if (this.muted > 0) return;
    const e: ValidationError = { instanceLocation: instLoc, keywordLocation: kwLoc, keyword, error };
    if (base !== '') e.absoluteKeywordLocation = `${base}#${pointer}`;
    if (at === undefined) this.errorList.push(e);
    else this.errorList.splice(at, 0, e);
  }

  /** Records a failure of `keyword` in `node`; `at` inserts it before sub-errors already recorded. */
  private fail(node: SchemaNode, keyword: string, instLoc: string, kwLoc: string, message: string, at?: number): void {
    this.error(instLoc, `${kwLoc}/${keyword}`, node.base, `${node.pointer}/${keyword}`, keyword, message, at);
  }

  /** Validates for the outcome only; nothing is recorded and the failure count is left untouched. */
  private test(node: SchemaNode, inst: unknown, instLoc: string, kwLoc: string, out: Evaluated | undefined): boolean {
    const count = this.errorCount;
    this.muted++;
    const valid = this.schema(node, inst, instLoc, kwLoc, out);
    this.muted--;
    this.errorCount = count;
    return valid;
  }

  /** Discards errors and failure counts recorded since the given marks (a passed `anyOf` branch, a matched `oneOf`). */
  private rollback(listLength: number, count: number): void {
    this.errorList.length = listLength;
    this.errorCount = count;
  }

  /**
   * Applies `child` to one property/item. A literal `false` child is reported against the applicator
   * keyword ("property x is not allowed") rather than as a bare "schema is false". `kwLoc` already ends in the keyword.
   */
  private child(
    child: SchemaNode,
    inst: unknown,
    instLoc: string,
    kwLoc: string,
    keyword: string,
    what: string,
  ): boolean {
    if (child.schema !== false) return this.schema(child, inst, instLoc, kwLoc, undefined);
    this.error(instLoc, kwLoc, child.base, child.pointer, keyword, `${what} is not allowed`);
    return false;
  }

  /** `kwLoc` is the keywordLocation prefix including `$ref` hops. */
  private schema(node: SchemaNode, inst: unknown, instLoc: string, kwLoc: string, out: Evaluated | undefined): boolean {
    const type = jsonTypeOf(inst);
    if (type === undefined) {
      this.fail(node, 'type', instLoc, kwLoc, 'instance is not a JSON value');
      return false;
    }
    const s = node.schema;
    if (s === true) return true;
    if (s === false) {
      this.error(instLoc, kwLoc, node.base, node.pointer, 'false', 'schema is false');
      return false;
    }
    const scope = this.scope;
    const entersResource = node.base !== scope[scope.length - 1];
    if (entersResource) scope.push(node.base);
    const valid = this.object(node, s, type, inst, instLoc, kwLoc, out);
    if (entersResource) scope.pop();
    return valid;
  }

  private object(
    node: SchemaNode,
    s: SchemaObject,
    type: JsonType,
    inst: unknown,
    instLoc: string,
    kwLoc: string,
    out: Evaluated | undefined,
  ): boolean {
    const startCount = this.errorCount;
    const tracks = out !== undefined || node.unevaluatedProperties !== undefined || node.unevaluatedItems !== undefined;
    const ev: Evaluated | undefined = tracks ? {} : undefined;

    if (node.ref !== undefined) this.schema(node.ref, inst, instLoc, kwLoc + '/$ref', ev);
    if (node.dynRef !== undefined) this.dynamicRef(node, inst, instLoc, kwLoc, ev);

    if (node.typeList !== undefined) {
      let ok = false;
      for (const t of node.typeList) {
        if (t === type || (t === 'integer' && type === 'number' && Number.isInteger(inst))) {
          ok = true;
          break;
        }
      }
      if (!ok) this.fail(node, 'type', instLoc, kwLoc, `expected ${node.typeList.join(' or ')}, got ${type}`);
    }
    if ('const' in s && !jsonEqual(inst, s.const)) {
      this.fail(node, 'const', instLoc, kwLoc, `must equal ${JSON.stringify(s.const)}`);
    }
    if (
      node.enumSet !== undefined
        ? !node.enumSet.has(inst)
        : s.enum !== undefined && !s.enum.some((e) => jsonEqual(inst, e))
    ) {
      this.fail(node, 'enum', instLoc, kwLoc, 'must equal one of the allowed values');
    }

    if (type === 'number') this.number(node, s, inst as number, instLoc, kwLoc);
    else if (type === 'string') this.string(node, s, inst as string, instLoc, kwLoc);
    else if (type === 'array') this.array(node, s, inst as unknown[], instLoc, kwLoc, ev);
    else if (type === 'object') this.properties(node, s, inst as Record<string, unknown>, instLoc, kwLoc, ev);

    if (node.allOfList !== undefined) {
      for (let i = 0; i < node.allOfList.length; i++)
        this.schema(node.allOfList[i]!, inst, instLoc, `${kwLoc}/allOf/${i}`, ev);
    }
    if (node.anyOfList !== undefined) {
      const listLength = this.errorList.length;
      const count = this.errorCount;
      let matched = false;
      for (let i = 0; i < node.anyOfList.length; i++) {
        if (this.schema(node.anyOfList[i]!, inst, instLoc, `${kwLoc}/anyOf/${i}`, ev)) matched = true;
      }
      if (matched) this.rollback(listLength, count);
      else this.fail(node, 'anyOf', instLoc, kwLoc, 'must match at least one schema', listLength);
    }
    if (node.oneOfList !== undefined) {
      const listLength = this.errorList.length;
      const count = this.errorCount;
      let matchCount = 0;
      for (let i = 0; i < node.oneOfList.length; i++) {
        if (this.schema(node.oneOfList[i]!, inst, instLoc, `${kwLoc}/oneOf/${i}`, ev)) matchCount++;
      }
      if (matchCount === 1) this.rollback(listLength, count);
      else if (matchCount === 0)
        this.fail(node, 'oneOf', instLoc, kwLoc, 'must match exactly one schema, matched none', listLength);
      else {
        this.rollback(listLength, count);
        this.fail(node, 'oneOf', instLoc, kwLoc, `must match exactly one schema, matched ${matchCount}`);
      }
    }
    if (node.not !== undefined && this.test(node.not, inst, instLoc, kwLoc + '/not', undefined)) {
      this.fail(node, 'not', instLoc, kwLoc, 'must not match the schema');
    }
    if (node.if !== undefined) {
      // A passing `if` contributes annotations even without then/else (core §10.2.2.1).
      const passes = this.test(node.if, inst, instLoc, kwLoc + '/if', ev);
      if (passes && node.then !== undefined) this.schema(node.then, inst, instLoc, kwLoc + '/then', ev);
      if (!passes && node.else !== undefined) this.schema(node.else, inst, instLoc, kwLoc + '/else', ev);
    }

    if (ev !== undefined) {
      if (type === 'object' && node.unevaluatedProperties !== undefined) {
        const o = inst as Record<string, unknown>;
        const childKwLoc = kwLoc + '/unevaluatedProperties';
        for (const k of Object.keys(o)) {
          if (ev.propSet?.has(k)) continue;
          markProp(ev, k);
          this.child(
            node.unevaluatedProperties,
            o[k],
            instLoc + '/' + escapePointerToken(k),
            childKwLoc,
            'unevaluatedProperties',
            `property "${k}"`,
          );
        }
      }
      if (type === 'array' && node.unevaluatedItems !== undefined) {
        const a = inst as unknown[];
        const childKwLoc = kwLoc + '/unevaluatedItems';
        for (let i = 0; i < a.length; i++) {
          if (ev.itemSet?.has(i)) continue;
          markItem(ev, i);
          this.child(node.unevaluatedItems, a[i], `${instLoc}/${i}`, childKwLoc, 'unevaluatedItems', `item ${i}`);
        }
      }
    }

    const valid = this.errorCount === startCount;
    // Only a passing schema contributes annotations (core §7.7.1.2).
    if (valid && out !== undefined && ev !== undefined) {
      if (ev.propSet !== undefined) for (const k of ev.propSet) markProp(out, k);
      if (ev.itemSet !== undefined) for (const i of ev.itemSet) markItem(out, i);
    }
    return valid;
  }

  private dynamicRef(node: SchemaNode, inst: unknown, instLoc: string, kwLoc: string, ev: Evaluated | undefined): void {
    let target = node.dynRef!;
    if (node.dynAnchor !== undefined) {
      // Bookended: the outermost resource in the dynamic scope with the same $dynamicAnchor wins (core §8.2.3.2).
      for (const uri of this.scope) {
        const found = this.resourceMap.get(uri)?.dynamicAnchorMap?.get(node.dynAnchor);
        if (found !== undefined) {
          target = found;
          break;
        }
      }
    }
    this.schema(target, inst, instLoc, kwLoc + '/$dynamicRef', ev);
  }

  private number(node: SchemaNode, s: SchemaObject, n: number, instLoc: string, kwLoc: string): void {
    if (s.multipleOf !== undefined && !isMultipleOf(n, s.multipleOf))
      this.fail(node, 'multipleOf', instLoc, kwLoc, `must be a multiple of ${s.multipleOf}`);
    if (s.maximum !== undefined && n > s.maximum) this.fail(node, 'maximum', instLoc, kwLoc, `must be <= ${s.maximum}`);
    if (s.exclusiveMaximum !== undefined && n >= s.exclusiveMaximum)
      this.fail(node, 'exclusiveMaximum', instLoc, kwLoc, `must be < ${s.exclusiveMaximum}`);
    if (s.minimum !== undefined && n < s.minimum) this.fail(node, 'minimum', instLoc, kwLoc, `must be >= ${s.minimum}`);
    if (s.exclusiveMinimum !== undefined && n <= s.exclusiveMinimum)
      this.fail(node, 'exclusiveMinimum', instLoc, kwLoc, `must be > ${s.exclusiveMinimum}`);
  }

  private string(node: SchemaNode, s: SchemaObject, str: string, instLoc: string, kwLoc: string): void {
    if (s.maxLength !== undefined || s.minLength !== undefined) {
      const len = codePointLength(str);
      if (s.maxLength !== undefined && len > s.maxLength)
        this.fail(node, 'maxLength', instLoc, kwLoc, `must be at most ${s.maxLength} characters`);
      if (s.minLength !== undefined && len < s.minLength)
        this.fail(node, 'minLength', instLoc, kwLoc, `must be at least ${s.minLength} characters`);
    }
    if (node.pattern !== undefined && !node.pattern.test(str))
      this.fail(node, 'pattern', instLoc, kwLoc, `must match pattern ${s.pattern as string}`);
    if (this.assertFormat && s.format !== undefined) {
      const check = formatMap[s.format];
      if (check !== undefined && !check(str)) this.fail(node, 'format', instLoc, kwLoc, `must be a valid ${s.format}`);
    }
  }

  private array(
    node: SchemaNode,
    s: SchemaObject,
    a: unknown[],
    instLoc: string,
    kwLoc: string,
    ev: Evaluated | undefined,
  ): void {
    if (s.maxItems !== undefined && a.length > s.maxItems)
      this.fail(node, 'maxItems', instLoc, kwLoc, `must have at most ${s.maxItems} items`);
    if (s.minItems !== undefined && a.length < s.minItems)
      this.fail(node, 'minItems', instLoc, kwLoc, `must have at least ${s.minItems} items`);
    if (s.uniqueItems === true) this.uniqueItems(node, a, instLoc, kwLoc);
    let prefixCount = 0;
    if (node.prefixItemList !== undefined) {
      prefixCount = Math.min(node.prefixItemList.length, a.length);
      for (let i = 0; i < prefixCount; i++) {
        this.schema(node.prefixItemList[i]!, a[i], `${instLoc}/${i}`, `${kwLoc}/prefixItems/${i}`, undefined);
        markItem(ev, i);
      }
    }
    if (node.items !== undefined) {
      const childKwLoc = kwLoc + '/items';
      for (let i = prefixCount; i < a.length; i++) {
        this.child(node.items, a[i], `${instLoc}/${i}`, childKwLoc, 'items', `item ${i}`);
        markItem(ev, i);
      }
    }
    if (node.contains !== undefined) {
      const childKwLoc = kwLoc + '/contains';
      let count = 0;
      for (let i = 0; i < a.length; i++) {
        if (this.test(node.contains, a[i], `${instLoc}/${i}`, childKwLoc, undefined)) {
          count++;
          markItem(ev, i);
        }
      }
      const min = s.minContains ?? 1;
      if (count < min) {
        const keyword = s.minContains === undefined ? 'contains' : 'minContains';
        this.fail(node, keyword, instLoc, kwLoc, `must contain at least ${min} matching items`);
      }
      if (s.maxContains !== undefined && count > s.maxContains)
        this.fail(node, 'maxContains', instLoc, kwLoc, `must contain at most ${s.maxContains} matching items`);
    }
  }

  /** Primitives are checked through a set; objects and arrays fall back to pairwise `jsonEqual`. */
  private uniqueItems(node: SchemaNode, a: unknown[], instLoc: string, kwLoc: string): void {
    const seen = new Set<unknown>();
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      let dup = -1;
      if (typeof v === 'object' && v !== null) {
        for (let j = 0; j < i; j++) {
          if (jsonEqual(v, a[j])) {
            dup = j;
            break;
          }
        }
      } else if (seen.has(v)) dup = a.indexOf(v);
      else seen.add(v);
      if (dup !== -1) {
        this.fail(node, 'uniqueItems', instLoc, kwLoc, `items ${dup} and ${i} are equal`);
        return;
      }
    }
  }

  private properties(
    node: SchemaNode,
    s: SchemaObject,
    o: Record<string, unknown>,
    instLoc: string,
    kwLoc: string,
    ev: Evaluated | undefined,
  ): void {
    const keyList = Object.keys(o);
    if (s.maxProperties !== undefined && keyList.length > s.maxProperties)
      this.fail(node, 'maxProperties', instLoc, kwLoc, `must have at most ${s.maxProperties} properties`);
    if (s.minProperties !== undefined && keyList.length < s.minProperties)
      this.fail(node, 'minProperties', instLoc, kwLoc, `must have at least ${s.minProperties} properties`);
    if (s.required !== undefined) {
      for (const k of s.required) {
        if (!hasOwnEnumerable(o, k)) this.fail(node, 'required', instLoc, kwLoc, `missing required property "${k}"`);
      }
    }
    if (s.dependentRequired !== undefined) {
      for (const k of Object.keys(s.dependentRequired)) {
        if (!hasOwnEnumerable(o, k)) continue;
        for (const dep of s.dependentRequired[k]!) {
          if (!hasOwnEnumerable(o, dep))
            this.fail(
              node,
              'dependentRequired',
              instLoc,
              kwLoc,
              `property "${dep}" is required when "${k}" is present`,
            );
        }
      }
    }
    const propertyMap = node.propertyMap;
    const patternPropList = node.patternPropList;
    const additional = node.additionalProperties;
    const propertyNames = node.propertyNames;
    const additionalKwLoc = kwLoc + '/additionalProperties';
    const namesKwLoc = kwLoc + '/propertyNames';
    for (const k of keyList) {
      const token = escapePointerToken(k);
      const childLoc = instLoc + '/' + token;
      let covered = false;
      const propertyNode = propertyMap?.get(k);
      if (propertyNode !== undefined) {
        this.schema(propertyNode, o[k], childLoc, `${kwLoc}/properties/${token}`, undefined);
        covered = true;
      }
      if (patternPropList !== undefined) {
        for (const [re, sourceToken, child] of patternPropList) {
          if (!re.test(k)) continue;
          this.schema(child, o[k], childLoc, `${kwLoc}/patternProperties/${sourceToken}`, undefined);
          covered = true;
        }
      }
      if (!covered && additional !== undefined) {
        this.child(additional, o[k], childLoc, additionalKwLoc, 'additionalProperties', `property "${k}"`);
        covered = true;
      }
      if (covered) markProp(ev, k);
      if (propertyNames !== undefined) {
        const listLength = this.errorList.length;
        if (!this.schema(propertyNames, k, instLoc, namesKwLoc, undefined))
          this.fail(node, 'propertyNames', instLoc, kwLoc, `property name "${k}" is invalid`, listLength);
      }
    }
    if (node.dependentSchemaList !== undefined) {
      for (const [k, child] of node.dependentSchemaList) {
        if (!hasOwnEnumerable(o, k)) continue;
        this.schema(child, o, instLoc, `${kwLoc}/dependentSchemas/${escapePointerToken(k)}`, ev);
      }
    }
  }
}

export function validateInstance(compiled: CompiledSchema, assertFormat: boolean, inst: unknown): ValidationError[] {
  return new Run(compiled.resourceMap, assertFormat).run(compiled.root, inst);
}
