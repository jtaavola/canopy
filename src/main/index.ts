import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type WebFrameMain,
} from "electron";
import * as pty from "node-pty";
import icon from "../../resources/icon.png?asset";
import { TREE_NAMES } from "./tree-names";

const execFileAsync = promisify(execFile);

const terminals = new Map<string, pty.IPty>();
const terminalBuffers = new Map<string, string[]>();
const workingTerminalIds = new Set<string>();
const terminalWorkingClearTimers = new Map<string, NodeJS.Timeout>();
const activeTerminalsByWebContents = new Map<number, string>();
const TERMINAL_BUFFER_CHUNK_LIMIT = 1000;

const EXCLUDED_TREE_ENTRIES = new Set([
  ".git",
  "build",
  "dist",
  "node_modules",
  "out",
]);

const FILE_PREVIEW_MAX_BYTES = 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

type FilePreviewResult =
  | { status: "ok"; content: string }
  | { status: "binary" }
  | { status: "too-large"; maxBytes: number }
  | { status: "not-found" }
  | { status: "directory" }
  | { status: "unavailable"; message: string };

type ChangedFile = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  unstaged: boolean;
};

type BrokenStatus = {
  isBroken: boolean;
  reason?: string;
};

type WorkspaceTree = {
  id: string;
  name: string;
  worktreePath: string;
  branchName: string;
  status?: BrokenStatus;
};

type WorkspaceProject = {
  id: string;
  name: string;
  rootPath: string;
  slug: string;
  trees: WorkspaceTree[];
  status?: BrokenStatus;
};

type WorkspaceState = {
  version: 1;
  projects: WorkspaceProject[];
  activeProjectId: string | null;
  activeTreeId: string | null;
};

const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  version: 1,
  projects: [],
  activeProjectId: null,
  activeTreeId: null,
};

type ChangedFilesResult =
  | { status: "ok"; files: ChangedFile[] }
  | { status: "not-git" }
  | { status: "error"; message: string };

type ChangedFileDiffResult =
  | { status: "ok"; patch: string }
  | { status: "not-git" }
  | { status: "not-found" }
  | { status: "error"; message: string };

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function hasBinaryBytes(buffer: Buffer): boolean {
  const bytesToCheck = Math.min(buffer.length, 8000);

  for (let index = 0; index < bytesToCheck; index += 1) {
    if (buffer[index] === 0) return true;
  }

  return false;
}

function mapGitStatus(code: string): ChangedFile["status"] {
  if (code === "R" || code === "C") return "renamed";
  if (code === "D") return "deleted";
  if (code === "A") return "added";
  if (code === "?") return "untracked";
  return "modified";
}

function parseGitStatus(output: string): ChangedFile[] {
  const records = output.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const xy = record.slice(0, 2);
    const path = record.slice(3);
    const statusCode = xy.includes("?") ? "?" : xy.replaceAll(" ", "")[0];
    const file: ChangedFile = {
      path,
      status: mapGitStatus(statusCode ?? "M"),
      staged: xy[0] !== " " && xy[0] !== "?",
      unstaged: xy[1] !== " ",
    };

    if (file.status === "renamed") {
      file.oldPath = records[index + 1];
      index += 1;
    }

    files.push(file);
  }

  return files;
}

async function collectGitChanges(
  rootPath: string,
): Promise<ChangedFilesResult> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: rootPath, maxBuffer: 10 * 1024 * 1024 },
    );

    return { status: "ok", files: parseGitStatus(stdout) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git failed.";
    if (message.includes("not a git repository")) return { status: "not-git" };
    return { status: "error", message };
  }
}

async function getGitDiff(
  rootPath: string,
  filePath: string,
): Promise<ChangedFileDiffResult> {
  const changes = await collectGitChanges(rootPath);
  if (changes.status !== "ok") return changes;

  const change = changes.files.find(
    (file) => file.path === filePath || file.oldPath === filePath,
  );
  if (!change) return { status: "not-found" };

  const args =
    change.status === "untracked"
      ? [
          "diff",
          "--no-index",
          "--",
          os.platform() === "win32" ? "NUL" : "/dev/null",
          change.path,
        ]
      : ["diff", "HEAD", "--", change.oldPath ?? change.path, change.path];

  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: rootPath,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { status: "ok", patch: stdout };
  } catch (error) {
    const maybeExecError = error as { stdout?: string; message?: string };
    if (maybeExecError.stdout) {
      return { status: "ok", patch: maybeExecError.stdout };
    }
    const message = maybeExecError.message ?? "Unable to load diff.";
    if (message.includes("not a git repository")) return { status: "not-git" };
    return { status: "error", message };
  }
}

async function collectProjectPaths(rootPath: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (EXCLUDED_TREE_ENTRIES.has(entry.name)) continue;

      const absolutePath = join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        paths.push(relative(rootPath, absolutePath).split(sep).join("/"));
      }
    }
  }

  await walk(rootPath);

  return paths.sort((a, b) => a.localeCompare(b));
}

function getShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "powershell.exe";
  }

  return (
    process.env.SHELL ??
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
  );
}

function emitTerminalStatusChanged(
  terminalId: string,
  isWorking: boolean,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("terminal:status-changed", {
        terminalId,
        isWorking,
      });
    }
  }
}

function setTerminalWorking(terminalId: string, isWorking: boolean): void {
  const clearTimer = terminalWorkingClearTimers.get(terminalId);
  if (clearTimer) {
    clearTimeout(clearTimer);
    terminalWorkingClearTimers.delete(terminalId);
  }

  const wasWorking = workingTerminalIds.has(terminalId);
  if (wasWorking === isWorking) return;

  if (isWorking) workingTerminalIds.add(terminalId);
  else workingTerminalIds.delete(terminalId);

  emitTerminalStatusChanged(terminalId, isWorking);
}

function scheduleTerminalWorkingClear(terminalId: string): void {
  if (!workingTerminalIds.has(terminalId)) return;
  if (terminalWorkingClearTimers.has(terminalId)) return;

  // Pi redraws its status line while response output streams, which can make
  // `Working...` briefly disappear. Delay clearing the status so the tree icon
  // does not flicker during those transient redraws.
  terminalWorkingClearTimers.set(
    terminalId,
    setTimeout(() => {
      terminalWorkingClearTimers.delete(terminalId);
      setTerminalWorking(terminalId, false);
    }, 1000),
  );
}

function stripAnsiControlSequences(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function updateTerminalWorkingStatusFromData(
  terminalId: string,
  data: string,
): void {
  const text = stripAnsiControlSequences(data);

  if (text.includes("Working...")) {
    setTerminalWorking(terminalId, true);
    return;
  }

  scheduleTerminalWorkingClear(terminalId);
}

function cleanupTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId);

  if (terminal) {
    terminal.kill();
    terminals.delete(terminalId);
  }

  terminalBuffers.delete(terminalId);
  setTerminalWorking(terminalId, false);
}

function cleanupWebContentsTerminals(webContentsId: number): void {
  activeTerminalsByWebContents.delete(webContentsId);

  for (const terminalId of terminals.keys()) {
    cleanupTerminal(terminalId);
  }
}

function normalizeTerminalDimension(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function getWorkspaceStatePath(): string {
  return join(app.getPath("userData"), "workspace-state.json");
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function projectId(rootPath: string): string {
  return `project-${hashId(rootPath)}`;
}

function treeId(rootPath: string, treeName: string): string {
  return `tree-${hashId(`${rootPath}:${treeName}`)}`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

function normalizeWorkspaceState(value: unknown): WorkspaceState {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_WORKSPACE_STATE;
  }

  const legacy = value as {
    openProjectPaths?: unknown;
    activeProjectPath?: unknown;
  };
  if (Array.isArray(legacy.openProjectPaths)) {
    const projects = legacy.openProjectPaths
      .filter(
        (path): path is string => typeof path === "string" && path.length > 0,
      )
      .map((rootPath) => ({
        id: projectId(rootPath),
        name: rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath,
        rootPath,
        slug: slugify(
          rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath,
        ),
        trees: [],
      }));
    const activeProject =
      projects.find(
        (project) => project.rootPath === legacy.activeProjectPath,
      ) ?? projects[0];
    return {
      version: 1,
      projects,
      activeProjectId: activeProject?.id ?? null,
      activeTreeId: null,
    };
  }

  const maybeState = value as {
    projects?: unknown;
    activeProjectId?: unknown;
    activeTreeId?: unknown;
  };
  const projects = Array.isArray(maybeState.projects)
    ? maybeState.projects.flatMap((project): WorkspaceProject[] => {
        if (typeof project !== "object" || project === null) return [];
        const candidate = project as Partial<WorkspaceProject>;
        if (
          typeof candidate.rootPath !== "string" ||
          candidate.rootPath.length === 0
        )
          return [];
        const rootPath = candidate.rootPath;
        const name =
          typeof candidate.name === "string" && candidate.name.length > 0
            ? candidate.name
            : (rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath);
        const id = projectId(rootPath);
        const trees = Array.isArray(candidate.trees)
          ? candidate.trees.flatMap((tree): WorkspaceTree[] => {
              if (typeof tree !== "object" || tree === null) return [];
              const treeCandidate = tree as Partial<WorkspaceTree>;
              if (
                typeof treeCandidate.name !== "string" ||
                typeof treeCandidate.worktreePath !== "string" ||
                typeof treeCandidate.branchName !== "string"
              )
                return [];
              return [
                {
                  id: treeId(rootPath, treeCandidate.name),
                  name: treeCandidate.name,
                  worktreePath: treeCandidate.worktreePath,
                  branchName: treeCandidate.branchName,
                },
              ];
            })
          : [];
        return [
          {
            id,
            name,
            rootPath,
            slug:
              typeof candidate.slug === "string"
                ? candidate.slug
                : slugify(name),
            trees,
          },
        ];
      })
    : [];
  const activeProject =
    projects.find((project) => project.id === maybeState.activeProjectId) ??
    projects[0];
  const activeTree =
    activeProject?.trees.find((tree) => tree.id === maybeState.activeTreeId) ??
    activeProject?.trees[0];

  return {
    version: 1,
    projects,
    activeProjectId: activeProject?.id ?? null,
    activeTreeId: activeTree?.id ?? null,
  };
}

async function projectBrokenReason(rootPath: string): Promise<string | null> {
  try {
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) return "Project path is not a directory.";
    await git(["rev-parse", "--show-toplevel"], rootPath);
    return null;
  } catch {
    return "Project path is missing or is no longer a Git repository.";
  }
}

async function listRegisteredWorktrees(rootPath: string): Promise<Set<string>> {
  const output = await git(["worktree", "list", "--porcelain"], rootPath);
  const paths = output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));

  return new Set(paths);
}

async function treeBrokenReason(
  tree: WorkspaceTree,
  registeredWorktrees: Set<string> | null,
): Promise<string | null> {
  if (!registeredWorktrees) return "Project Git worktrees are unavailable.";

  try {
    const treeStat = await stat(tree.worktreePath);
    if (!treeStat.isDirectory()) return "Tree path is not a directory.";
    const realWorktreePath = resolve(await realpath(tree.worktreePath));
    if (
      !registeredWorktrees.has(realWorktreePath) &&
      !registeredWorktrees.has(resolve(tree.worktreePath))
    ) {
      return "Tree is no longer registered as a Git worktree.";
    }
    return null;
  } catch {
    return "Tree directory is missing.";
  }
}

async function hydrateWorkspaceStatus(
  state: WorkspaceState,
): Promise<WorkspaceState> {
  const projects = await Promise.all(
    state.projects.map(async (project): Promise<WorkspaceProject> => {
      const projectReason = await projectBrokenReason(project.rootPath);
      let registeredWorktrees: Set<string> | null = null;

      if (!projectReason) {
        try {
          registeredWorktrees = await listRegisteredWorktrees(project.rootPath);
        } catch {
          registeredWorktrees = null;
        }
      }

      const trees = await Promise.all(
        project.trees.map(async (tree): Promise<WorkspaceTree> => {
          const reason = await treeBrokenReason(tree, registeredWorktrees);
          return {
            ...tree,
            status: reason ? { isBroken: true, reason } : { isBroken: false },
          };
        }),
      );

      return {
        ...project,
        trees,
        status: projectReason
          ? { isBroken: true, reason: projectReason }
          : { isBroken: false },
      };
    }),
  );

  return { ...state, projects };
}

async function loadWorkspaceState(): Promise<WorkspaceState> {
  try {
    const content = await readFile(getWorkspaceStatePath(), "utf8");
    return hydrateWorkspaceStatus(normalizeWorkspaceState(JSON.parse(content)));
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT")
    ) {
      return DEFAULT_WORKSPACE_STATE;
    }

    throw error;
  }
}

async function saveWorkspaceState(state: unknown): Promise<void> {
  const normalizedState = normalizeWorkspaceState(state);
  const workspaceStatePath = getWorkspaceStatePath();

  await mkdir(dirname(workspaceStatePath), { recursive: true });
  await writeFile(
    workspaceStatePath,
    `${JSON.stringify(normalizedState, null, 2)}\n`,
    "utf8",
  );
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function getGitTopLevel(selectedPath: string): Promise<string> {
  try {
    const topLevel = await git(["rev-parse", "--show-toplevel"], selectedPath);
    return await realpath(topLevel);
  } catch {
    throw new Error(
      "Canopy projects must be Git repositories. Choose a folder inside a Git repository.",
    );
  }
}

async function resolveWorktreeBase(rootPath: string): Promise<string> {
  try {
    await git(["fetch", "origin", "--prune"], rootPath);
    try {
      await git(["remote", "set-head", "origin", "--auto"], rootPath);
    } catch {}
    return await git(["rev-parse", "--verify", "origin/HEAD"], rootPath);
  } catch {
    return "HEAD";
  }
}

async function listBranches(rootPath: string): Promise<Set<string>> {
  try {
    const output = await git(
      ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
      rootPath,
    );
    const branches = new Set<string>();
    for (const ref of output.split("\n").filter(Boolean)) {
      if (ref.startsWith("refs/heads/")) {
        branches.add(ref.slice("refs/heads/".length));
        continue;
      }

      if (ref.startsWith("refs/remotes/")) {
        const remoteBranch = ref.slice("refs/remotes/".length);
        const separatorIndex = remoteBranch.indexOf("/");
        if (separatorIndex === -1) continue;

        const branch = remoteBranch.slice(separatorIndex + 1);
        if (branch !== "HEAD") branches.add(branch);
      }
    }
    return branches;
  } catch {
    return new Set();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function allocateTreeName(project: WorkspaceProject): Promise<string> {
  const existingNames = new Set(project.trees.map((tree) => tree.name));
  const existingPaths = new Set(project.trees.map((tree) => tree.worktreePath));
  const branches = await listBranches(project.rootPath);
  const projectWorkspacePath = join(
    os.homedir(),
    "canopy",
    "workspaces",
    project.slug,
  );
  const candidates = [...TREE_NAMES].sort(() => Math.random() - 0.5);
  const isAvailable = async (name: string): Promise<boolean> => {
    const worktreePath = join(projectWorkspacePath, name);
    return (
      !existingNames.has(name) &&
      !existingPaths.has(worktreePath) &&
      !(await pathExists(worktreePath)) &&
      !branches.has(name)
    );
  };

  for (const candidate of candidates) {
    if (await isAvailable(candidate)) return candidate;
  }

  for (const candidate of candidates) {
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const name = `${candidate}-${suffix}`;
      if (await isAvailable(name)) return name;
    }
  }

  throw new Error("Unable to allocate a unique tree name.");
}

function allocateProjectSlug(
  rootPath: string,
  existingProjects: WorkspaceProject[],
): string {
  const base = slugify(
    rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath,
  );
  const collision = existingProjects.some(
    (project) => project.slug === base && project.rootPath !== rootPath,
  );
  return collision ? `${base}-${hashId(rootPath).slice(0, 6)}` : base;
}

async function createInitialTree(
  project: WorkspaceProject,
): Promise<WorkspaceTree> {
  const name = await allocateTreeName(project);
  const worktreePath = join(
    os.homedir(),
    "canopy",
    "workspaces",
    project.slug,
    name,
  );
  await mkdir(dirname(worktreePath), { recursive: true });
  const base = await resolveWorktreeBase(project.rootPath);
  await git(
    ["worktree", "add", "-b", name, worktreePath, base],
    project.rootPath,
  );
  return {
    id: treeId(project.rootPath, name),
    name,
    worktreePath,
    branchName: name,
  };
}

async function createTreeForProject(
  projectIdToUpdate: string,
): Promise<WorkspaceState> {
  const state = await loadWorkspaceState();
  const project = state.projects.find(
    (candidate) => candidate.id === projectIdToUpdate,
  );

  if (!project) throw new Error("Project is no longer open.");

  const tree = await createInitialTree(project);
  project.trees.push(tree);
  state.activeProjectId = project.id;
  state.activeTreeId = tree.id;
  await saveWorkspaceState(state);
  return state;
}

async function deleteTreeFromProject(
  projectIdToUpdate: string,
  treeIdToDelete: string,
): Promise<WorkspaceState> {
  const state = await loadWorkspaceState();
  const project = state.projects.find(
    (candidate) => candidate.id === projectIdToUpdate,
  );

  if (!project) throw new Error("Project is no longer open.");

  const treeIndex = project.trees.findIndex(
    (candidate) => candidate.id === treeIdToDelete,
  );
  if (treeIndex < 0) throw new Error("Tree is no longer open.");

  const [tree] = project.trees.splice(treeIndex, 1);

  try {
    await git(
      ["worktree", "remove", "--force", tree.worktreePath],
      project.rootPath,
    );
  } catch {}
  try {
    await git(["branch", "-D", tree.branchName], project.rootPath);
  } catch {}

  cleanupTerminal(tree.worktreePath);

  if (state.activeProjectId === project.id && state.activeTreeId === tree.id) {
    state.activeProjectId = project.id;
    state.activeTreeId = project.trees[0]?.id ?? null;
  }

  if (state.activeTreeId === tree.id) state.activeTreeId = null;

  try {
    await rmdir(join(os.homedir(), "canopy", "workspaces", project.slug));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    ) {
      throw error;
    }
  }

  await saveWorkspaceState(state);
  return state;
}

async function removeProjectFromWorkspace(
  projectIdToRemove: string,
): Promise<WorkspaceState> {
  const state = await loadWorkspaceState();
  const projectIndex = state.projects.findIndex(
    (candidate) => candidate.id === projectIdToRemove,
  );

  if (projectIndex < 0) throw new Error("Project is no longer open.");

  const project = state.projects[projectIndex];
  const projectReason = await projectBrokenReason(project.rootPath);
  if (project.trees.length > 0 && !projectReason) {
    throw new Error(
      `Remove all trees from ${project.name} before removing the project from Canopy.`,
    );
  }

  for (const tree of project.trees) cleanupTerminal(tree.worktreePath);

  state.projects.splice(projectIndex, 1);

  if (state.activeProjectId === project.id) {
    const nextProject =
      state.projects[projectIndex] ?? state.projects[projectIndex - 1] ?? null;
    state.activeProjectId = nextProject?.id ?? null;
    state.activeTreeId = nextProject?.trees[0]?.id ?? null;
  } else if (
    !state.projects.some((candidate) => candidate.id === state.activeProjectId)
  ) {
    const nextProject = state.projects[0] ?? null;
    state.activeProjectId = nextProject?.id ?? null;
    state.activeTreeId = nextProject?.trees[0]?.id ?? null;
  }

  if (
    state.activeTreeId &&
    !state.projects.some((candidate) =>
      candidate.trees.some((tree) => tree.id === state.activeTreeId),
    )
  ) {
    state.activeTreeId = null;
  }

  await saveWorkspaceState(state);
  return state;
}

async function openProjectFromPath(
  selectedPath: string,
): Promise<WorkspaceState> {
  const rootPath = await getGitTopLevel(selectedPath);
  const state = await loadWorkspaceState();
  const existingProject = state.projects.find(
    (project) => project.rootPath === rootPath,
  );
  if (existingProject) {
    const tree =
      existingProject.trees[0] ?? (await createInitialTree(existingProject));
    if (existingProject.trees.length === 0) existingProject.trees.push(tree);

    state.activeProjectId = existingProject.id;
    state.activeTreeId = tree.id;
    await saveWorkspaceState(state);
    return state;
  }

  const project: WorkspaceProject = {
    id: projectId(rootPath),
    name: rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath,
    rootPath,
    slug: allocateProjectSlug(rootPath, state.projects),
    trees: [],
  };
  const tree = await createInitialTree(project);
  project.trees.push(tree);
  state.projects.push(project);
  state.activeProjectId = project.id;
  state.activeTreeId = tree.id;
  await saveWorkspaceState(state);
  return state;
}

function validateSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false;

  const trustedUrls = [
    ...(is.dev && process.env.ELECTRON_RENDERER_URL
      ? [new URL(process.env.ELECTRON_RENDERER_URL)]
      : []),
    pathToFileURL(join(__dirname, "../renderer/index.html")),
  ];

  try {
    const senderUrl = new URL(frame.url);

    return trustedUrls.some((trustedUrl) => {
      if (senderUrl.protocol !== trustedUrl.protocol) return false;

      if (senderUrl.protocol === "file:") {
        return senderUrl.href === trustedUrl.href;
      }

      return senderUrl.origin === trustedUrl.origin;
    });
  } catch {
    return false;
  }
}

function registerProjectIpc(): void {
  ipcMain.handle("workspace:load", async (event): Promise<WorkspaceState> => {
    if (!validateSender(event.senderFrame)) return DEFAULT_WORKSPACE_STATE;

    return loadWorkspaceState();
  });

  ipcMain.handle("workspace:save", async (event, state?: unknown) => {
    if (!validateSender(event.senderFrame)) return;

    await saveWorkspaceState(state);
  });

  ipcMain.handle("project:open", async (event) => {
    if (!validateSender(event.senderFrame)) return null;

    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Open project",
      properties: ["openDirectory" as const],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) return null;

    const selectedPath = result.filePaths[0];
    return selectedPath ? openProjectFromPath(selectedPath) : null;
  });

  ipcMain.handle(
    "project:create-tree",
    async (event, projectIdToUpdate?: unknown) => {
      if (!validateSender(event.senderFrame)) return DEFAULT_WORKSPACE_STATE;
      if (
        typeof projectIdToUpdate !== "string" ||
        projectIdToUpdate.length === 0
      ) {
        throw new Error("Choose a project before creating a tree.");
      }

      return createTreeForProject(projectIdToUpdate);
    },
  );

  ipcMain.handle(
    "project:delete-tree",
    async (event, projectIdToUpdate?: unknown, treeIdToDelete?: unknown) => {
      if (!validateSender(event.senderFrame)) return DEFAULT_WORKSPACE_STATE;
      if (
        typeof projectIdToUpdate !== "string" ||
        projectIdToUpdate.length === 0 ||
        typeof treeIdToDelete !== "string" ||
        treeIdToDelete.length === 0
      ) {
        throw new Error("Choose a tree before deleting it.");
      }

      return deleteTreeFromProject(projectIdToUpdate, treeIdToDelete);
    },
  );

  ipcMain.handle(
    "project:remove",
    async (event, projectIdToRemove?: unknown) => {
      if (!validateSender(event.senderFrame)) return DEFAULT_WORKSPACE_STATE;
      if (
        typeof projectIdToRemove !== "string" ||
        projectIdToRemove.length === 0
      ) {
        throw new Error("Choose a project before removing it.");
      }

      return removeProjectFromWorkspace(projectIdToRemove);
    },
  );
}

function registerFileTreeIpc(): void {
  ipcMain.handle("file-tree:list", async (event, rootPath?: unknown) => {
    if (!validateSender(event.senderFrame)) return [];
    if (typeof rootPath !== "string" || rootPath.length === 0) return [];

    return collectProjectPaths(rootPath);
  });

  ipcMain.handle(
    "file-tree:preview",
    async (
      event,
      options?: { rootPath?: unknown; filePath?: unknown },
    ): Promise<FilePreviewResult> => {
      if (!validateSender(event.senderFrame)) return { status: "not-found" };
      if (
        typeof options?.rootPath !== "string" ||
        options.rootPath.length === 0 ||
        typeof options.filePath !== "string" ||
        options.filePath.length === 0
      ) {
        return { status: "not-found" };
      }

      const rootPath = resolve(options.rootPath);
      const absoluteFilePath = resolve(rootPath, options.filePath);

      if (!isPathInsideRoot(rootPath, absoluteFilePath)) {
        return { status: "not-found" };
      }

      try {
        const [realRootPath, realFilePath] = await Promise.all([
          realpath(rootPath),
          realpath(absoluteFilePath),
        ]);

        if (!isPathInsideRoot(realRootPath, realFilePath)) {
          return { status: "not-found" };
        }

        const fileStat = await stat(realFilePath);

        if (fileStat.isDirectory()) return { status: "directory" };
        if (!fileStat.isFile()) return { status: "not-found" };
        if (fileStat.size > FILE_PREVIEW_MAX_BYTES) {
          return { status: "too-large", maxBytes: FILE_PREVIEW_MAX_BYTES };
        }

        const extensionStart = options.filePath.lastIndexOf(".");
        const extension =
          extensionStart >= 0
            ? options.filePath.toLowerCase().slice(extensionStart)
            : "";

        if (IMAGE_EXTENSIONS.has(extension)) return { status: "binary" };

        const contentBuffer = await readFile(realFilePath);

        if (hasBinaryBytes(contentBuffer)) return { status: "binary" };

        return { status: "ok", content: contentBuffer.toString("utf8") };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return { status: "not-found" };
        }

        return { status: "unavailable", message: "File is unavailable." };
      }
    },
  );
}

function registerGitChangesIpc(): void {
  ipcMain.handle("git-changes:list", async (event, rootPath?: unknown) => {
    if (!validateSender(event.senderFrame))
      return {
        status: "error",
        message: "Unauthorized",
      } satisfies ChangedFilesResult;
    if (typeof rootPath !== "string" || rootPath.length === 0)
      return { status: "not-git" } satisfies ChangedFilesResult;

    return collectGitChanges(rootPath);
  });

  ipcMain.handle(
    "git-changes:diff",
    async (event, options?: { rootPath?: unknown; filePath?: unknown }) => {
      if (!validateSender(event.senderFrame))
        return {
          status: "error",
          message: "Unauthorized",
        } satisfies ChangedFileDiffResult;
      if (
        typeof options?.rootPath !== "string" ||
        options.rootPath.length === 0 ||
        typeof options.filePath !== "string" ||
        options.filePath.length === 0
      ) {
        return { status: "not-found" } satisfies ChangedFileDiffResult;
      }

      return getGitDiff(options.rootPath, options.filePath);
    },
  );
}

function registerTerminalIpc(): void {
  ipcMain.handle(
    "terminal:start",
    (event, options?: { cols?: unknown; rows?: unknown; cwd?: unknown }) => {
      if (!validateSender(event.senderFrame)) return;

      const webContentsId = event.sender.id;
      const terminalId =
        typeof options?.cwd === "string" && options.cwd.length > 0
          ? options.cwd
          : os.homedir();

      activeTerminalsByWebContents.set(webContentsId, terminalId);

      const existingTerminal = terminals.get(terminalId);
      if (existingTerminal) {
        existingTerminal.resize(
          normalizeTerminalDimension(options?.cols, existingTerminal.cols),
          normalizeTerminalDimension(options?.rows, existingTerminal.rows),
        );
        for (const data of terminalBuffers.get(terminalId) ?? []) {
          if (event.sender.isDestroyed()) break;
          event.sender.send("terminal:data", data);
        }
        event.sender.send("terminal:status-changed", {
          terminalId,
          isWorking: workingTerminalIds.has(terminalId),
        });
        return;
      }

      const shellPath = getShell();
      const terminal = pty.spawn(shellPath, [], {
        name: "xterm-256color",
        cols: normalizeTerminalDimension(options?.cols, 80),
        rows: normalizeTerminalDimension(options?.rows, 24),
        cwd: terminalId,
        env: process.env,
      });

      terminals.set(terminalId, terminal);
      terminalBuffers.set(terminalId, []);

      terminal.onData((data) => {
        updateTerminalWorkingStatusFromData(terminalId, data);
        const buffer = terminalBuffers.get(terminalId) ?? [];
        buffer.push(data);
        if (buffer.length > TERMINAL_BUFFER_CHUNK_LIMIT) buffer.shift();
        terminalBuffers.set(terminalId, buffer);
        if (
          !event.sender.isDestroyed() &&
          activeTerminalsByWebContents.get(webContentsId) === terminalId
        ) {
          event.sender.send("terminal:data", data);
        }
      });

      terminal.onExit(({ exitCode, signal }) => {
        terminals.delete(terminalId);
        terminalBuffers.delete(terminalId);
        setTerminalWorking(terminalId, false);

        if (!event.sender.isDestroyed()) {
          event.sender.send("terminal:exit", { terminalId, exitCode, signal });
        }
      });
    },
  );

  ipcMain.on(
    "terminal:write",
    (event, options?: { terminalId?: unknown; data?: unknown }) => {
      if (!validateSender(event.senderFrame)) return;
      if (
        typeof options?.terminalId !== "string" ||
        typeof options.data !== "string"
      ) {
        return;
      }

      terminals.get(options.terminalId)?.write(options.data);
    },
  );

  ipcMain.on(
    "terminal:resize",
    (
      event,
      size?: { terminalId?: unknown; cols?: unknown; rows?: unknown },
    ) => {
      if (!validateSender(event.senderFrame)) return;
      if (typeof size?.terminalId !== "string") return;

      const terminal = terminals.get(size.terminalId);

      if (!terminal) return;

      const cols = normalizeTerminalDimension(size.cols, terminal.cols);
      const rows = normalizeTerminalDimension(size.rows, terminal.rows);

      terminal.resize(cols, rows);
    },
  );

  ipcMain.on("terminal:dispose", (event, terminalId?: unknown) => {
    if (!validateSender(event.senderFrame)) return;
    if (typeof terminalId !== "string") return;

    cleanupTerminal(terminalId);
  });
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  const mainWindowWebContentsId = mainWindow.webContents.id;

  mainWindow.on("closed", () => {
    cleanupWebContentsTerminals(mainWindowWebContentsId);
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerProjectIpc();
  registerFileTreeIpc();
  registerGitChangesIpc();
  registerTerminalIpc();

  createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
