export interface SchemaProblem {
  /** `<resource URI>#<JSON pointer>` of the offending keyword; the URI part is empty for an anonymous root. */
  schemaLocation: string;
  message: string;
}

/** Thrown by the `Validator` constructor when the schema (or any document in `schemas`) is invalid. */
export class SchemaError extends Error {
  override readonly name = 'SchemaError';
  readonly errors: SchemaProblem[];

  constructor(errors: SchemaProblem[]) {
    super(
      `invalid schema (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n` +
        errors.map((e) => `  ${e.schemaLocation}: ${e.message}`).join('\n'),
    );
    this.errors = errors;
  }
}
