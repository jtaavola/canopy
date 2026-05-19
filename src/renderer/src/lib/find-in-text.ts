export const SEARCH_HIGHLIGHT_CSS = `
  ::highlight(file-preview-search) {
    background-color: rgb(253 224 71 / 0.6);
    color: black;
  }

  ::highlight(file-preview-search-active) {
    background-color: rgb(245 158 11);
    color: black;
  }
`;

type TextSegment = {
  node: Text;
  start: number;
  end: number;
};

/**
 * Search for `query` inside the DOM subtree rooted at `root` and return
 * the matching Range objects.  Line-scoped elements (`[data-line]`) are
 * searched individually so matches never straddle line boundaries.
 */
export function findInText(root: Node, query: string): Range[] {
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

export function clearSearchHighlights(): void {
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  highlights?.delete("file-preview-search");
  highlights?.delete("file-preview-search-active");
}

export function updateSearchHighlights(
  ranges: Range[],
  activeIndex: number,
): void {
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  if (!highlights || typeof Highlight === "undefined") return;

  highlights.set(
    "file-preview-search",
    new Highlight(...ranges.filter((_, index) => index !== activeIndex)),
  );
  highlights.set(
    "file-preview-search-active",
    ranges[activeIndex] ? new Highlight(ranges[activeIndex]) : new Highlight(),
  );
}
