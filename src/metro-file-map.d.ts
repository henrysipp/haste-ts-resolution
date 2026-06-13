declare module 'metro-file-map' {
  import type { HasteLogger } from './types';

  export class HastePlugin {
    constructor(options: {
      rootDir: string;
      platforms: Set<string>;
      enableHastePackages: boolean;
      failValidationOnConflicts: boolean;
      console: HasteLogger | null;
    });

    setModule(id: string, module: [string, number]): void;
    getModule(name: string, platform: string | null, supportsNativePlatform: boolean): string | null;
  }
}

declare module 'metro-file-map/src/plugins/haste/getPlatformExtension' {
  export default function getPlatformExtension(file: string, platforms: Set<string>): string | null;
}
