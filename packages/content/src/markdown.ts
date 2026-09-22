import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

export interface MarkdownOptions {
  /** Additional remark plugins */
  remarkPlugins?: Array<readonly [unknown, ...unknown[]] | unknown>;
  /** Additional rehype plugins */
  rehypePlugins?: Array<readonly [unknown, ...unknown[]] | unknown>;
  /** Enable syntax highlighting (default: true) */
  highlight?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- unified processor is loosely typed
type Processor = any;

/** hast properties that carry a URL (hast names, camelCased). */
const URL_PROPERTIES = ['href', 'src', 'action', 'formAction', 'poster', 'cite', 'xLinkHref'];

/** Media properties where an inline data: image/audio/video/font is fine. */
const MEDIA_PROPERTIES = new Set(['src', 'poster']);

/**
 * Whether a URL would execute script when followed or loaded. The scheme is
 * read the way the browser's URL parser reads it: tabs and newlines deleted
 * anywhere, leading control characters and spaces stripped.
 */
function isUnsafeUrl(value: string, property: string): boolean {
  // eslint-disable-next-line no-control-regex -- matching C0 controls is the point
  const url = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '');
  if (/^(?:javascript|vbscript):/i.test(url)) return true;
  if (/^data:/i.test(url)) {
    return !(MEDIA_PROPERTIES.has(property) && /^data:(?:image|audio|video|font)\//i.test(url));
  }
  return false;
}

interface HastNode {
  type: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Drop script-carrying URLs from the rendered tree. Markdown syntax happily
 * produces `[x](javascript:alert(1))` and `![](javascript:…)` — raw HTML is
 * already dropped by remark-rehype, but links and images are not — and
 * content can come from anyone with write access, the MCP tools included.
 */
function rehypeSafeUrls() {
  const visit = (node: HastNode): void => {
    if (node.type === 'element' && node.properties) {
      for (const prop of URL_PROPERTIES) {
        const value = node.properties[prop];
        if (typeof value === 'string' && isUnsafeUrl(value, prop)) {
          delete node.properties[prop];
        }
      }
    }
    if (node.children) {
      for (const child of node.children) visit(child);
    }
  };
  return (tree: HastNode): void => visit(tree);
}

/**
 * build a frozen processor for the common (no custom plugins) case. unified
 * processors are reusable across many .process() calls, and rehype-highlight
 * initialises its language grammars at construction time — so building one per
 * renderMarkdown call (the previous behaviour) reloaded the highlighter on
 * every markdown file. two frozen instances (highlight on/off) are built lazily
 * and reused.
 */
function buildBaseProcessor(highlight: boolean): Processor {
  let processor: Processor = unified().use(remarkParse).use(remarkRehype).use(rehypeSlug);
  if (highlight) {
    processor = processor.use(rehypeHighlight);
  }
  return processor.use(rehypeSafeUrls).use(rehypeStringify).freeze();
}

let cachedHighlight: Processor | undefined;
let cachedPlain: Processor | undefined;

function getCachedProcessor(highlight: boolean): Processor {
  if (highlight) {
    return (cachedHighlight ??= buildBaseProcessor(true));
  }
  return (cachedPlain ??= buildBaseProcessor(false));
}

/**
 * Render markdown to HTML using the unified pipeline.
 */
export async function renderMarkdown(
  source: string,
  options: MarkdownOptions = {},
): Promise<string> {
  const { remarkPlugins = [], rehypePlugins = [], highlight = true } = options;

  // fast path: no caller-supplied plugins → reuse a cached frozen processor.
  if (remarkPlugins.length === 0 && rehypePlugins.length === 0) {
    const result = await getCachedProcessor(highlight).process(source);
    return String(result);
  }

  // custom plugins → assemble a one-off pipeline (cannot be safely cached).
  let processor: Processor = unified().use(remarkParse);
  processor = applyPlugins(processor, remarkPlugins);

  processor = processor.use(remarkRehype);
  processor = processor.use(rehypeSlug);

  if (highlight) {
    processor = processor.use(rehypeHighlight);
  }

  processor = applyPlugins(processor, rehypePlugins);
  processor = processor.use(rehypeSafeUrls).use(rehypeStringify);

  const result = await processor.process(source);
  return String(result);
}

/** apply caller-supplied plugins, each either a bare plugin or a [plugin, ...options] tuple. */
function applyPlugins(
  processor: Processor,
  plugins: NonNullable<MarkdownOptions['remarkPlugins']>,
): Processor {
  for (const plugin of plugins) {
    if (Array.isArray(plugin)) {
      processor = processor.use(plugin[0], ...plugin.slice(1));
    } else {
      processor = processor.use(plugin);
    }
  }
  return processor;
}
