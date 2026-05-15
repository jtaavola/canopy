# Issue Tracker

Issues for this repo are tracked in Linear.

Use the installed `linear` CLI to create and manage issues directly.

## Defaults

- Team: JTA, already configured via environment variable
- Label: `canopy`

When creating issues, assign them to the JTA team and apply the `canopy` label.

## Workflow

Skills that create or update issues (`to-issues`, `triage`, `to-prd`, and related workflows) should use Linear directly rather than drafting markdown files or GitHub issues.

If the Linear CLI command syntax is unclear, inspect `linear --help` before taking action.

## Helpful commands

Create an issue non-interactively. Prefer `--description-file` for markdown bodies so quoting does not get mangled:

```sh
linear issue create \
  --team JTA \
  --title "Example issue title" \
  --description-file /tmp/canopy-issue.md \
  --label label-1 \
  --label label-2 \
  --label label-3 \
  --no-interactive
```

Start work on an issue. This creates/switches to a branch and moves the issue to In Progress:

```sh
linear issue start JTA-20
```
