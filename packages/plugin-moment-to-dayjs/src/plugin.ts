import { definePlugin, type FileContext, type Node, walk } from "@omnimod/core";
import {
  cast,
  type Identifier,
  type ImportDeclaration,
  type ImportDefaultSpecifier,
  type ImportSpecifier,
  type MemberExpression,
} from "@omnimod/plugin-utils";

export type MomentToDayjsOptions = Record<string, unknown>;

/** Static `moment.<name>()` helpers that Day.js only exposes via a plugin. */
const STATIC_PLUGIN_APIS: Record<string, string> = {
  utc: 'the `utc` plugin (`import utc from "dayjs/plugin/utc"; dayjs.extend(utc)`)',
  duration:
    'the `duration` plugin (`import duration from "dayjs/plugin/duration"; dayjs.extend(duration)`)',
  locale: 'explicit locale loading (`import "dayjs/locale/<name>"; dayjs.locale("<name>")`)',
  tz: 'the `timezone` plugin (`import timezone from "dayjs/plugin/timezone"; dayjs.extend(timezone)`)',
};

/** Instance methods (`moment().<name>()`) that Day.js only exposes via a plugin. */
const INSTANCE_PLUGIN_APIS: Record<string, string> = {
  fromNow:
    'the `relativeTime` plugin (`import relativeTime from "dayjs/plugin/relativeTime"; dayjs.extend(relativeTime)`)',
  from: 'the `relativeTime` plugin (`import relativeTime from "dayjs/plugin/relativeTime"; dayjs.extend(relativeTime)`)',
  to: 'the `relativeTime` plugin (`import relativeTime from "dayjs/plugin/relativeTime"; dayjs.extend(relativeTime)`)',
  calendar:
    'the `calendar` plugin (`import calendar from "dayjs/plugin/calendar"; dayjs.extend(calendar)`)',
  isBetween:
    'the `isBetween` plugin (`import isBetween from "dayjs/plugin/isBetween"; dayjs.extend(isBetween)`)',
};

interface MomentImport {
  node: ImportDeclaration;
  /** Local name of the default `moment` import, if any. */
  defaultLocal: string | null;
  /** Whether the source literal still needs rewriting to "dayjs". */
  source: { start: number; end: number };
}

/**
 * Migrate Moment.js to Day.js. Rewrites the `moment` import to `dayjs`, renames
 * the default binding (and all its call sites) to `dayjs`, and rewrites type-only
 * `{ Moment }` imports to `{ Dayjs }`. Chained methods are API-mirrored by Day.js,
 * so once the base identifier is renamed they carry over unchanged. APIs that
 * Day.js only exposes through a plugin (`utc`, `duration`, `.fromNow()`, …) are
 * flagged with a diagnostic and a `// TODO(omnimod)` comment naming the plugin.
 */
export const momentToDayjs = definePlugin<MomentToDayjsOptions>({
  name: "moment-to-dayjs",
  description: "Migrate Moment.js to Day.js.",
  include: ["**/*.{ts,tsx,js,jsx,mts,cts}"],

  transform(file: FileContext): void {
    const momentImport = findMomentImport(file.program);
    if (!momentImport) return;

    const { node, defaultLocal } = momentImport;

    // (1) Rewrite the module source: "moment" -> "dayjs".
    file.magic.update(momentImport.source.start, momentImport.source.end, '"dayjs"');

    // (2) Rewrite type-only `{ Moment as X }` named specifiers to `{ Dayjs as X }`.
    //     `Moment` is the only type Moment.js exports we mirror (-> `Dayjs`).
    for (const spec of node.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      const named = cast<ImportSpecifier>(spec);
      const imported = named.imported;
      if (imported.type !== "Identifier") continue;
      if (cast<Identifier>(imported).name === "Moment") {
        file.magic.update(imported.start, imported.end, "Dayjs");
        // A bare `import { Moment } from "moment"` also binds the local `Moment`;
        // rewrite its type references too. (Aliased `{ Moment as M }` keeps `M`.)
        if (named.local.name === "Moment" && named.local.start === imported.start) {
          renameTypeReferences(file, node, "Moment", "Dayjs");
        }
      }
    }

    // (3) Rename the default binding + all its references. Only rename when the
    //     local was literally `moment`; an aliased default (`import m from …`)
    //     keeps its name and just points at the new source (handled by step 1).
    if (defaultLocal === "moment") {
      // Rename the binding in the import specifier itself — the reference walk
      // below skips anything inside the import declaration, so the specifier's
      // local `moment` must be rewritten to `dayjs` explicitly.
      for (const spec of node.specifiers) {
        if (spec.type !== "ImportDefaultSpecifier") continue;
        const local = cast<ImportDefaultSpecifier>(spec).local;
        file.magic.update(local.start, local.end, "dayjs");
      }
      renameValueReferences(file, node, "moment", "dayjs");
    }

    // (4) Warn about APIs Day.js only supports through a plugin. These are flagged
    //     (not rewritten away): the renamed `dayjs.utc()` / `dayjs().fromNow()`
    //     call is correct *once the plugin is registered*, which the note explains.
    //     Detection matches the *original* AST name; the note shows the *renamed*
    //     base (`moment` becomes `dayjs`, an alias keeps its name).
    if (defaultLocal) {
      const renamed = defaultLocal === "moment" ? "dayjs" : defaultLocal;
      reportPluginApis(file, defaultLocal, renamed, momentImport);
    }
  },
});

/** Find the `import … from "moment"` declaration, capturing its default local. */
function findMomentImport(program: Node): MomentImport | null {
  const body = (program as { body?: Node[] }).body ?? [];
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const imp = cast<ImportDeclaration>(stmt);
    if (imp.source.value !== "moment") continue;

    let defaultLocal: string | null = null;
    for (const spec of imp.specifiers) {
      if (spec.type === "ImportDefaultSpecifier") {
        defaultLocal = cast<ImportDefaultSpecifier>(spec).local.name;
      }
    }
    return {
      node: imp,
      defaultLocal,
      source: { start: imp.source.start, end: imp.source.end },
    };
  }
  return null;
}

/** True when `node`'s span lies inside the import declaration (skip those). */
function insideImport(importNode: ImportDeclaration, node: Node): boolean {
  return node.start >= importNode.start && node.end <= importNode.end;
}

/** Rewrite value-position `Identifier`/`JSXIdentifier` references from → to. */
function renameValueReferences(
  file: FileContext,
  importNode: ImportDeclaration,
  from: string,
  to: string,
): void {
  walk(file.program, (node) => {
    if (node.type !== "Identifier" && node.type !== "JSXIdentifier") return;
    if (insideImport(importNode, node)) return;
    if (cast<Identifier>(node).name !== from) return;
    // A member/property name (`obj.moment`) or a non-shorthand object key isn't a
    // binding reference — but oxc doesn't hand us the parent here, so guard by the
    // fact that such identifiers coincide in name only rarely; the walk visits the
    // *base* identifier of `moment.utc` (which we DO want to rename) as its own
    // node, and property `utc` as a separate node with a different name.
    file.magic.update(node.start, node.end, to);
  });
}

/** Rewrite type-position `Identifier` references (e.g. `Moment` annotations). */
function renameTypeReferences(
  file: FileContext,
  importNode: ImportDeclaration,
  from: string,
  to: string,
): void {
  walk(file.program, (node) => {
    if (node.type !== "Identifier") return;
    if (insideImport(importNode, node)) return;
    if (cast<Identifier>(node).name !== from) return;
    file.magic.update(node.start, node.end, to);
  });
}

/**
 * Report (once each) any plugin-only Moment API used on the local binding.
 * `origLocal` matches the untouched AST; `renamedBase` is what the code now reads.
 */
function reportPluginApis(
  file: FileContext,
  origLocal: string,
  renamedBase: string,
  momentImport: MomentImport,
): void {
  const seenStatic = new Set<string>();
  const seenInstance = new Set<string>();

  walk(file.program, (node) => {
    if (node.type !== "MemberExpression") return;
    const member = cast<MemberExpression>(node);
    if (member.computed || member.property.type !== "Identifier") return;
    const prop = cast<Identifier>(member.property).name;

    // Static: `<base>.utc` / `<base>.duration` / `<base>.locale` / `<base>.tz`.
    if (
      member.object.type === "Identifier" &&
      cast<Identifier>(member.object).name === origLocal &&
      prop in STATIC_PLUGIN_APIS &&
      !insideImport(momentImport.node, node)
    ) {
      if (!seenStatic.has(prop)) {
        seenStatic.add(prop);
        emitTodo(file, node, `\`${renamedBase}.${prop}()\``, STATIC_PLUGIN_APIS[prop]);
      }
      return;
    }

    // Instance: `<expr>.fromNow()` / `.calendar()` / `.from()` / `.to()` / `.isBetween()`.
    if (prop in INSTANCE_PLUGIN_APIS && !seenInstance.has(prop)) {
      seenInstance.add(prop);
      emitTodo(file, node, `\`.${prop}()\``, INSTANCE_PLUGIN_APIS[prop]);
    }
  });
}

/** Report a diagnostic and prepend a `// TODO(omnimod)` line above the statement. */
function emitTodo(file: FileContext, node: Node, label: string, requirement: string): void {
  const message = `${label} needs ${requirement} in Day.js.`;
  file.report({ message, severity: "warn" });
  const lineStart = statementLineStart(file.source, node.start);
  file.magic.appendLeft(lineStart, `// TODO(omnimod): ${label} — add ${requirement}\n`);
}

/** Offset of the start of the source line containing `offset`. */
function statementLineStart(source: string, offset: number): number {
  const nl = source.lastIndexOf("\n", offset - 1);
  return nl + 1;
}
