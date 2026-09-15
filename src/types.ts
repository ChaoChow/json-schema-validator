/** A JSON Schema 2020-12 document: either a boolean or a keyword object. */
export type Schema = boolean | SchemaObject;

export type SchemaType = 'null' | 'boolean' | 'object' | 'array' | 'number' | 'integer' | 'string';

/**
 * Keyword object for authoring. Every 2020-12 keyword is typed; unknown keywords are allowed
 * and ignored at validation time.
 */
export interface SchemaObject {
  $id?: string;
  $schema?: string;
  $ref?: string;
  $anchor?: string;
  $dynamicRef?: string;
  $dynamicAnchor?: string;
  $vocabulary?: Record<string, boolean>;
  $comment?: string;
  $defs?: Record<string, Schema>;

  type?: SchemaType | SchemaType[];
  enum?: unknown[];
  const?: unknown;
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  maxContains?: number;
  minContains?: number;
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  dependentRequired?: Record<string, string[]>;
  format?: string;

  prefixItems?: Schema[];
  items?: Schema;
  contains?: Schema;
  additionalProperties?: Schema;
  properties?: Record<string, Schema>;
  patternProperties?: Record<string, Schema>;
  dependentSchemas?: Record<string, Schema>;
  propertyNames?: Schema;
  if?: Schema;
  then?: Schema;
  else?: Schema;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  not?: Schema;
  unevaluatedItems?: Schema;
  unevaluatedProperties?: Schema;

  title?: string;
  description?: string;
  default?: unknown;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  examples?: unknown[];
  contentEncoding?: string;
  contentMediaType?: string;
  contentSchema?: Schema;

  [keyword: string]: unknown;
}

export interface ValidatorOptions {
  /** Extra documents keyed by retrieval URI (must be absolute). `$ref`s may target them. */
  schemas?: Record<string, unknown>;
  /** Make `format` an assertion instead of an annotation. Off by default, per the spec. */
  assertFormat?: boolean;
}

/** One failing keyword, in the spec's "basic" output shape (core §12.3). */
export interface ValidationError {
  /** JSON pointer to the failing part of the instance. */
  instanceLocation: string;
  /** JSON pointer to the keyword, including `$ref` hops (e.g. `/properties/a/$ref/type`). */
  keywordLocation: string;
  /** URI of the keyword; absent when the enclosing resource has no absolute URI. */
  absoluteKeywordLocation?: string;
  keyword: string;
  error: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
