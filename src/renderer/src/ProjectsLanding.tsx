interface ProjectsLandingProps {
  onOpenProject: () => void;
  isOpening: boolean;
  error: string | null;
}

function ProjectsLanding(_props: ProjectsLandingProps): React.JSX.Element {
  return <div>Hello world</div>;
}

export default ProjectsLanding;
