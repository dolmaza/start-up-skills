---
name: git-workflow
description: >-
  Branch-and-PR discipline for work Claude does in your project: main is
  merge-only, every change lands on its own branch and ends in a pull request
  you review and merge. Covers the pre-flight tree guard, branch naming,
  checkpoint commits, the PR body, and graceful degradation when there is no
  remote or no gh. Use whenever a session is about to write, commit, or push.
---

# Git Workflow — main is merge-only

Main receives changes **only through merged pull requests**. Claude never
commits to main, never pushes main, and never merges its own PR — you review
and merge.

## Before writing anything

1. **Guard the tree.** `git status` — if the working tree is dirty with
   unrelated changes, stop and ask; never sweep foreign edits into a branch.
   If the current branch is someone else's work, ask before reusing it.
2. **Start from fresh main.** `git checkout main && git pull` (skip the pull
   when there is no remote yet), then cut a branch named by intent:
   `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `perf/<target>`.
3. **Resuming** unfinished work → reuse its branch, merging or rebasing main
   first if it has moved.

## While building

- Commit at logical checkpoints — per layer landed, per component finished —
  with conventional messages: `feat(orders): place-order handler`,
  `test(orders): handler unit tests`, `chore(scaffold): solution layout`.
- Never one giant end-of-run commit, and never deliberately commit a red
  build: checkpoint commits should compile.

## Finishing — every run, clean or blocked

1. Push the branch: `git push -u origin <branch>`.
2. Raise the PR with `gh pr create`, base = the default branch. The body says
   what was built, what was verified (build, tests, lint), and anything left
   undone with the reason.
   - Gates green → a ready PR.
   - Stopped early or a gate is red → a **draft** PR whose body leads with
     what is unmet and what would unblock it; the next run reuses the branch
     and flips it with `gh pr ready` when green.
3. Report the PR URL and stop. Merging is yours.

## Degradation

- **No remote** → create the branch and commits locally, and say that a remote
  is needed for pushes and PRs.
- **No `gh` / not authenticated** → push the branch and print the repo's
  compare URL for a manual PR; suggest `gh auth login`.

## Branch protection

When a GitHub remote exists, protecting the default branch makes this
enforceable rather than merely agreed: require a pull request before merging,
block direct pushes, and — once CI exists — require the CI check. Offer it;
never change repo settings without an explicit yes.
