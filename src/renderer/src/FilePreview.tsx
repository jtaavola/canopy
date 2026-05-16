import { Button } from "@renderer/components/ui/button";
import { IconX } from "@tabler/icons-react";
import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";

function getMonacoLanguage(filePath: string): string {
  const extension = filePath.toLowerCase().split(".").pop() ?? "";
  const languages: Record<string, string> = {
    css: "css",
    html: "html",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    jsonc: "json",
    md: "markdown",
    ts: "typescript",
    tsx: "typescript",
  };

  return languages[extension] ?? "plaintext";
}

export function FilePreview({
  projectPath,
  filePath,
  onClose,
}: {
  projectPath: string;
  filePath: string;
  onClose: () => void;
}): React.JSX.Element {
  const editorElementRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof window.api.fileTree.preview>
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(true);
    setPreview(null);

    window.api.fileTree
      .preview(projectPath, filePath)
      .then((result) => {
        if (!isMounted) return;
        setPreview(result);
      })
      .catch(() => {
        if (!isMounted) return;
        setPreview({ status: "unavailable", message: "File is unavailable." });
      })
      .finally(() => {
        if (!isMounted) return;
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [filePath, projectPath]);

  useEffect(() => {
    const editorElement = editorElementRef.current;

    if (!editorElement || preview?.status !== "ok") return;

    const editor = monaco.editor.create(editorElement, {
      value: preview.content,
      language: getMonacoLanguage(filePath),
      readOnly: true,
      minimap: { enabled: false },
      automaticLayout: true,
      theme: "vs-dark",
    });

    return () => editor.dispose();
  }, [filePath, preview]);

  let message: string | null = null;

  if (isLoading) message = "Loading file preview…";
  else if (preview?.status === "binary") {
    message = "Binary file preview is not supported.";
  } else if (preview?.status === "too-large") {
    message = "File is too large to preview.";
  } else if (preview?.status === "not-found") {
    message = "File not found.";
  } else if (preview?.status === "directory") {
    message = "Directories cannot be previewed.";
  } else if (preview?.status === "unavailable") {
    message = preview.message;
  }

  return (
    <section
      className="flex size-full min-h-0 flex-col bg-background"
      aria-label="File preview"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 font-semibold text-muted-foreground text-xs uppercase tracking-widest">
        <span className="min-w-0 flex-1 truncate">{filePath}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close file preview and return to terminal"
          title="Close file preview"
          onClick={onClose}
        >
          <IconX aria-hidden="true" data-icon="inline-start" />
        </Button>
      </div>
      {message ? (
        <div className="flex flex-1 items-center justify-center p-4 text-muted-foreground text-sm">
          {message}
        </div>
      ) : (
        <div ref={editorElementRef} className="min-h-0 flex-1" />
      )}
    </section>
  );
}
