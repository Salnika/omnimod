import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@omnimod/core";
import { expect, test } from "vite-plus/test";
import { reactClassToHooks } from "../src/index.ts";

interface PluginResult {
  changed: string;
  diagnostics: { message: string; severity: string }[];
}

async function runPlugin(input: string, filename = "Component.tsx"): Promise<PluginResult> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-rc2h-"));
  try {
    await writeFile(join(dir, filename), input, "utf8");
    const result = await run(reactClassToHooks, { root: dir });
    const change = result.changed.find((c) => c.path.endsWith(filename));
    return {
      changed: change?.after ?? "",
      diagnostics: result.diagnostics.map((d) => ({ message: d.message, severity: d.severity })),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SIMPLE_INPUT = `import React from "react";
class Hello extends React.Component {
  render() {
    return <div>{this.props.name}</div>;
  }
}
export default Hello;
`;

test("converts a trivial class component into a function component", async () => {
  const { changed } = await runPlugin(SIMPLE_INPUT);

  expect(changed).toContain("function Hello(props)");
  expect(changed).toContain("<div>{props.name}</div>");
  expect(changed).not.toContain("extends");
  expect(changed).not.toContain("this.props");
  expect(changed).toContain("export default Hello;");
});

const STATE_INPUT = `import React, { Component } from "react";

export class Counter extends Component {
  state = { count: 0 };

  increment = () => {
    this.setState({ count: this.state.count + 1 });
  };

  componentDidMount() {
    console.log("mounted");
  }

  componentWillUnmount() {
    console.log("bye");
  }

  render() {
    return <button onClick={this.increment}>{this.state.count}</button>;
  }
}
`;

test("converts state, a bound method, and mount/unmount lifecycles to hooks", async () => {
  const { changed } = await runPlugin(STATE_INPUT);

  // useState from state field.
  expect(changed).toContain("const [count, setCount] = useState(0);");
  // Bound method → const arrow; setState → setter; this.state.count → count.
  expect(changed).toContain("const increment = () =>");
  expect(changed).toContain("setCount(count + 1)");
  // mount + unmount collapse into one effect with a cleanup.
  expect(changed).toContain("useEffect(() => {");
  expect(changed).toContain('console.log("mounted")');
  expect(changed).toContain("return () => {");
  expect(changed).toContain('console.log("bye")');
  expect(changed).toContain("}, []);");
  // render body, this.increment → increment.
  expect(changed).toContain("onClick={increment}");
  expect(changed).toContain("{count}");
  // Hooks imported (merged into the existing react import).
  expect(changed).toContain("useState");
  expect(changed).toContain("useEffect");
  expect(changed).not.toContain("extends");
});

const GDSFP_INPUT = `import React from "react";
class Tricky extends React.Component {
  static getDerivedStateFromProps(props, state) {
    return null;
  }
  render() {
    return <div />;
  }
}
export default Tricky;
`;

test("leaves a class with getDerivedStateFromProps untouched and warns", async () => {
  const { changed, diagnostics } = await runPlugin(GDSFP_INPUT);

  // Unchanged: still a class, no changed entry.
  expect(changed).toBe("");
  expect(diagnostics.some((d) => d.severity === "warn" && d.message.includes("Tricky"))).toBe(true);
});

const MULTIKEY_INPUT = `import React from "react";
class Multi extends React.Component {
  state = { a: 1, b: 2 };
  bump = () => {
    this.setState({ a: 1, b: 2 });
  };
  render() {
    return <div onClick={this.bump} />;
  }
}
export default Multi;
`;

test("leaves a component with a multi-key setState untouched and warns", async () => {
  const { changed, diagnostics } = await runPlugin(MULTIKEY_INPUT);

  expect(changed).toBe("");
  expect(diagnostics.some((d) => d.severity === "warn" && d.message.includes("setState"))).toBe(
    true,
  );
});
