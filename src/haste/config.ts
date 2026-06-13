import path from 'path';
import type { HasteConfig } from '../types';
import { isPathInsideOrEqual, normalizeSlashes, stripTrailingSlash } from './paths';

export function normalizeConfig(rawConfig: Record<string, unknown>, projectDir: string): HasteConfig {
  const rootDirInput = typeof rawConfig.rootDir === 'string' ? rawConfig.rootDir : projectDir;
  const absoluteRootDir = path.isAbsolute(rootDirInput)
    ? rootDirInput
    : path.join(projectDir, rootDirInput);

  const config: HasteConfig = {
    rootDir: absoluteRootDir,
    extensions: Array.isArray(rawConfig.extensions) && rawConfig.extensions.length > 0
      ? rawConfig.extensions.filter((ext): ext is string => typeof ext === 'string')
      : ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
    platforms: Array.isArray(rawConfig.platforms) && rawConfig.platforms.length > 0
      ? rawConfig.platforms.filter((platform): platform is string => typeof platform === 'string')
      : ['ios', 'android', 'native', 'web'],
    excludeDirs: normalizeExcludeDirs(rawConfig.excludeDirs, absoluteRootDir),
    indexAsPackage: rawConfig.indexAsPackage !== false,
    hasteImplModulePath: typeof rawConfig.hasteImplModulePath === 'string'
      ? rawConfig.hasteImplModulePath
      : undefined
  };

  config.rootDir = stripTrailingSlash(normalizeSlashes(config.rootDir));
  return config;
}

function normalizeExcludeDirs(excludeDirs: unknown, rootDir: string): string[] {
  if (!Array.isArray(excludeDirs)) {
    return [];
  }

  return excludeDirs
    .filter((dir): dir is string => typeof dir === 'string' && dir.trim().length > 0)
    .map((dir) => {
      const absolute = path.isAbsolute(dir) ? dir : path.join(rootDir, dir);
      return stripTrailingSlash(normalizeSlashes(absolute));
    });
}

export function shouldIndexFile(filePath: string, config: HasteConfig): boolean {
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
