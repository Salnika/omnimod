// @omnimod/plugin-utils — helpers for authoring omnimod plugins.

export { cast } from "./ast.ts";
export type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ClassBody,
  ClassDeclaration,
  ClassExpression,
  ConditionalExpression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ExpressionStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  JSXAttribute,
  JSXClosingElement,
  JSXElement,
  JSXExpressionContainer,
  JSXIdentifier,
  JSXOpeningElement,
  JSXSpreadAttribute,
  Literal,
  LogicalExpression,
  MemberExpression,
  MethodDefinition,
  NewExpression,
  ObjectExpression,
  ObjectPattern,
  Property,
  PropertyDefinition,
  ReturnStatement,
  StringLiteral,
  SwitchStatement,
  TaggedTemplateExpression,
  TemplateElement,
  TemplateElementValue,
  TemplateLiteral,
  ThisExpression,
  UnaryExpression,
  VariableDeclaration,
  VariableDeclarator,
} from "./ast.ts";

export { cssPropToCamel } from "./casing.ts";

export {
  buildPlaceholderCss,
  cssToVeStyle,
  globalRules,
  keyframesToVe,
  parseScss,
  placeholderToken,
} from "./css.ts";
export type { DescendantRule, PlaceholderResolver, VeStyleResult } from "./css.ts";

export { ImportManager } from "./imports.ts";

export {
  isEmptyObject,
  serializeVe,
  veArray,
  veBoolean,
  veNumber,
  veObject,
  veRaw,
  veString,
} from "./ve.ts";
export type { VeEntry, VeValue } from "./ve.ts";
