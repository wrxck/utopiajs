// ============================================================================
// @matthesketh/utopia-server — VNode types for SSR
// ============================================================================

export interface VElement {
  type: 1;
  tag: string;
  attrs: Record<string, string>;
  children: VNode[];
  /**
   * Raw inner HTML from `u-html`. When set, the serializers write it in place
   * of `children` — the SSR mirror of assigning `innerHTML`.
   */
  html?: string;
  /**
   * The value a `u-model` binds to this `<select>`. Its options are appended
   * after the binding runs, so the serializers mark the matching option
   * `selected` when they reach it.
   */
  _modelValue?: string;
  _parent?: VParent;
}

export interface VText {
  type: 2;
  text: string;
  _parent?: VParent;
}

export interface VComment {
  type: 3;
  text: string;
  /**
   * Work waiting for this anchor to be inserted. A `u-if`/`u-for` anchor that
   * is returned as a branch (an else-if chain) or as a component root is
   * created before it has a parent; its first render runs on insertion.
   */
  _pending?: (() => void)[];
  _parent?: VParent;
}

/**
 * Mirror of the client DocumentFragment (compiled output when the compiler's
 * `fragments` option is on). Its children are parented to the fragment until
 * it is flattened into a real parent at insertion time, so structural
 * directives (u-if/u-for anchors) inside un-inserted fragment content still
 * resolve a parent. Serializers only ever see one as a render root.
 */
export interface VFragment {
  type: 4;
  children: VNode[];
  _parent?: VParent;
}

/** Anything a VNode can be parented to — a real element or a fragment. */
export type VParent = VElement | VFragment;

export type VNode = VElement | VText | VComment | VFragment;
