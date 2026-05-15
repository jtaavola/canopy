import canopyLogo from "../../../resources/icon.png";

interface ProjectsLandingProps {
  onOpenProject: () => void;
  isOpening: boolean;
  error: string | null;
}

function ProjectsLanding({
  onOpenProject,
  isOpening,
  error,
}: ProjectsLandingProps): React.JSX.Element {
  return (
    <section
      className="flex min-w-0 flex-1 items-center justify-center bg-background px-6 py-12 text-neutral-100"
      aria-label="Projects"
    >
      <div className="w-full max-w-lg -translate-y-8">
        <div className="mb-5 flex flex-col items-center text-center">
          <img
            src={canopyLogo}
            alt=""
            className="mb-3 block h-12 w-12 rounded-xl"
          />
          <div className="mb-6 text-5xl leading-none font-bold tracking-tight">
            Canopy
          </div>
        </div>
        <button
          type="button"
          className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3.5 text-left text-neutral-100 hover:border-neutral-700 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-default disabled:opacity-65 disabled:hover:border-neutral-800 disabled:hover:bg-neutral-900"
          onClick={onOpenProject}
          disabled={isOpening}
        >
          <span className="text-sm font-semibold">
            {isOpening ? "Opening…" : "Open project…"}
          </span>
          <span className="text-xs text-neutral-100/55">
            Select a local folder as your workspace
          </span>
        </button>
        {error ? (
          <div className="mt-3.5 text-sm text-red-400">{error}</div>
        ) : null}
      </div>
    </section>
  );
}

export default ProjectsLanding;
