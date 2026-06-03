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
npm install
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
        "rootDir": ".",
        "platforms": ["ios", "android", "native", "web"],
        "indexAsPackage": true
      }
    ]
  }
}
```

## Plugin Options

- `rootDir`: Base directory to index. Default: project root.
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

## Quick Try (Editor)

1. Open `examples/` in VS Code.
2. Ensure the workspace TypeScript version is used.
3. In `examples/src/App.ts`, `import { Button } from 'Button'` should resolve via plugin.

Files included for this demo:

- `examples/tsconfig.json`
- `examples/src/components/Button.ts`
- `examples/src/App.ts`
