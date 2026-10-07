import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import type { EdgeKind } from "./types.ts";

export interface RawImport {
  /** null when an `import()` or `require()` argument isn't a literal string. */
  specifier: string | null;
  /** The argument's source text, kept so a non-literal import can still be named. */
  text: string;
  line: number;
  kind: EdgeKind;
  typeOnly: boolean;
}

export interface RawModule {
  imports: RawImport[];
  /** See `FileNode.exports`. */
  exports: string[] | null;
}

// One in-memory project reused for every file: parsing only, never resolution,
// which is done separately so every outcome can be classified and reported.
const project = new Project({
  useInMemoryFileSystem: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: true },
});

export function extractModule(fileName: string, text: string): RawModule {
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
    const callee = call.getExpression();
    let kind: EdgeKind;
    if (callee.getKind() === SyntaxKind.ImportKeyword) kind = "dynamic";
    // Only the bare global. `require.resolve()` loads nothing, and a
    // `createRequire()` result is a value whose name could be anything.
    else if (Node.isIdentifier(callee) && callee.getText() === "require") kind = "require";
    else continue;
    const arg = call.getArguments()[0];
    found.push({
      specifier: literal(arg),
      text: arg?.getText() ?? "",
      line: call.getStartLineNumber(),
      kind,
      typeOnly: false,
    });
  }

  // TypeScript's spelling of the same call: `import x = require("./x")`.
  for (const decl of source.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    const ref = decl.getModuleReference();
    if (!Node.isExternalModuleReference(ref)) continue; // `import x = A.B` aliases a namespace
    const arg = ref.getExpression();
    found.push({
      specifier: literal(arg),
      text: arg?.getText() ?? "",
      line: decl.getStartLineNumber(),
      kind: "require",
      typeOnly: decl.isTypeOnly(),
    });
  }

  const exports = commonjsExports(source, found.some((r) => r.kind === "require"));
  project.removeSourceFile(source);
  // Stable, so records on one line keep the order they were collected in.
  return { imports: found.sort((a, b) => a.line - b.line), exports };
}

function literal(node: Node | undefined): string | null {
  return node !== undefined && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    ? node.getLiteralValue()
    : null;
}

// ---------------------------------------------------------------------------
// CommonJS exports.
// ---------------------------------------------------------------------------

/** `exports` itself, not a property that happens to be called that. */
const isExportsName = (node: Node): boolean => Node.isIdentifier(node) && node.getText() === "exports";

/** `module.exports`. */
const isModuleExports = (node: Node): boolean =>
  Node.isPropertyAccessExpression(node) &&
  node.getName() === "exports" &&
  Node.isIdentifier(node.getExpression()) &&
  node.getExpression().getText() === "module";

const isExportsObject = (node: Node): boolean => isExportsName(node) || isModuleExports(node);

function isEsm(source: SourceFile): boolean {
  return (
    source.getImportDeclarations().length > 0 ||
    source.getExportDeclarations().length > 0 ||
    source.getExportAssignments().some((a) => !a.isExportEquals()) ||
    source.getStatements().some((s) => Node.isModifierable(s) && s.hasModifier(SyntaxKind.ExportKeyword))
  );
}

/**
 * Names read from assignments to `exports.x`, `module.exports.x` and
 * `module.exports` itself, plus `Object.defineProperty(exports, "x")`, which
 * is how compiled TypeScript writes them. Anything that hands the exports
 * object somewhere else, or whose name has to be evaluated, makes the whole
 * list unreadable: a list with a name missing would look complete.
 */
function commonjsExports(source: SourceFile, requires: boolean): string[] | null {
  if (isEsm(source)) return null;
  let commonjs = requires || /\.c[jt]s$/.test(source.getFilePath());
  const names: string[] = [];
  let unreadable = false;
  let replaced = 0;
  // `exports.x =` writes to the original object, which is no longer what's
  // exported once `module.exports` is replaced.
  let viaExportsName = false;

  const replace = (value: Node | undefined) => {
    commonjs = true;
    replaced += 1;
    if (value === undefined) return;
    if (Node.isCallExpression(value) && Node.isIdentifier(value.getExpression()) && value.getExpression().getText() === "require") {
      unreadable = true; // the names belong to the required file
      return;
    }
    if (!Node.isObjectLiteralExpression(value)) {
      names.push("default");
      return;
    }
    for (const prop of value.getProperties()) {
      if (Node.isSpreadAssignment(prop)) {
        unreadable = true;
        continue;
      }
      const key = prop.getNameNode();
      if (Node.isIdentifier(key) || Node.isNumericLiteral(key)) names.push(key.getText());
      else if (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) names.push(key.getLiteralValue());
      else unreadable = true; // computed
    }
  };

  for (const node of source.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (node.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = node.getLeft();
    if (isModuleExports(left)) {
      replace(node.getRight());
      continue;
    }
    if (!Node.isPropertyAccessExpression(left) && !Node.isElementAccessExpression(left)) continue;
    const target = left.getExpression();
    if (!isExportsObject(target)) continue;
    commonjs = true;
    if (isExportsName(target)) viaExportsName = true;
    const name = Node.isPropertyAccessExpression(left) ? left.getName() : literal(left.getArgumentExpression());
    if (name === null) unreadable = true;
    else names.push(name);
  }

  // TypeScript's `export = x` is `module.exports = x`.
  for (const assignment of source.getExportAssignments()) {
    if (assignment.isExportEquals()) replace(assignment.getExpression());
  }

  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const args = call.getArguments();
    const at = args.findIndex(isExportsObject);
    if (at === -1) continue;
    commonjs = true;
    if (at === 0 && call.getExpression().getText() === "Object.defineProperty") {
      const name = literal(args[1]);
      if (name === null) unreadable = true;
      // Compiled TypeScript's interop flag, not something a caller imports.
      else if (name !== "__esModule") names.push(name);
    } else {
      unreadable = true; // Object.assign(exports, …), __exportStar(…, exports)
    }
  }

  if (!commonjs) return null;
  if (unreadable || replaced > 1 || (replaced > 0 && viaExportsName)) return null;
  return [...new Set(names)];
}
