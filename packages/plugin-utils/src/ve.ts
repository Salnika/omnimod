/**
 * A small value model for the object literals vanilla-extract consumes
 * (`style({...})`, recipe variants, theme contracts). Kept as data so callers
 * can build/merge objects programmatically, then serialize to source once.
 *
 * The `raw` kind escapes serialization: it emits unquoted JS (e.g. a `vars.x.y`
 * token reference or a `createVar()` handle).
 */
export type VeValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "raw"; readonly code: string }
  | { readonly kind: "object"; readonly entries: readonly VeEntry[] }
  | { readonly kind: "array"; readonly items: readonly VeValue[] };

export interface VeEntry {
  readonly key: string;
  readonly value: VeValue;
}

export const veString = (value: string): VeValue => ({ kind: "string", value });
export const veNumber = (value: number): VeValue => ({ kind: "number", value });
export const veBoolean = (value: boolean): VeValue => ({ kind: "boolean", value });
export const veRaw = (code: string): VeValue => ({ kind: "raw", code });
export const veObject = (entries: VeEntry[]): VeValue => ({ kind: "object", entries });
export const veArray = (items: VeValue[]): VeValue => ({ kind: "array", items });

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function serializeKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** Serialize a VeValue to formatted TypeScript source (2-space indentation). */
export function serializeVe(value: VeValue, indent = 0): string {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);

  switch (value.kind) {
    case "string":
      return JSON.stringify(value.value);
    case "number":
      return String(value.value);
    case "boolean":
      return String(value.value);
    case "raw":
      return value.code;
    case "array": {
      if (value.items.length === 0) return "[]";
      return `[${value.items.map((item) => serializeVe(item, indent)).join(", ")}]`;
    }
    case "object": {
      if (value.entries.length === 0) return "{}";
      const lines = value.entries.map(
        (entry) =>
          `${padInner}${serializeKey(entry.key)}: ${serializeVe(entry.value, indent + 1)},`,
      );
      return `{\n${lines.join("\n")}\n${pad}}`;
    }
  }
}

/** True when the value is an object with no entries. */
export function isEmptyObject(value: VeValue): boolean {
  return value.kind === "object" && value.entries.length === 0;
}
