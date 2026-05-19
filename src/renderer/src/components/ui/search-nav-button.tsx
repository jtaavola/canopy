import { Button } from "@renderer/components/ui/button";

export function SearchNavButton({
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
