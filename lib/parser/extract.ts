import { Node, Project, SyntaxKind } from "ts-morph";
import type { EdgeKind } from "./types.ts";

export interface RawImport {
  /** null when a dynamic import's argument isn't a literal string. */
  specifier: string | null;
  /** The argument's source text, kept so a non-literal import can still be named. */
  text: string;
  line: number;
  kind: EdgeKind;
  typeOnly: boolean;
}

// One in-memory project reused for every file: parsing only, never resolution,
// which is done separately so every outcome can be classified and reported.
const project = new Project({
  useInMemoryFileSystem: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: true },
});

export function extractImports(fileName: string, text: string): RawImport[] {
  // `fileName` decides how the text is parsed (.tsx enables JSX, .js allows JS-only syntax).
  const source = project.createSourceFile(fileName, text, { overwrite: true });
  const found: RawImport[] = [];

  for (const decl of source.getImportDeclarations()) {
    found.push({
      specifier: decl.getModuleSpecifierValue(),
      text: decl.getModuleSpecifier().getText(),
      line: decl.getStartLineNumber(),
      kind: "import",
      typeOnly: decl.isTypeOnly(),
    });
  }

  for (const decl of source.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier === undefined) continue; // `export { x }` re-exports nothing from another file
    found.push({
      specifier,
      text: decl.getModuleSpecifier()?.getText() ?? specifier,
      line: decl.getStartLineNumber(),
      kind: "reexport",
      typeOnly: decl.isTypeOnly(),
    });
  }

  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const arg = call.getArguments()[0];
    const literal =
      arg !== undefined && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))
        ? arg.getLiteralValue()
        : null;
    found.push({
      specifier: literal,
      text: arg?.getText() ?? "",
      line: call.getStartLineNumber(),
      kind: "dynamic",
      typeOnly: false,
    });
  }

  project.removeSourceFile(source);
  return found.sort((a, b) => a.line - b.line);
}
