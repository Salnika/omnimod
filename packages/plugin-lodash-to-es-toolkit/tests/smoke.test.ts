import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@omnimod/core";
import { expect, test } from "vite-plus/test";
import { lodashToEsToolkit } from "../src/index.ts";

async function runPlugin(input: string): Promise<{
  after: string;
  diagnostics: { message: string }[];
}> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-lodash-"));
  try {
    await writeFile(join(dir, "input.ts"), input, "utf8");
    const result = await run(lodashToEsToolkit, { root: dir });
    const change = result.changed.find((c) => c.path.endsWith("input.ts"));
    return {
      after: change?.after ?? "",
      diagnostics: result.diagnostics.map((d) => ({ message: d.message })),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("splits a mixed lodash import into es-toolkit + residual lodash", async () => {
  const { after, diagnostics } = await runPlugin(
    `import { debounce, cloneDeep, get } from "lodash";\nexport const d = debounce(() => {}, 100);\n`,
  );

  // Supported names moved to es-toolkit.
  expect(after).toContain('from "es-toolkit"');
  expect(after).toContain("debounce");
  expect(after).toContain("cloneDeep");

  // Divergent `get` stays imported from lodash (split import).
  expect(after).toContain('import { get } from "lodash";');

  // Usage of debounce is untouched (still valid — es-toolkit re-exports it).
  expect(after).toContain("export const d = debounce(() => {}, 100);");

  // A diagnostic mentions the residual `get`.
  expect(diagnostics.some((d) => d.message.includes("get"))).toBe(true);
});

test("rewrites native-safe isArray to Array.isArray and drops the import", async () => {
  const { after } = await runPlugin(
    `import { isArray } from "lodash";\nexport const a = isArray(x);\n`,
  );

  expect(after).toContain("Array.isArray(x)");
  expect(after).not.toContain('from "lodash"');
  expect(after).not.toContain('from "es-toolkit"');
});

test("moves an all-supported import wholesale to es-toolkit", async () => {
  const { after } = await runPlugin(`import { uniq, chunk } from "lodash-es";\n`);
  expect(after).toContain('from "es-toolkit"');
  expect(after).toContain("chunk");
  expect(after).toContain("uniq");
  expect(after).not.toContain("lodash-es");
});

test("warns on a default lodash import and leaves it untouched", async () => {
  const { after, diagnostics } = await runPlugin(
    `import _ from "lodash";\nexport const v = _.debounce(fn, 10);\n`,
  );
  expect(after).toBe("");
  expect(diagnostics.some((d) => d.message.includes("Default"))).toBe(true);
});
