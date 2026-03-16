import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';

export interface MarkdownOptions {
  /** Additional remark plugins */
  remarkPlugins?: Array<readonly [unknown, ...unknown[]] | unknown>;
  /** Additional rehype plugins */
  rehypePlugins?: Array<readonly [unknown, ...unknown[]] | unknown>;
  /** Enable syntax highlighting (default: true) */
  highlight?: boolean;
}

/**
 * Render markdown to HTML using the unified pipeline.
 */
export async function renderMarkdown(
  source: string,
  options: MarkdownOptions = {},
): Promise<string> {
  const { remarkPlugins = [], rehypePlugins = [], highlight = true } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic pipeline assembly
  let processor: any = unified().use(remarkParse);

  for (const plugin of remarkPlugins) {
    if (Array.isArray(plugin)) {
      processor = processor.use(plugin[0], ...plugin.slice(1));
    } else {
      processor = processor.use(plugin);
    }
  }

  processor = processor.use(remarkRehype);

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
