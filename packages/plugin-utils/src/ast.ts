import type { Node } from "@omnimod/core";

// Narrow structural views over the oxc ESTree AST, shared by every omnimod
// plugin. These are *structural casts*, not runtime validation: guard on
// `node.type` first, then `cast<T>(node)` to read the fields you need. Fields
// that only some node producers set (e.g. `async`, `importKind`) are optional so
// a single definition serves all plugins.

/** Reinterpret a generic `Node` as one of the narrowed views below. */
export function cast<T extends Node>(node: Node): T {
  return node as unknown as T;
}

// — Identifiers & literals —————————————————————————————————————————————

export interface Identifier extends Node {
  name: string;
}
export interface JSXIdentifier extends Node {
  name: string;
}
export interface Literal extends Node {
  value: string | number | boolean | null;
  raw?: string;
}
/** A `Literal` already known to carry a string value. */
export interface StringLiteral extends Node {
  value: string;
}
export interface ThisExpression extends Node {
  type: "ThisExpression";
}

// — Expressions ————————————————————————————————————————————————————————

export interface MemberExpression extends Node {
  object: Node;
  property: Node;
  computed: boolean;
}
export interface CallExpression extends Node {
  callee: Node;
  arguments: Node[];
}
export interface NewExpression extends Node {
  callee: Node;
  arguments: Node[];
}
export interface ConditionalExpression extends Node {
  test: Node;
  consequent: Node;
  alternate: Node;
}
export interface BinaryExpression extends Node {
  operator: string;
  left: Node;
  right: Node;
}
export interface LogicalExpression extends Node {
  operator: string;
  left: Node;
  right: Node;
}
export interface UnaryExpression extends Node {
  operator: string;
  argument: Node;
}
export interface AssignmentExpression extends Node {
  operator: string;
  left: Node;
  right: Node;
}

// — Functions ——————————————————————————————————————————————————————————

export interface ArrowFunctionExpression extends Node {
  params: Node[];
  body: Node;
  expression: boolean;
  async?: boolean;
}
export interface FunctionExpression extends Node {
  params: Node[];
  body: Node;
  async?: boolean;
}
export interface FunctionDeclaration extends Node {
  id: Node | null;
  params: Node[];
  body: Node;
}

// — Objects, patterns & statements —————————————————————————————————————

export interface ObjectExpression extends Node {
  properties: Node[];
}
export interface ObjectPattern extends Node {
  properties: Node[];
}
export interface ArrayExpression extends Node {
  elements: (Node | null)[];
}
export interface Property extends Node {
  key: Node;
  value: Node;
  computed: boolean;
  shorthand: boolean;
  kind: string;
}
export interface AssignmentPattern extends Node {
  left: Node;
  right: Node;
}
export interface BlockStatement extends Node {
  body: Node[];
}
export interface ReturnStatement extends Node {
  argument: Node | null;
}
export interface ExpressionStatement extends Node {
  expression: Node;
}
export interface SwitchStatement extends Node {
  discriminant: Node;
  cases: Node[];
}
export interface VariableDeclarator extends Node {
  id: Node;
  init: Node | null;
}
export interface VariableDeclaration extends Node {
  declarations: VariableDeclarator[];
  kind: string;
}

// — Imports & exports ——————————————————————————————————————————————————

export interface ImportSpecifier extends Node {
  imported: Node;
  local: Identifier;
  /** "type" for `import type { X }` / `import { type X }`, else "value". */
  importKind?: string;
}
export interface ImportDefaultSpecifier extends Node {
  local: Identifier;
}
export interface ImportNamespaceSpecifier extends Node {
  local: Identifier;
}
export interface ImportDeclaration extends Node {
  source: StringLiteral;
  specifiers: Node[];
}
export interface ExportNamedDeclaration extends Node {
  declaration: Node | null;
}
export interface ExportDefaultDeclaration extends Node {
  declaration: Node;
}

// — Classes ————————————————————————————————————————————————————————————

export interface ClassBody extends Node {
  body: Node[];
}
export interface MethodDefinition extends Node {
  key: Node;
  value: FunctionExpression;
  kind: string;
  static: boolean;
  computed: boolean;
}
export interface PropertyDefinition extends Node {
  key: Node;
  value: Node | null;
  static: boolean;
  computed: boolean;
}
export interface ClassDeclaration extends Node {
  id: Identifier | null;
  superClass: Node | null;
  body: ClassBody;
}
export interface ClassExpression extends Node {
  id: Identifier | null;
  superClass: Node | null;
  body: ClassBody;
}

// — Template literals ——————————————————————————————————————————————————

export interface TemplateElementValue {
  raw: string;
  cooked: string | null;
}
export interface TemplateElement extends Node {
  value: TemplateElementValue;
}
export interface TemplateLiteral extends Node {
  quasis: TemplateElement[];
  expressions: Node[];
}
export interface TaggedTemplateExpression extends Node {
  tag: Node;
  quasi: TemplateLiteral;
}

// — JSX ————————————————————————————————————————————————————————————————

export interface JSXExpressionContainer extends Node {
  expression: Node;
}
export interface JSXAttribute extends Node {
  name: Node;
  value: Node | null;
}
export interface JSXSpreadAttribute extends Node {
  argument: Node;
}
export interface JSXOpeningElement extends Node {
  name: Node;
  attributes: Node[];
  selfClosing: boolean;
}
export interface JSXClosingElement extends Node {
  name: Node;
}
export interface JSXElement extends Node {
  openingElement: JSXOpeningElement;
}
