import { isUriReference } from './format.js';
import { metaSchemaMap } from './meta-schema.js';
import { SchemaError, type SchemaProblem } from './schema-error.js';
import type { Schema, SchemaObject, SchemaType } from './types.js';
import { escapePointerToken, isAbsoluteUri, resolveUri, splitFragment, unescapePointerToken } from './uri.js';

export interface SchemaLocation {
  /** URI of the enclosing resource; empty for an anonymous root. */
  base: string;
  /** JSON pointer within the resource. */
  pointer: string;
}

/**
 * One schema at one location, with its children and precomputed keyword data, so `validate()`
 * walks nodes without lookups. A schema object used at two locations gets two nodes.
 */
export interface SchemaNode extends SchemaLocation {
  schema: Schema;
  ref?: SchemaNode;
  dynRef?: SchemaNode;
  /** Set when `$dynamicRef` lands on a `$dynamicAnchor` (bookending), enabling dynamic-scope lookup. */
  dynAnchor?: string;
  /** Has at least one in-place applicator edge, so it can take part in an infinite-recursion cycle. */
  inPlace?: true;
  typeList?: SchemaType[];
  /** `enum` as a set when every member is a primitive; otherwise members are compared with `jsonEqual`. */
  enumSet?: Set<unknown>;
  pattern?: RegExp;
  propertyMap?: Map<string, SchemaNode>;
  /** Compiled `patternProperties` with the escaped pointer token of the original key. */
  patternPropList?: [RegExp, string, SchemaNode][];
  dependentSchemaList?: [string, SchemaNode][];
  prefixItemList?: SchemaNode[];
  allOfList?: SchemaNode[];
  anyOfList?: SchemaNode[];
  oneOfList?: SchemaNode[];
  items?: SchemaNode;
  contains?: SchemaNode;
  additionalProperties?: SchemaNode;
  propertyNames?: SchemaNode;
  if?: SchemaNode;
  then?: SchemaNode;
  else?: SchemaNode;
  not?: SchemaNode;
  unevaluatedItems?: SchemaNode;
  unevaluatedProperties?: SchemaNode;
}

export interface Resource {
  node: SchemaNode;
  anchorMap?: Map<string, SchemaNode>;
  dynamicAnchorMap?: Map<string, SchemaNode>;
  /** Every node in this resource by its pointer, including embedded resource roots under their parent pointer. */
  pointerMap: Map<string, SchemaNode>;
}

export interface CompiledSchema {
  root: SchemaNode;
  resourceMap: Map<string, Resource>;
}

const SCHEMA_URI = 'https://json-schema.org/draft/2020-12/schema';
const ANCHOR_RE = /^[A-Za-z_][-A-Za-z0-9._]*$/;
const TYPE_SET = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);

const LIST_FIELD_MAP = {
  prefixItems: 'prefixItemList',
  allOf: 'allOfList',
  anyOf: 'anyOfList',
  oneOf: 'oneOfList',
} as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPrimitive(v: unknown): boolean {
  return typeof v !== 'object' || v === null;
}

function safeDecode(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function isUniqueStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') && new Set(v).size === v.length;
}

class Compiler {
  readonly problemList: SchemaProblem[] = [];
  readonly resourceMap = new Map<string, Resource>();
  private readonly nodeList: SchemaNode[] = [];
  private readonly refNodeList: SchemaNode[] = [];
  /** Objects on the current walk path, to reject a JS object graph that contains itself. */
  private readonly walkStack = new Set<object>();

  addDocument(doc: unknown, uri: string): SchemaNode | undefined {
    if (uri !== '' && !isAbsoluteUri(uri))
      this.problem({ base: uri, pointer: '' }, `schemas key "${uri}" is not an absolute URI`);
    return this.walk(doc, { base: uri, pointer: '' }, true);
  }

  finish(root: SchemaNode | undefined): CompiledSchema {
    // Resolving may pull in bundled meta-schemas, which append to refNodeList.
    for (let i = 0; i < this.refNodeList.length; i++) this.resolveRef(this.refNodeList[i]!);
    this.detectCycle();
    if (this.problemList.length > 0 || root === undefined) throw new SchemaError(this.problemList);
    return { root, resourceMap: this.resourceMap };
  }

  private problem(loc: SchemaLocation, message: string, keyword?: string): void {
    const pointer = keyword === undefined ? loc.pointer : loc.pointer + '/' + escapePointerToken(keyword);
    this.problemList.push({ schemaLocation: `${loc.base}#${pointer}`, message });
  }

  private registerResource(uri: string, node: SchemaNode, loc: SchemaLocation): void {
    const existing = this.resourceMap.get(uri);
    if (existing === undefined) {
      const pointerMap = new Map<string, SchemaNode>();
      pointerMap.set('', node);
      this.resourceMap.set(uri, { node, pointerMap });
    } else if (existing.node !== node) {
      this.problem(loc, `duplicate schema URI "${uri}"`, '$id');
    }
  }

  private walk(s: unknown, loc: SchemaLocation, isDocRoot: boolean): SchemaNode | undefined {
    if (typeof s !== 'boolean' && !isPlainObject(s)) {
      const hint = Array.isArray(s) ? ' (the array form of items is prefixItems in 2020-12)' : '';
      this.problem(loc, `schema must be an object or boolean${hint}`);
      return undefined;
    }
    if (typeof s === 'object' && this.walkStack.has(s)) {
      this.problem(loc, 'schema object contains itself');
      return undefined;
    }
    const node: SchemaNode = { schema: s, base: loc.base, pointer: loc.pointer };
    if (isDocRoot) this.registerResource(loc.base, node, loc);
    let isResourceRoot = isDocRoot;
    if (typeof s === 'object' && '$id' in s) {
      const resolved = this.checkId(s.$id, loc);
      if (resolved !== undefined) {
        this.registerResource(resolved, node, loc);
        node.base = resolved;
        node.pointer = '';
        isResourceRoot = true;
      }
    }
    this.resourceMap.get(loc.base)!.pointerMap.set(loc.pointer, node);
    if (typeof s === 'boolean') return node;
    this.nodeList.push(node);
    this.walkStack.add(s);
    this.checkKeywordList(node, s, isResourceRoot);
    this.walkStack.delete(s);
    return node;
  }

  private checkId(id: unknown, loc: SchemaLocation): string | undefined {
    if (typeof id !== 'string' || !isUriReference(id, false, false)) {
      this.problem(loc, '$id must be a valid URI-reference', '$id');
      return undefined;
    }
    const [uri, fragment] = splitFragment(id);
    if (fragment !== undefined && fragment !== '') {
      this.problem(loc, '$id must not contain a fragment (use $anchor)', '$id');
      return undefined;
    }
    const resolved = resolveUri(uri, loc.base);
    if (!isAbsoluteUri(resolved)) {
      this.problem(loc, `$id "${id}" does not resolve to an absolute URI (no base URI)`, '$id');
      return undefined;
    }
    return resolved;
  }

  private checkKeywordList(node: SchemaNode, o: SchemaObject, isResourceRoot: boolean): void {
    const resource = this.resourceMap.get(node.base)!;
    const bad = (keyword: string, message: string): void => this.problem(node, `${keyword} ${message}`, keyword);
    const expect = (keyword: string, ok: boolean, message: string): boolean => {
      if (!ok) bad(keyword, message);
      return ok;
    };
    const sub = (keyword: string, token?: string): SchemaLocation => ({
      base: node.base,
      pointer: `${node.pointer}/${keyword}${token === undefined ? '' : '/' + escapePointerToken(token)}`,
    });

    for (const keyword of Object.keys(o)) {
      const v = o[keyword];
      switch (keyword) {
        case '$id':
          break;
        case '$schema':
          if (expect(keyword, typeof v === 'string', 'must be a string')) {
            if (v !== SCHEMA_URI && v !== SCHEMA_URI + '#')
              bad(keyword, `"${v as string}" is not supported; only ${SCHEMA_URI} is`);
            else if (!isResourceRoot) bad(keyword, 'is only allowed at the root of a schema resource');
          }
          break;
        case '$vocabulary':
          if (
            expect(
              keyword,
              isPlainObject(v) && Object.values(v).every((b) => typeof b === 'boolean'),
              'must be an object of booleans',
            )
          ) {
            if (!isResourceRoot) bad(keyword, 'is only allowed at the root of a schema resource');
          }
          break;
        case '$anchor':
        case '$dynamicAnchor':
          if (expect(keyword, typeof v === 'string' && ANCHOR_RE.test(v), 'must match ^[A-Za-z_][-A-Za-z0-9._]*$')) {
            const name = v as string;
            if (resource.anchorMap?.has(name))
              bad(keyword, `"${name}" is already defined in ${node.base || 'this resource'}`);
            (resource.anchorMap ??= new Map()).set(name, node);
            if (keyword === '$dynamicAnchor') (resource.dynamicAnchorMap ??= new Map()).set(name, node);
          }
          break;
        case '$ref':
        case '$dynamicRef':
          // Push once even when both keywords are present.
          if (
            expect(keyword, typeof v === 'string', 'must be a string') &&
            (keyword === '$ref' || typeof o.$ref !== 'string')
          ) {
            this.refNodeList.push(node);
          }
          break;
        case '$comment':
        case 'title':
        case 'description':
        case 'contentEncoding':
        case 'contentMediaType':
        case 'format':
          expect(keyword, typeof v === 'string', 'must be a string');
          break;
        case '$defs':
          if (expect(keyword, isPlainObject(v), 'must be an object')) {
            for (const k of Object.keys(v as object))
              this.walk((v as Record<string, unknown>)[k], sub(keyword, k), false);
          }
          break;
        case 'properties':
          if (expect(keyword, isPlainObject(v), 'must be an object')) {
            node.propertyMap = new Map();
            for (const k of Object.keys(v as object)) {
              const child = this.walk((v as Record<string, unknown>)[k], sub(keyword, k), false);
              if (child !== undefined) node.propertyMap.set(k, child);
            }
          }
          break;
        case 'dependentSchemas':
          if (expect(keyword, isPlainObject(v), 'must be an object')) {
            node.dependentSchemaList = [];
            node.inPlace = true;
            for (const k of Object.keys(v as object)) {
              const child = this.walk((v as Record<string, unknown>)[k], sub(keyword, k), false);
              if (child !== undefined) node.dependentSchemaList.push([k, child]);
            }
          }
          break;
        case 'patternProperties':
          if (expect(keyword, isPlainObject(v), 'must be an object')) {
            node.patternPropList = [];
            for (const k of Object.keys(v as object)) {
              const loc = sub(keyword, k);
              const re = this.compileRegex(k, keyword, loc);
              const child = this.walk((v as Record<string, unknown>)[k], loc, false);
              if (re !== undefined && child !== undefined)
                node.patternPropList.push([re, escapePointerToken(k), child]);
            }
          }
          break;
        case 'prefixItems':
        case 'allOf':
        case 'anyOf':
        case 'oneOf':
          if (expect(keyword, Array.isArray(v) && v.length > 0, 'must be a non-empty array')) {
            const list: SchemaNode[] = [];
            (v as unknown[]).forEach((item, i) => {
              const child = this.walk(item, sub(keyword, String(i)), false);
              if (child !== undefined) list.push(child);
            });
            node[LIST_FIELD_MAP[keyword]] = list;
            if (keyword !== 'prefixItems') node.inPlace = true;
          }
          break;
        case 'items':
        case 'contains':
        case 'additionalProperties':
        case 'propertyNames':
        case 'if':
        case 'then':
        case 'else':
        case 'not':
        case 'unevaluatedItems':
        case 'unevaluatedProperties':
          node[keyword] = this.walk(v, sub(keyword), false);
          if (keyword === 'not' || keyword === 'if' || keyword === 'then' || keyword === 'else') node.inPlace = true;
          break;
        case 'contentSchema':
          this.walk(v, sub(keyword), false);
          break;
        case 'type':
          if (Array.isArray(v)) {
            if (
              expect(
                keyword,
                v.length > 0 && isUniqueStringList(v) && v.every((t) => TYPE_SET.has(t)),
                'array must be non-empty unique type names',
              )
            )
              node.typeList = v as SchemaType[];
          } else if (
            expect(keyword, typeof v === 'string' && TYPE_SET.has(v), 'must be a type name or array of type names')
          )
            node.typeList = [v as SchemaType];
          break;
        case 'enum':
          if (expect(keyword, Array.isArray(v), 'must be an array') && (v as unknown[]).every(isPrimitive))
            node.enumSet = new Set(v as unknown[]);
          break;
        case 'examples':
          expect(keyword, Array.isArray(v), 'must be an array');
          break;
        case 'multipleOf':
          expect(keyword, typeof v === 'number' && v > 0, 'must be a number greater than 0');
          break;
        case 'maximum':
        case 'exclusiveMaximum':
        case 'minimum':
        case 'exclusiveMinimum':
          expect(keyword, typeof v === 'number' && Number.isFinite(v), 'must be a number');
          break;
        case 'maxLength':
        case 'minLength':
        case 'maxItems':
        case 'minItems':
        case 'maxProperties':
        case 'minProperties':
        case 'maxContains':
        case 'minContains':
          expect(keyword, Number.isInteger(v) && (v as number) >= 0, 'must be a non-negative integer');
          break;
        case 'pattern':
          node.pattern = this.compileRegex(v, keyword, sub(keyword));
          break;
        case 'uniqueItems':
        case 'deprecated':
        case 'readOnly':
        case 'writeOnly':
          expect(keyword, typeof v === 'boolean', 'must be a boolean');
          break;
        case 'required':
          expect(keyword, isUniqueStringList(v), 'must be an array of unique strings');
          break;
        case 'dependentRequired':
          expect(
            keyword,
            isPlainObject(v) && Object.values(v).every(isUniqueStringList),
            'must be an object of unique string arrays',
          );
          break;
        default:
          // Unknown keywords (including pre-2020-12 ones) are annotations, per core §6.5.
          break;
      }
    }
  }

  /** `loc` points at the keyword (or the patternProperties key) itself. */
  private compileRegex(source: unknown, keyword: string, loc: SchemaLocation): RegExp | undefined {
    if (typeof source !== 'string') {
      this.problem(loc, `${keyword} must be a string`);
      return undefined;
    }
    try {
      return new RegExp(source, 'u');
    } catch (e) {
      this.problem(loc, `${keyword} is not a valid ECMA-262 regex: ${(e as Error).message}`);
      return undefined;
    }
  }

  private resolveRef(node: SchemaNode): void {
    const o = node.schema as SchemaObject;
    for (const keyword of ['$ref', '$dynamicRef'] as const) {
      const ref = o[keyword];
      if (typeof ref !== 'string') continue;
      const uri = resolveUri(ref, node.base);
      const [docUri, rawFragment] = splitFragment(uri);
      if (docUri !== '' && !isAbsoluteUri(docUri)) {
        this.problem(node, `${keyword} "${ref}" is relative but the schema has no base URI`, keyword);
        continue;
      }
      let resource = this.resourceMap.get(docUri);
      if (resource === undefined && docUri in metaSchemaMap) {
        this.addDocument(metaSchemaMap[docUri], docUri);
        resource = this.resourceMap.get(docUri);
      }
      let target: SchemaNode | undefined;
      if (resource !== undefined) {
        const fragment = rawFragment === undefined ? '' : safeDecode(rawFragment);
        if (fragment === '') target = resource.node;
        else if (fragment.startsWith('/')) target = this.resolvePointer(resource, fragment);
        else {
          target = resource.anchorMap?.get(fragment);
          if (keyword === '$dynamicRef' && target !== undefined && resource.dynamicAnchorMap?.get(fragment) === target)
            node.dynAnchor = fragment;
        }
      }
      if (target === undefined) this.problem(node, `${keyword} "${ref}" cannot be resolved (${uri})`, keyword);
      else {
        if (keyword === '$ref') node.ref = target;
        else node.dynRef = target;
        node.inPlace = true;
      }
    }
  }

  private resolvePointer(resource: Resource, pointer: string): SchemaNode | undefined {
    let cur: unknown = resource.node.schema;
    let known = resource.node;
    let rest = '';
    for (const token of pointer.slice(1).split('/').map(unescapePointerToken)) {
      if (Array.isArray(cur)) cur = /^(?:0|[1-9]\d*)$/.test(token) ? cur[+token] : undefined;
      else if (isPlainObject(cur)) cur = Object.hasOwn(cur, token) ? cur[token] : undefined;
      else cur = undefined;
      if (cur === undefined) return undefined;
      rest += '/' + escapePointerToken(token);
      const node = this.resourceMap.get(known.base)!.pointerMap.get(known.pointer + rest);
      if (node !== undefined) {
        known = node;
        rest = '';
      }
    }
    if (rest === '') return known;
    if (typeof cur !== 'boolean' && !isPlainObject(cur)) return undefined;
    // A target under an unknown keyword was not walked at load time; check it now.
    return this.walk(cur, { base: known.base, pointer: known.pointer + rest }, false);
  }

  /** Cycles through in-place applicators never consume instance and would recurse forever. */
  private detectCycle(): void {
    const state = new Map<SchemaNode, 1 | 2>();
    const visit = (node: SchemaNode): void => {
      state.set(node, 1);
      const edge = (target: SchemaNode, keyword: string): void => {
        if (target.inPlace === undefined) return; // a leaf cannot close a cycle
        const s = state.get(target);
        if (s === 1)
          this.problem(
            node,
            `infinite recursion: ${keyword} refers back to a schema that is still being applied`,
            keyword,
          );
        else if (s === undefined) visit(target);
      };
      if (node.ref !== undefined) edge(node.ref, '$ref');
      if (node.dynRef !== undefined) edge(node.dynRef, '$dynamicRef');
      if (node.not !== undefined) edge(node.not, 'not');
      if (node.if !== undefined) edge(node.if, 'if');
      if (node.then !== undefined) edge(node.then, 'then');
      if (node.else !== undefined) edge(node.else, 'else');
      if (node.allOfList !== undefined) for (const s of node.allOfList) edge(s, 'allOf');
      if (node.anyOfList !== undefined) for (const s of node.anyOfList) edge(s, 'anyOf');
      if (node.oneOfList !== undefined) for (const s of node.oneOfList) edge(s, 'oneOf');
      if (node.dependentSchemaList !== undefined)
        for (const [, s] of node.dependentSchemaList) edge(s, 'dependentSchemas');
      state.set(node, 2);
    };
    for (const node of this.nodeList) if (node.inPlace !== undefined && !state.has(node)) visit(node);
  }
}

/** Walks every document, checks every keyword, resolves every reference; throws `SchemaError` listing all problems. */
export function compile(root: unknown, schemaMap: Record<string, unknown> | undefined): CompiledSchema {
  const compiler = new Compiler();
  const rootNode = compiler.addDocument(root, '');
  if (schemaMap !== undefined) for (const uri of Object.keys(schemaMap)) compiler.addDocument(schemaMap[uri], uri);
  return compiler.finish(rootNode);
}
