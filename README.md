# haste-ts-plugin

TypeScript language service plugin that adds Haste-style module resolution in editors.

## What It Does

Resolves bare imports like:

```ts
import Button from 'Button';
```

to project files using filename-based module names.

This affects **TypeScript editor services** (`tsserver`) only. Your runtime/bundler resolver (Metro/Jest/Babel/etc.) still needs matching Haste behavior.

## Install

```bash
yarn add -D haste-ts-plugin
```

This package is self-contained (no runtime dependencies).

## tsconfig Setup

In your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "haste-ts-plugin",
        "rootDir": "./src",
        "excludeDirs": ["app"],
        "platforms": ["ios", "android", "native", "web"],
        "indexAsPackage": true
      }
    ]
  }
}
```

## Plugin Options

- `rootDir`: Base directory to index. Default: project root.
- `excludeDirs`: Directories under `rootDir` to skip, e.g. `["app"]` excludes `src/app` when `rootDir` is `./src`.
- `platforms`: Platform priority list for files like `Button.ios.ts`.
- `extensions`: File extensions to index.
- `indexAsPackage`: If true, `Foo/index.ts` maps to `Foo`.

Module names are mapped from filenames, e.g. `src/components/Button.ts` resolves for:

```ts
import { Button } from 'Button';
```

## Notes

- Collisions are logged to the TypeScript server log.
- If multiple candidates exist, platform-specific files are prioritized based on `platforms` and the importing file platform.
- TypeScript compiler plugins in `compilerOptions.plugins` are language-service plugins only. They improve editor/tsserver diagnostics but are ignored by `tsc`, so `yarn tsc --noEmit` still needs matching `paths` mappings or another patched typecheck runner.

## Quick Try (Editor)

1. Open `examples/` in VS Code.
2. Ensure the workspace TypeScript version is used.
3. In `examples/src/App.ts`, `import { Button } from 'Button'` should resolve via plugin.

Files included for this demo:

- `examples/tsconfig.json`
- `examples/src/components/Button.ts`
- `examples/src/App.ts`
