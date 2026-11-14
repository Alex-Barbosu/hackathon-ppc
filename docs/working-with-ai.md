# Working with AI agents on FileGrid

## Starting a session
Open Claude Code (or any agent) at the repo root. It loads the root `CLAUDE.md`, and the
zone `CLAUDE.md` of whatever folder it works in. First prompt:

> You work only in zone X (see CODEOWNERS). Read the root CLAUDE.md and your zone's
> CLAUDE.md. Take the top unfinished P0 item, build it against the contracts (use the
> mock at /mock where the other zone isn't ready), run `make up`, and open a small PR
> from a branch named `zone-x/<feature>`.

## Branches and PRs
- Branch: `zone-a/…`, `zone-b/…`, `zone-c/…`. PR to `main` every 1–2 hours.
- The PR description names the requirement it proves (e.g. "NFR resilience: retries never duplicate").
- CI must be green: zone guard, contracts lint, gitleaks, builds, and the `make up` stack check.

## Changing a contract
1. Branch `contracts/<change>`; edit only files in `contracts/` (and `config/policy.yaml` if the schema changed).
2. Open the PR with the `contracts` label; all three approve.
3. After merge: `make gen`, then each zone implements its side in its own PR.

## Shared files that are frozen
`compose.yml` (include list only) and `CODEOWNERS`. A new service = a new folder with its
own `compose.yml`, added to the include list in a `base`-labelled PR.
