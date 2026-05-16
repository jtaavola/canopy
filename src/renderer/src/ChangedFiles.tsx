import { PatchDiff } from "@pierre/diffs/react";
import { Button } from "@renderer/components/ui/button";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ChangedFile } from "../../preload/index.d";

export function ChangedDiff({
  projectPath,
  filePath,
  onClose,
}: {
  projectPath: string;
  filePath: string;
  onClose: () => void;
}): React.JSX.Element {
  const [patch, setPatch] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading diff…");

  useEffect(() => {
    let isMounted = true;

    setPatch(null);
    setMessage("Loading diff…");

    window.api.gitChanges.diff(projectPath, filePath).then((result) => {
      if (!isMounted) return;
      if (result.status === "ok") {
        setPatch(result.patch);
        setMessage(result.patch ? "" : "No diff available.");
      } else if (result.status === "not-git") {
        setMessage("This project is not a git repository.");
      } else if (result.status === "not-found") {
        setMessage("This file is no longer changed.");
      } else {
        setMessage(result.message);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [filePath, projectPath]);

  return (
    <section className="file-preview" aria-label="Changed file diff">
      <header className="file-preview-header">
        <span className="min-w-0 flex-1 truncate">{filePath}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
          <IconX aria-hidden="true" data-icon="inline-start" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-950">
        {patch ? (
          <PatchDiff
            patch={patch}
            disableWorkerPool
            options={{ diffStyle: "split" }}
          />
        ) : (
          <div className="p-6 text-neutral-400 text-sm">{message}</div>
        )}
      </div>
    </section>
  );
}

export function ChangedFilesList({
  projectPath,
  onOpenChangedFile,
}: {
  projectPath: string;
  onOpenChangedFile: (filePath: string) => void;
}): React.JSX.Element {
  const [files, setFiles] = useState<readonly ChangedFile[]>([]);
  const [message, setMessage] = useState("Loading changes…");

  useEffect(() => {
    let isMounted = true;

    const load = (): void => {
      window.api.gitChanges
        .list(projectPath)
        .then((result) => {
          if (!isMounted) return;
          if (result.status === "ok") {
            setFiles(result.files);
            setMessage(result.files.length ? "" : "No changed files.");
          } else if (result.status === "not-git") {
            setFiles([]);
            setMessage("This project is not a git repository.");
          } else {
            setFiles([]);
            setMessage(result.message);
          }
        })
        .catch(() => {
          if (isMounted) setMessage("Unable to load changed files.");
        });
    };

    load();
    const interval = window.setInterval(load, 2000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  if (!files.length) return <div className="explorer-error">{message}</div>;

  return (
    <ul className="m-0 min-h-0 flex-1 overflow-auto p-2">
      {files.map((file) => (
        <li key={`${file.oldPath ?? ""}:${file.path}`}>
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-neutral-200 text-sm hover:bg-neutral-800"
            onClick={() => onOpenChangedFile(file.path)}
          >
            <span className="mr-2 inline-block w-5 text-center text-neutral-500 text-xs uppercase">
              {file.status[0]}
            </span>
            {file.oldPath ? `${file.oldPath} → ` : ""}
            {file.path}
          </button>
        </li>
      ))}
    </ul>
  );
}
