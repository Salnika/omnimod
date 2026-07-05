import { expect, test } from "vite-plus/test";
import {
  buildPlaceholderCss,
  cssToVeStyle,
  parseScss,
  placeholderToken,
  serializeVe,
  veRaw,
} from "../src/index.ts";

test("buildPlaceholderCss inserts one token per interpolation", () => {
  expect(buildPlaceholderCss(["color: ", ";"])).toBe(`color: ${placeholderToken(0)};`);
});

test("cssToVeStyle converts declarations, pseudos, media and descendants", () => {
  const css = `
    color: red;
    padding: 10px;
    z-index: 5;
    &:hover { color: blue; }
    & .icon { fill: green; }
    @media (min-width: 768px) { display: flex; }
  `;
  const result = cssToVeStyle(parseScss(css));
  const base = serializeVe(result.base);

  expect(base).toContain('color: "red"');
  expect(base).toContain('padding: "10px"');
  expect(base).toContain("zIndex: 5");
  expect(base).toContain('"&:hover"');
  expect(base).toContain('color: "blue"');
  expect(base).toContain('"@media"');
  expect(base).toContain('"(min-width: 768px)"');
  expect(base).toContain('display: "flex"');

  expect(result.descendants).toHaveLength(1);
  expect(result.descendants[0].selector).toBe("& .icon");
  expect(serializeVe(result.descendants[0].style)).toContain('fill: "green"');
});

test("cssToVeStyle resolves interpolation placeholders via the resolver", () => {
  const css = `color: ${placeholderToken(0)};`;
  const result = cssToVeStyle(parseScss(css), (token) =>
    token === placeholderToken(0) ? veRaw("vars.color.primary") : null,
  );
  expect(serializeVe(result.base)).toContain("color: vars.color.primary");
  expect(result.warnings).toHaveLength(0);
});
