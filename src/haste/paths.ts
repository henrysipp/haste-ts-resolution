export function isPathInsideOrEqual(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(`${directory}/`);
}

export function stripTrailingSlash(filePath: string): string {
  return filePath.replace(/\/+$/, '');
}

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
