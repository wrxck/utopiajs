// ============================================================================
// @matthesketh/utopia-server — VNode types for SSR
// ============================================================================

export interface VElement {
  type: 1;
  tag: string;
  attrs: Record<string, string>;
  children: VNode[];
  _parent?: VElement;
}

export interface VText {
  type: 2;
  text: string;
  _parent?: VElement;
}

export interface VComment {
  type: 3;
  text: string;
  _parent?: VElement;
}

export type VNode = VElement | VText | VComment;
