import { FileTree, useFileTree } from "@pierre/trees/react";
import { Button } from "@renderer/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@renderer/components/ui/resizable";
import { cn } from "@renderer/lib/utils";
import {
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import ProjectsLanding from "./ProjectsLanding";
import "xterm/css/xterm.css";

function getProjectName(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath;
}

function ProjectManager({
  projectPaths,
  activeProjectPath,
  isOpeningProject,
  onOpenProject,
  onSelectProject,
  onRemoveProject,
}: {
  projectPaths: readonly string[];
  activeProjectPath: string;
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
        {projectPaths.map((projectPath) => {
          const isActive = projectPath === activeProjectPath;

          return (
            <li key={projectPath} className="relative mb-1 flex items-stretch">
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
                title={projectPath}
                onClick={() => onSelectProject(projectPath)}
              >
                <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-sm">
                  {getProjectName(projectPath)}
                </span>
                <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-neutral-500 text-xs">
                  {projectPath}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-2 right-1.5 text-neutral-400 hover:bg-neutral-700 hover:text-white"
                aria-label={`Remove ${getProjectName(projectPath)} from open projects`}
                title="Remove from open projects"
                onClick={() => onRemoveProject(projectPath)}
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

function ProjectExplorer({
  projectPath,
}: {
  projectPath: string;
}): React.JSX.Element {
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
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
      <div className="explorer-header">
        Files · {getProjectName(projectPath)}
      </div>
      {error ? <div className="explorer-error">{error}</div> : null}
      <FileTree model={model} className="explorer-tree" />
    </aside>
  );
}

function App(): React.JSX.Element {
  const terminalElementRef = useRef<HTMLDivElement>(null);
  const [projectPaths, setProjectPaths] = useState<readonly string[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(
    null,
  );
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [openProjectError, setOpenProjectError] = useState<string | null>(null);
  const [isProjectManagerVisible, setIsProjectManagerVisible] = useState(true);
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [projectManagerSize, setProjectManagerSize] = useState("20%");
  const [explorerSize, setExplorerSize] = useState("25%");

  useEffect(() => {
    const terminalElement = terminalElementRef.current;

    if (!terminalElement || !activeProjectPath) return;

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
      window.api.terminal.resize({ cols: terminal.cols, rows: terminal.rows });
    };

    const resizeObserver = new ResizeObserver(resizeShell);
    const removeDataListener = window.api.terminal.onData((data) =>
      terminal.write(data),
    );
    const removeExitListener = window.api.terminal.onExit(({ exitCode }) => {
      terminal.writeln(`\r\n[process exited with code ${exitCode}]`);
    });
    const inputDisposable = terminal.onData((data) =>
      window.api.terminal.write(data),
    );

    resizeObserver.observe(terminalElement);

    window.api.terminal.start({
      cols: terminal.cols,
      rows: terminal.rows,
      cwd: activeProjectPath,
    });

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      window.api.terminal.dispose();
      terminal.dispose();
    };
  }, [activeProjectPath]);

  const openProject = async (): Promise<void> => {
    setIsOpeningProject(true);
    setOpenProjectError(null);

    try {
      const selectedProjectPath = await window.api.project.open();

      if (selectedProjectPath) {
        setProjectPaths((currentProjectPaths) =>
          currentProjectPaths.includes(selectedProjectPath)
            ? currentProjectPaths
            : [...currentProjectPaths, selectedProjectPath],
        );
        setActiveProjectPath(selectedProjectPath);
        setIsProjectManagerVisible(true);
      }
    } catch (unknownError: unknown) {
      setOpenProjectError(
        unknownError instanceof Error
          ? unknownError.message
          : "Unable to open project",
      );
    } finally {
      setIsOpeningProject(false);
    }
  };

  const removeProject = (projectPathToRemove: string): void => {
    setProjectPaths((currentProjectPaths) => {
      const nextProjectPaths = currentProjectPaths.filter(
        (projectPath) => projectPath !== projectPathToRemove,
      );

      setActiveProjectPath((currentActiveProjectPath) => {
        if (currentActiveProjectPath !== projectPathToRemove) {
          return currentActiveProjectPath;
        }

        return nextProjectPaths[0] ?? null;
      });

      return nextProjectPaths;
    });
  };

  const noDragStyle = {
    WebkitAppRegion: "no-drag",
  } as React.CSSProperties & { WebkitAppRegion: string };

  return (
    <main className="app-shell">
      <header className="app-header relative">
        {activeProjectPath ? (
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
          {activeProjectPath ? ` · ${getProjectName(activeProjectPath)}` : ""}
        </div>
        {activeProjectPath ? (
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
      <div className="workspace-shell">
        {activeProjectPath ? (
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
                    projectPaths={projectPaths}
                    activeProjectPath={activeProjectPath}
                    isOpeningProject={isOpeningProject}
                    onOpenProject={openProject}
                    onSelectProject={setActiveProjectPath}
                    onRemoveProject={removeProject}
                  />
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  className="bg-neutral-800 after:bg-transparent hover:bg-neutral-700"
                />
              </>
            ) : null}
            <ResizablePanel
              id="terminal-panel"
              minSize="30%"
              className="min-w-0"
            >
              <section className="terminal-shell" aria-label="Terminal">
                <div ref={terminalElementRef} className="terminal-container" />
              </section>
            </ResizablePanel>
            {isExplorerVisible ? (
              <>
                <ResizableHandle
                  withHandle
                  className="bg-neutral-800 after:bg-transparent hover:bg-neutral-700"
                />
                <ResizablePanel
                  id="project-explorer-panel"
                  defaultSize={explorerSize}
                  minSize="10%"
                  maxSize="40%"
                  onResize={(size) => setExplorerSize(`${size.asPercentage}%`)}
                  className="min-w-0"
                >
                  <ProjectExplorer projectPath={activeProjectPath} />
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
