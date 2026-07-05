import { expect, test } from "vite-plus/test";
import {
  cssPropToCamel,
  ImportManager,
  serializeVe,
  veNumber,
  veObject,
  veRaw,
  veString,
} from "../src/index.ts";

test("cssPropToCamel handles standard and vendor-prefixed properties", () => {
  expect(cssPropToCamel("background-color")).toBe("backgroundColor");
  expect(cssPropToCamel("-webkit-transition")).toBe("WebkitTransition");
  expect(cssPropToCamel("-ms-flex")).toBe("msFlex");
  expect(cssPropToCamel("--my-var")).toBe("--my-var");
  expect(cssPropToCamel("color")).toBe("color");
});

test("serializeVe renders objects, quoting keys only when required", () => {
  const value = veObject([
    { key: "color", value: veString("red") },
    { key: "zIndex", value: veNumber(5) },
    { key: ":hover", value: veObject([{ key: "color", value: veRaw("vars.blue") }]) },
  ]);
  expect(serializeVe(value)).toBe(
    [
      "{",
      '  color: "red",',
      "  zIndex: 5,",
      '  ":hover": {',
      "    color: vars.blue,",
      "  },",
      "}",
    ].join("\n"),
  );
});

test("ImportManager renders sorted, deduped imports", () => {
  const imports = new ImportManager();
  imports.addNamed("@vanilla-extract/css", "style");
  imports.addNamed("@vanilla-extract/css", "globalStyle");
  imports.addDefault("clsx", "clsx");
  expect(imports.render()).toBe(
    ['import { globalStyle, style } from "@vanilla-extract/css";', 'import clsx from "clsx";'].join(
      "\n",
    ),
  );
});
