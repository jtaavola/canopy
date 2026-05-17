import {
  FileTree,
  useFileTree,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { Button } from "@renderer/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@renderer/components/ui/resizable";
import { Spinner } from "@renderer/components/ui/spinner";
import { cn } from "@renderer/lib/utils";
import {
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { FitAddon } from "@xterm/addon-fit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "xterm";
import type { WorkspaceProject } from "../../preload/index.d";
import { ChangedDiff, ChangedFilesList } from "./ChangedFiles";
import { FilePreview } from "./FilePreview";
import ProjectsLanding from "./ProjectsLanding";
import "xterm/css/xterm.css";

function getUserFacingErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;

  return message.replace(/^Error invoking remote method '[^']+':\s*/, "");
}

function ProjectManager({
  projects,
  activeProjectId,
  isOpeningProject,
  onOpenProject,
  onSelectProject,
  onRemoveProject,
}: {
  projects: readonly WorkspaceProject[];
  activeProjectId: string;
  isOpeningProject: boolean;
  onOpenProject: () => void;
  onSelectProject: (projectPath: string) => void;
  onRemoveProject: (projectPath: string) => void;
}): React.JSX.Element {
  return (
    <aside
      id="project-manager"
      className="flex size-full min-h-0 flex-col bg-neutral-900"
      aria-label="Open projects"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-neutral-800 border-b py-0 pr-2 pl-3 font-bold text-neutral-400 text-xs uppercase tracking-widest">
        <span>Projects</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-neutral-200"
          aria-label="Open another project"
          title="Open another project"
          onClick={onOpenProject}
          disabled={isOpeningProject}
        >
          <IconPlus aria-hidden="true" data-icon="inline-start" />
        </Button>
      </div>
      <ul className="m-0 min-h-0 flex-1 overflow-auto p-2">
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;

          return (
            <li key={project.id} className="relative mb-1 flex items-stretch">
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  "h-auto min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg border py-2 pr-9 pl-2.5 text-left hover:text-white",
                  isActive
                    ? "border-neutral-500 bg-neutral-700 text-white shadow-sm"
                    : "border-transparent bg-transparent text-neutral-200 hover:bg-neutral-800",
                )}
                aria-current={isActive ? "page" : undefined}
                title={project.rootPath}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-sm">
                  {project.name}
                </span>
                <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-neutral-500 text-xs">
                  {project.rootPath}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-2 right-1.5 text-neutral-400 hover:bg-neutral-700 hover:text-white"
                aria-label={`Remove ${project.name} from open projects`}
                title="Remove from open projects"
                onClick={() => onRemoveProject(project.id)}
              >
                <IconX aria-hidden="true" data-icon="inline-start" />
              </Button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function FileSelectionObserver({
  model,
  filePaths,
  onOpenFile,
}: {
  model: ReturnType<typeof useFileTree>["model"];
  filePaths: readonly string[];
  onOpenFile: (filePath: string) => void;
}): null {
  const selectedPaths = useFileTreeSelection(model);
  const filePathSet = new Set(filePaths);
  const selectedFilePath = selectedPaths.find((path) => filePathSet.has(path));

  useEffect(() => {
    if (selectedFilePath) onOpenFile(selectedFilePath);
  }, [onOpenFile, selectedFilePath]);

  return null;
}

function ProjectExplorer({
  projectPath,
  onOpenFile,
  onOpenChangedFile,
}: {
  projectPath: string;
  onOpenFile: (filePath: string) => void;
  onOpenChangedFile: (filePath: string) => void;
}): React.JSX.Element {
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"files" | "changed">("files");
  const { model } = useFileTree({
    paths,
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpandedPaths: ["src", "src/renderer", "src/renderer/src"],
  });

  useEffect(() => {
    let isMounted = true;

    setError(null);
    setPaths([]);
    model.resetPaths([]);

    window.api.fileTree
      .list(projectPath)
      .then((projectPaths) => {
        if (!isMounted) return;
        setPaths(projectPaths);
        model.resetPaths(projectPaths);
      })
      .catch((unknownError: unknown) => {
        if (!isMounted) return;
        setError(
          unknownError instanceof Error
            ? unknownError.message
            : "Unable to load project files",
        );
      });

    return () => {
      isMounted = false;
    };
  }, [model, projectPath]);

  return (
    <aside
      id="project-explorer"
      className="flex size-full min-h-0 flex-col bg-neutral-950"
      aria-label="Project file explorer"
    >
      <div className="explorer-header gap-2">
        <button
          type="button"
          className={cn(activeTab === "files" && "text-white")}
          onClick={() => setActiveTab("files")}
        >
          Files
        </button>
        <span>·</span>
        <button
          type="button"
          className={cn(activeTab === "changed" && "text-white")}
          onClick={() => setActiveTab("changed")}
        >
          Changed
        </button>
      </div>
      {activeTab === "files" ? (
        <>
          {error ? <div className="explorer-error">{error}</div> : null}
          <FileSelectionObserver
            model={model}
            filePaths={paths}
            onOpenFile={onOpenFile}
          />
          <FileTree model={model} className="explorer-tree" />
        </>
      ) : (
        <ChangedFilesList
          projectPath={projectPath}
          onOpenChangedFile={onOpenChangedFile}
        />
      )}
    </aside>
  );
}

function App(): React.JSX.Element {
  const terminalElementRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<readonly WorkspaceProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTreeId, setActiveTreeId] = useState<string | null>(null);
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedChangedFilePath, setSelectedChangedFilePath] = useState<
    string | null
  >(null);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [openProjectError, setOpenProjectError] = useState<string | null>(null);
  const [isProjectManagerVisible, setIsProjectManagerVisible] = useState(true);
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [projectManagerSize, setProjectManagerSize] = useState("20%");
  const [explorerSize, setExplorerSize] = useState("25%");
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const activeTree = useMemo(
    () =>
      activeProject?.trees.find((tree) => tree.id === activeTreeId) ??
      activeProject?.trees[0] ??
      null,
    [activeProject, activeTreeId],
  );
  const activeWorktreePath = activeTree?.worktreePath ?? null;

  useEffect(() => {
    let isMounted = true;

    window.api.workspace
      .load()
      .then((workspaceState) => {
        if (!isMounted) return;

        setProjects(workspaceState.projects);
        setActiveProjectId(workspaceState.activeProjectId);
        setActiveTreeId(workspaceState.activeTreeId);
      })
      .catch((unknownError: unknown) => {
        if (!isMounted) return;

        setOpenProjectError(
          getUserFacingErrorMessage(
            unknownError,
            "Unable to restore workspace",
          ),
        );
      })
      .finally(() => {
        if (isMounted) setHasLoadedWorkspaceState(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedWorkspaceState) return;

    window.api.workspace
      .save({
        version: 1,
        projects: [...projects],
        activeProjectId,
        activeTreeId,
      })
      .catch((unknownError: unknown) => {
        setOpenProjectError(
          getUserFacingErrorMessage(unknownError, "Unable to save workspace"),
        );
      });
  }, [activeProjectId, activeTreeId, hasLoadedWorkspaceState, projects]);

  useEffect(() => {
    const terminalElement = terminalElementRef.current;

    if (!terminalElement || !activeWorktreePath) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#111111",
        foreground: "#f2f2f2",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);
    fitAddon.fit();

    const resizeShell = (): void => {
      fitAddon.fit();
      window.api.terminal.resize(activeWorktreePath, {
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };

    const resizeObserver = new ResizeObserver(resizeShell);
    const removeDataListener = window.api.terminal.onData((data) =>
      terminal.write(data),
    );
    const removeExitListener = window.api.terminal.onExit(
      ({ terminalId, exitCode }) => {
        if (terminalId === activeWorktreePath) {
          terminal.writeln(`\r\n[process exited with code ${exitCode}]`);
        }
      },
    );
    const inputDisposable = terminal.onData((data) =>
      window.api.terminal.write(activeWorktreePath, data),
    );

    resizeObserver.observe(terminalElement);

    window.api.terminal.start({
      cols: terminal.cols,
      rows: terminal.rows,
      cwd: activeWorktreePath,
    });

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      terminal.dispose();
    };
  }, [activeWorktreePath]);

  const openProject = async (): Promise<void> => {
    setIsOpeningProject(true);
    setOpenProjectError(null);

    try {
      const workspaceState = await window.api.project.open();

      if (workspaceState) {
        setProjects(workspaceState.projects);
        setActiveProjectId(workspaceState.activeProjectId);
        setActiveTreeId(workspaceState.activeTreeId);
        setSelectedFilePath(null);
        setSelectedChangedFilePath(null);
        setIsProjectManagerVisible(true);
      }
    } catch (unknownError: unknown) {
      setOpenProjectError(
        getUserFacingErrorMessage(unknownError, "Unable to open project"),
      );
    } finally {
      setIsOpeningProject(false);
    }
  };

  const selectProject = (projectId: string): void => {
    const project = projects.find((candidate) => candidate.id === projectId);
    setActiveProjectId(projectId);
    setActiveTreeId(project?.trees[0]?.id ?? null);
    setSelectedFilePath(null);
    setSelectedChangedFilePath(null);
  };

  const removeProject = (projectIdToRemove: string): void => {
    const project = projects.find(
      (candidate) => candidate.id === projectIdToRemove,
    );
    for (const tree of project?.trees ?? [])
      window.api.terminal.dispose(tree.worktreePath);

    setProjects((currentProjects) => {
      const nextProjects = currentProjects.filter(
        (project) => project.id !== projectIdToRemove,
      );

      if (activeProjectId === projectIdToRemove) {
        setSelectedFilePath(null);
        setSelectedChangedFilePath(null);
        setActiveProjectId(nextProjects[0]?.id ?? null);
        setActiveTreeId(nextProjects[0]?.trees[0]?.id ?? null);
      }

      return nextProjects;
    });
  };

  const noDragStyle = {
    WebkitAppRegion: "no-drag",
  } as React.CSSProperties & { WebkitAppRegion: string };

  const openFilePreview = useCallback((filePath: string): void => {
    setSelectedChangedFilePath(null);
    setSelectedFilePath(filePath);
  }, []);

  const openChangedFilePreview = useCallback((filePath: string): void => {
    setSelectedFilePath(null);
    setSelectedChangedFilePath(filePath);
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header relative">
        {activeWorktreePath ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-neutral-200"
            style={noDragStyle}
            aria-controls="project-manager"
            aria-expanded={isProjectManagerVisible}
            aria-label={
              isProjectManagerVisible ? "Hide projects" : "Show projects"
            }
            title={isProjectManagerVisible ? "Hide projects" : "Show projects"}
            onClick={() =>
              setIsProjectManagerVisible((isVisible) => !isVisible)
            }
          >
            <IconLayoutSidebar aria-hidden="true" data-icon="inline-start" />
          </Button>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-semibold text-neutral-100 text-sm tracking-tight">
          Canopy
          {activeProject
            ? ` · ${activeProject.name}${activeTree ? ` · ${activeTree.name}` : ""}`
            : ""}
        </div>
        {activeWorktreePath ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-neutral-200"
            style={noDragStyle}
            aria-controls="project-explorer"
            aria-expanded={isExplorerVisible}
            aria-label={isExplorerVisible ? "Hide files" : "Show files"}
            title={isExplorerVisible ? "Hide files" : "Show files"}
            onClick={() => setIsExplorerVisible((isVisible) => !isVisible)}
          >
            <IconLayoutSidebarRight
              aria-hidden="true"
              data-icon="inline-start"
            />
          </Button>
        ) : null}
      </header>
      {openProjectError && activeWorktreePath ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-red-900/70 border-b bg-red-950 px-4 py-2 text-red-100 text-sm"
        >
          <span>{openProjectError}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-red-100 hover:bg-red-900/60 hover:text-white"
            aria-label="Dismiss project error"
            onClick={() => setOpenProjectError(null)}
          >
            <IconX aria-hidden="true" data-icon="inline-start" />
          </Button>
        </div>
      ) : null}
      <div className="workspace-shell">
        {!hasLoadedWorkspaceState ? (
          <section
            className="flex min-w-0 flex-1 items-center justify-center bg-background"
            aria-label="Loading workspace"
          >
            <Spinner aria-hidden="true" />
          </section>
        ) : activeWorktreePath ? (
          <ResizablePanelGroup orientation="horizontal" className="min-h-0">
            {isProjectManagerVisible ? (
              <>
                <ResizablePanel
                  id="project-manager-panel"
                  defaultSize={projectManagerSize}
                  minSize="10%"
                  maxSize="40%"
                  onResize={(size) =>
                    setProjectManagerSize(`${size.asPercentage}%`)
                  }
                  className="min-w-0"
                >
                  <ProjectManager
                    projects={projects}
                    activeProjectId={activeProjectId ?? ""}
                    isOpeningProject={isOpeningProject}
                    onOpenProject={openProject}
                    onSelectProject={selectProject}
                    onRemoveProject={removeProject}
                  />
                </ResizablePanel>
                <ResizableHandle className="bg-neutral-800 after:bg-transparent hover:bg-neutral-700" />
              </>
            ) : null}
            <ResizablePanel
              id="terminal-panel"
              minSize="30%"
              className="h-full min-w-0"
            >
              <section
                className={cn(
                  "terminal-shell",
                  (selectedFilePath || selectedChangedFilePath) && "hidden",
                )}
                aria-label="Terminal"
              >
                <div ref={terminalElementRef} className="terminal-container" />
              </section>
              {selectedFilePath ? (
                <FilePreview
                  projectPath={activeWorktreePath}
                  filePath={selectedFilePath}
                  onClose={() => setSelectedFilePath(null)}
                />
              ) : null}
              {selectedChangedFilePath ? (
                <ChangedDiff
                  projectPath={activeWorktreePath}
                  filePath={selectedChangedFilePath}
                  onClose={() => setSelectedChangedFilePath(null)}
                />
              ) : null}
            </ResizablePanel>
            {isExplorerVisible ? (
              <>
                <ResizableHandle className="bg-neutral-800 after:bg-transparent hover:bg-neutral-700" />
                <ResizablePanel
                  id="project-explorer-panel"
                  defaultSize={explorerSize}
                  minSize="10%"
                  maxSize="40%"
                  onResize={(size) => setExplorerSize(`${size.asPercentage}%`)}
                  className="min-w-0"
                >
                  <ProjectExplorer
                    projectPath={activeWorktreePath}
                    onOpenFile={openFilePreview}
                    onOpenChangedFile={openChangedFilePreview}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        ) : (
          <ProjectsLanding
            onOpenProject={openProject}
            isOpening={isOpeningProject}
            error={openProjectError}
          />
        )}
      </div>
    </main>
  );
}

export default App;
