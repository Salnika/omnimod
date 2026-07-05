import { definePlugin, type FileContext, type Node, walk } from "@omnimod/core";
import {
  type CallExpression,
  cast,
  type Identifier,
  type ImportDeclaration,
  type ImportSpecifier,
  type MemberExpression,
} from "@omnimod/plugin-utils";

export type JestToVitestOptions = Record<string, unknown>;

/** `jest.<member>` names that map to a renamed `vi.<other>` member. */
const RENAMED_MEMBERS = new Map<string, string>([
  ["requireActual", "importActual"],
  ["requireMock", "importMock"],
]);

/**
 * Migrate Jest to Vitest. Rewrites every `jest.<member>` access to `vi.<member>`
 * (renaming `requireActual`→`importActual` / `requireMock`→`importMock`), repoints
 * `@jest/globals` imports at `"vitest"`, and ensures `vi` is imported from
 * `"vitest"` when it ends up used. Globals like `describe`/`it`/`expect` are left
 * untouched; the plugin only reminds you to enable `test: { globals: true }`.
 */
export const jestToVitest = definePlugin<JestToVitestOptions>({
  name: "jest-to-vitest",
  description: "Migrate Jest to Vitest.",
  include: ["**/*.{test,spec}.{ts,tsx,js,jsx}", "**/__tests__/**/*.{ts,tsx,js,jsx}"],

  transform(file: FileContext): void {
    // A jest.config.* file is configuration, not a test — snapshot/config format
    // differs between the two runners, so we warn rather than touch it.
    if (/(^|[/\\])jest\.config\.[cm]?[jt]s$/.test(file.path)) {
      file.report({
        severity: "warn",
        message:
          "jest.config file detected: Vitest config lives in vite.config / vitest.config and " +
          "snapshot serialization differs — migrate this configuration by hand.",
      });
      return;
    }

    let usedVi = false;
    let rewroteRequireActual = false;
    // Existing `import { ... } from "vitest"` (or a repointed `@jest/globals`).
    let vitestImport: ImportDeclaration | null = null;
    let vitestImportHasVi = false;

    walk(file.program, (node) => {
      // (1) jest.<member> → vi.<member>.
      if (node.type === "MemberExpression") {
        const member = cast<MemberExpression>(node);
        if (isJestIdentifier(member.object)) {
          const object = cast<Identifier>(member.object);
          file.magic.update(object.start, object.end, "vi");
          usedVi = true;
          // requireActual / requireMock rename (only for non-computed props).
          if (!member.computed && member.property.type === "Identifier") {
            const property = cast<Identifier>(member.property);
            const renamed = RENAMED_MEMBERS.get(property.name);
            if (renamed) {
              file.magic.update(property.start, property.end, renamed);
              if (property.name === "requireActual") rewroteRequireActual = true;
            }
          }
        }
        return;
      }

      // A bare `jest(...)` call (rare) — still repoint the callee identifier.
      if (node.type === "CallExpression") {
        const call = cast<CallExpression>(node);
        if (isJestIdentifier(call.callee)) {
          const callee = cast<Identifier>(call.callee);
          file.magic.update(callee.start, callee.end, "vi");
          usedVi = true;
        }
        return;
      }

      // (3) import ... from "@jest/globals" → from "vitest".
      if (node.type === "ImportDeclaration") {
        const imp = cast<ImportDeclaration>(node);
        if (imp.source.value === "@jest/globals") {
          // Replace the source string literal, preserving the quote style.
          file.magic.update(imp.source.start, imp.source.end, '"vitest"');
          vitestImport = imp;
          vitestImportHasVi = importsLocalVi(imp);
        } else if (imp.source.value === "vitest") {
          vitestImport = imp;
          vitestImportHasVi = importsLocalVi(imp);
        }
        return;
      }
    });

    // Nothing referenced jest; leave the file (and its imports) untouched.
    if (!usedVi && !vitestImport) return;

    // (2) Ensure `vi` is imported from "vitest" once it is used.
    if (usedVi && !vitestImportHasVi) {
      if (vitestImport) {
        addViToImport(file, vitestImport);
      } else {
        file.magic.prepend('import { vi } from "vitest";\n');
      }
    }

    if (rewroteRequireActual) {
      file.report({
        severity: "warn",
        message:
          "`jest.requireActual` was rewritten to `vi.importActual`, which is async — " +
          "await its result (e.g. `const actual = await vi.importActual(...)`).",
      });
    }

    // Globals (describe/it/test/expect/beforeEach) work under Vitest but only when
    // `test.globals` is on; nudge the user once per file rather than injecting imports.
    file.report({
      severity: "info",
      message:
        "Left test globals (describe/it/test/expect) as-is. Enable `test: { globals: true }` in " +
        'your Vitest config, or import them from "vitest".',
    });
  },
});

/** True when a node is the global `jest` identifier. */
function isJestIdentifier(node: Node): boolean {
  return node.type === "Identifier" && cast<Identifier>(node).name === "jest";
}

/** Whether an import declaration already binds the local name `vi`. */
function importsLocalVi(imp: ImportDeclaration): boolean {
  return imp.specifiers.some((spec) => {
    if (spec.type !== "ImportSpecifier") return false;
    return cast<ImportSpecifier>(spec).local.name === "vi";
  });
}

/**
 * Add `vi` to an existing `from "vitest"` import. Inserts after the first named
 * specifier when there is one, otherwise turns it into `{ vi }` after the brace.
 */
function addViToImport(file: FileContext, imp: ImportDeclaration): void {
  const named = imp.specifiers.filter((spec) => spec.type === "ImportSpecifier");
  const first = named[0];
  if (first) {
    // `import { a, ... }` → `import { vi, a, ... }`.
    file.magic.appendLeft(first.start, "vi, ");
    return;
  }
  // No named specifiers (e.g. side-effect or default-only import): append a clause.
  // Insert `{ vi }` right after the default specifier, before the source keyword.
  const lastSpec = imp.specifiers[imp.specifiers.length - 1];
  if (lastSpec) {
    file.magic.appendLeft(lastSpec.end, ", { vi }");
  } else {
    // `import "vitest";` — rewrite to a named import by inserting before the source.
    file.magic.appendLeft(imp.source.start, "{ vi } from ");
  }
}
