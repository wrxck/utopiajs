export interface FeedOptions {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl?: string;
  language?: string;
  author?: string;
  copyright?: string;
}

export interface FeedEntry {
  slug: string;
  title: string;
  description?: string;
  date: string;
  html?: string;
  url: string;
  tags?: string[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(date: string | Date): string {
  return new Date(date).toUTCString();
}

function toIso8601(date: string | Date): string {
  return new Date(date).toISOString();
}

/**
 * Generate an RSS 2.0 feed from content entries.
 */
export function generateRssFeed(entries: FeedEntry[], options: FeedOptions): string {
  const { title, description, siteUrl, feedUrl, language = 'en', copyright } = options;

  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.url)}</link>
      <guid isPermaLink="true">${escapeXml(entry.url)}</guid>
      <pubDate>${toRfc822(entry.date)}</pubDate>${entry.description ? `\n      <description>${escapeXml(entry.description)}</description>` : ''}${entry.html ? `\n      <content:encoded><![CDATA[${entry.html}]]></content:encoded>` : ''}${entry.tags ? entry.tags.map((t) => `\n      <category>${escapeXml(t)}</category>`).join('') : ''}
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <description>${escapeXml(description)}</description>
    <link>${escapeXml(siteUrl)}</link>${feedUrl ? `\n    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>` : ''}
    <language>${escapeXml(language)}</language>
    <lastBuildDate>${toRfc822(new Date())}</lastBuildDate>${copyright ? `\n    <copyright>${escapeXml(copyright)}</copyright>` : ''}
${items}
  </channel>
</rss>`;
}

/**
 * Generate an Atom 1.0 feed from content entries.
 */
export function generateAtomFeed(entries: FeedEntry[], options: FeedOptions): string {
  const { title, description, siteUrl, feedUrl, author } = options;

  const atomEntries = entries
    .map(
      (entry) => `  <entry>
    <title>${escapeXml(entry.title)}</title>
    <link href="${escapeXml(entry.url)}"/>
    <id>${escapeXml(entry.url)}</id>
    <updated>${toIso8601(entry.date)}</updated>${entry.description ? `\n    <summary>${escapeXml(entry.description)}</summary>` : ''}${entry.html ? `\n    <content type="html"><![CDATA[${entry.html}]]></content>` : ''}${entry.tags ? entry.tags.map((t) => `\n    <category term="${escapeXml(t)}"/>`).join('') : ''}
  </entry>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title)}</title>
  <subtitle>${escapeXml(description)}</subtitle>
  <link href="${escapeXml(siteUrl)}"/>${feedUrl ? `\n  <link href="${escapeXml(feedUrl)}" rel="self" type="application/atom+xml"/>` : ''}
  <id>${escapeXml(siteUrl)}/</id>
  <updated>${toIso8601(new Date())}</updated>${author ? `\n  <author>\n    <name>${escapeXml(author)}</name>\n  </author>` : ''}
${atomEntries}
</feed>`;
}
