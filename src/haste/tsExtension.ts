import type ts from 'typescript';

export function toTsExtension(tsModule: typeof ts, filePath: string): ts.Extension {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.d.ts')) return tsModule.Extension.Dts;
  if (lower.endsWith('.tsx')) return tsModule.Extension.Tsx;
  if (lower.endsWith('.ts')) return tsModule.Extension.Ts;
  if (lower.endsWith('.jsx')) return tsModule.Extension.Jsx;
  if (lower.endsWith('.js')) return tsModule.Extension.Js;
  if (lower.endsWith('.mts')) return tsModule.Extension.Mts || tsModule.Extension.Ts;
  if (lower.endsWith('.cts')) return tsModule.Extension.Cts || tsModule.Extension.Ts;
  if (lower.endsWith('.mjs')) return tsModule.Extension.Mjs || tsModule.Extension.Js;
  if (lower.endsWith('.cjs')) return tsModule.Extension.Cjs || tsModule.Extension.Js;
  return tsModule.Extension.Ts;
}
