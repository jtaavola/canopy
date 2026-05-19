import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  clearSearchHighlights,
  findInText,
  updateSearchHighlights,
} from "@renderer/lib/find-in-text";
import { SearchNavButton } from "@renderer/components/ui/search-nav-button";
import { Button } from "@renderer/components/ui/button";

export function useFileSearch(
  containerRef: React.RefObject<Node | null>,
  options?: { disabled?: boolean; label?: string },
) {
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
        findInText(root, query),
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

  const searchBarContent = (
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
  );

  const searchBar = isSearchOpen ? searchBarContent : null;

  const { disabled = false, label = "Search file" } = options ?? {};

  const searchControls = isSearchOpen ? (
    searchBarContent
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={`${label} (⌘F)`}
      onClick={openSearch}
      disabled={disabled && !isSearchOpen}
    >
      <IconSearch aria-hidden="true" data-icon="inline-start" />
    </Button>
  );

  return {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    searchIndex,
    matchCount,
    searchInputRef,
    searchBar,
    searchControls,
    openSearch,
    closeSearch,
    handlePostRender,
  };
}


