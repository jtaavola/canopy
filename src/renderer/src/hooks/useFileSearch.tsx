import { useCallback, useEffect, useRef, useState } from "react";

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

function createSearchRanges(root: Node, query: string): Range[] {
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

function clearSearchHighlights(): void {
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  highlights?.delete("file-preview-search");
  highlights?.delete("file-preview-search-active");
}

function updateSearchHighlights(ranges: Range[], activeIndex: number): void {
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

export function useFileSearch(containerRef: React.RefObject<Node | null>) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRangesRef = useRef<Range[]>([]);
  const searchStateRef = useRef({
    isOpen: false,
    query: "",
    index: 0,
  });
  const runSearchRef = useRef<(query: string, requestedIndex?: number) => void>(
    () => {},
  );

  const getSearchRoots = useCallback((): Node[] => {
    const el = containerRef.current;
    if (!el || !(el instanceof Element)) return [];

    const roots: Node[] = [];
    for (const fileContainer of el.querySelectorAll<HTMLElement>(
      "diffs-container",
    )) {
      const shadowRoot = fileContainer.shadowRoot;
      if (!shadowRoot) continue;
      const contentColumns = shadowRoot.querySelectorAll("[data-content]");
      if (contentColumns.length) {
        for (const col of contentColumns) roots.push(col);
      } else {
        roots.push(shadowRoot);
      }
    }

    return roots.length ? roots : [el];
  }, [containerRef]);

  const scrollToMatch = useCallback(
    (index: number) => {
      const el = containerRef.current;
      const range = searchRangesRef.current[index];
      if (!el || !(el instanceof Element) || !range) return;

      const matchRect = range.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      el.scrollTo?.({
        top: el.scrollTop + matchRect.top - elRect.top - 80,
        behavior: "smooth",
      });
    },
    [containerRef],
  );

  const runSearch = useCallback(
    (query: string, requestedIndex = 0) => {
      clearSearchHighlights();

      if (!query || !containerRef.current) {
        searchRangesRef.current = [];
        setMatchCount(0);
        setSearchIndex(0);
        return;
      }

      const ranges = getSearchRoots().flatMap((root) =>
        createSearchRanges(root, query),
      );

      const nextIndex = ranges.length
        ? ((requestedIndex % ranges.length) + ranges.length) % ranges.length
        : 0;

      searchRangesRef.current = ranges;
      searchStateRef.current.index = nextIndex;
      setMatchCount(ranges.length);
      setSearchIndex(nextIndex);
      updateSearchHighlights(ranges, nextIndex);
      scrollToMatch(nextIndex);
    },
    [getSearchRoots, scrollToMatch, containerRef],
  );

  useEffect(() => {
    runSearchRef.current = runSearch;
  }, [runSearch]);

  useEffect(() => {
    searchStateRef.current = {
      isOpen: isSearchOpen,
      query: searchQuery,
      index: searchIndex,
    };
  }, [isSearchOpen, searchIndex, searchQuery]);

  const handlePostRender = useCallback(() => {
    window.requestAnimationFrame(() => {
      const { isOpen, query, index } = searchStateRef.current;
      if (!isOpen || !query) return;
      runSearchRef.current(query, index);
    });
  }, []);

  const goToSearchMatch = useCallback(
    (direction: 1 | -1) => {
      if (!matchCount) return;
      runSearch(searchQuery, searchIndex + direction);
    },
    [matchCount, runSearch, searchIndex, searchQuery],
  );

  useEffect(() => {
    if (!isSearchOpen) {
      clearSearchHighlights();
      return;
    }

    const id = window.setTimeout(() => runSearch(searchQuery), 50);
    return () => window.clearTimeout(id);
  }, [isSearchOpen, runSearch, searchQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.select());
      } else if (event.key === "Escape" && isSearchOpen) {
        event.preventDefault();
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSearchOpen]);

  useEffect(
    () => () => {
      clearSearchHighlights();
    },
    [],
  );

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.select());
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const searchBar = isSearchOpen ? (
    <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 normal-case tracking-normal">
      <IconSearch className="size-3.5" aria-hidden="true" />
      <input
        ref={searchInputRef}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            goToSearchMatch(event.shiftKey ? -1 : 1);
          }
        }}
        placeholder="Search file"
        aria-label="Search file"
        className="h-6 w-44 bg-transparent text-foreground text-xs outline-none placeholder:text-muted-foreground"
      />
      <span className="min-w-12 text-right text-muted-foreground text-xs">
        {searchQuery ? `${matchCount ? searchIndex + 1 : 0}/${matchCount}` : ""}
      </span>
      <SearchNavButton
        aria-label="Previous match"
        onClick={() => goToSearchMatch(-1)}
        disabled={!matchCount}
      >
        <IconChevronUp aria-hidden="true" data-icon="inline-start" />
      </SearchNavButton>
      <SearchNavButton
        aria-label="Next match"
        onClick={() => goToSearchMatch(1)}
        disabled={!matchCount}
      >
        <IconChevronDown aria-hidden="true" data-icon="inline-start" />
      </SearchNavButton>
      <SearchNavButton aria-label="Close search" onClick={closeSearch}>
        <IconX aria-hidden="true" data-icon="inline-start" />
      </SearchNavButton>
    </div>
  ) : null;

  return {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    searchIndex,
    matchCount,
    searchInputRef,
    searchBar,
    openSearch,
    closeSearch,
    handlePostRender,
  };
}

import { Button } from "@renderer/components/ui/button";
// Stacked imports to avoid circular dependency on Button
import {
  IconChevronDown,
  IconChevronUp,
  IconSearch,
  IconX,
} from "@tabler/icons-react";

function SearchNavButton({
  children,
  ...props
}: {
  "aria-label": string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Button type="button" variant="ghost" size="icon-xs" {...props}>
      {children}
    </Button>
  );
}
