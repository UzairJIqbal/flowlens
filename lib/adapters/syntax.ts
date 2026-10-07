import { Node, Project, type SourceFile } from "ts-morph";
import type { SourceText } from "../parser/adapter.ts";

// Routes are read from syntax, never from text patterns: a decorator argument
// is a string literal or it isn't, and only the parser can say which.

// Parsing only. Nothing here resolves a name to another file; a value that
// lives in another file is, to an adapter, a value it can't see.
const project = new Project({
  useInMemoryFileSystem: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: true },
});

export function withSource<T>(file: SourceText, read: (source: SourceFile) => T): T {
  // The leading slash and extension decide how the text parses (.tsx enables JSX).
  const source = project.createSourceFile(`/${file.path}`, file.text, { overwrite: true });
  try {
    return read(source);
  } finally {
    project.removeSourceFile(source);
  }
}

/** The value of a plain string literal, or null for anything that has to be evaluated. */
export function literal(node: Node | undefined): string | null {
  if (node !== undefined && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))) {
    return node.getLiteralValue();
  }
  return null;
}

/** A string literal, or an array made only of them. Null if any part has to be evaluated. */
export function literals(node: Node | undefined): string[] | null {
  const one = literal(node);
  if (one !== null) return [one];
  if (node === undefined || !Node.isArrayLiteralExpression(node)) return null;
  const values: string[] = [];
  for (const element of node.getElements()) {
    const value = literal(element);
    if (value === null) return null;
    values.push(value);
  }
  return values.length > 0 ? values : null;
}

/**
 * Local names bound to a package's named exports, mapped to the export each
 * one is: `import { Get as G } from "@nestjs/common"` gives G → Get.
 */
export function importedNames(source: SourceFile, from: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const decl of source.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== from) continue;
    for (const named of decl.getNamedImports()) {
      names.set(named.getAliasNode()?.getText() ?? named.getName(), named.getName());
    }
  }
  return names;
}
