// ---------------------------------------------------------------------------
// template-compiler.ts — Compile a template string into a JS render function
// ---------------------------------------------------------------------------
// Turns raw HTML template content (from an SFC <template> block) into a
// JavaScript function body that creates real DOM nodes using helpers exported
// by @matthesketh/utopia-runtime.
//
// The compiler works in two phases:
//   1. **Parse** — recursive-descent parser turns the HTML into a lightweight
//      AST of elements, text nodes, interpolations, and directives.
//   2. **Codegen** — walks the AST and emits imperative JS that builds the
//      DOM tree at component mount time.
// ---------------------------------------------------------------------------

// ---- Public API ------------------------------------------------------------

export interface TemplateCompileOptions {
  /** When set, every created element will receive this data attribute. */
  scopeId?: string;
}

export interface TemplateCompileResult {
  /** The full ES-module source for the render function. */
  code: string;
  /** The set of @matthesketh/utopia-runtime helpers actually referenced. */
  helpers: Set<string>;
}

/**
 * Compile a raw HTML template string into a JavaScript render function module.
 */
export function compileTemplate(
  template: string,
  options: TemplateCompileOptions = {},
): TemplateCompileResult {
  const ast = parseTemplate(template);
  return generate(ast, options);
}

// ===========================================================================
// Phase 1 — Template AST
// ===========================================================================

// ---- AST node types --------------------------------------------------------

export const enum NodeType {
  Element = 1,
  Text = 2,
  Interpolation = 3,
  Comment = 4,
}

export interface ElementNode {
  type: NodeType.Element;
  tag: string;
  attrs: Attribute[];
  directives: Directive[];
  children: TemplateNode[];
  selfClosing: boolean;
}

export interface TextNode {
  type: NodeType.Text;
  content: string;
}

export interface InterpolationNode {
  type: NodeType.Interpolation;
  expression: string;
}

export interface CommentNode {
  type: NodeType.Comment;
  content: string;
}

export type TemplateNode = ElementNode | TextNode | InterpolationNode | CommentNode;

export interface Attribute {
  name: string;
  value: string | null; // null for boolean attributes
}

export interface Directive {
  kind: DirectiveKind;
  arg: string | null; // event name, attribute name, etc.
  expression: string;
  modifiers: string[];
}

export type DirectiveKind = 'on' | 'bind' | 'if' | 'else' | 'else-if' | 'for' | 'model';

// ===========================================================================
// Phase 1 — Recursive-descent HTML parser
// ===========================================================================

// Known HTML void (self-closing) elements.
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

class TemplateParser {
  private source: string;
  private pos: number;

  constructor(source: string) {
    this.source = source;
    this.pos = 0;
  }

  parse(): TemplateNode[] {
    return this.parseChildren(null);
  }

  // ---- Children (text / interpolation / elements) -------------------------

  private parseChildren(parentTag: string | null): TemplateNode[] {
    const nodes: TemplateNode[] = [];

    while (this.pos < this.source.length) {
      // Are we at the closing tag of the parent?
      if (parentTag !== null && this.lookingAt(`</${parentTag}`)) {
        break;
      }

      // Comment?
      if (this.lookingAt('<!--')) {
        nodes.push(this.parseComment());
        continue;
      }

      // Opening tag?
      if (this.lookingAt('<') && this.peekTagStart()) {
        nodes.push(this.parseElement());
        continue;
      }

      // Otherwise parse text / interpolation.
      const textOrInterp = this.parseTextOrInterpolation(parentTag);
      if (textOrInterp.length > 0) {
        nodes.push(...textOrInterp);
      }
    }

    return nodes;
  }

  // ---- Comments -----------------------------------------------------------

  private parseComment(): CommentNode {
    this.expect('<!--');
    const endIdx = this.source.indexOf('-->', this.pos);
    if (endIdx === -1) {
      throw this.error('Unterminated comment');
    }
    const content = this.source.slice(this.pos, endIdx);
    this.pos = endIdx + 3;
    return { type: NodeType.Comment, content: content.trim() };
  }

  // ---- Elements -----------------------------------------------------------

  private parseElement(): ElementNode {
    this.expect('<');
    const tag = this.readTagName();

    const attrs: Attribute[] = [];
    const directives: Directive[] = [];
    this.parseAttributeList(attrs, directives);

    this.skipWhitespace();

    // Self-closing: `/>` or void element?
    let selfClosing = false;
    if (this.lookingAt('/>')) {
      this.pos += 2;
      selfClosing = true;
    } else {
      this.expect('>');
      if (VOID_ELEMENTS.has(tag.toLowerCase())) {
        selfClosing = true;
      }
    }

    let children: TemplateNode[] = [];
    if (!selfClosing) {
      children = this.parseChildren(tag);
      // Consume the closing tag.
      this.expect(`</${tag}`);
      this.skipWhitespace();
      this.expect('>');
    }

    return { type: NodeType.Element, tag, attrs, directives, children, selfClosing };
  }

  // ---- Attributes & Directives --------------------------------------------

  private parseAttributeList(attrs: Attribute[], directives: Directive[]): void {
    while (true) {
      this.skipWhitespace();

      // End of attributes?
      if (this.pos >= this.source.length) break;
      if (this.lookingAt('>') || this.lookingAt('/>')) break;

      const name = this.readAttributeName();
      if (!name) break;

      let value: string | null = null;
      this.skipWhitespace();
      if (this.lookingAt('=')) {
        this.pos++; // skip '='
        this.skipWhitespace();
        value = this.readAttributeValue();
      }

      // Classify as directive or plain attribute.
      const dir = classifyDirective(name, value);
      if (dir) {
        directives.push(dir);
      } else {
        attrs.push({ name, value });
      }
    }
  }

  // ---- Text & Interpolation -----------------------------------------------

  private parseTextOrInterpolation(parentTag: string | null): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    let textBuf = '';

    const flush = () => {
      if (textBuf) {
        nodes.push({ type: NodeType.Text, content: textBuf });
        textBuf = '';
      }
    };

    while (this.pos < this.source.length) {
      // Stop at tags.
      if (this.lookingAt('<')) {
        // Closing tag of parent?
        if (parentTag !== null && this.lookingAt(`</${parentTag}`)) break;
        // Comment or new element
        if (this.lookingAt('<!--') || this.peekTagStart()) break;
        // Stray `<` — treat as text.
        textBuf += this.source[this.pos++];
        continue;
      }

      // Interpolation {{ expr }}
      if (this.lookingAt('{{')) {
        flush();
        this.pos += 2;
        const endIdx = this.findInterpolationEnd(this.pos);
        if (endIdx === -1) throw this.error('Unterminated interpolation {{ }}');
        const expression = this.source.slice(this.pos, endIdx).trim();
        nodes.push({ type: NodeType.Interpolation, expression });
        this.pos = endIdx + 2;
        continue;
      }

      textBuf += this.source[this.pos++];
    }

    flush();
    return nodes;
  }

  // ---- Interpolation end finder -------------------------------------------

  /**
   * Find the position of the closing `}}` for an interpolation expression,
   * respecting JavaScript string literals so that `}}` inside quotes is not
   * treated as the end delimiter.
   *
   * Handles single-quoted, double-quoted, and template literal strings,
   * including escaped characters within them.
   */
  private findInterpolationEnd(start: number): number {
    let pos = start;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;

    while (pos < this.source.length - 1) {
      const ch = this.source[pos];

      // Skip escaped characters inside strings.
      if ((inSingle || inDouble || inBacktick) && ch === '\\') {
        pos += 2;
        continue;
      }

      if (!inDouble && !inBacktick && ch === "'") {
        inSingle = !inSingle;
      } else if (!inSingle && !inBacktick && ch === '"') {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble && ch === '`') {
        inBacktick = !inBacktick;
      } else if (
        !inSingle &&
        !inDouble &&
        !inBacktick &&
        ch === '}' &&
        this.source[pos + 1] === '}'
      ) {
        return pos;
      }

      pos++;
    }

    return -1;
  }

  // ---- Low-level helpers --------------------------------------------------

  private readTagName(): string {
    const start = this.pos;
    while (this.pos < this.source.length && /[a-zA-Z0-9\-_]/.test(this.source[this.pos])) {
      this.pos++;
    }
    const name = this.source.slice(start, this.pos);
    if (!name) throw this.error('Expected tag name');
    return name;
  }

  private readAttributeName(): string {
    const start = this.pos;
    // Allow: word chars, `-`, `:`, `@`, `.`
    while (this.pos < this.source.length && /[a-zA-Z0-9\-_:@.]/.test(this.source[this.pos])) {
      this.pos++;
    }
    return this.source.slice(start, this.pos);
  }

  private readAttributeValue(): string {
    const quote = this.source[this.pos];
    if (quote === '"' || quote === "'") {
      this.pos++; // skip opening quote
      const start = this.pos;
      const endIdx = this.source.indexOf(quote, this.pos);
      if (endIdx === -1) throw this.error(`Unterminated attribute value (expected ${quote})`);
      const value = this.source.slice(start, endIdx);
      this.pos = endIdx + 1;
      return value;
    }
    // Unquoted value — read until whitespace or `>`.
    const start = this.pos;
    while (this.pos < this.source.length && !/[\s/>]/.test(this.source[this.pos])) {
      this.pos++;
    }
    return this.source.slice(start, this.pos);
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos++;
    }
  }

  private lookingAt(str: string): boolean {
    return this.source.startsWith(str, this.pos);
  }

  /** Returns true when the char after `<` looks like the start of a tag name. */
  private peekTagStart(): boolean {
    const next = this.source[this.pos + 1];
    return next !== undefined && /[a-zA-Z]/.test(next);
  }

  private expect(str: string): void {
    if (!this.lookingAt(str)) {
      throw this.error(
        `Expected "${str}" but found "${this.source.slice(this.pos, this.pos + 20)}"`,
      );
    }
    this.pos += str.length;
  }

  private error(message: string): Error {
    let line = 1;
    let col = 1;
    for (let i = 0; i < this.pos && i < this.source.length; i++) {
      if (this.source[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return new Error(`Template parse error at ${line}:${col} — ${message}`);
  }
}

/** Exported for testing — parse a template string into an AST. */
export function parseTemplate(source: string): TemplateNode[] {
  return new TemplateParser(source).parse();
}

// ---- Directive classification -----------------------------------------------

function classifyDirective(name: string, value: string | null): Directive | null {
  const expression = value ?? '';

  // @click="handler" --> u-on:click
  if (name.startsWith('@')) {
    const parts = name.slice(1).split('.');
    return {
      kind: 'on',
      arg: parts[0],
      expression,
      modifiers: parts.slice(1),
    };
  }

  // :attr="expr" --> u-bind:attr
  if (name.startsWith(':')) {
    const parts = name.slice(1).split('.');
    return {
      kind: 'bind',
      arg: parts[0],
      expression,
      modifiers: parts.slice(1),
    };
  }

  // u-on:event, u-bind:attr, u-if, u-for, u-model
  if (name.startsWith('u-')) {
    const withoutPrefix = name.slice(2); // e.g. "on:click", "bind:value", "if", "for", "model"
    const colonIdx = withoutPrefix.indexOf(':');

    let kind: string;
    let arg: string | null = null;
    const modifiers: string[] = [];

    if (colonIdx !== -1) {
      kind = withoutPrefix.slice(0, colonIdx);
      const rest = withoutPrefix.slice(colonIdx + 1);
      const parts = rest.split('.');
      arg = parts[0];
      modifiers.push(...parts.slice(1));
    } else {
      const parts = withoutPrefix.split('.');
      kind = parts[0];
      modifiers.push(...parts.slice(1));
    }

    if (!isDirectiveKind(kind)) return null;

    return { kind, arg, expression, modifiers };
  }

  return null;
}

function isDirectiveKind(s: string): s is DirectiveKind {
  return s === 'on' || s === 'bind' || s === 'if' || s === 'else' || s === 'else-if' || s === 'for' || s === 'model';
}

// ===========================================================================
// Phase 2 — Code generation
// ===========================================================================

/**
 * A set of variable names that are "local" (i.e. function parameters from
 * u-for).  This set is threaded through recursive codegen calls.
 */
type LocalScope = Set<string>;

class CodeGenerator {
  private code: string[] = [];
  private varCounter: number = 0;
  private helpers: Set<string> = new Set();
  private scopeId: string | undefined;
  private deferredCallsStack: string[][] = [];

  constructor(private options: TemplateCompileOptions) {
    this.scopeId = options.scopeId;
  }

  generate(ast: TemplateNode[]): TemplateCompileResult {
    const scope: LocalScope = new Set();

    // Find substantive root nodes (non-whitespace-only text, elements, interp).
    const rootElements = ast.filter(
      (n) =>
        n.type === NodeType.Element ||
        n.type === NodeType.Interpolation ||
        (n.type === NodeType.Text && n.content.trim() !== ''),
    );

    if (rootElements.length === 0) {
      this.helpers.add('createElement');
      this.emit(`const _root = createElement('div')`);
      this.emit(`return _root`);
    } else if (rootElements.length === 1 && rootElements[0].type === NodeType.Element) {
      const rootVar = this.genNode(rootElements[0], scope);
      this.emit(`return ${rootVar}`);
    } else {
      // Multiple root nodes — wrap in a <div>.
      this.helpers.add('createElement');
      const fragVar = this.freshVar();
      this.emit(`const ${fragVar} = createElement('div')`);
      if (this.scopeId) {
        this.helpers.add('setAttr');
        this.emit(`setAttr(${fragVar}, '${escapeStr(this.scopeId)}', '')`);
      }
      this.genChildren(fragVar, ast, scope);
      this.emit(`return ${fragVar}`);
    }

    // Build the final module.
    const helperList = Array.from(this.helpers).sort();
    const importLine =
      helperList.length > 0
        ? `import { ${helperList.join(', ')} } from '@matthesketh/utopia-runtime'\n\n`
        : '';

    const fnBody = this.code.map((l) => `  ${l}`).join('\n');
    const moduleCode = `${importLine}function __render(_ctx) {\n${fnBody}\n}\n`;

    return { code: moduleCode, helpers: this.helpers };
  }

  // ---- Node generation ----------------------------------------------------

  private genNode(node: TemplateNode, scope: LocalScope): string | null {
    switch (node.type) {
      case NodeType.Element:
        return this.genElement(node, scope);
      case NodeType.Text:
        return this.genText(node);
      case NodeType.Interpolation:
        return this.genInterpolation(node, scope);
      case NodeType.Comment:
        return null;
    }
  }

  // ---- Element generation -------------------------------------------------

  private genElement(node: ElementNode, scope: LocalScope): string {
    // Handle u-if — structural directive.
    const ifDir = node.directives.find((d) => d.kind === 'if');
    if (ifDir) {
      return this.genIf(node, ifDir, scope);
    }

    // Handle u-for — structural directive.
    const forDir = node.directives.find((d) => d.kind === 'for');
    if (forDir) {
      return this.genFor(node, forDir, scope);
    }

    // Slot element — renders content from the parent's $slots.
    if (node.tag === 'slot') {
      return this.genSlot(node);
    }

    // Component reference? (PascalCase)
    if (isComponentTag(node.tag)) {
      return this.genComponent(node, scope);
    }

    // Regular HTML element.
    this.helpers.add('createElement');
    const elVar = this.freshVar();
    this.emit(`const ${elVar} = createElement('${node.tag}')`);

    // Scope ID
    if (this.scopeId) {
      this.helpers.add('setAttr');
      this.emit(`setAttr(${elVar}, '${escapeStr(this.scopeId)}', '')`);
    }

    // Static attributes
    for (const attr of node.attrs) {
      this.helpers.add('setAttr');
      if (attr.value === null) {
        this.emit(`setAttr(${elVar}, '${escapeStr(attr.name)}', '')`);
      } else {
        this.emit(`setAttr(${elVar}, '${escapeStr(attr.name)}', '${escapeStr(attr.value)}')`);
      }
    }

    // Directives (excluding structural ones).
    for (const dir of node.directives) {
      if (dir.kind === 'if' || dir.kind === 'else' || dir.kind === 'else-if' || dir.kind === 'for') continue;
      this.genDirective(elVar, dir, scope);
    }

    // Children — handles u-if/u-else pairing, deferred createFor/createIf calls.
    this.genChildren(elVar, node.children, scope);

    return elVar;
  }

  // ---- Text & Interpolation -----------------------------------------------

  private genText(node: TextNode): string | null {
    if (!node.content) return null;
    this.helpers.add('createTextNode');
    const v = this.freshVar();
    const decoded = decodeEntities(node.content);
    this.emit(`const ${v} = createTextNode(${JSON.stringify(decoded)})`);
    return v;
  }

  private genInterpolation(node: InterpolationNode, scope: LocalScope): string {
    this.helpers.add('createTextNode');
    this.helpers.add('createEffect');
    this.helpers.add('setText');

    const textVar = this.freshVar();
    const expr = this.resolveExpression(node.expression, scope);
    this.emit(`const ${textVar} = createTextNode('')`);
    this.emit(`createEffect(() => setText(${textVar}, String(${expr})))`);
    return textVar;
  }

  // ---- Directives ---------------------------------------------------------

  private genDirective(elVar: string, dir: Directive, scope: LocalScope): void {
    switch (dir.kind) {
      case 'on':
        this.genOn(elVar, dir, scope);
        break;
      case 'bind':
        this.genBind(elVar, dir, scope);
        break;
      case 'model':
        this.genModel(elVar, dir, scope);
        break;
    }
  }

  private genOn(elVar: string, dir: Directive, scope: LocalScope): void {
    this.helpers.add('addEventListener');
    const event = dir.arg ?? 'click';
    const handler = this.resolveExpression(dir.expression, scope);
    const modifiers = dir.modifiers;

    // Separate handler-wrapping modifiers from addEventListener options.
    const OPTION_MODS = new Set(['once', 'capture', 'passive']);
    const handlerMods = modifiers.filter((m) => !OPTION_MODS.has(m));
    const optionMods = modifiers.filter((m) => OPTION_MODS.has(m));

    let handlerExpr = handler;

    if (handlerMods.length > 0) {
      const guards: string[] = [];
      const calls: string[] = [];

      for (const mod of handlerMods) {
        switch (mod) {
          case 'prevent':
            calls.push('_e.preventDefault()');
            break;
          case 'stop':
            calls.push('_e.stopPropagation()');
            break;
          case 'self':
            guards.push('if (_e.target !== _e.currentTarget) return');
            break;
        }
      }

      const body = [...guards, ...calls, `(${handler})(_e)`].join('; ');
      handlerExpr = `(_e) => { ${body} }`;
    }

    const optionsStr =
      optionMods.length > 0 ? `, { ${optionMods.map((m) => `${m}: true`).join(', ')} }` : '';

    this.emit(`addEventListener(${elVar}, '${escapeStr(event)}', ${handlerExpr}${optionsStr})`);
  }

  private genBind(elVar: string, dir: Directive, scope: LocalScope): void {
    this.helpers.add('setAttr');
    this.helpers.add('createEffect');
    const attrName = dir.arg ?? 'value';
    const expr = this.resolveExpression(dir.expression, scope);
    this.emit(`createEffect(() => setAttr(${elVar}, '${escapeStr(attrName)}', ${expr}))`);
  }

  private genModel(elVar: string, dir: Directive, scope: LocalScope): void {
    this.helpers.add('setAttr');
    this.helpers.add('addEventListener');
    this.helpers.add('createEffect');

    const signalRef = this.resolveExpression(dir.expression, scope);
    this.emit(`createEffect(() => setAttr(${elVar}, 'value', ${signalRef}()))`);
    this.emit(`addEventListener(${elVar}, 'input', (e) => ${signalRef}.set(e.target.value))`);
  }

  // ---- Structural: u-if ---------------------------------------------------

  private genIf(
    node: ElementNode,
    dir: Directive,
    scope: LocalScope,
    elseIfChain?: { node: ElementNode; dir: Directive }[],
    elseNode?: ElementNode,
  ): string {
    this.helpers.add('createIf');

    const anchorVar = this.freshVar();
    this.helpers.add('createComment');
    this.emit(`const ${anchorVar} = createComment('u-if')`);

    const condition = this.resolveExpression(dir.expression, scope);

    // Strip the u-if/u-else-if directive and generate the element in a nested function.
    const strippedNode: ElementNode = {
      ...node,
      directives: node.directives.filter((d) => d.kind !== 'if' && d.kind !== 'else-if'),
    };

    const trueFnVar = this.freshVar();
    const savedCode = this.code;
    this.code = [];
    const innerVar = this.genElement(strippedNode, scope);
    const innerLines = [...this.code];
    this.code = savedCode;

    this.emit(`const ${trueFnVar} = () => {`);
    for (const line of innerLines) {
      this.emit(`  ${line}`);
    }
    this.emit(`  return ${innerVar}`);
    this.emit(`}`);

    // Generate the else branch: could be an else-if chain, a plain u-else, or nothing.
    let elseArg = '';
    if (elseIfChain && elseIfChain.length > 0) {
      // The false branch is a nested createIf for the first else-if.
      const firstElseIf = elseIfChain[0];
      const remainingElseIfs = elseIfChain.slice(1);

      const falseFnVar = this.freshVar();
      const savedCode2 = this.code;
      this.code = [];
      const nestedAnchor = this.genIf(
        firstElseIf.node,
        firstElseIf.dir,
        scope,
        remainingElseIfs.length > 0 ? remainingElseIfs : undefined,
        elseNode,
      );
      const nestedLines = [...this.code];
      this.code = savedCode2;

      this.emit(`const ${falseFnVar} = () => {`);
      for (const line of nestedLines) {
        this.emit(`  ${line}`);
      }
      this.emit(`  return ${nestedAnchor}`);
      this.emit(`}`);

      elseArg = `, ${falseFnVar}`;
    } else if (elseNode) {
      const falseFnVar = this.freshVar();
      const strippedElse: ElementNode = {
        ...elseNode,
        directives: elseNode.directives.filter((d) => d.kind !== 'else'),
      };
      const savedCode2 = this.code;
      this.code = [];
      const elseInnerVar = this.genElement(strippedElse, scope);
      const elseLines = [...this.code];
      this.code = savedCode2;

      this.emit(`const ${falseFnVar} = () => {`);
      for (const line of elseLines) {
        this.emit(`  ${line}`);
      }
      this.emit(`  return ${elseInnerVar}`);
      this.emit(`}`);

      elseArg = `, ${falseFnVar}`;
    }

    this.emitOrDefer(`createIf(${anchorVar}, () => Boolean(${condition}), ${trueFnVar}${elseArg})`);
    return anchorVar;
  }

  // ---- Structural: u-for --------------------------------------------------

  private genFor(node: ElementNode, dir: Directive, scope: LocalScope): string {
    this.helpers.add('createFor');

    const anchorVar = this.freshVar();
    this.helpers.add('createComment');
    this.emit(`const ${anchorVar} = createComment('u-for')`);

    // Parse "item in expr" or "(item, index) in expr"
    const forMatch = dir.expression.match(
      /^\s*(?:\(\s*(\w+)\s*(?:,\s*(\w+)\s*)?\)|(\w+))\s+in\s+(.+)$/,
    );
    if (!forMatch) {
      throw new Error(`Invalid u-for expression: "${dir.expression}"`);
    }
    const itemName = forMatch[1] ?? forMatch[3];
    const indexName = forMatch[2] ?? '_index';
    const listExpr = this.resolveExpression(forMatch[4].trim(), scope);

    // Create a new scope that includes the item variable.
    const innerScope: LocalScope = new Set(scope);
    innerScope.add(itemName);

    // Look for a :key binding to pass as key function.
    const keyDir = node.directives.find((d) => d.kind === 'bind' && d.arg === 'key');

    // Strip u-for and :key, then generate element in the inner scope.
    const strippedNode: ElementNode = {
      ...node,
      directives: node.directives.filter(
        (d) => d.kind !== 'for' && !(d.kind === 'bind' && d.arg === 'key'),
      ),
    };

    const savedCode = this.code;
    this.code = [];
    const innerVar = this.genElement(strippedNode, innerScope);
    const innerLines = [...this.code];
    this.code = savedCode;

    const renderFnVar = this.freshVar();
    this.emit(`const ${renderFnVar} = (${itemName}, ${indexName}) => {`);
    for (const line of innerLines) {
      this.emit(`  ${line}`);
    }
    this.emit(`  return ${innerVar}`);
    this.emit(`}`);

    let keyArg = '';
    if (keyDir) {
      const keyExpr = this.resolveExpression(keyDir.expression, innerScope);
      keyArg = `, (${itemName}, ${indexName}) => ${keyExpr}`;
    }

    this.emitOrDefer(`createFor(${anchorVar}, () => ${listExpr}, ${renderFnVar}${keyArg})`);
    return anchorVar;
  }

  // ---- Children processing (handles u-if / u-else-if / u-else pairing) ----

  private genChildren(parentVar: string, children: TemplateNode[], scope: LocalScope): void {
    this.deferredCallsStack.push([]);
    let i = 0;

    while (i < children.length) {
      const child = children[i];

      // Detect u-if elements and look ahead for a chain of u-else-if / u-else siblings.
      if (child.type === NodeType.Element) {
        const ifDir = child.directives.find((d) => d.kind === 'if');
        if (ifDir) {
          const elseIfChain: { node: ElementNode; dir: Directive }[] = [];
          let elseNode: ElementNode | undefined;
          let skipTo = i + 1;

          for (let j = i + 1; j < children.length; j++) {
            const next = children[j];
            // Skip whitespace-only text between chained directives.
            if (next.type === NodeType.Text && !next.content.trim()) continue;

            if (next.type === NodeType.Element) {
              const elseIfDir = next.directives.find((d) => d.kind === 'else-if');
              if (elseIfDir) {
                elseIfChain.push({ node: next, dir: elseIfDir });
                skipTo = j + 1;
                continue;
              }
              if (next.directives.some((d) => d.kind === 'else')) {
                elseNode = next;
                skipTo = j + 1;
              }
            }
            break;
          }

          const childVar = this.genIf(
            child,
            ifDir,
            scope,
            elseIfChain.length > 0 ? elseIfChain : undefined,
            elseNode,
          );
          this.helpers.add('appendChild');
          this.emit(`appendChild(${parentVar}, ${childVar})`);
          i = skipTo;
          continue;
        }

        // Skip u-else and u-else-if elements that weren't consumed by a preceding u-if
        // (orphaned — silently ignore).
        if (child.directives.some((d) => d.kind === 'else' || d.kind === 'else-if')) {
          i++;
          continue;
        }
      }

      const childVar = this.genNode(child, scope);
      if (childVar) {
        this.helpers.add('appendChild');
        this.emit(`appendChild(${parentVar}, ${childVar})`);
      }
      i++;
    }

    const deferred = this.deferredCallsStack.pop()!;
    for (const line of deferred) {
      this.emit(line);
    }
  }

  // ---- Slot rendering -----------------------------------------------------

  /**
   * Generate code for a `<slot />` element.
   *
   * Named slots use `<slot name="foo" />`, defaulting to "default".
   * The generated code reads from `_ctx.$slots[name]()` if available,
   * otherwise renders a comment placeholder.
   */
  private genSlot(node: ElementNode): string {
    const nameAttr = node.attrs.find((a) => a.name === 'name');
    const slotName = nameAttr?.value ?? 'default';
    const slotVar = this.freshVar();
    this.helpers.add('createComment');

    if (slotName === 'default') {
      // For the default slot, also check _ctx.children as a fallback.
      // The router's layout system passes children as a Node prop rather
      // than through the $slots mechanism.
      this.emit(
        `const ${slotVar} = _ctx && _ctx.$slots && _ctx.$slots['default'] ? _ctx.$slots['default']() : (_ctx && _ctx.children instanceof Node ? _ctx.children : createComment('slot'))`,
      );
    } else {
      this.emit(
        `const ${slotVar} = _ctx && _ctx.$slots && _ctx.$slots['${escapeStr(slotName)}'] ? _ctx.$slots['${escapeStr(slotName)}']() : createComment('slot')`,
      );
    }

    return slotVar;
  }

  // ---- Component generation -----------------------------------------------

  private genComponent(node: ElementNode, scope: LocalScope): string {
    const compVar = this.freshVar();

    // Build props object.
    const propEntries: string[] = [];

    for (const a of node.attrs) {
      if (a.value !== null) {
        propEntries.push(`'${escapeStr(a.name)}': '${escapeStr(a.value)}'`);
      } else {
        propEntries.push(`'${escapeStr(a.name)}': true`);
      }
    }

    for (const d of node.directives) {
      if (d.kind === 'bind' && d.arg) {
        propEntries.push(`'${escapeStr(d.arg)}': ${this.resolveExpression(d.expression, scope)}`);
      }
    }

    const propsStr = propEntries.length > 0 ? `{ ${propEntries.join(', ')} }` : '{}';
    this.helpers.add('createComponent');

    // Compile children as a default slot factory if children are present.
    const substantiveChildren = node.children.filter(
      (c) =>
        c.type === NodeType.Element ||
        c.type === NodeType.Interpolation ||
        (c.type === NodeType.Text && c.content.trim() !== ''),
    );

    if (substantiveChildren.length > 0) {
      const slotFnVar = this.freshVar();
      const savedCode = this.code;
      this.code = [];

      // Generate a wrapper for slot children.
      if (substantiveChildren.length === 1 && substantiveChildren[0].type === NodeType.Element) {
        const innerVar = this.genNode(substantiveChildren[0], scope);
        this.emit(`return ${innerVar}`);
      } else {
        this.helpers.add('createElement');
        this.helpers.add('appendChild');
        const fragVar = this.freshVar();
        this.emit(`const ${fragVar} = createElement('div')`);
        for (const child of node.children) {
          const childVar = this.genNode(child, scope);
          if (childVar) {
            this.emit(`appendChild(${fragVar}, ${childVar})`);
          }
        }
        this.emit(`return ${fragVar}`);
      }

      const slotLines = [...this.code];
      this.code = savedCode;

      this.emit(`const ${slotFnVar} = () => {`);
      for (const line of slotLines) {
        this.emit(`  ${line}`);
      }
      this.emit(`}`);

      this.emit(
        `const ${compVar} = createComponent(${node.tag}, ${propsStr}, { default: ${slotFnVar} })`,
      );
    } else {
      this.emit(`const ${compVar} = createComponent(${node.tag}, ${propsStr})`);
    }

    return compVar;
  }

  // ---- Expression resolution ----------------------------------------------

  /**
   * Resolve a template expression to a JS expression.
   *
   * All identifiers are emitted as bare references — user script variables
   * live at module scope and are accessible via closure.
   */
  private resolveExpression(expr: string, _scope: LocalScope): string {
    const trimmed = expr.trim();
    if (!trimmed) return "''";
    return trimmed;
  }

  // ---- Utilities ----------------------------------------------------------

  private freshVar(): string {
    return `_el${this.varCounter++}`;
  }

  private emit(line: string): void {
    this.code.push(line);
  }

  private emitOrDefer(line: string): void {
    const stack = this.deferredCallsStack;
    if (stack.length > 0) {
      stack[stack.length - 1].push(line);
    } else {
      this.emit(line);
    }
  }
}

// ---- Helpers ---------------------------------------------------------------

/**
 * Determines if a tag name is a component reference.
 * Heuristic: starts with uppercase.
 */
function isComponentTag(tag: string): boolean {
  return /^[A-Z][a-zA-Z0-9_$]*$/.test(tag);
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Decode common HTML entities to their literal characters so that
 * `createTextNode` produces the correct output.
 */
const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': '\u00A0',
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&bull;': '\u2022',
  '&hellip;': '\u2026',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
  '&rarr;': '\u2192',
  '&larr;': '\u2190',
  '&uarr;': '\u2191',
  '&darr;': '\u2193',
  '&times;': '\u00D7',
  '&divide;': '\u00F7',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (match, dec, hex, named) => {
    if (dec) {
      const code = parseInt(dec, 10);
      if (code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    if (hex) {
      const code = parseInt(hex, 16);
      if (code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    if (named) return ENTITY_MAP[`&${named};`] ?? match;
    return match;
  });
}

// ---- Main generate entry ---------------------------------------------------

function generate(ast: TemplateNode[], options: TemplateCompileOptions): TemplateCompileResult {
  const gen = new CodeGenerator(options);
  return gen.generate(ast);
}
