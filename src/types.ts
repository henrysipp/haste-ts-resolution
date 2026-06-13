export interface HasteConfig {
  rootDir: string;
  extensions: string[];
  platforms: string[];
  excludeDirs: string[];
  indexAsPackage: boolean;
  hasteImplModulePath?: string;
}

export interface HasteImpl {
  getHasteName(filename: string): string | undefined;
  getCacheKey?(): string;
}

export interface HasteLogger {
  info(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface ResolvedHasteModule {
  resolvedFileName: string;
  extension: import('typescript').Extension;
  isExternalLibraryImport: false;
}
