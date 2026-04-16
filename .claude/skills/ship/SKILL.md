---
name: ship
description: Finalize dev work on an issue branch — update docs, squash commits, push, and open a PR.
argument-hint: "<issue-number>"
allowed-tools: Agent Bash(git *) Bash(gh *) Bash(cd *) Bash(cat *) Bash(ls *) Bash(wc *) Read Edit Write Grep Glob
---

# Ship Issue

Finalize development work on a feature branch: update documentation, squash commits, push, and submit a pull request.

## Input

`$ARGUMENTS` must be a GitHub issue number (e.g. `78`). If missing or non-numeric, ask the user for the issue number.

## Step 1: Verify Branch State

Confirm that you are on a feature branch (not `main`). If on `main`, abort and tell the user to switch to the feature branch first.

Run `git log main..HEAD --oneline` to see all commits on this branch. There must be at least one commit. Display the commit list to the user.

Run `git status` to confirm the working tree is clean. If there are uncommitted changes, warn the user and ask how to proceed.

## Step 2: Fetch Issue Details

Run `gh issue view $ARGUMENTS --json title,body,labels,number` to get the issue title and number.

Also check if a matching markdown file exists under `tmp/issues/` by looking for files that start with a zero-padded version of the issue number (e.g. issue 78 maps to a file starting with `078-`). If the file exists, read it to understand the requirements for documentation updates.

## Step 3: Update Documentation

Search for all `SPECIFICATIONS.md` files in the repository using Glob (`**/SPECIFICATIONS.md`). Update each relevant file with the latest design decisions from this branch's changes. Use `git diff main..HEAD` to understand what changed.

Search for all `README.md` files in the repository using Glob (`**/README.md`). Update each relevant file with the latest implementation details. **Ensure no sensitive or account-specific information is included** — no ARNs, account IDs, tokens, secrets, or endpoint URLs.

## Step 4: Commit Documentation Updates

Stage and commit all documentation changes:

```
git add -A
git commit -m "docs: update specifications and readme for issue #$ARGUMENTS

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Step 5: Squash Commits

The goal is to end up with exactly **two commits** on the branch:

1. The **first commit** — the original commit from the agent team (preserved as-is).
2. A **squashed commit** — all subsequent commits combined into one.

Determine the first commit on the branch:

```
FIRST_COMMIT=$(git log main..HEAD --reverse --format="%H" | head -1)
```

If there are only 1 or 2 commits total on the branch, skip squashing and inform the user.

If there are 3 or more commits, perform an interactive-free squash:

1. Get the hash of the second commit: `SECOND_COMMIT=$(git log main..HEAD --reverse --format="%H" | sed -n '2p')`
2. Soft reset to the second commit: `git reset --soft $SECOND_COMMIT`
3. Amend the second commit with all squashed changes and a descriptive message:

```
git commit --amend -m "$(cat <<'EOF'
feat: implement issue #$ARGUMENTS — <brief summary of all changes>

<bullet list summarizing the key changes from all squashed commits>

Closes #$ARGUMENTS

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

The squashed commit message should:
- Start with an appropriate semantic prefix (`feat:`, `fix:`, etc.)
- Include a brief summary of all the work done
- Include a bullet list of key changes derived from the squashed commit messages
- Include `Closes #<issue-number>` so the PR auto-closes the issue on merge
- End with the co-author trailer

Display the final two commits with `git log main..HEAD --oneline` for the user to review.

## Step 6: Push and Create Pull Request

Push the branch to the remote:

```
git push -u origin HEAD
```

Create a pull request using `gh pr create`. Derive the PR title and body from the issue and the work done:

```
gh pr create --title "<semantic-prefix>: <short description>" --body "$(cat <<'EOF'
## Summary
<2-4 bullet points describing what this PR does>

## Test Plan
<bullet list of how the changes were tested>

Closes #$ARGUMENTS

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

The PR body must include `Closes #<issue-number>` so the issue is automatically closed when the PR is merged.

Display the PR URL to the user.
