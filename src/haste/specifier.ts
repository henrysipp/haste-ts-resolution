export function isBareSpecifier(name: string): boolean {
  if (!name) {
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
