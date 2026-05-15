import { Alert, AlertDescription } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { Spinner } from "@renderer/components/ui/spinner";
import { IconFolderOpen } from "@tabler/icons-react";

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
      className="flex min-w-0 flex-1 items-center justify-center bg-background px-6 py-12"
      aria-label="Projects"
    >
      <div className="w-full max-w-lg -translate-y-8">
        <div className="mb-12 flex flex-col items-center text-center">
          <img src={canopyLogo} alt="" className="mb-3 size-12" />
          <h1 className="text-5xl font-light uppercase tracking-widest">Canopy</h1>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-auto w-full justify-start gap-3 rounded-lg px-8 py-4"
          onClick={onOpenProject}
          disabled={isOpening}
        >
          {isOpening ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <IconFolderOpen data-icon="inline-start" />
          )}
          <span className="flex flex-col items-start gap-0.5">
            <span className="font-semibold">
              {isOpening ? "Opening…" : "Open project…"}
            </span>
            <span className="text-xs text-muted-foreground">
              Select a local folder as your workspace
            </span>
          </span>
        </Button>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}

export default ProjectsLanding;
