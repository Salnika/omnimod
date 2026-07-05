import { walk } from "@omnimod/core";
import type { Node } from "@omnimod/core";
import {
  cast,
  type CallExpression,
  type Identifier,
  type MemberExpression,
  type ObjectExpression,
  type Property,
} from "@omnimod/plugin-utils";

/** A textual edit within a fixed [start,end) region of the original source. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface StateInfo {
  /** State keys, in declaration order. */
  keys: string[];
  /** Setter name per key (`count` → `setCount`). */
  setters: Map<string, string>;
}

/** `count` → `setCount`. */
export function setterName(key: string): string {
  return `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Rewrite the `this.*` references inside a region of source into their function
 * equivalents. Returns the transformed text and a flag noting whether a
 * multi-key / functional `setState` was encountered (which forces a bail).
 *
 * Handled forms:
 *  - `this.state.k`            → `k`
 *  - `this.props.x` / `this.props` → `props.x` / `props`
 *  - `this.setState({ k: v })` → `setK(v)` (single-key object updates only)
 *  - `this.foo`                → `foo` (methods / bound fields)
 */
export function rewriteThis(
  source: string,
  region: Node,
  state: StateInfo,
): { text: string; unsupportedSetState: boolean } {
  const edits: Edit[] = [];
  let unsupportedSetState = false;

  walk(region, (node) => {
    if (node.type !== "MemberExpression") return;
    const member = cast<MemberExpression>(node);
    if (member.object.type !== "ThisExpression") return;
    if (member.computed || member.property.type !== "Identifier") return;
    const prop = cast<Identifier>(member.property).name;

    if (prop === "state") {
      // `this.state.k` → `k`; a bare `this.state` is left (rare) — replace with
      // an object literal reconstruction is unsafe, so only handle `.k`.
      return;
    }
    if (prop === "props") {
      // `this.props` → `props` (drop the `this.` prefix).
      edits.push({ start: member.object.start, end: member.property.start, text: "" });
      return;
    }
    // `this.foo` (method / bound field) → `foo`.
    edits.push({ start: member.object.start, end: member.property.start, text: "" });
  });

  // A second pass for `this.state.k` (member-of-member) and `this.setState(...)`.
  walk(region, (node) => {
    // this.state.k  → k
    if (node.type === "MemberExpression") {
      const outer = cast<MemberExpression>(node);
      if (
        outer.object.type === "MemberExpression" &&
        !outer.computed &&
        outer.property.type === "Identifier"
      ) {
        const inner = cast<MemberExpression>(outer.object);
        if (
          inner.object.type === "ThisExpression" &&
          inner.property.type === "Identifier" &&
          cast<Identifier>(inner.property).name === "state"
        ) {
          const key = cast<Identifier>(outer.property).name;
          if (state.keys.includes(key)) {
            edits.push({ start: outer.start, end: outer.property.end, text: key });
          }
        }
      }
    }

    // this.setState({ k: v }) → setK(v)
    if (node.type === "CallExpression") {
      const call = cast<CallExpression>(node);
      if (
        call.callee.type === "MemberExpression" &&
        !cast<MemberExpression>(call.callee).computed
      ) {
        const callee = cast<MemberExpression>(call.callee);
        if (
          callee.object.type === "ThisExpression" &&
          callee.property.type === "Identifier" &&
          cast<Identifier>(callee.property).name === "setState"
        ) {
          const arg = call.arguments[0];
          if (!arg || arg.type !== "ObjectExpression") {
            unsupportedSetState = true;
            return;
          }
          const obj = cast<ObjectExpression>(arg);
          if (obj.properties.length !== 1) {
            unsupportedSetState = true;
            return;
          }
          const only = obj.properties[0];
          if (!only || only.type !== "Property") {
            unsupportedSetState = true;
            return;
          }
          const property = cast<Property>(only);
          if (property.computed || property.key.type !== "Identifier") {
            unsupportedSetState = true;
            return;
          }
          const key = cast<Identifier>(property.key).name;
          const setter = state.setters.get(key);
          if (!setter) {
            unsupportedSetState = true;
            return;
          }
          // Recursively rewrite `this.*` inside the update value (e.g.
          // `this.state.count + 1` → `count + 1`) before wrapping in the setter.
          const valueText = rewriteThis(source, property.value, state).text;
          edits.push({ start: call.start, end: call.end, text: `${setter}(${valueText})` });
        }
      }
    }
  });

  return { text: applyEdits(source, region, edits), unsupportedSetState };
}

/**
 * Apply non-overlapping edits within [region.start, region.end) to the source
 * and return the rewritten substring. Inner `this.state.k` / `setState` edits
 * subsume the prefix-strip edits, so drop any prefix-strip that overlaps a
 * span-replacing edit.
 */
function applyEdits(source: string, region: Node, edits: Edit[]): string {
  // Sort by start; when spans nest, prefer the wider (span-replacing) edit and
  // discard prefix strips that fall inside it.
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Edit[] = [];
  let lastEnd = -1;
  for (const edit of sorted) {
    if (edit.start < lastEnd) continue; // overlaps a previously kept edit → drop.
    kept.push(edit);
    lastEnd = edit.end;
  }

  let out = "";
  let cursor = region.start;
  for (const edit of kept) {
    out += source.slice(cursor, edit.start);
    out += edit.text;
    cursor = edit.end;
  }
  out += source.slice(cursor, region.end);
  return out;
}
