import fs from 'fs';
import type ts from 'typescript';
import { createHasteResolver, isBareSpecifier, normalizeConfig } from './haste';
import type { HasteLogger } from './types';

type LanguageServiceHost = ts.server.PluginCreateInfo['languageServiceHost'];
type PatchedHost = LanguageServiceHost & {
  __hasteTsPatched?: boolean;
};

/**
 * TypeScript language service plugin that resolves Haste-style module names.
 */
function init(modules: { typescript: typeof ts }) {
  const tsModule = modules.typescript;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const logger = getLogger(info);
    try {
      const config = normalizeConfig(info.config || {}, info.project.getCurrentDirectory());
      const resolver = createHasteResolver({
        ts: tsModule,
        config,
        projectDir: info.project.getCurrentDirectory(),
        getScriptFileNames: () => info.languageServiceHost.getScriptFileNames(),
        getProjectVersion: () => safeGetProjectVersion(info.project),
        logger
      });

      patchLanguageServiceHostResolvers(info, resolver, logger);

      const languageService = info.languageService;
      const proxy: ts.LanguageService = Object.create(null);

      for (const key of Object.keys(languageService) as Array<keyof ts.LanguageService>) {
        const value = languageService[key];
        proxy[key] = (typeof value === 'function' ? value.bind(languageService) : value) as never;
      }

      logger.info(`[ts-haste-plugin] enabled for project ${info.project.getProjectName()}`);
      return proxy;
    } catch (error) {
      logger.info(`[ts-haste-plugin] initialization failed, falling back: ${formatError(error)}`);
      return info.languageService;
    }
  }

  return { create };
}

function patchLanguageServiceHostResolvers(
  info: ts.server.PluginCreateInfo,
  resolver: ReturnType<typeof createHasteResolver>,
  logger: HasteLogger
): void {
  const host = info.languageServiceHost as PatchedHost;
  if (host.__hasteTsPatched) {
    return;
  }
  host.__hasteTsPatched = true;

  const moduleResolutionHost = createModuleResolutionHost(host);

  if (typeof host.resolveModuleNameLiterals === 'function') {
    const prior = host.resolveModuleNameLiterals.bind(host);
    type ResolveLiterals = NonNullable<PatchedHost['resolveModuleNameLiterals']>;

    host.resolveModuleNameLiterals = ((
      moduleLiterals,
      containingFile,
      redirectedReference,
      options,
      containingSourceFile,
      reusedNames
    ) => {
      try {
        const priorResults = prior(
          moduleLiterals,
          containingFile,
          redirectedReference,
          options,
          containingSourceFile,
          reusedNames
        );

        resolver.refreshIfNeeded();

        return moduleLiterals.map((literal, index) => {
          const existing = priorResults?.[index];
          if (existing?.resolvedModule) {
            return existing;
          }

          const specifier = getLiteralText(literal);
          if (!isBareSpecifier(specifier)) {
            return existing ?? { resolvedModule: undefined };
          }

          const resolved = resolver.resolve(specifier, containingFile);
          return resolved ? { resolvedModule: resolved } : (existing ?? { resolvedModule: undefined });
        });
      } catch (error) {
        logger.info(`[ts-haste-plugin] resolver error (literals), falling back: ${formatError(error)}`);
        return prior(
          moduleLiterals,
          containingFile,
          redirectedReference,
          options,
          containingSourceFile,
          reusedNames
        );
      }
    }) as ResolveLiterals;

    logger.info('[ts-haste-plugin] patched host.resolveModuleNameLiterals');
    return;
  }

  if (typeof host.resolveModuleNames === 'function') {
    const prior = host.resolveModuleNames.bind(host);
    type ResolveNames = NonNullable<PatchedHost['resolveModuleNames']>;

    host.resolveModuleNames = ((
      moduleNames,
      containingFile,
      reusedNames,
      redirectedReference,
      options,
      containingSourceFile
    ) => {
      try {
        const priorResults = prior(
          moduleNames,
          containingFile,
          reusedNames,
          redirectedReference,
          options,
          containingSourceFile
        );

        resolver.refreshIfNeeded();

        return moduleNames.map((name, index) => {
          if (priorResults?.[index]) {
            return priorResults[index];
          }

          if (!isBareSpecifier(name)) {
            return priorResults?.[index];
          }

          return resolver.resolve(name, containingFile) ?? priorResults?.[index];
        });
      } catch (error) {
        logger.info(`[ts-haste-plugin] resolver error (names), falling back: ${formatError(error)}`);
        return prior(
          moduleNames,
          containingFile,
          reusedNames,
          redirectedReference,
          options,
          containingSourceFile
        );
      }
    }) as ResolveNames;

    logger.info('[ts-haste-plugin] patched host.resolveModuleNames');
    return;
  }

  type ResolveLiterals = NonNullable<PatchedHost['resolveModuleNameLiterals']>;

  host.resolveModuleNameLiterals = ((
    moduleLiterals,
    containingFile,
    redirectedReference,
    options,
    containingSourceFile,
    reusedNames
  ) => {
    try {
      resolver.refreshIfNeeded();

      return moduleLiterals.map((literal) => {
        const specifier = getLiteralText(literal);
        const resolved = resolver.resolveWithTsFallback(
          specifier,
          containingFile,
          options,
          moduleResolutionHost
        );
        return { resolvedModule: resolved };
      });
    } catch (error) {
      logger.info(`[ts-haste-plugin] resolver error (fallback literals): ${formatError(error)}`);
      return moduleLiterals.map(() => ({ resolvedModule: undefined }));
    }
  }) as ResolveLiterals;

  logger.info('[ts-haste-plugin] installed fallback host.resolveModuleNameLiterals');
}

function createModuleResolutionHost(host: LanguageServiceHost): ts.ModuleResolutionHost {
  return {
    fileExists: typeof host.fileExists === 'function' ? host.fileExists.bind(host) : fs.existsSync,
    readFile: typeof host.readFile === 'function' ? host.readFile.bind(host) : readFileSafe,
    directoryExists: typeof host.directoryExists === 'function' ? host.directoryExists.bind(host) : undefined,
    getCurrentDirectory: typeof host.getCurrentDirectory === 'function'
      ? host.getCurrentDirectory.bind(host)
      : () => process.cwd(),
    realpath: typeof host.realpath === 'function' ? host.realpath.bind(host) : undefined,
    getDirectories: typeof host.getDirectories === 'function' ? host.getDirectories.bind(host) : undefined,
    useCaseSensitiveFileNames: typeof host.useCaseSensitiveFileNames === 'function'
      ? host.useCaseSensitiveFileNames.bind(host)
      : () => true
  };
}

function readFileSafe(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function safeGetProjectVersion(project: ts.server.Project): string {
  try {
    if (typeof project.getProjectVersion === 'function') {
      return project.getProjectVersion();
    }
  } catch {
    // no-op
  }

  return String(Date.now());
}

function getLiteralText(node: ts.StringLiteralLike | undefined): string {
  if (!node) {
    return '';
  }

  if (typeof node.text === 'string') {
    return node.text;
  }

  return String(node);
}

function getLogger(info: ts.server.PluginCreateInfo): HasteLogger {
  const logger = info.project.projectService?.logger;
  if (logger && typeof logger.info === 'function') {
    return logger as HasteLogger;
  }

  return {
    info() {}
  };
}

function formatError(error: unknown): string {
  if (!error) {
    return 'unknown error';
  }

  if (error instanceof Error && typeof error.stack === 'string') {
    return error.stack;
  }

  return String(error);
}

export = init;
