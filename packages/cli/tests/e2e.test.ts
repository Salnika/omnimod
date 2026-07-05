import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { main } from "../src/index.ts";

const INPUT = `import styled from "styled-components";

const Card = styled.div\`
  color: red;
  & .icon {
    color: green;
  }
\`;

export function App() {
  return (
    <Card className="wrapper">
      <span className="icon" />
    </Card>
  );
}
`;

test("omnimod run --write converts a project end-to-end", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-cli-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "App.tsx"), INPUT, "utf8");

    const code = await main([
      "node",
      "omnimod",
      "run",
      "styled-to-vanilla-extract",
      "src/**/*.tsx",
      "--write",
      "--cwd",
      dir,
    ]);
    expect(code).toBe(0);

    const css = await readFile(join(dir, "src", "App.css.ts"), "utf8");
    expect(css).toContain("export const card = style({");
    expect(css).toContain("globalStyle(");

    const app = await readFile(join(dir, "src", "App.tsx"), "utf8");
    expect(app).toContain('import { card } from "./App.css";');
    expect(app).toContain('<div className={clsx(card, "wrapper")}>');
    expect(app).not.toContain("styled-components");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
