import type { Node, Program } from "@omnimod/core";
import {
  cast,
  type ClassDeclaration,
  type Identifier,
  type MemberExpression,
  type MethodDefinition,
  type PropertyDefinition,
} from "@omnimod/plugin-utils";

/** The React class-component base classes we recognise as a superclass. */
const REACT_BASES = new Set(["Component", "PureComponent"]);

/**
 * True when `superClass` is one of `React.Component`, `Component`,
 * `React.PureComponent`, `PureComponent`.
 */
function isReactComponentSuper(superClass: Node | null): boolean {
  if (!superClass) return false;
  if (superClass.type === "Identifier") {
    return REACT_BASES.has(cast<Identifier>(superClass).name);
  }
  if (superClass.type === "MemberExpression") {
    const member = cast<MemberExpression>(superClass);
    if (member.computed || member.property.type !== "Identifier") return false;
    if (member.object.type !== "Identifier") return false;
    return (
      cast<Identifier>(member.object).name === "React" &&
      REACT_BASES.has(cast<Identifier>(member.property).name)
    );
  }
  return false;
}

/** A class member we understand and can migrate. */
export interface ClassMember {
  node: Node;
  kind:
    | "render"
    | "state-field"
    | "lifecycle-mount"
    | "lifecycle-unmount"
    | "lifecycle-update"
    | "method"
    | "default-props"
    | "constructor";
  /** Local name for methods / fields (their key). */
  name: string;
}

export interface ClassInfo {
  /** The class node (declaration or expression). */
  node: ClassDeclaration;
  /** Local component name; null for anonymous classes. */
  name: string | null;
  members: ClassMember[];
  /** Human-readable reason the class must be left untouched, if any. */
  bail: string | null;
}

const UNSUPPORTED_LIFECYCLE = new Set([
  "getDerivedStateFromProps",
  "getSnapshotBeforeUpdate",
  "shouldComponentUpdate",
  "componentDidCatch",
  "getDerivedStateFromError",
  "componentWillMount",
  "UNSAFE_componentWillMount",
  "componentWillReceiveProps",
  "UNSAFE_componentWillReceiveProps",
  "componentWillUpdate",
  "UNSAFE_componentWillUpdate",
]);

/** Property key as a plain string, or null if it is computed / non-identifier. */
function memberName(key: Node, computed: boolean): string | null {
  if (computed) return null;
  if (key.type === "Identifier") return cast<Identifier>(key).name;
  if (key.type === "Literal") {
    const value = (key as { value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * Inspect a React class component and decide whether it is "simple" enough to
 * migrate. Returns a `bail` reason (non-null) when it must be left untouched.
 */
function analyzeClass(node: ClassDeclaration): ClassInfo {
  const name = node.id ? cast<Identifier>(node.id).name : null;
  const members: ClassMember[] = [];
  let bail: string | null = null;
  let hasRender = false;

  for (const raw of node.body.body) {
    if (bail) break;

    if (raw.type === "MethodDefinition") {
      const method = cast<MethodDefinition>(raw);
      const key = memberName(method.key, method.computed);

      if (method.kind === "constructor") {
        // Only a bare `super(props)` constructor (with an optional
        // `this.state = {}` assignment) is trivial; anything else bails.
        bail = "constructor contains logic beyond super()/this.state";
        continue;
      }
      if (method.static) {
        bail = `unsupported static method \`${key ?? "?"}\``;
        continue;
      }
      if (key === null) {
        bail = "computed method name";
        continue;
      }
      if (key === "render") {
        hasRender = true;
        members.push({ node: raw, kind: "render", name: key });
      } else if (key === "componentDidMount") {
        members.push({ node: raw, kind: "lifecycle-mount", name: key });
      } else if (key === "componentWillUnmount") {
        members.push({ node: raw, kind: "lifecycle-unmount", name: key });
      } else if (key === "componentDidUpdate") {
        members.push({ node: raw, kind: "lifecycle-update", name: key });
      } else if (UNSUPPORTED_LIFECYCLE.has(key)) {
        bail = `unsupported lifecycle method \`${key}\``;
      } else if (method.kind === "get" || method.kind === "set") {
        bail = `unsupported accessor \`${key}\``;
      } else {
        members.push({ node: raw, kind: "method", name: key });
      }
      continue;
    }

    if (raw.type === "PropertyDefinition") {
      const prop = cast<PropertyDefinition>(raw);
      const key = memberName(prop.key, prop.computed);
      if (key === null) {
        bail = "computed class field";
        continue;
      }
      if (prop.static) {
        if (key === "defaultProps") {
          members.push({ node: raw, kind: "default-props", name: key });
        } else {
          bail = `unsupported static field \`${key}\``;
        }
        continue;
      }
      if (key === "state") {
        members.push({ node: raw, kind: "state-field", name: key });
        continue;
      }
      // An arrow-function class field is a bound method → convertible.
      if (prop.value && prop.value.type === "ArrowFunctionExpression") {
        members.push({ node: raw, kind: "method", name: key });
        continue;
      }
      bail = `unsupported instance field \`${key}\` (only \`state\` and bound methods are handled)`;
      continue;
    }

    if (raw.type === "StaticBlock") {
      bail = "static initialization block";
      continue;
    }
    // Anything else (accessor property, etc.) is not understood.
    bail = `unsupported class member \`${raw.type}\``;
  }

  if (!bail && !hasRender) bail = "no render() method";

  return { node, name, members, bail };
}

/**
 * Collect top-level React class components (declaration or expression) in a
 * module. Only top-level classes and single-declarator `const X = class ...`
 * variable forms are considered; anything nested / HOC-wrapped is ignored.
 */
export interface FoundClass {
  info: ClassInfo;
  /** The whole top-level statement enclosing the class (for span edits). */
  statement: Node;
  /** True when the class is the declaration form (`class X extends ...`). */
  isDeclaration: boolean;
}

export function findClassComponents(program: Program): FoundClass[] {
  const found: FoundClass[] = [];

  for (const stmt of program.body) {
    let classNode: ClassDeclaration | null = null;
    let isDeclaration = false;

    if (stmt.type === "ClassDeclaration") {
      classNode = cast<ClassDeclaration>(stmt);
      isDeclaration = true;
    } else if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") {
      const decl = (stmt as { declaration?: Node | null }).declaration;
      if (decl && decl.type === "ClassDeclaration") {
        classNode = cast<ClassDeclaration>(decl);
        isDeclaration = true;
      }
    }

    if (!classNode) continue;
    if (!isReactComponentSuper(classNode.superClass)) continue;

    found.push({ info: analyzeClass(classNode), statement: stmt, isDeclaration });
  }

  return found;
}
