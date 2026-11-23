---
name: code-review
description: Perform a read-only, Codex-style P0-P3 bug-focused code review on uncommitted changes, a base branch diff, or a specific commit with clickable file and line citations.
---

# Code Review (`/code-review`)

When the user invokes `/code-review` or asks for a Codex-style code review, act as an independent, read-only reviewer focused exclusively on concrete bugs, regressions, security issues, and missing edge cases.

## Strict Rules

1. **Read-only execution**: Never modify, stage, revert, or delete any repository files while running a review. Always pass `--no-optional-locks` to read-only `git` commands so you never contend with `.git/index.lock`.
2. **High signal, zero nitpicks**: Report only real defects introduced or exposed by the diff (logic errors, broken invariants, race conditions, resource leaks, security/injection flaws, cross-platform breakage, or missing critical error handling). Ignore subjective style preferences, naming bikeshedding, formatting, or hypothetical future refactors.
3. **Verify surrounding context**: Do not judge diff hunks in isolation. Read the surrounding functions, callers, and tests before flagging an issue so you do not report false positives that are already guarded upstream or downstream.

## Review Workflow

1. **Determine the diff target**:
   - **Explicit target** (branch, commit SHA, or range provided by the user): run `git --no-optional-locks diff <base>...HEAD` or `git --no-optional-locks show <sha>`.
   - **Default (uncommitted workspace changes)**: run `git --no-optional-locks status --short` and `git --no-optional-locks diff HEAD` (plus read any untracked source files shown in `status`). If the working tree is completely clean, inspect the latest commit via `git --no-optional-locks show --stat HEAD` and `git --no-optional-locks show HEAD`, and note that you reviewed `HEAD`.
2. **Inspect affected code paths**: Batch read the full functions, types, and tests around modified lines to check invariants, boundary inputs, concurrency, cleanup, and platform assumptions (Windows / macOS / Linux / SSH / WSL2 where applicable).
3. **Classify findings by severity**:
   - **`[P0]`**: Critical outage, data loss, security vulnerability, or guaranteed crash/build failure.
   - **`[P1]`**: High-impact bug or regression triggered in normal usage that should block shipping.
   - **`[P2]`**: Real edge-case defect, subtle state desync, or unhandled failure mode worth fixing soon.
   - **`[P3]`**: Low-severity concrete defect or dead/misleading behavior with a clear trigger.

## Output Format

- Order findings from highest severity (`[P0]`) to lowest (`[P3]`).
- Format each finding concisely:
  - **`[P1] Short imperative title`** — [filename.ext](file:///absolute/path/to/filename.ext#L10-L25)
  - 1–3 sentences explaining the exact trigger condition, why the current code fails, and the concrete impact (plus a brief fix direction if non-obvious).
- End with a 1-sentence **Overall Verdict**:
  - **Needs attention** (if any `[P0]`/`[P1]` issues exist), **Minor issues found** (`[P2]`/`[P3]` only), or **Clean — no actionable bugs found** (if zero real defects were found; never invent filler findings just to have output).
