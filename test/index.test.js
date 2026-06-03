'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const init = require('../index');

const rootDir = normalize('/tmp/haste-ts-plugin/src');

test('resolves bare imports by filename through resolveModuleNameLiterals', () => {
  const buttonPath = file('components/Button.ts');
  const appPath = file('App.ts');
  const host = createHost({
    scripts: [appPath, buttonPath],
    resolveModuleNameLiterals: (moduleLiterals) => moduleLiterals.map(() => ({ resolvedModule: undefined }))
  });

  createPlugin({ host });

  const [result] = host.resolveModuleNameLiterals([{ text: 'Button' }], appPath);

  assert.deepEqual(result.resolvedModule, {
    resolvedFileName: buttonPath,
    extension: ts.Extension.Ts,
    isExternalLibraryImport: false
  });
});

test('ignores providesModule config and docblocks', () => {
  const actualPath = file('components/ActualName.ts');
  const appPath = file('App.ts');
  const host = createHost({
    scripts: [appPath, actualPath],
    readFile: () => [
      '/**',
      ' * @providesModule LegacyName',
      ' */',
      'export const value = 1;'
    ].join('\n'),
    resolveModuleNameLiterals: (moduleLiterals) => moduleLiterals.map(() => ({ resolvedModule: undefined }))
  });

  createPlugin({
    host,
    config: {
      rootDir,
      strategy: ['providesModule'],
      providesModuleTag: 'providesModule'
    }
  });

  const [legacyResult] = host.resolveModuleNameLiterals([{ text: 'LegacyName' }], appPath);
  const [filenameResult] = host.resolveModuleNameLiterals([{ text: 'ActualName' }], appPath);

  assert.equal(legacyResult.resolvedModule, undefined);
  assert.equal(filenameResult.resolvedModule.resolvedFileName, actualPath);
});

test('prefers the importing file platform when multiple filename candidates exist', () => {
  const defaultPath = file('components/Button.ts');
  const iosPath = file('components/Button.ios.ts');
  const appPath = file('App.ios.ts');
  const host = createHost({
    scripts: [appPath, defaultPath, iosPath],
    resolveModuleNameLiterals: (moduleLiterals) => moduleLiterals.map(() => ({ resolvedModule: undefined }))
  });

  createPlugin({ host });

  const [result] = host.resolveModuleNameLiterals([{ text: 'Button' }], appPath);

  assert.equal(result.resolvedModule.resolvedFileName, iosPath);
});

test('maps package index files to the parent directory name by default', () => {
  const packageIndexPath = file('components/Card/index.ts');
  const appPath = file('App.ts');
  const host = createHost({
    scripts: [appPath, packageIndexPath],
    resolveModuleNameLiterals: (moduleLiterals) => moduleLiterals.map(() => ({ resolvedModule: undefined }))
  });

  createPlugin({ host });

  const [result] = host.resolveModuleNameLiterals([{ text: 'Card' }], appPath);

  assert.equal(result.resolvedModule.resolvedFileName, packageIndexPath);
});

test('keeps existing TypeScript module resolutions', () => {
  const buttonPath = file('components/Button.ts');
  const appPath = file('App.ts');
  const existingResolution = {
    resolvedFileName: file('../node_modules/react/index.d.ts'),
    extension: ts.Extension.Dts,
    isExternalLibraryImport: true
  };
  const host = createHost({
    scripts: [appPath, buttonPath],
    resolveModuleNameLiterals: (moduleLiterals) => moduleLiterals.map((literal) => {
      return literal.text === 'react'
        ? { resolvedModule: existingResolution }
        : { resolvedModule: undefined };
    })
  });

  createPlugin({ host });

  const [result] = host.resolveModuleNameLiterals([{ text: 'react' }], appPath);

  assert.equal(result.resolvedModule, existingResolution);
});

function createPlugin({ host, config = { rootDir } }) {
  const plugin = init({ typescript: ts });
  return plugin.create({
    config,
    languageService: {
      getProgram() {
        return undefined;
      }
    },
    languageServiceHost: host,
    project: {
      getCurrentDirectory() {
        return rootDir;
      },
      getProjectName() {
        return 'unit-test-project';
      },
      getProjectVersion() {
        return '1';
      },
      projectService: {
        logger: {
          info() {}
        }
      }
    }
  });
}

function createHost({ scripts, resolveModuleNameLiterals, readFile }) {
  return {
    getScriptFileNames() {
      return scripts;
    },
    resolveModuleNameLiterals,
    readFile,
    fileExists() {
      return false;
    },
    getCurrentDirectory() {
      return rootDir;
    },
    useCaseSensitiveFileNames() {
      return true;
    }
  };
}

function file(relativePath) {
  return normalize(path.join(rootDir, relativePath));
}

function normalize(filePath) {
  return filePath.replace(/\\/g, '/');
}
