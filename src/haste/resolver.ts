import type ts from 'typescript';
import { buildHasteMap, loadHasteImpl, resolveHasteModule } from './map';
import { isBareSpecifier } from './specifier';
import { toTsExtension } from './tsExtension';
import type { HasteConfig, HasteLogger, ResolvedHasteModule } from '../types';

export interface HasteResolver {
  refreshIfNeeded(): void;
  resolve(name: string, containingFile: string): ResolvedHasteModule | undefined;
  resolveWithTsFallback(
    name: string,
    containingFile: string,
    options: ts.CompilerOptions | undefined,
    moduleResolutionHost: ts.ModuleResolutionHost
  ): ts.ResolvedModuleFull | undefined;
}

export function createHasteResolver(options: {
  ts: typeof ts;
  config: HasteConfig;
  projectDir: string;
  getScriptFileNames: () => readonly string[];
  getProjectVersion: () => string;
  logger: HasteLogger;
}): HasteResolver {
  const { ts: tsModule, config, projectDir, getScriptFileNames, getProjectVersion, logger } = options;
  let lastProjectVersion: string | null = null;
  let hasteMap: ReturnType<typeof buildHasteMap> | null = null;
  const hasteImpl = loadHasteImpl(config, projectDir);

  function refreshIfNeeded(): void {
    const projectVersion = getProjectVersion();
    if (projectVersion === lastProjectVersion) {
      return;
    }

    hasteMap = buildHasteMap(getScriptFileNames(), config, hasteImpl, logger);
    lastProjectVersion = projectVersion;
  }

  function resolve(name: string, containingFile: string): ResolvedHasteModule | undefined {
    if (!isBareSpecifier(name) || !hasteMap) {
      return undefined;
    }

    const resolvedFileName = resolveHasteModule(hasteMap, config, name, containingFile);
    if (!resolvedFileName) {
      return undefined;
    }

    return {
      resolvedFileName,
      extension: toTsExtension(tsModule, resolvedFileName),
      isExternalLibraryImport: false
    };
  }

  function resolveWithTsFallback(
    name: string,
    containingFile: string,
    options: ts.CompilerOptions | undefined,
    moduleResolutionHost: ts.ModuleResolutionHost
  ): ts.ResolvedModuleFull | undefined {
    if (!isBareSpecifier(name)) {
      return undefined;
    }

    const tsResolved = tsModule.resolveModuleName(name, containingFile, options || {}, moduleResolutionHost)
      .resolvedModule;

    if (tsResolved) {
      return tsResolved;
    }

    return resolve(name, containingFile);
  }

  return {
    refreshIfNeeded,
    resolve,
    resolveWithTsFallback
  };
}
