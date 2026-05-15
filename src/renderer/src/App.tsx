import { FileTree, useFileTree } from "@pierre/trees/react";
import { IconLayoutSidebarRight } from "@tabler/icons-react";
import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import canopyLogo from "../../../resources/icon.png";
import "xterm/css/xterm.css";

function getProjectName(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath;
}

function ProjectsLanding({
  onOpenProject,
  isOpening,
  error,
}: {
  onOpenProject: () => void;
  isOpening: boolean;
  error: string | null;
}): React.JSX.Element {
  return (
    <section className="projects-landing" aria-labelledby="projects-title">
      <div className="projects-panel">
        <div className="projects-heading">
          <img src={canopyLogo} alt="" className="projects-logo" />
          <div className="projects-brand-name">Canopy</div>
          <h1 id="projects-title">Projects</h1>
          <p>Open a folder to start working in Canopy.</p>
        </div>
        <button
          type="button"
          className="project-row"
          onClick={onOpenProject}
          disabled={isOpening}
        >
          <span className="project-row-title">
            {isOpening ? "Opening…" : "Open project…"}
          </span>
          <span className="project-row-description">
            Select a local folder as your workspace
          </span>
        </button>
        {error ? <div className="landing-error">{error}</div> : null}
      </div>
    </section>
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
      className="explorer-panel"
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
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [openProjectError, setOpenProjectError] = useState<string | null>(null);
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);

  useEffect(() => {
    const terminalElement = terminalElementRef.current;

    if (!terminalElement || !projectPath) return;

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
      cwd: projectPath,
    });

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      window.api.terminal.dispose();
      terminal.dispose();
    };
  }, [projectPath]);

  const openProject = async (): Promise<void> => {
    setIsOpeningProject(true);
    setOpenProjectError(null);

    try {
      const selectedProjectPath = await window.api.project.open();

      if (selectedProjectPath) {
        setProjectPath(selectedProjectPath);
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-title">
          Canopy{projectPath ? ` · ${getProjectName(projectPath)}` : ""}
        </div>
        {projectPath ? (
          <button
            type="button"
            className="explorer-toggle"
            aria-controls="project-explorer"
            aria-expanded={isExplorerVisible}
            aria-label={isExplorerVisible ? "Hide files" : "Show files"}
            title={isExplorerVisible ? "Hide files" : "Show files"}
            onClick={() => setIsExplorerVisible((isVisible) => !isVisible)}
          >
            <IconLayoutSidebarRight aria-hidden="true" size={18} stroke={1.8} />
          </button>
        ) : null}
      </header>
      <div className="workspace-shell">
        {projectPath ? (
          <>
            <section className="terminal-shell" aria-label="Terminal">
              <div ref={terminalElementRef} className="terminal-container" />
            </section>
            {isExplorerVisible ? (
              <ProjectExplorer projectPath={projectPath} />
            ) : null}
          </>
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
