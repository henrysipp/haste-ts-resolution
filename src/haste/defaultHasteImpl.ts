import path from 'path';
import type { HasteImpl } from '../types';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filename-based getHasteName matching jest-haste-map's reference test impl,
 * generalized for configurable platforms and source extensions.
 */
export function createDefaultHasteImpl({
  platforms,
  extensions
}: {
  platforms: string[];
  extensions: string[];
}): HasteImpl {
  const platformGroup = platforms.map(escapeRegex).join('|');
  const extensionGroup = extensions
    .map((ext) => escapeRegex(ext.startsWith('.') ? ext : `.${ext}`))
    .join('|');

  return {
    getCacheKey() {
      return `haste-ts-plugin-default:${platforms.join(',')}:${extensions.join(',')}`;
    },

    getHasteName(filename) {
      if (
        filename.includes(`${path.sep}node_modules${path.sep}`) ||
        filename.includes('__mocks__')
      ) {
        return undefined;
      }

      const base = path.basename(filename);
      const match = base.match(new RegExp(`^(.*)(${extensionGroup})$`));
      if (!match) {
        return undefined;
      }

      let name = match[1];
      if (platformGroup) {
        name = name.replace(new RegExp(`\\.(${platformGroup})$`), '');
      }

      return name || undefined;
    }
  };
}
