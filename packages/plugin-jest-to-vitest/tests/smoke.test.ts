import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@omnimod/core";
import { expect, test } from "vite-plus/test";
import { jestToVitest } from "../src/index.ts";

async function runPlugin(
  name: string,
  input: string,
): Promise<{ changed: string; diagnostics: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-j2v-"));
  try {
    await writeFile(join(dir, name), input, "utf8");
    const result = await run(jestToVitest, { root: dir });
    const changed = result.changed.find((change) => change.path.endsWith(name))?.after ?? "";
    const diagnostics = result.diagnostics.map((diagnostic) => diagnostic.message);
    return { changed, diagnostics };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const INPUT = `test("x", () => {
  const f = jest.fn();
  jest.spyOn(obj, "m");
});
`;

test("rewrites jest.* to vi.* and prepends the vitest import", async () => {
  const { changed, diagnostics } = await runPlugin("thing.test.ts", INPUT);

  expect(changed).toContain("vi.fn()");
  expect(changed).toContain("vi.spyOn(");
  expect(changed.startsWith('import { vi } from "vitest";')).toBe(true);
  expect(changed).not.toContain("jest.fn");
  expect(changed).not.toContain("jest.spyOn");

  // One info diagnostic nudging the user to enable global test APIs.
  expect(diagnostics.some((message) => message.includes("globals: true"))).toBe(true);
});

const REQUIRE_ACTUAL_INPUT = `const actual = jest.requireActual("./mod");
jest.mock("./mod");
`;

test("renames requireActual to importActual and warns it is async", async () => {
  const { changed, diagnostics } = await runPlugin("mod.test.ts", REQUIRE_ACTUAL_INPUT);

  expect(changed).toContain("vi.importActual(");
  expect(changed).toContain("vi.mock(");
  expect(changed).not.toContain("requireActual");
  expect(diagnostics.some((message) => message.includes("async"))).toBe(true);
});

const GLOBALS_INPUT = `import { describe, expect } from "@jest/globals";

describe("x", () => {
  const f = jest.fn();
  expect(f).toBeDefined();
});
`;

test("repoints @jest/globals at vitest and adds vi to the existing import", async () => {
  const { changed } = await runPlugin("globals.test.ts", GLOBALS_INPUT);

  expect(changed).toContain('from "vitest"');
  expect(changed).not.toContain("@jest/globals");
  expect(changed).toContain("vi.fn()");
  // vi folded into the existing named import — no separate prepended line.
  expect(changed).toContain("vi, describe, expect");
  expect(changed).not.toContain('import { vi } from "vitest";');
});

const NO_JEST_INPUT = `test("x", () => {
  const value = compute();
  expect(value).toBe(1);
});
`;

test("leaves a file with no jest usage completely untouched", async () => {
  const { changed } = await runPlugin("pure.test.ts", NO_JEST_INPUT);

  // No jest references → no edits at all (not even a prepended vitest import).
  expect(changed).toBe("");
});
