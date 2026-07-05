/**
 * Collects import specifiers needed by generated code and renders them as
 * `import` statements. Deduplicates and sorts for deterministic output.
 */
export class ImportManager {
  // module -> (local name -> imported name)
  private readonly named = new Map<string, Map<string, string>>();
  // module -> default local name
  private readonly defaults = new Map<string, string>();

  /** Require `import { <imported> as <local> } from "<module>"`. */
  addNamed(module: string, imported: string, local: string = imported): void {
    let entry = this.named.get(module);
    if (!entry) {
      entry = new Map();
      this.named.set(module, entry);
    }
    entry.set(local, imported);
  }

  /** Require `import <local> from "<module>"`. */
  addDefault(module: string, local: string): void {
    this.defaults.set(module, local);
  }

  isEmpty(): boolean {
    return this.named.size === 0 && this.defaults.size === 0;
  }

  /** Render one import statement per module, sorted by module specifier. */
  render(): string {
    const modules = [...new Set([...this.named.keys(), ...this.defaults.keys()])].sort();
    const lines: string[] = [];

    for (const module of modules) {
      const clauses: string[] = [];
      const defaultLocal = this.defaults.get(module);
      if (defaultLocal) clauses.push(defaultLocal);

      const named = this.named.get(module);
      if (named && named.size > 0) {
        const specifiers = [...named.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([local, imported]) => (local === imported ? imported : `${imported} as ${local}`));
        clauses.push(`{ ${specifiers.join(", ")} }`);
      }

      lines.push(`import ${clauses.join(", ")} from ${JSON.stringify(module)};`);
    }

    return lines.join("\n");
  }
}
