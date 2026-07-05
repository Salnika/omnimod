import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { run, walk } from "../src/index.ts";
import type { Plugin } from "../src/index.ts";

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-core-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf8");
  }
  return dir;
}

const renamePlugin: Plugin = {
  name: "rename-a-to-b",
  transform(file) {
    walk(file.program, (node) => {
      if (node.type === "Identifier" && node.name === "a") {
        file.magic.update(node.start, node.end, "b");
      }
    });
  },
};

test("run() reports changes as a dry-run without touching disk", async () => {
  const dir = await tempProject({ "in.ts": "export const a = 1;\n" });
  try {
    const result = await run(renamePlugin, { root: dir });
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].after).toBe("export const b = 1;\n");
    expect(await readFile(join(dir, "in.ts"), "utf8")).toBe("export const a = 1;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run({ write: true }) persists edits and emitted files", async () => {
  const dir = await tempProject({ "in.ts": "export const a = 1;\n" });
  const emitPlugin: Plugin = {
    name: "emit-generated",
    transform(file) {
      file.emit({ path: "generated.ts", contents: "export const g = 42;\n" });
    },
  };
  try {
    const result = await run(emitPlugin, { root: dir, write: true });
    expect(result.emitted).toHaveLength(1);
    expect(await readFile(join(dir, "generated.ts"), "utf8")).toBe("export const g = 42;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run() collects diagnostics reported by the plugin", async () => {
  const dir = await tempProject({ "in.ts": "const a = 1;\n" });
  const reportPlugin: Plugin = {
    name: "reporter",
    transform(file) {
      file.report({ message: "heads up", severity: "warn" });
    },
  };
  try {
    const result = await run(reportPlugin, { root: dir });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe("heads up");
    expect(result.diagnostics[0].file).toContain("in.ts");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
