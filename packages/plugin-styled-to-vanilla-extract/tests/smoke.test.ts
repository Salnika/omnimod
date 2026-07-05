import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { run } from "@omnimod/core";
import { expect, test } from "vite-plus/test";
import { styledToVanillaExtract } from "../src/index.ts";

async function runMulti(
  files: Record<string, string>,
): Promise<{ changed: Record<string, string>; emitted: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-mf-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, "utf8");
    }
    const result = await run(styledToVanillaExtract, { root: dir });
    const changed: Record<string, string> = {};
    for (const change of result.changed) changed[basename(change.path)] = change.after;
    const emitted: Record<string, string> = {};
    for (const file of result.emitted) emitted[basename(file.path)] = file.contents;
    return { changed, emitted };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const INPUT = `import styled from "styled-components";

const Card = styled.div\`
  color: red;
  padding: 10px;
  &:hover {
    color: blue;
  }
  & .icon {
    fill: green;
  }
\`;

export function App() {
  return (
    <Card className="foo" onClick={handle}>
      <span className="icon" />
    </Card>
  );
}
`;

async function runPlugin(input: string): Promise<{ changed: string; css: string }> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-sve-"));
  try {
    await writeFile(join(dir, "App.tsx"), input, "utf8");
    const result = await run(styledToVanillaExtract, { root: dir });
    const changed = result.changed.find((change) => change.path.endsWith("App.tsx"));
    const css = result.emitted.find((file) => file.path.endsWith("App.css.ts"));
    return { changed: changed?.after ?? "", css: css?.contents ?? "" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("converts a static styled.div into style() and rewrites JSX inline", async () => {
  const { changed, css } = await runPlugin(INPUT);

  // Generated .css.ts
  expect(css).toContain('import { globalStyle, style } from "@vanilla-extract/css";');
  expect(css).toContain("export const card = style({");
  expect(css).toContain('color: "red"');
  expect(css).toContain('padding: "10px"');
  expect(css).toContain('"&:hover"');
  expect(css).toContain('color: "blue"');
  expect(css).toContain("globalStyle(");
  expect(css).toContain("${card} .icon");
  expect(css).toContain('fill: "green"');

  // Rewritten component file
  expect(changed).toContain('import { card } from "./App.css";');
  expect(changed).toContain('import clsx from "clsx";');
  expect(changed).toContain('<div className={clsx(card, "foo")} onClick={handle}>');
  expect(changed).toContain("</div>");
  expect(changed).not.toContain("styled.div");
  expect(changed).not.toContain('from "styled-components"');
});

const GLOBAL_INPUT = `import { createGlobalStyle } from "styled-components";

const GlobalStyle = createGlobalStyle\`
  body {
    margin: 0;
  }
  * {
    box-sizing: border-box;
  }
\`;

export function App() {
  return (
    <>
      <GlobalStyle />
      <main>hello</main>
    </>
  );
}
`;

test("converts createGlobalStyle into globalStyle() and removes its JSX usage", async () => {
  const { changed, css } = await runPlugin(GLOBAL_INPUT);

  expect(css).toContain('import { globalStyle } from "@vanilla-extract/css";');
  expect(css).toContain('globalStyle("body", {');
  expect(css).toContain("margin: 0");
  expect(css).toContain('globalStyle("*", {');
  expect(css).toContain('boxSizing: "border-box"');

  expect(changed).toContain('import "./App.css";');
  expect(changed).not.toContain("<GlobalStyle");
  expect(changed).not.toContain("createGlobalStyle");
  expect(changed).toContain("<main>hello</main>");
});

const RECIPE_INPUT = `import styled from "styled-components";

const Button = styled.button\`
  padding: 8px;
  color: \${(p) => (p.primary ? "white" : "black")};
  width: \${({ size }) => (size === "lg" ? "20px" : "10px")};
\`;

export function App() {
  return (
    <Button primary size="lg" onClick={handle}>
      Go
    </Button>
  );
}
`;

test("converts discrete prop interpolations into a recipe with variants", async () => {
  const { changed, css } = await runPlugin(RECIPE_INPUT);

  expect(css).toContain('import { recipe } from "@vanilla-extract/recipes";');
  expect(css).toContain("export const button = recipe({");
  expect(css).toContain('padding: "8px"'); // base
  expect(css).toContain('width: "10px"'); // enum fallback → base
  expect(css).toContain('color: "white"'); // primary true
  expect(css).toContain('color: "black"'); // primary false
  expect(css).toContain('width: "20px"'); // size lg
  expect(css).toContain("defaultVariants:");
  expect(css).toContain("primary: false");

  expect(changed).toContain('import { button } from "./App.css";');
  expect(changed).toContain('className={button({ primary: true, size: "lg" })}');
  expect(changed).toContain("onClick={handle}");
  expect(changed).not.toContain('size="lg"');
});

const VAR_INPUT = `import styled from "styled-components";

const Box = styled.div\`
  color: red;
  width: \${(p) => p.width};
\`;

export function App() {
  return <Box width={w} className="x" />;
}
`;

test("converts a continuous prop into createVar + assignInlineVars", async () => {
  const { changed, css } = await runPlugin(VAR_INPUT);

  expect(css).toContain("export const widthVar = createVar();");
  expect(css).toContain("export const box = style({");
  expect(css).toContain("width: widthVar");

  expect(changed).toContain('import { assignInlineVars } from "@vanilla-extract/dynamic";');
  expect(changed).toContain("box, widthVar");
  expect(changed).toContain("assignInlineVars({ [widthVar]: w })");
  expect(changed).toContain('className={clsx(box, "x")}');
  expect(changed).not.toContain("width={w}");
});

const THEME_INPUT = `import styled from "styled-components";

const Title = styled.h1\`
  color: \${({ theme }) => theme.colors.primary};
  font-size: \${(p) => p.theme.sizes.lg};
\`;

export function App() {
  return <Title>Hi</Title>;
}
`;

test("maps theme access to a generated vars contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-theme-"));
  try {
    await writeFile(join(dir, "App.tsx"), THEME_INPUT, "utf8");
    const result = await run(styledToVanillaExtract, { root: dir });
    const css = result.emitted.find((file) => file.path.endsWith("App.css.ts"))?.contents ?? "";
    const theme =
      result.emitted.find((file) => file.path.endsWith("omnimod-theme.css.ts"))?.contents ?? "";

    expect(css).toContain('import { vars } from "./omnimod-theme.css";');
    expect(css).toContain("color: vars.colors.primary");
    expect(css).toContain("fontSize: vars.sizes.lg");

    expect(theme).toContain('import { createThemeContract } from "@vanilla-extract/css";');
    expect(theme).toContain("export const vars = createThemeContract({");
    expect(theme).toContain("colors: {");
    expect(theme).toContain("primary: null");
    expect(theme).toContain("sizes: {");
    expect(theme).toContain("lg: null");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const KEYFRAMES_INPUT = `import styled, { keyframes } from "styled-components";

const spin = keyframes\`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
\`;

const Spinner = styled.div\`
  animation-name: \${spin};
  animation-duration: 1s;
\`;

export function App() {
  return <Spinner />;
}
`;

test("converts keyframes and references them from a style", async () => {
  const { changed, css } = await runPlugin(KEYFRAMES_INPUT);

  expect(css).toContain('import { keyframes, style } from "@vanilla-extract/css";');
  expect(css).toContain("export const spin = keyframes({");
  expect(css).toContain('transform: "rotate(0deg)"');
  expect(css).toContain('transform: "rotate(360deg)"');
  expect(css).toContain("export const spinner = style({");
  expect(css).toContain("animationName: spin");
  expect(css).toContain('animationDuration: "1s"');

  expect(changed).toContain('import { spinner } from "./App.css";');
  expect(changed).toContain("<div className={spinner} />");
  expect(changed).not.toContain('from "styled-components"');
});

test("rewrites usages of an exported styled component across files", async () => {
  const { changed, emitted } = await runMulti({
    "Button.tsx": `import styled from "styled-components";

export const Button = styled.button\`
  padding: 8px;
  color: \${(p) => (p.primary ? "white" : "black")};
\`;
`,
    "App.tsx": `import { Button } from "./Button";

export function App() {
  return <Button primary>Go</Button>;
}
`,
  });

  expect(emitted["Button.css.ts"]).toContain("export const button = recipe({");

  // Definition file: styled declaration and import gone.
  expect(changed["Button.tsx"]).not.toContain("styled.button");
  expect(changed["Button.tsx"]).not.toContain('from "styled-components"');

  // Importer: import repointed at the css, usage rewritten.
  expect(changed["App.tsx"]).toContain('import { button } from "./Button.css";');
  expect(changed["App.tsx"]).not.toContain('from "./Button"');
  expect(changed["App.tsx"]).toContain("<button className={button({ primary: true })}>Go</button>");
});

const MIXED_INPUT = `import styled from "styled-components";

const Bad = styled.div\`
  font-family: "X";
  \${(props) => extraStyles(props)}
\`;

const Good = styled.span\`
  color: blue;
\`;

export function App() {
  return (
    <>
      <Bad />
      <Good />
    </>
  );
}
`;

const FRAGMENT_INPUT = `import styled, { css } from "styled-components";

const rounded = css\`
  border-radius: 8px;
  overflow: hidden;
\`;

const Card = styled.div\`
  \${rounded}
  padding: 12px;
\`;

export function App() {
  return <Card className="root">x</Card>;
}
`;

test("converts a css fragment and composes it via clsx", async () => {
  const { changed, css } = await runPlugin(FRAGMENT_INPUT);

  expect(css).toContain("export const rounded = style({");
  expect(css).toContain('borderRadius: "8px"');
  expect(css).toContain('overflow: "hidden"');
  expect(css).toContain("export const card = style({");
  expect(css).toContain('padding: "12px"');

  expect(changed).toContain('import { card, rounded } from "./App.css";');
  expect(changed).toContain('className={clsx(rounded, card, "root")}');
  expect(changed).not.toContain('from "styled-components"');
  expect(changed).not.toContain("${rounded}");
});

const CONDITIONAL_BLOCK_INPUT = `import styled from "styled-components";

const Box = styled.div\`
  color: white;
  \${(p) => p.$active && \`background: blue;\`}
\`;

export function App() {
  return <Box $active className="c">x</Box>;
}
`;

test("converts a conditional css block into a boolean recipe variant", async () => {
  const { changed, css } = await runPlugin(CONDITIONAL_BLOCK_INPUT);

  expect(css).toContain("export const box = recipe({");
  expect(css).toContain('color: "white"'); // base
  expect(css).toContain("$active: {");
  expect(css).toContain('background: "blue"'); // variant true
  expect(css).toContain("$active: false"); // defaultVariants

  expect(changed).toContain('className={clsx(box({ $active: true }), "c")}');
  expect(changed).not.toContain('from "styled-components"');
});

const COMPUTED_THEME_INPUT = `import styled from "styled-components";

const Box = styled.div\`
  color: \${(props) => props.theme.colors.blueGrey[900]};
\`;

export function App() {
  return <Box>x</Box>;
}
`;

test("supports computed theme access (theme.x.y[900])", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-ct-"));
  try {
    await writeFile(join(dir, "App.tsx"), COMPUTED_THEME_INPUT, "utf8");
    const result = await run(styledToVanillaExtract, { root: dir });
    const css = result.emitted.find((file) => file.path.endsWith("App.css.ts"))?.contents ?? "";
    const theme =
      result.emitted.find((file) => file.path.endsWith("omnimod-theme.css.ts"))?.contents ?? "";

    expect(css).toContain('color: vars.colors.blueGrey["900"]');
    expect(theme).toContain("blueGrey: {");
    expect(theme).toContain('"900": null');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const COMPOSE_INPUT = `import styled from "styled-components";

const Base = styled.button\`
  padding: 8px;
\`;

const Fancy = styled(Base)\`
  color: red;
\`;

export function App() {
  return <Fancy className="x">go</Fancy>;
}
`;

test("composes styled(Base) into the base tag + base style", async () => {
  const { changed, css } = await runPlugin(COMPOSE_INPUT);

  expect(css).toContain("export const base = style({");
  expect(css).toContain('padding: "8px"');
  expect(css).toContain("export const fancy = style({");
  expect(css).toContain('color: "red"');

  // Inherits the base element (button) and composes both styles.
  expect(changed).toContain('import { base, fancy } from "./App.css";');
  expect(changed).toContain('<button className={clsx(base, fancy, "x")}>go</button>');
  expect(changed).not.toContain('from "styled-components"');
});

const ATTRS_INPUT = `import styled from "styled-components";

const Fancy = styled.button.attrs({ type: "button" })\`
  color: red;
\`;

export function App() {
  return <Fancy>x</Fancy>;
}
`;

test("emits MIGRATION.md listing what could not be converted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-mig-"));
  try {
    await writeFile(join(dir, "App.tsx"), ATTRS_INPUT, "utf8");
    const result = await run(styledToVanillaExtract, { root: dir });
    const migration =
      result.emitted.find((file) => file.path.endsWith("MIGRATION.md"))?.contents ?? "";

    expect(migration).toContain("Finish the styled-components");
    expect(migration).toContain("One-time setup");
    expect(migration).toContain("styled(...).attrs()");
    expect(migration).toContain("App.tsx");
    expect(migration).toContain("## Verify");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const MIXED_VALUE_INPUT = `import styled from "styled-components";

const Box = styled.div\`
  border: solid 1px \${({ theme }) => theme.colors.border};
  color: \${({ theme, active }) => (active ? theme.colors.on : theme.colors.off)};
\`;

export function App() {
  return <Box active>x</Box>;
}
`;

test("handles mixed values and theme-valued ternary branches", async () => {
  const { changed, css } = await runPlugin(MIXED_VALUE_INPUT);

  expect(css).toContain('import { vars } from "./omnimod-theme.css";');
  // Mixed value → template literal.
  expect(css).toContain("border: `solid 1px ${vars.colors.border}`");
  // Theme-valued ternary branches → recipe variant.
  expect(css).toContain("export const box = recipe({");
  expect(css).toContain("color: vars.colors.on");
  expect(css).toContain("color: vars.colors.off");
  expect(css).toContain("active: false");

  expect(changed).toContain("className={box({ active: true })}");
});

test("skips a component with an unparseable interpolation and converts the rest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-mixed-"));
  try {
    await writeFile(join(dir, "App.tsx"), MIXED_INPUT, "utf8");
    // Must not throw despite the statement-position interpolation in `Bad`.
    const result = await run(styledToVanillaExtract, { root: dir });
    const css = result.emitted.find((file) => file.path.endsWith("App.css.ts"))?.contents ?? "";
    const changed = result.changed.find((change) => change.path.endsWith("App.tsx"))?.after ?? "";

    // The parseable component converted.
    expect(css).toContain("export const good = style({");
    expect(css).toContain('color: "blue"');
    expect(changed).toContain("<span className={good} />");

    // The bad one was left untouched, with a diagnostic and the import kept.
    expect(changed).toContain("<Bad />");
    expect(changed).toContain('from "styled-components"');
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Bad"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
