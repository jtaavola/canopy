const SEARCH_HIGHLIGHT_PREFIX = "file-preview-search";

export function searchHighlightCss(names: DomSearchHighlightNames): string {
  return `
  ::highlight(${names.match}) {
    background-color: rgb(253 224 71 / 0.6);
    color: black;
  }

  ::highlight(${names.active}) {
    background-color: rgb(245 158 11);
    color: black;
  }
`;
}

type TextSegment = {
  node: Text;
  start: number;
  end: number;
};

type DomSearchHighlightNames = {
  match: string;
  active: string;
};

export type DomSearchResult = {
  matchCount: number;
  activeIndex: number;
  activeRange: Range | null;
};

export class DomSearchHighlights {
  readonly highlightCss: string;

  #ranges: Range[] = [];
  #activeIndex = 0;
  #highlightNames: DomSearchHighlightNames;

  constructor(id = crypto.randomUUID()) {
    this.#highlightNames = {
      match: `${SEARCH_HIGHLIGHT_PREFIX}-${id}`,
      active: `${SEARCH_HIGHLIGHT_PREFIX}-${id}-active`,
    };
    this.highlightCss = searchHighlightCss(this.#highlightNames);
  }

  search(
    roots: readonly Node[],
    query: string,
    requestedIndex = 0,
  ): DomSearchResult {
    this.clear();

    if (!query || !roots.length) {
      return this.result();
    }

    this.#ranges = roots.flatMap((root) => findRangesInText(root, query));
    this.#activeIndex = this.#ranges.length
      ? ((requestedIndex % this.#ranges.length) + this.#ranges.length) %
        this.#ranges.length
      : 0;

    this.updateHighlights();
    return this.result();
  }

  clear(): void {
    this.#ranges = [];
    this.#activeIndex = 0;
    this.clearHighlights();
  }

  result(): DomSearchResult {
    return {
      matchCount: this.#ranges.length,
      activeIndex: this.#activeIndex,
      activeRange: this.#ranges[this.#activeIndex] ?? null,
    };
  }

  private updateHighlights(): void {
    const highlights = (CSS as unknown as { highlights?: HighlightRegistry })
      .highlights;
    if (!highlights || typeof Highlight === "undefined") return;

    highlights.set(
      this.#highlightNames.match,
      new Highlight(
        ...this.#ranges.filter((_, index) => index !== this.#activeIndex),
      ),
    );
    highlights.set(
      this.#highlightNames.active,
      this.#ranges[this.#activeIndex]
        ? new Highlight(this.#ranges[this.#activeIndex])
        : new Highlight(),
    );
  }

  private clearHighlights(): void {
    const highlights = (CSS as unknown as { highlights?: HighlightRegistry })
      .highlights;
    highlights?.delete(this.#highlightNames.match);
    highlights?.delete(this.#highlightNames.active);
  }
}

/**
 * Search for `query` inside the DOM subtrees rooted at `roots`. Line-scoped
 * elements (`[data-line]`) are searched individually so matches never straddle
 * line boundaries.
 */
function findRangesInText(root: Node, query: string): Range[] {
  const ranges: Range[] = [];
  const needle = query.toLocaleLowerCase();
  const searchUnits = getSearchUnits(root);

  for (const unit of searchUnits) {
    const segments = getTextSegments(unit);
    const text = segments.map((segment) => segment.node.data).join("");
    const haystack = text.toLocaleLowerCase();
    let start = haystack.indexOf(needle);

    while (start !== -1) {
      const startPosition = findTextPosition(segments, start);
      const endPosition = findTextPosition(segments, start + query.length);

      if (startPosition && endPosition) {
        const range = document.createRange();
        range.setStart(startPosition.node, startPosition.offset);
        range.setEnd(endPosition.node, endPosition.offset);
        ranges.push(range);
      }

      start = haystack.indexOf(needle, start + query.length);
    }
  }

  return ranges;
}

function getSearchUnits(root: Node): Node[] {
  const queryableRoot =
    root instanceof Element || root instanceof DocumentFragment ? root : null;
  const lineElements = queryableRoot
    ? Array.from(queryableRoot.querySelectorAll<HTMLElement>("[data-line]"))
    : [];

  return lineElements.length ? lineElements : [root];
}

function getTextSegments(root: Node): TextSegment[] {
  const segments: TextSegment[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textLength = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Text) || node.data.length === 0) continue;

    segments.push({
      node,
      start: textLength,
      end: textLength + node.data.length,
    });
    textLength += node.data.length;
  }

  return segments;
}

function findTextPosition(
  segments: TextSegment[],
  offset: number,
): { node: Text; offset: number } | null {
  for (const [index, segment] of segments.entries()) {
    const isLastSegment = index === segments.length - 1;
    if (
      offset >= segment.start &&
      (offset < segment.end || (isLastSegment && offset === segment.end))
    ) {
      return { node: segment.node, offset: offset - segment.start };
    }
  }

  return null;
}
