# @chaochow/json-schema-validator

Package that validates JSON against JSON Schema

## Install

```sh
npm install @chaochow/json-schema-validator
```

## Usage

```ts
import { hello } from '@chaochow/json-schema-validator';

hello(); // Hello, world!
```

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
| `test`          | Run tests once                                     |
| `test:watch`    | Run tests in watch mode                            |
| `test:coverage` | Run tests with coverage (80% threshold)            |
| `check`         | typecheck + lint + format:check + test:coverage    |
| `publish:npm`   | Publish to npm (runs `prepublishOnly` guard first) |

## Git hooks

Wired up by `npm install` via `.githooks/`:

- `pre-commit` — Prettier + ESLint fix on staged files
- `pre-push` — `npm run check`
