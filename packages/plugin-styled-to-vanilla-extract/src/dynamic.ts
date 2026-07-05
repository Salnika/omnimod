import {
  buildPlaceholderCss,
  cssToVeStyle,
  ImportManager,
  parseScss,
  placeholderToken,
  type PlaceholderResolver,
  serializeVe,
  type VeEntry,
  type VeValue,
  veBoolean,
  veNumber,
  veObject,
  veRaw,
  veString,
} from "@omnimod/plugin-utils";
import type { StyledComponent } from "./detect.ts";
import {
  analyzeInterpolation,
  type BlockSource,
  type BranchValue,
  type Interpolation,
  varsAccessor,
} from "./interpolation.ts";
import { styleExportName, uniqueName } from "./naming.ts";

const NUMERIC = /^-?\d+(?:\.\d+)?$/;
const EXPR_TOKEN = /__OMNIMOD_EXPR_(\d+)__/;
const VARIANT_SENTINEL = /__OMNIMOD_VARIANT_(\d+)__/g;

function sentinel(index: number): string {
  return `__OMNIMOD_VARIANT_${index}__`;
}

function cssValueToVe(value: string): VeValue {
  return NUMERIC.test(value) ? veNumber(Number(value)) : veString(value);
}

function branchFallbackString(branch: BranchValue): string {
  return branch.kind === "literal" ? branch.value : "";
}

interface VarBinding {
  /** The styled prop name (e.g. "gap"). */
  prop: string;
  /** The generated `createVar()` export name. */
  varName: string;
}

/** A style composed in via clsx: `name` is imported, `expr` is the clsx argument. */
interface ComposedStyle {
  name: string;
  expr: string;
}

export interface BaseInfo {
  styleName: string;
  tag: string;
  kind: "style" | "recipe";
  composedStyles: ComposedStyle[];
}

export interface StyledArtifact {
  styleName: string;
  /** The intrinsic element to render (inherited from the base for `styled(Base)`). */
  tag: string;
  kind: "style" | "recipe";
  /** Full source block(s) for this component in the generated `.css.ts`. */
  cssBlock: string;
  /** Props consumed as recipe variants (stripped from the DOM element). */
  variantProps: string[];
  /** Props consumed as inline CSS variables. */
  varProps: VarBinding[];
  /** Style/fragment exports composed in via clsx at each usage. */
  composedStyles: ComposedStyle[];
  warnings: string[];
  usesTheme: boolean;
}

export interface ConvertContext {
  /** Shared imports for the generated `.css.ts`. */
  cssImports: ImportManager;
  /** Shared export-name registry (dedup across components). */
  usedNames: Set<string>;
  /** Import specifier for the `vars` theme contract, or null to leave theme as TODO. */
  themeVars: string | null;
  /** Accumulates every theme token path accessed (e.g. "colors.primary"). */
  themePaths: Set<string>;
  /** Local names that are valid `${ref}` targets (keyframes). */
  knownRefs: Set<string>;
  /** Local names of css fragments; `${frag}` spreads compose via clsx. */
  fragments: Set<string>;
  /** Already-converted local components, for `styled(Base)` composition. */
  localBases: Map<string, BaseInfo>;
}

interface VariantRecord {
  prop: string;
  info: Interpolation;
  fallbackForNested: string;
}

interface VariantBuild {
  type: "boolean" | "enum";
  options: Map<string, VeEntry[]>;
}

/** Convert one `styled.tag`...`` (static or dynamic) into a vanilla-extract artifact. */
export function convertStyled(component: StyledComponent, ctx: ConvertContext): StyledArtifact {
  const styleName = uniqueName(styleExportName(component.localName), ctx.usedNames);
  const warnings: string[] = [];
  const variantProps = new Set<string>();
  const varProps: VarBinding[] = [];
  const variantByIndex = new Map<number, VariantRecord>();
  const variants = new Map<string, VariantBuild>();
  const blockVariants: { prop: string; whenTrue: VeValue | null; whenFalse: VeValue | null }[] = [];
  let usesTheme = false;

  // `styled(Base)`: inherit the base tag and compose its style(s) first.
  let tag = component.tag;
  const composedStyles: ComposedStyle[] = [];
  if (component.baseName) {
    const base = ctx.localBases.get(component.baseName);
    if (!base) {
      throw new Error(`styled(${component.baseName}): base is not a local styled component`);
    }
    tag = base.tag;
    composedStyles.push(...base.composedStyles, {
      name: base.styleName,
      expr: base.kind === "recipe" ? `${base.styleName}({})` : base.styleName,
    });
  }

  const resolve = (token: string): VeValue | null => {
    const match = EXPR_TOKEN.exec(token);
    if (!match) return null;
    const index = Number(match[1]);
    const expr = component.expressions[index];
    if (!expr) return null;

    const interp = analyzeInterpolation(expr);
    switch (interp.kind) {
      case "theme":
        usesTheme = true;
        ctx.themePaths.add(interp.path);
        if (ctx.themeVars !== null) {
          ctx.cssImports.addNamed(ctx.themeVars, "vars");
          return veRaw(varsAccessor(interp.path));
        }
        warnings.push(`theme.${interp.path} needs a theme contract; left a TODO`);
        return veString(`/* TODO(omnimod): theme.${interp.path} */`);
      case "var": {
        const varName = uniqueName(`${interp.prop}Var`, ctx.usedNames);
        varProps.push({ prop: interp.prop, varName });
        ctx.cssImports.addNamed("@vanilla-extract/css", "createVar");
        return veRaw(varName);
      }
      case "ref":
        if (ctx.knownRefs.has(interp.name)) return veRaw(interp.name);
        warnings.push(
          `Reference to \`${interp.name}\` is not a local keyframes/style; left a TODO`,
        );
        return veString(`/* TODO(omnimod): ${interp.name} */`);
      case "boolean-variant":
        variantProps.add(interp.prop);
        variantByIndex.set(index, {
          prop: interp.prop,
          info: interp,
          fallbackForNested: branchFallbackString(interp.whenTrue),
        });
        return veRaw(sentinel(index));
      case "enum-variant":
        variantProps.add(interp.prop);
        variantByIndex.set(index, {
          prop: interp.prop,
          info: interp,
          fallbackForNested: interp.fallback
            ? branchFallbackString(interp.fallback)
            : interp.cases[0]
              ? branchFallbackString(interp.cases[0].value)
              : "",
        });
        return veRaw(sentinel(index));
      case "conditional-block":
        // Handled in the pre-parse pass; only reached if used in value position.
        warnings.push("Conditional block in an unexpected position; left a TODO");
        return veString("/* TODO(omnimod) */");
      case "unsupported":
        warnings.push(`Could not convert an interpolation (${interp.reason}); left a TODO`);
        return veString(`/* TODO(omnimod): ${interp.reason} */`);
    }
  };

  // Resolve a variant branch (literal or theme token) to a value.
  const branchToVe = (branch: BranchValue): VeValue => {
    if (branch.kind === "literal") return cssValueToVe(branch.value);
    usesTheme = true;
    ctx.themePaths.add(branch.path);
    if (ctx.themeVars !== null) {
      ctx.cssImports.addNamed(ctx.themeVars, "vars");
      return veRaw(varsAccessor(branch.path));
    }
    warnings.push(`theme.${branch.path} needs a theme contract; left a TODO`);
    return veString(`/* TODO(omnimod): theme.${branch.path} */`);
  };

  // Convert a conditional CSS block into a style object (theme/ref aware).
  const convertBlock = (block: BlockSource): VeValue => {
    const blockResolve: PlaceholderResolver = (token) => {
      const match = EXPR_TOKEN.exec(token);
      if (!match) return null;
      const expr = block.expressions[Number(match[1])];
      if (!expr) return null;
      const interp = analyzeInterpolation(expr);
      if (interp.kind === "theme") {
        usesTheme = true;
        ctx.themePaths.add(interp.path);
        if (ctx.themeVars !== null) {
          ctx.cssImports.addNamed(ctx.themeVars, "vars");
          return veRaw(varsAccessor(interp.path));
        }
        return veString(`/* TODO(omnimod): theme.${interp.path} */`);
      }
      if (interp.kind === "ref" && ctx.knownRefs.has(interp.name)) return veRaw(interp.name);
      warnings.push(`Conditional block: unsupported interpolation (${interp.kind}); left a TODO`);
      return veString("/* TODO(omnimod) */");
    };
    return cssToVeStyle(parseScss(buildPlaceholderCss(block.quasis)), blockResolve).base;
  };

  // Pull out `${fragment}` spreads and `${cond && css`...`}` blocks before parsing,
  // so the bare placeholder doesn't break the CSS parser.
  let css = buildPlaceholderCss(component.quasis);
  component.expressions.forEach((expr, index) => {
    const interp = analyzeInterpolation(expr);
    if (interp.kind === "ref" && ctx.fragments.has(interp.name)) {
      composedStyles.push({ name: interp.name, expr: interp.name });
      css = css.replaceAll(placeholderToken(index), "");
    } else if (interp.kind === "conditional-block") {
      variantProps.add(interp.prop);
      blockVariants.push({
        prop: interp.prop,
        whenTrue: interp.whenTrue ? convertBlock(interp.whenTrue) : null,
        whenFalse: interp.whenFalse ? convertBlock(interp.whenFalse) : null,
      });
      css = css.replaceAll(placeholderToken(index), "");
    }
  });

  const veStyle = cssToVeStyle(parseScss(css), resolve);
  warnings.push(...veStyle.warnings);

  const baseEntries: VeEntry[] = [];
  for (const entry of objectEntries(veStyle.base)) {
    const index = sentinelIndex(entry.value);
    const record = index === null ? undefined : variantByIndex.get(index);
    if (!record) {
      baseEntries.push(entry);
      continue;
    }
    applyVariant(entry.key, record, variants, baseEntries, branchToVe);
  }

  // Merge conditional-block variants (from `${cond && css`...`}`).
  for (const blockVariant of blockVariants) {
    const build = ensureVariant(variants, blockVariant.prop, "boolean");
    optionEntries(build, "true").push(...blockEntries(blockVariant.whenTrue));
    optionEntries(build, "false").push(...blockEntries(blockVariant.whenFalse));
  }

  const usesRecipe = variants.size > 0;
  const cssBlock = renderBlock({
    styleName,
    usesRecipe,
    baseEntries,
    variants,
    varProps,
    descendants: veStyle.descendants,
    cssImports: ctx.cssImports,
    warnings,
    variantByIndex,
  });

  return {
    styleName,
    tag,
    kind: usesRecipe ? "recipe" : "style",
    cssBlock,
    variantProps: [...variantProps],
    varProps,
    composedStyles,
    warnings,
    usesTheme,
  };
}

function objectEntries(value: VeValue): VeEntry[] {
  return value.kind === "object" ? [...value.entries] : [];
}

function blockEntries(value: VeValue | null): VeEntry[] {
  return value && value.kind === "object" ? [...value.entries] : [];
}

function sentinelIndex(value: VeValue): number | null {
  if (value.kind !== "raw") return null;
  const match = /^__OMNIMOD_VARIANT_(\d+)__$/.exec(value.code);
  return match ? Number(match[1]) : null;
}

function applyVariant(
  property: string,
  record: VariantRecord,
  variants: Map<string, VariantBuild>,
  baseEntries: VeEntry[],
  branchToVe: (branch: BranchValue) => VeValue,
): void {
  if (record.info.kind === "boolean-variant") {
    const build = ensureVariant(variants, record.prop, "boolean");
    optionEntries(build, "true").push({ key: property, value: branchToVe(record.info.whenTrue) });
    optionEntries(build, "false").push({
      key: property,
      value: branchToVe(record.info.whenFalse),
    });
  } else if (record.info.kind === "enum-variant") {
    const build = ensureVariant(variants, record.prop, "enum");
    for (const enumCase of record.info.cases) {
      optionEntries(build, enumCase.match).push({
        key: property,
        value: branchToVe(enumCase.value),
      });
    }
    if (record.info.fallback !== null) {
      baseEntries.push({ key: property, value: branchToVe(record.info.fallback) });
    }
  }
}

function ensureVariant(
  variants: Map<string, VariantBuild>,
  prop: string,
  type: "boolean" | "enum",
): VariantBuild {
  let build = variants.get(prop);
  if (!build) {
    build = { type, options: new Map() };
    variants.set(prop, build);
  }
  return build;
}

function optionEntries(build: VariantBuild, key: string): VeEntry[] {
  let entries = build.options.get(key);
  if (!entries) {
    entries = [];
    build.options.set(key, entries);
  }
  return entries;
}

interface RenderArgs {
  styleName: string;
  usesRecipe: boolean;
  baseEntries: VeEntry[];
  variants: Map<string, VariantBuild>;
  varProps: VarBinding[];
  descendants: { selector: string; style: VeValue }[];
  cssImports: ImportManager;
  warnings: string[];
  variantByIndex: Map<number, VariantRecord>;
}

function renderBlock(args: RenderArgs): string {
  const parts: string[] = [];

  for (const binding of args.varProps) {
    parts.push(`export const ${binding.varName} = createVar();`);
  }

  if (args.usesRecipe) {
    args.cssImports.addNamed("@vanilla-extract/recipes", "recipe");
    parts.push(`export const ${args.styleName} = recipe(${serializeVe(recipeObject(args))});`);
  } else {
    args.cssImports.addNamed("@vanilla-extract/css", "style");
    parts.push(
      `export const ${args.styleName} = style(${serializeVe(veObject(args.baseEntries))});`,
    );
  }

  for (const descendant of args.descendants) {
    if (args.usesRecipe) {
      args.warnings.push("Descendant selector skipped: not supported with a variant recipe");
      continue;
    }
    args.cssImports.addNamed("@vanilla-extract/css", "globalStyle");
    const selector = descendant.selector.replaceAll("&", `\${${args.styleName}}`);
    parts.push(`globalStyle(\`${selector}\`, ${serializeVe(descendant.style)});`);
  }

  let block = parts.join("\n\n");
  block = block.replace(VARIANT_SENTINEL, (_match, index: string) => {
    const record = args.variantByIndex.get(Number(index));
    args.warnings.push("Prop-conditional inside a nested selector was inlined to a single value");
    return JSON.stringify(record?.fallbackForNested ?? "");
  });
  return block;
}

function recipeObject(args: RenderArgs): VeValue {
  const variantEntries: VeEntry[] = [];
  const defaults: VeEntry[] = [];

  for (const [prop, build] of args.variants) {
    const optionEntriesList: VeEntry[] = [];
    for (const [option, entries] of build.options) {
      optionEntriesList.push({ key: option, value: veObject(entries) });
    }
    variantEntries.push({ key: prop, value: veObject(optionEntriesList) });
    if (build.type === "boolean") {
      defaults.push({ key: prop, value: veBoolean(false) });
    }
  }

  const recipeEntries: VeEntry[] = [
    { key: "base", value: veObject(args.baseEntries) },
    { key: "variants", value: veObject(variantEntries) },
  ];
  if (defaults.length > 0) {
    recipeEntries.push({ key: "defaultVariants", value: veObject(defaults) });
  }
  return veObject(recipeEntries);
}
