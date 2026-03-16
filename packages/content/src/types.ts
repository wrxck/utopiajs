/** Supported content file formats */
export type ContentFormat = 'md' | 'utopia' | 'json' | 'yaml';

/** Schema field type definitions */
export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'date' | 'array';

/** Schema field definition */
export interface SchemaField {
  type: SchemaFieldType;
  required?: boolean;
  default?: unknown;
  /** For array fields: the type of items in the array */
  items?: 'string' | 'number' | 'boolean';
}

/** Content collection schema — maps field names to their definitions */
export type CollectionSchema = Record<string, SchemaField>;

/** Configuration for a content collection */
export interface CollectionConfig<S extends CollectionSchema = CollectionSchema> {
  name: string;
  directory: string;
  schema?: S;
  formats?: ContentFormat[];
}

/** Parsed content entry */
export interface ContentEntry<T extends Record<string, unknown> = Record<string, unknown>> {
  /** URL-friendly identifier derived from filename */
  slug: string;
  /** Collection this entry belongs to */
  collection: string;
  /** Validated frontmatter / metadata */
  data: T;
  /** Raw content body (markdown, etc.) */
  body: string;
  /** Rendered HTML (for markdown entries) */
  html?: string;
  /** Source file format */
  format: ContentFormat;
  /** Absolute path to source file */
  filePath: string;
}

/** Query options for filtering and sorting collections */
export interface QueryOptions {
  /** Filter entries by a predicate */
  filter?: (entry: ContentEntry) => boolean;
  /** Sort field (dot-path into data) */
  sort?: string;
  /** Sort direction */
  order?: 'asc' | 'desc';
  /** Maximum entries to return */
  limit?: number;
  /** Number of entries to skip */
  offset?: number;
}

/** Content adapter interface — abstraction over content source */
export interface ContentAdapter {
  /** Read all entries from a collection directory */
  readEntries(config: CollectionConfig): Promise<ContentEntry[]>;
  /** Read a single entry by slug */
  readEntry(config: CollectionConfig, slug: string): Promise<ContentEntry | null>;
  /** Write a new entry */
  writeEntry(
    config: CollectionConfig,
    slug: string,
    data: Record<string, unknown>,
    body: string,
    format?: ContentFormat,
  ): Promise<void>;
  /** Update an existing entry */
  updateEntry(
    config: CollectionConfig,
    slug: string,
    data?: Record<string, unknown>,
    body?: string,
  ): Promise<void>;
  /** Delete an entry */
  deleteEntry(config: CollectionConfig, slug: string): Promise<void>;
  /** List all slugs in a collection */
  listSlugs(config: CollectionConfig): Promise<string[]>;
}

/** Resolved collection with its adapter and config */
export interface Collection {
  config: CollectionConfig;
  adapter: ContentAdapter;
}

/** Schema validation error */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}
