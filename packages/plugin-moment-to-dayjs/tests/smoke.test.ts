import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@omnimod/core";
import { expect, test } from "vite-plus/test";
import { momentToDayjs } from "../src/index.ts";

async function runPlugin(
  fileName: string,
  input: string,
): Promise<{ after: string; diagnostics: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-m2d-"));
  try {
    await writeFile(join(dir, fileName), input, "utf8");
    const result = await run(momentToDayjs, { root: dir });
    const change = result.changed.find((c) => c.path.endsWith(fileName));
    return {
      after: change?.after ?? "",
      diagnostics: result.diagnostics.map((d) => d.message),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const BASIC_INPUT = `import moment from "moment";
export const d = moment("2020-01-01").add(1, "day").format("YYYY-MM-DD");
`;

test("rewrites the moment import and its call sites to dayjs", async () => {
  const { after } = await runPlugin("date.ts", BASIC_INPUT);

  expect(after).toContain('import dayjs from "dayjs"');
  expect(after).toContain('dayjs("2020-01-01").add(1, "day").format(');
  expect(after).not.toContain('from "moment"');
  expect(after).not.toContain("moment(");
});

const ALIAS_INPUT = `import m from "moment";
export const now = m();
`;

test("keeps an aliased default binding and only repoints the source", async () => {
  const { after } = await runPlugin("alias.ts", ALIAS_INPUT);

  expect(after).toContain('import m from "dayjs"');
  expect(after).toContain("const now = m();");
  expect(after).not.toContain('"moment"');
});

const TYPE_INPUT = `import moment, { Moment } from "moment";
export function fmt(d: Moment): string {
  return moment(d).format("YYYY");
}
`;

test("rewrites the type-only Moment import (and its annotations) to Dayjs", async () => {
  const { after } = await runPlugin("types.ts", TYPE_INPUT);

  expect(after).toContain('from "dayjs"');
  expect(after).toContain("{ Dayjs }");
  expect(after).toContain("d: Dayjs");
  expect(after).not.toContain("Moment");
  expect(after).toContain("dayjs(d).format(");
});

const UTC_INPUT = `import moment from "moment";
export const d = moment.utc("2020-01-01").toISOString();
`;

test("reports a diagnostic for moment.utc and leaves a TODO", async () => {
  const { after, diagnostics } = await runPlugin("utc.ts", UTC_INPUT);

  expect(diagnostics.some((m) => m.includes("utc"))).toBe(true);
  expect(after).toContain("// TODO(omnimod):");
  expect(after).toContain("dayjs/plugin/utc");
});
