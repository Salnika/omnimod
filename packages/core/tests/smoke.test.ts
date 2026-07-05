import { expect, test } from "vite-plus/test";
import { parseFile, walk } from "../src/index.ts";

test("parseFile parses TSX and exposes usable UTF-16 offsets", () => {
  const source = "const Foo = styled.div`color: red;`;\n";
  const parsed = parseFile("Foo.tsx", source);
  expect(parsed.errors).toHaveLength(0);
  expect(parsed.program.type).toBe("Program");

  const spans: string[] = [];
  walk(parsed.program, (node) => {
    if (node.type === "TaggedTemplateExpression") {
      spans.push(source.slice(node.start, node.end));
    }
  });
  expect(spans).toEqual(["styled.div`color: red;`"]);
});

test("walk can skip subtrees", () => {
  const parsed = parseFile("x.ts", "const a = { b: 1 };");
  const seen: string[] = [];
  walk(parsed.program, (node) => {
    seen.push(node.type);
    if (node.type === "ObjectExpression") return "skip";
  });
  expect(seen).toContain("ObjectExpression");
  expect(seen).not.toContain("Property");
});
