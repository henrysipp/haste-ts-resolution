import path from 'path';
import { HastePlugin } from 'metro-file-map';
import getPlatformExtension from 'metro-file-map/src/plugins/haste/getPlatformExtension';
import { shouldIndexFile } from './config';
import { createDefaultHasteImpl } from './defaultHasteImpl';
import { normalizeSlashes } from './paths';
import type { HasteConfig, HasteImpl, HasteLogger } from '../types';

const HASTE_MODULE = 0;

export function loadHasteImpl(config: HasteConfig, projectDir: string): HasteImpl {
  if (config.hasteImplModulePath) {
    const implPath = path.isAbsolute(config.hasteImplModulePath)
      ? config.hasteImplModulePath
      : path.join(projectDir, config.hasteImplModulePath);
    return require(implPath) as HasteImpl;
  }

  return createDefaultHasteImpl({
    platforms: config.platforms,
    extensions: config.extensions
  });
}

export function buildHasteMap(
  scripts: readonly string[],
  config: HasteConfig,
  hasteImpl: HasteImpl,
  logger: HasteLogger
): HastePlugin {
  const hasteMap = new HastePlugin({
    rootDir: config.rootDir,
    platforms: new Set(config.platforms),
    enableHastePackages: false,
    failValidationOnConflicts: false,
    console: logger
  });

  for (const filePath of scripts) {
    if (!shouldIndexFile(filePath, config)) {
      continue;
    }

    let id = hasteImpl.getHasteName(filePath);
    if (id == null) {
      continue;
    }

    if (config.indexAsPackage && id.toLowerCase() === 'index') {
      id = path.basename(path.dirname(filePath));
      if (!id) {
        continue;
      }
    }

    const relativePath = normalizeSlashes(path.relative(config.rootDir, filePath));
    hasteMap.setModule(id, [relativePath, HASTE_MODULE]);
  }

  return hasteMap;
}

export function resolveHasteModule(
  hasteMap: HastePlugin,
  config: HasteConfig,
  name: string,
  containingFile: string
): string | null {
  const platform = getPlatformExtension(containingFile, new Set(config.platforms));
  return hasteMap.getModule(name, platform, true);
}
