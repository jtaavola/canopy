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
      className="flex min-w-0 flex-1 items-center justify-center bg-[#111111] px-6 py-12 text-[#f2f2f2]"
      aria-labelledby="projects-title"
    >
      <div className="w-full max-w-[520px] -translate-y-[4vh]">
        <div className="mb-[18px] text-center">
          <img
            src={canopyLogo}
            alt=""
            className="mx-auto mb-3 block size-12 rounded-xl"
          />
          <div className="mb-6 text-5xl leading-none font-[750] tracking-[-0.04em]">
            Canopy
          </div>
          <h1
            id="projects-title"
            className="mb-1 text-[22px] leading-tight font-semibold tracking-[-0.02em]"
          >
            Projects
          </h1>
          <p className="text-[13px] leading-6 text-[#f2f2f28f]">
            Open a folder to start working in Canopy.
          </p>
        </div>
        <button
          type="button"
          className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[10px] border border-[#2a2a2a] bg-[#181818] px-4 py-3.5 text-left text-[#f2f2f2] hover:border-[#3a3a3a] hover:bg-[#202020] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6aa7ff] disabled:cursor-default disabled:opacity-65"
          onClick={onOpenProject}
          disabled={isOpening}
        >
          <span className="text-sm font-semibold">
            {isOpening ? "Opening…" : "Open project…"}
          </span>
          <span className="text-xs text-[#f2f2f28a]">
            Select a local folder as your workspace
          </span>
        </button>
        {error ? (
          <div className="mt-3.5 text-[13px] text-[#ff8a8a]">{error}</div>
        ) : null}
      </div>
    </section>
  );
}

export default ProjectsLanding;
