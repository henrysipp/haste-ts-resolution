'use strict';
const path = require('path');

/**
 * TypeScript language service plugin that resolves Haste-style module names.
 */
function init(modules) {
  const ts = modules.typescript;

  function create(info) {
    const logger = getLogger(info);
    try {
      const config = normalizeConfig(info.config || {}, info.project.getCurrentDirectory());
      const state = createState(ts, info, config, logger);

      // Critical: TypeScript resolution for diagnostics/go-to-def is driven by the host,
      // so patch the host resolvers directly.
      patchLanguageServiceHostResolvers(info, state, logger);

      const languageService = info.languageService;
      const proxy = Object.create(null);

      for (const key of Object.keys(languageService)) {
        const value = languageService[key];
        proxy[key] = typeof value === 'function' ? value.bind(languageService) : value;
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

function patchLanguageServiceHostResolvers(info, state, logger) {
  const host = info.languageServiceHost;
  const patchFlag = '__hasteTsPatched';
  if (host[patchFlag]) {
    return;
  }
  host[patchFlag] = true;

  const moduleResolutionHost = createModuleResolutionHost(host);

  if (typeof host.resolveModuleNameLiterals === 'function') {
    const prior = host.resolveModuleNameLiterals.bind(host);

    host.resolveModuleNameLiterals = function resolveModuleNameLiterals(
      moduleLiterals,
      containingFile,
      redirectedReference,
      options,
      containingSourceFile,
      reusedNames
    ) {
      try {
        const priorResults = prior(
          moduleLiterals,
          containingFile,
          redirectedReference,
          options,
          containingSourceFile,
          reusedNames
        );

        state.refreshIfNeeded();

        return moduleLiterals.map((literal, index) => {
          const existing = priorResults && priorResults[index];
          if (existing && existing.resolvedModule) {
            return existing;
          }

          const specifier = getLiteralText(literal);
          if (!isBareSpecifier(specifier)) {
            return existing || { resolvedModule: undefined };
          }

          const resolved = state.resolve(specifier, containingFile);
          return resolved ? { resolvedModule: resolved } : (existing || { resolvedModule: undefined });
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
    };

    logger.info('[ts-haste-plugin] patched host.resolveModuleNameLiterals');
    return;
  }

  if (typeof host.resolveModuleNames === 'function') {
    const prior = host.resolveModuleNames.bind(host);

    host.resolveModuleNames = function resolveModuleNames(
      moduleNames,
      containingFile,
      reusedNames,
      redirectedReference,
      options,
      containingSourceFile
    ) {
      try {
        const priorResults = prior(
          moduleNames,
          containingFile,
          reusedNames,
          redirectedReference,
          options,
          containingSourceFile
        );

        state.refreshIfNeeded();

        return moduleNames.map((name, index) => {
          if (priorResults && priorResults[index]) {
            return priorResults[index];
          }

          if (!isBareSpecifier(name)) {
            return priorResults ? priorResults[index] : undefined;
          }

          return state.resolve(name, containingFile) || (priorResults ? priorResults[index] : undefined);
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
    };

    logger.info('[ts-haste-plugin] patched host.resolveModuleNames');
    return;
  }

  // Fallback for hosts that do not provide custom resolvers.
  host.resolveModuleNameLiterals = function resolveModuleNameLiterals(
    moduleLiterals,
    containingFile,
    redirectedReference,
    options,
    containingSourceFile,
    reusedNames
  ) {
    try {
      state.refreshIfNeeded();

      return moduleLiterals.map((literal) => {
        const specifier = getLiteralText(literal);
        const resolved = resolveWithFallback(specifier, containingFile, options, moduleResolutionHost, state);
        return { resolvedModule: resolved };
      });
    } catch (error) {
      logger.info(`[ts-haste-plugin] resolver error (fallback literals): ${formatError(error)}`);
      return moduleLiterals.map(() => ({ resolvedModule: undefined }));
    }
  };

  logger.info('[ts-haste-plugin] installed fallback host.resolveModuleNameLiterals');
}

function resolveWithFallback(name, containingFile, options, moduleResolutionHost, state) {
  if (!isBareSpecifier(name)) {
    return undefined;
  }

  const tsResolved = state.ts.resolveModuleName(name, containingFile, options || {}, moduleResolutionHost)
    .resolvedModule;

  if (tsResolved) {
    return tsResolved;
  }

  return state.resolve(name, containingFile);
}

function createModuleResolutionHost(host) {
  return {
    fileExists: typeof host.fileExists === 'function' ? host.fileExists.bind(host) : require('fs').existsSync,
    readFile: typeof host.readFile === 'function' ? host.readFile.bind(host) : readFileSafe,
    directoryExists: typeof host.directoryExists === 'function' ? host.directoryExists.bind(host) : undefined,
    getCurrentDirectory: typeof host.getCurrentDirectory === 'function'
      ? host.getCurrentDirectory.bind(host)
      : process.cwd,
    realpath: typeof host.realpath === 'function' ? host.realpath.bind(host) : undefined,
    getDirectories: typeof host.getDirectories === 'function' ? host.getDirectories.bind(host) : undefined,
    useCaseSensitiveFileNames: typeof host.useCaseSensitiveFileNames === 'function'
      ? host.useCaseSensitiveFileNames.bind(host)
      : true
  };
}

function readFileSafe(path) {
  try {
    return require('fs').readFileSync(path, 'utf8');
  } catch (_) {
    return undefined;
  }
}

function createState(ts, info, config, logger) {
  let lastProjectVersion = null;
  let moduleIndex = new Map();

  function refreshIfNeeded() {
    const projectVersion = safeGetProjectVersion(info.project);
    if (projectVersion === lastProjectVersion) {
      return;
    }

    moduleIndex = buildModuleIndex(info, config, logger);
    lastProjectVersion = projectVersion;
  }

  function resolve(name, containingFile) {
    const candidates = moduleIndex.get(name);
    if (!candidates || candidates.length === 0) {
      return undefined;
    }

    const best = pickBestCandidate(candidates, config, containingFile);
    if (!best) {
      return undefined;
    }

    return {
      resolvedFileName: best.filePath,
      extension: toTsExtension(ts, best.filePath),
      isExternalLibraryImport: false
    };
  }

  return {
    ts,
    refreshIfNeeded,
    resolve
  };
}

function buildModuleIndex(info, config, logger) {
  const index = new Map();
  const scripts = info.languageServiceHost.getScriptFileNames();

  for (const filePath of scripts) {
    if (!shouldIndexFile(filePath, config)) {
      continue;
    }

    const moduleName = moduleNameFromFilename(filePath, config.indexAsPackage);
    if (!moduleName) {
      continue;
    }

    const parsed = parsePlatform(filePath, config.platforms);
    const candidates = index.get(moduleName) || [];
    candidates.push({ filePath, platform: parsed.platform });
    index.set(moduleName, candidates);
  }

  detectAndLogCollisions(index, logger);
  return index;
}

function detectAndLogCollisions(index, logger) {
  for (const [moduleName, candidates] of index.entries()) {
    if (candidates.length <= 1) {
      continue;
    }

    const uniquePlatforms = new Set(candidates.map((c) => c.platform || 'default'));
    if (uniquePlatforms.size === candidates.length) {
      continue;
    }

    logger.info(
      `[ts-haste-plugin] collision for '${moduleName}': ${candidates.map((c) => c.filePath).join(', ')}`
    );
  }
}

function pickBestCandidate(candidates, config, containingFile) {
  const containingPlatform = parsePlatform(containingFile, config.platforms).platform;
  const platformOrder = createPlatformOrder(config.platforms, containingPlatform);

  const sorted = candidates.slice().sort((a, b) => {
    const aPriority = platformPriority(platformOrder, a.platform);
    const bPriority = platformPriority(platformOrder, b.platform);

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return a.filePath.localeCompare(b.filePath);
  });

  return sorted[0];
}

function createPlatformOrder(platforms, preferred) {
  const order = [];
  if (preferred && platforms.includes(preferred)) {
    order.push(preferred);
  }

  for (const platform of platforms) {
    if (!order.includes(platform)) {
      order.push(platform);
    }
  }

  order.push('default');
  return order;
}

function platformPriority(order, platform) {
  const key = platform || 'default';
  const index = order.indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function parsePlatform(filePath, knownPlatforms) {
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  const match = fileName.match(/\.([a-z0-9_]+)\.[^.]+$/i);

  if (!match) {
    return { platform: undefined };
  }

  const platform = match[1];
  if (knownPlatforms.includes(platform)) {
    return { platform };
  }

  return { platform: undefined };
}

function shouldIndexFile(filePath, config) {
  if (!filePath || filePath.includes('/node_modules/') || filePath.includes('\\node_modules\\')) {
    return false;
  }

  const normalized = stripTrailingSlash(normalizeSlashes(filePath));
  const root = stripTrailingSlash(normalizeSlashes(config.rootDir));
  if (!isPathInsideOrEqual(normalized, root)) {
    return false;
  }

  if (config.excludeDirs.some((dir) => isPathInsideOrEqual(normalized, dir))) {
    return false;
  }

  return config.extensions.some((ext) => normalized.endsWith(ext));
}

function moduleNameFromFilename(filePath, indexAsPackage) {
  const normalized = normalizeSlashes(filePath);
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1];

  const stripped = fileName
    .replace(/\.[a-z0-9_]+\.[^.]+$/i, '')
    .replace(/\.[^.]+$/, '');

  if (stripped.toLowerCase() === 'index' && indexAsPackage) {
    const parent = parts[parts.length - 2];
    return parent || undefined;
  }

  return stripped || undefined;
}

function normalizeConfig(rawConfig, projectDir) {
  const rootDirInput = rawConfig.rootDir || projectDir;
  const absoluteRootDir = path.isAbsolute(rootDirInput)
    ? rootDirInput
    : path.join(projectDir, rootDirInput);

  const config = {
    rootDir: absoluteRootDir,
    extensions: Array.isArray(rawConfig.extensions) && rawConfig.extensions.length > 0
      ? rawConfig.extensions
      : ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
    platforms: Array.isArray(rawConfig.platforms) && rawConfig.platforms.length > 0
      ? rawConfig.platforms
      : ['ios', 'android', 'native', 'web'],
    excludeDirs: normalizeExcludeDirs(rawConfig.excludeDirs, absoluteRootDir),
    indexAsPackage: rawConfig.indexAsPackage !== false
  };

  config.rootDir = stripTrailingSlash(normalizeSlashes(config.rootDir));
  return config;
}

function safeGetProjectVersion(project) {
  try {
    if (typeof project.getProjectVersion === 'function') {
      return project.getProjectVersion();
    }
  } catch (_) {
    // no-op
  }

  return String(Date.now());
}

function toTsExtension(ts, filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.d.ts')) return ts.Extension.Dts;
  if (lower.endsWith('.tsx')) return ts.Extension.Tsx;
  if (lower.endsWith('.ts')) return ts.Extension.Ts;
  if (lower.endsWith('.jsx')) return ts.Extension.Jsx;
  if (lower.endsWith('.js')) return ts.Extension.Js;
  if (lower.endsWith('.mts')) return ts.Extension.Mts || ts.Extension.Ts;
  if (lower.endsWith('.cts')) return ts.Extension.Cts || ts.Extension.Ts;
  if (lower.endsWith('.mjs')) return ts.Extension.Mjs || ts.Extension.Js;
  if (lower.endsWith('.cjs')) return ts.Extension.Cjs || ts.Extension.Js;
  return ts.Extension.Ts;
}

function getLiteralText(node) {
  if (!node) {
    return '';
  }

  if (typeof node.text === 'string') {
    return node.text;
  }

  return String(node);
}

function isBareSpecifier(name) {
  if (!name || typeof name !== 'string') {
    return false;
  }

  if (name.startsWith('.') || name.startsWith('/') || name.startsWith('..')) {
    return false;
  }

  // URLs and special schemes are not Haste module names.
  if (name.includes(':')) {
    return false;
  }

  return true;
}

function getLogger(info) {
  const logger = info.project && info.project.projectService && info.project.projectService.logger;
  if (logger && typeof logger.info === 'function') {
    return logger;
  }

  return {
    info: function noop() {}
  };
}

function normalizeExcludeDirs(excludeDirs, rootDir) {
  if (!Array.isArray(excludeDirs)) {
    return [];
  }

  return excludeDirs
    .filter((dir) => typeof dir === 'string' && dir.trim())
    .map((dir) => {
      const absolute = path.isAbsolute(dir) ? dir : path.join(rootDir, dir);
      return stripTrailingSlash(normalizeSlashes(absolute));
    });
}

function isPathInsideOrEqual(filePath, directory) {
  return filePath === directory || filePath.startsWith(directory + '/');
}

function stripTrailingSlash(filePath) {
  return filePath.replace(/\/+$/, '');
}

function normalizeSlashes(filePath) {
  return filePath.replace(/\\/g, '/');
}

function formatError(error) {
  if (!error) {
    return 'unknown error';
  }

  if (error && typeof error.stack === 'string') {
    return error.stack;
  }

  return String(error);
}

module.exports = init;
