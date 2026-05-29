import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';

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
  return processor.use(rehypeStringify).freeze();
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

  for (const plugin of remarkPlugins) {
    if (Array.isArray(plugin)) {
      processor = processor.use(plugin[0], ...plugin.slice(1));
    } else {
      processor = processor.use(plugin);
    }
  }

  processor = processor.use(remarkRehype);
  processor = processor.use(rehypeSlug);

  if (highlight) {
    processor = processor.use(rehypeHighlight);
  }

  for (const plugin of rehypePlugins) {
    if (Array.isArray(plugin)) {
      processor = processor.use(plugin[0], ...plugin.slice(1));
    } else {
      processor = processor.use(plugin);
    }
  }

  processor = processor.use(rehypeStringify);

  const result = await processor.process(source);
  return String(result);
}
