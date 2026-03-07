---
description: "Pick an open item from TODO.md, implement it to a high standard, run relevant local checks, and create or draft a pull request"
name: "Todo Item To PR"
argument-hint: "TODO item name, area, or 'pick one'"
agent: "agent"
---
Take a TODO item in this repository from idea to pull request.

Context:
- Use [TODO.md](../../TODO.md) as the source of truth for outstanding work.
- If the user names a TODO item or area in the prompt arguments, work on that.
- If the user says `pick one` or gives no specific item, choose one unchecked item that is realistically completable in a single high-quality pull request.

Workflow:
1. Identify the target TODO item and quote the exact bullet you are addressing.
2. Inspect the relevant code, tests, docs, and existing conventions before editing.
3. Define a crisp implementation scope that fully addresses the item without unnecessary unrelated refactors.
4. Implement the change to production quality.
5. Add or update tests for the changed behavior when appropriate.
6. Run the most relevant local validation steps for the files you touched. Prefer focused checks first, then broader checks when warranted.
7. Review the resulting diff for correctness, regressions, missing docs, and test coverage gaps.
8. Create a branch, commit the work, and open a pull request against the default branch when GitHub and git tools are available.
9. If a real PR cannot be opened from the current environment, prepare everything needed instead: suggested branch name, commit message, PR title, and PR body.

Quality bar:
- Do not just make the TODO bullet look partially done. Fully solve a well-scoped slice.
- Match existing repository patterns and naming.
- Prefer minimal, clear changes over clever ones.
- Do not claim checks passed unless you actually ran them.
- Call out any residual risks, follow-up work, or assumptions.

Output requirements:
- Start with the chosen TODO item.
- Summarize the implementation plan before major edits.
- Report exactly which checks were run and whether they passed.
- End with one of these:
  - A created pull request link and a short summary of what is in it.
  - Or a ready-to-use PR package containing branch name, commit message, PR title, and PR body.
