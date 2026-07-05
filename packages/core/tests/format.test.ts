import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { detectFixers, formatFiles } from "../src/index.ts";

// A stand-in `prettier` bin: appends a marker to every non-flag argument (file).
const FAKE_PRETTIER = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --*) ;;
    *) printf '/* formatted */\\n' >> "$arg" ;;
  esac
done
`;

async function setupProject(): Promise<{ dir: string; target: string }> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-fmt-"));
  await writeFile(join(dir, ".prettierrc"), "{}", "utf8");
  await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
  const bin = join(dir, "node_modules", ".bin", "prettier");
  await writeFile(bin, FAKE_PRETTIER, "utf8");
  await chmod(bin, 0o755);
  const target = join(dir, "App.css.ts");
  await writeFile(target, "export const a = 1;\n", "utf8");
  return { dir, target };
}

test("detectFixers finds prettier from a config + local bin", async () => {
  const { dir } = await setupProject();
  try {
    expect(detectFixers(dir).map((fixer) => fixer.tool)).toContain("prettier");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatFiles runs the detected formatter on the given files", async () => {
  const { dir, target } = await setupProject();
  try {
    const result = await formatFiles(dir, [target]);
    expect(result.tools).toContain("prettier");
    expect(await readFile(target, "utf8")).toContain("/* formatted */");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatFiles is a no-op when no formatter is configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-nofmt-"));
  try {
    const result = await formatFiles(dir, [join(dir, "x.ts")]);
    expect(result.tools).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
