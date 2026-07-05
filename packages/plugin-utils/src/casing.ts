/**
 * Convert a CSS property name to the camelCase key vanilla-extract expects.
 *
 * - `background-color` → `backgroundColor`
 * - `-webkit-transition` → `WebkitTransition` (vendor prefixes → PascalCase)
 * - `-ms-flex` → `msFlex` (the `-ms-` prefix is lowercased, per csstype/React)
 * - `--my-var` → `--my-var` (custom properties are kept verbatim)
 */
export function cssPropToCamel(prop: string): string {
  const trimmed = prop.trim();
  if (trimmed.startsWith("--")) return trimmed;
  return trimmed
    .replace(/^-ms-/, "ms-")
    .replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}
