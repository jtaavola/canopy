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
    const highlights = getHighlightRegistry();
    if (!highlights || typeof Highlight === "undefined") return;

    const activeRange = this.#ranges[this.#activeIndex];
    highlights.set(
      this.#highlightNames.match,
      new Highlight(...this.#ranges.filter((range) => range !== activeRange)),
    );
    highlights.set(
      this.#highlightNames.active,
      activeRange ? new Highlight(activeRange) : new Highlight(),
    );
  }

  private clearHighlights(): void {
    const highlights = getHighlightRegistry();
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
  return getSearchUnits(root).flatMap((unit) => findRangesInUnit(unit, query));
}

function findRangesInUnit(root: Node, query: string): Range[] {
  const textNodes = getTextNodes(root);
  const foldedText = foldTextWithOriginalOffsets(
    textNodes.map((node) => node.data).join(""),
  );
  const needle = query.toLocaleLowerCase();
  const ranges: Range[] = [];

  for (
    let start = foldedText.text.indexOf(needle);
    start !== -1;
    start = foldedText.text.indexOf(needle, start + needle.length)
  ) {
    const end = start + needle.length;
    const originalStart = foldedText.startOffsets[start];
    const originalEnd = foldedText.endOffsets[end];
    if (originalStart === undefined || originalEnd === undefined) continue;

    const range = createRange(textNodes, originalStart, originalEnd);
    if (range) ranges.push(range);
  }

  return ranges;
}

function foldTextWithOriginalOffsets(text: string): {
  text: string;
  startOffsets: number[];
  endOffsets: number[];
} {
  let foldedText = "";
  const startOffsets: number[] = [];
  const endOffsets: number[] = [0];

  for (let originalOffset = 0; originalOffset < text.length; ) {
    const char = text.codePointAt(originalOffset);
    const originalLength = char && char > 0xffff ? 2 : 1;
    const foldedChar = text
      .slice(originalOffset, originalOffset + originalLength)
      .toLocaleLowerCase();
    const originalEnd = originalOffset + originalLength;

    for (
      let foldedOffset = 0;
      foldedOffset < foldedChar.length;
      foldedOffset++
    ) {
      startOffsets[foldedText.length + foldedOffset] = originalOffset;
      endOffsets[foldedText.length + foldedOffset + 1] = originalEnd;
    }

    foldedText += foldedChar;
    endOffsets[foldedText.length] = originalEnd;
    originalOffset = originalEnd;
  }

  return { text: foldedText, startOffsets, endOffsets };
}

function getSearchUnits(root: Node): Node[] {
  if (!(root instanceof Element || root instanceof DocumentFragment)) {
    return [root];
  }

  const lines = Array.from(root.querySelectorAll<HTMLElement>("[data-line]"));
  return lines.length ? lines : [root];
}

function getTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && node.data.length > 0) nodes.push(node);
  }

  return nodes;
}

function createRange(
  textNodes: readonly Text[],
  start: number,
  end: number,
): Range | null {
  const startPosition = findTextPosition(textNodes, start);
  const endPosition = findTextPosition(textNodes, end);
  if (!startPosition || !endPosition) return null;

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  return range;
}

function findTextPosition(
  textNodes: readonly Text[],
  offset: number,
): { node: Text; offset: number } | null {
  for (const [index, node] of textNodes.entries()) {
    const isLastNode = index === textNodes.length - 1;
    if (
      offset < node.data.length ||
      (isLastNode && offset === node.data.length)
    ) {
      return { node, offset };
    }
    offset -= node.data.length;
  }

  return null;
}

function getHighlightRegistry(): HighlightRegistry | undefined {
  return (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
}
