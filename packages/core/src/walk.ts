import type { Node } from "./types.ts";

export type WalkResult = void | "skip";

/**
 * Visitor callback. Return `"skip"` to avoid descending into a node's children.
 * `key`/`index` describe where the node sits in its parent.
 */
export type Visitor = (
  node: Node,
  parent: Node | null,
  key: string | null,
  index: number | null,
) => WalkResult;

// Structural fields that are never child nodes — skip them while descending.
const SKIP_KEYS = new Set(["type", "start", "end", "range", "loc", "parent"]);

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * Depth-first walk over an oxc ESTree AST. Engine-agnostic: it recurses into any
 * own property whose value is a node (has a string `type`) or an array of nodes.
 */
export function walk(root: Node, enter: Visitor, leave?: Visitor): void {
  function visit(node: Node, parent: Node | null, key: string | null, index: number | null): void {
    if (enter(node, parent, key, index) === "skip") return;

    for (const childKey in node) {
      if (SKIP_KEYS.has(childKey)) continue;
      const value = (node as Record<string, unknown>)[childKey];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const child = value[i];
          if (isNode(child)) visit(child, node, childKey, i);
        }
      } else if (isNode(value)) {
        visit(value, node, childKey, null);
      }
    }

    leave?.(node, parent, key, index);
  }

  visit(root, null, null, null);
}
