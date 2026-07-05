import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@omnimod/core";
import { expect, test } from "vite-plus/test";
import { reduxToToolkit } from "../src/index.ts";

async function runPlugin(
  input: string,
  filename = "store.ts",
): Promise<{ after: string; diagnostics: { message: string; severity: string }[] }> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-rtk-"));
  try {
    await writeFile(join(dir, filename), input, "utf8");
    const result = await run(reduxToToolkit, { root: dir });
    const change = result.changed.find((c) => c.path.endsWith(filename));
    return {
      after: change?.after ?? "",
      diagnostics: result.diagnostics.map((d) => ({ message: d.message, severity: d.severity })),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("rewrites createStore into configureStore and retargets the import", async () => {
  const { after } = await runPlugin(
    `import { createStore } from "redux";\nconst store = createStore(rootReducer);\n`,
  );

  expect(after).toContain('import { configureStore } from "@reduxjs/toolkit"');
  expect(after).toContain("configureStore({ reducer: rootReducer })");
  expect(after).not.toContain("createStore");
  expect(after).not.toContain('from "redux"');
});

test("moves preloadedState into the configureStore object", async () => {
  const { after } = await runPlugin(
    `import { createStore } from "redux";\nconst store = createStore(rootReducer, preloaded);\n`,
  );

  expect(after).toContain("configureStore({ reducer: rootReducer, preloadedState: preloaded })");
});

test("warns and leaves a TODO for applyMiddleware enhancers", async () => {
  const { after, diagnostics } = await runPlugin(
    `import { createStore, applyMiddleware } from "redux";\nconst store = createStore(rootReducer, applyMiddleware(thunk));\n`,
  );

  expect(after).toContain("configureStore({ reducer: rootReducer })");
  expect(after).toContain("TODO(omnimod)");
  expect(after).toContain("applyMiddleware(thunk)");
  // applyMiddleware is RTK-reexported → the import is retargeted too.
  expect(after).toContain('from "@reduxjs/toolkit"');
  expect(diagnostics.some((d) => d.severity === "warn" && d.message.includes("enhancers"))).toBe(
    true,
  );
});

test("keeps redux-only exports on redux and moves known names to RTK", async () => {
  const { after } = await runPlugin(
    `import { createStore, __DO_NOT_USE__ActionTypes } from "redux";\nconst store = createStore(rootReducer);\n`,
  );

  // Known name split out to RTK.
  expect(after).toContain('import { configureStore } from "@reduxjs/toolkit";');
  // Unknown redux export stays on redux.
  expect(after).toContain('from "redux"');
  expect(after).toContain("__DO_NOT_USE__ActionTypes");
});

test("reports a warn for a switch-statement reducer and leaves it untouched", async () => {
  const input = `const initialState = { count: 0 };
export function counter(state = initialState, action) {
  switch (action.type) {
    case "INC":
      return { count: state.count + 1 };
    default:
      return state;
  }
}
`;
  const { after, diagnostics } = await runPlugin(input, "reducer.ts");

  expect(diagnostics.some((d) => d.severity === "warn" && /createSlice/.test(d.message))).toBe(
    true,
  );
  expect(after).toContain("TODO(omnimod)");
  // Body left intact — the switch is not rewritten.
  expect(after).toContain('case "INC":');
  expect(after).toContain("switch (action.type)");
});
