import { File, PatchDiff } from "@pierre/diffs/react";
import { Button } from "@renderer/components/ui/button";
import {
  IconChevronDown,
  IconChevronUp,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextSearchSession } from "./lib/text-search-session";

type SearchState = {
  controls: React.ReactNode;
  attachContainer: (node: HTMLDivElement | null) => void;
  handlePostRender: () => void;
  highlightCss: string;
};

export function useFileContentSearch(options?: {
  disabled?: boolean;
  label?: string;
}): SearchState {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textSearchSessionRef = useRef(new TextSearchSession());
  const searchStateRef = useRef({ isOpen: false, query: "", index: 0 });
  const runSearchRef = useRef<(query: string, requestedIndex?: number) => void>(
    () => {},
  );

  const getSearchRoots = useCallback((): Node[] => {
    const el = containerRef.current;
    if (!el) return [];

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
  }, []);

  const scrollToMatch = useCallback((range: Range | null) => {
    const el = containerRef.current;
    if (!el || !range) return;

    const matchRect = range.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    el.scrollTo?.({
      top: el.scrollTop + matchRect.top - elRect.top - 80,
      behavior: "smooth",
    });
  }, []);

  const runSearch = useCallback(
    (query: string, requestedIndex = 0) => {
      const result = textSearchSessionRef.current.search(
        getSearchRoots(),
        query,
        requestedIndex,
      );

      searchStateRef.current.index = result.activeIndex;
      setMatchCount(result.matchCount);
      setSearchIndex(result.activeIndex);
      scrollToMatch(result.activeRange);
    },
    [getSearchRoots, scrollToMatch],
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
      textSearchSessionRef.current.clear();
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

  useEffect(() => () => textSearchSessionRef.current.clear(), []);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.select());
  }, []);

  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  const { disabled = false, label = "Search file" } = options ?? {};

  const searchBar = (
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

  const controls = isSearchOpen ? (
    searchBar
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={`${label} (⌘F)`}
      onClick={openSearch}
      disabled={disabled}
    >
      <IconSearch aria-hidden="true" data-icon="inline-start" />
    </Button>
  );

  return {
    controls,
    attachContainer: (node) => (containerRef.current = node),
    handlePostRender,
    highlightCss: textSearchSessionRef.current.highlightCss,
  };
}

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

export function SearchableFile({
  file,
  search,
  className,
}: {
  file: React.ComponentProps<typeof File>["file"];
  search: SearchState;
  className?: string;
}): React.JSX.Element {
  const options = useMemo(
    () => ({
      themeType: "dark" as const,
      overflow: "scroll" as const,
      disableFileHeader: true,
      unsafeCSS: search.highlightCss,
      onPostRender: search.handlePostRender,
    }),
    [search.handlePostRender, search.highlightCss],
  );

  return (
    <div ref={search.attachContainer} className={className}>
      <File
        file={file}
        className="block min-h-full text-xs"
        options={options}
        disableWorkerPool
      />
    </div>
  );
}

export function SearchableChangedDiff({
  patch,
  search,
  className,
}: {
  patch: string;
  search: SearchState;
  className?: string;
}): React.JSX.Element {
  const options = useMemo(
    () => ({
      themeType: "system" as const,
      unsafeCSS: search.highlightCss,
      onPostRender: search.handlePostRender,
    }),
    [search.handlePostRender, search.highlightCss],
  );

  return (
    <div ref={search.attachContainer} className={className}>
      <PatchDiff patch={patch} disableWorkerPool options={options} />
    </div>
  );
}
