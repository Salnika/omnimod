import {
  buildPlaceholderCss,
  cssToVeStyle,
  globalRules,
  ImportManager,
  keyframesToVe,
  parseScss,
  type PlaceholderResolver,
  serializeVe,
  veRaw,
  veString,
} from "@omnimod/plugin-utils";
import type {
  CssFragmentConst,
  GlobalStyleConst,
  KeyframesConst,
  SkippedComponent,
  StyledComponent,
} from "./detect.ts";
import { type BaseInfo, convertStyled, type StyledArtifact } from "./dynamic.ts";
import { analyzeInterpolation, varsAccessor } from "./interpolation.ts";

const EXPR_TOKEN = /__OMNIMOD_EXPR_(\d+)__/;

interface GeneratedEntry {
  component: StyledComponent;
  artifact: StyledArtifact;
}

export interface GeneratedCss {
  /** Full source of the `.css.ts` file. */
  contents: string;
  entries: GeneratedEntry[];
  /** Keyframes actually converted (safe to remove from the source). */
  keyframes: KeyframesConst[];
  /** Css fragments actually converted. */
  fragments: CssFragmentConst[];
  /** Globals actually converted. */
  globals: GlobalStyleConst[];
  warnings: string[];
  /** Items whose CSS could not be parsed (left untouched in the source). */
  skipped: SkippedComponent[];
  usesTheme: boolean;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

/**
 * Build a `.css.ts` file from a file's styled components, keyframes, css
 * fragments and global styles. Unparseable CSS is skipped with a diagnostic
 * rather than thrown, so one bad item can't abort the run.
 */
export function generateCss(
  components: StyledComponent[],
  globals: GlobalStyleConst[] = [],
  keyframes: KeyframesConst[] = [],
  fragments: CssFragmentConst[] = [],
  themeVars: string | null = null,
  themePaths: Set<string> = new Set(),
): GeneratedCss {
  const imports = new ImportManager();
  const usedNames = new Set<string>();
  const blocks: string[] = [];
  const entries: GeneratedEntry[] = [];
  const warnings: string[] = [];
  const skipped: SkippedComponent[] = [];
  const appliedKeyframes: KeyframesConst[] = [];
  const appliedFragments: CssFragmentConst[] = [];
  const appliedGlobals: GlobalStyleConst[] = [];
  let usesTheme = false;

  // Keyframes first, so styles that reference them resolve in module order.
  const knownRefs = new Set<string>();
  for (const frames of keyframes) {
    try {
      const object = serializeVe(keyframesToVe(parseScss(frames.cssText)));
      imports.addNamed("@vanilla-extract/css", "keyframes");
      usedNames.add(frames.localName);
      knownRefs.add(frames.localName);
      blocks.push(`export const ${frames.localName} = keyframes(${object});`);
      appliedKeyframes.push(frames);
    } catch (error) {
      skipped.push({
        localName: frames.localName,
        reason: `could not parse keyframes CSS (${errorMessage(error)})`,
      });
    }
  }

  // Css fragments become plain style() exports, composed via clsx at usage.
  const fragmentNames = new Set<string>();
  for (const fragment of fragments) {
    try {
      const resolver = fragmentResolver(fragment, imports, themeVars, themePaths, warnings);
      const ve = cssToVeStyle(parseScss(buildPlaceholderCss(fragment.quasis)), resolver);
      imports.addNamed("@vanilla-extract/css", "style");
      usedNames.add(fragment.localName);
      fragmentNames.add(fragment.localName);
      blocks.push(`export const ${fragment.localName} = style(${serializeVe(ve.base)});`);
      for (const descendant of ve.descendants) {
        imports.addNamed("@vanilla-extract/css", "globalStyle");
        const selector = descendant.selector.replaceAll("&", `\${${fragment.localName}}`);
        blocks.push(`globalStyle(\`${selector}\`, ${serializeVe(descendant.style)});`);
      }
      appliedFragments.push(fragment);
    } catch (error) {
      skipped.push({
        localName: fragment.localName,
        reason: `could not parse css fragment (${errorMessage(error)})`,
      });
    }
  }

  // Source order so a `styled(Base)` sees its base already converted.
  const ordered = [...components].sort((a, b) => a.statement.start - b.statement.start);
  const localBases = new Map<string, BaseInfo>();
  for (const component of ordered) {
    let artifact: StyledArtifact;
    try {
      artifact = convertStyled(component, {
        cssImports: imports,
        usedNames,
        themeVars,
        themePaths,
        knownRefs,
        fragments: fragmentNames,
        localBases,
      });
    } catch (error) {
      skipped.push({
        localName: component.localName,
        reason: `could not convert (${errorMessage(error)})`,
      });
      continue;
    }
    entries.push({ component, artifact });
    localBases.set(component.localName, {
      styleName: artifact.styleName,
      tag: artifact.tag,
      kind: artifact.kind,
      composedStyles: artifact.composedStyles,
    });
    warnings.push(...artifact.warnings);
    if (artifact.usesTheme) usesTheme = true;
    blocks.push(artifact.cssBlock);
  }

  for (const global of globals) {
    try {
      const rules = globalRules(parseScss(global.cssText));
      for (const rule of rules) {
        imports.addNamed("@vanilla-extract/css", "globalStyle");
        blocks.push(`globalStyle(${JSON.stringify(rule.selector)}, ${serializeVe(rule.style)});`);
      }
      appliedGlobals.push(global);
    } catch (error) {
      skipped.push({
        localName: global.localName,
        reason: `could not parse global CSS (${errorMessage(error)})`,
      });
    }
  }

  const contents = `${imports.render()}\n\n${blocks.join("\n\n")}\n`;
  return {
    contents,
    entries,
    keyframes: appliedKeyframes,
    fragments: appliedFragments,
    globals: appliedGlobals,
    warnings,
    skipped,
    usesTheme,
  };
}

/** Resolver for a css fragment: theme access → vars, anything else → a TODO. */
function fragmentResolver(
  fragment: CssFragmentConst,
  imports: ImportManager,
  themeVars: string | null,
  themePaths: Set<string>,
  warnings: string[],
): PlaceholderResolver {
  return (token) => {
    const match = EXPR_TOKEN.exec(token);
    if (!match) return null;
    const expr = fragment.expressions[Number(match[1])];
    if (!expr) return null;

    const interp = analyzeInterpolation(expr);
    if (interp.kind === "theme") {
      themePaths.add(interp.path);
      if (themeVars !== null) {
        imports.addNamed(themeVars, "vars");
        return veRaw(varsAccessor(interp.path));
      }
      warnings.push(`theme.${interp.path} needs a theme contract; left a TODO`);
      return veString(`/* TODO(omnimod): theme.${interp.path} */`);
    }
    warnings.push(`Fragment \`${fragment.localName}\`: unsupported interpolation; left a TODO`);
    return veString("/* TODO(omnimod) */");
  };
}
