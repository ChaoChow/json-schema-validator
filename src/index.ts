import { compile, type CompiledSchema } from './compile.js';
import type { Schema, ValidationResult, ValidatorOptions } from './types.js';
import { validateInstance } from './validate.js';

export { SchemaError, type SchemaProblem } from './schema-error.js';
export type { Schema, SchemaObject, SchemaType, ValidationError, ValidationResult, ValidatorOptions } from './types.js';

/**
 * A JSON Schema 2020-12 validator. The constructor checks the schema (and every document in
 * `options.schemas`) and throws `SchemaError` listing every problem; `validate()` then never throws.
 */
export class Validator {
  /** The root schema as given. Not cloned or frozen: mutating it after construction is undefined behaviour. */
  readonly schema: Schema;
  private readonly compiled: CompiledSchema;
  private readonly assertFormat: boolean;

  constructor(schema: unknown, options: ValidatorOptions = {}) {
    this.compiled = compile(schema, options.schemas);
    this.schema = schema as Schema;
    this.assertFormat = options.assertFormat === true;
  }

  /** Returns every failing keyword; `errors` is empty exactly when `valid` is true. */
  validate(instance: unknown): ValidationResult {
    const errors = validateInstance(this.compiled, this.assertFormat, instance);
    return { valid: errors.length === 0, errors };
  }
}

/** `new Validator(schema, options).validate(instance)`. */
export function validate(schema: unknown, instance: unknown, options?: ValidatorOptions): ValidationResult {
  return new Validator(schema, options).validate(instance);
}
