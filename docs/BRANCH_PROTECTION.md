# Master Branch Protection

`master` is the release branch. **Current repository workflow:** branch protection is disabled for the single-maintainer project; focused changes may be committed and pushed directly to `master` after the relevant checks pass. This document is an opt-in runbook for re-enabling or auditing GitHub protection, not a requirement for the current workflow.

If protection is re-enabled, changes must enter through a pull request after the validation checks below succeed, and the release checklist must be interpreted against the observed repository state.

## Required checks

Require these exact GitHub Actions check contexts:

- `quality`
- `integration`
- `docker (linux/amd64)`
- `docker (linux/arm64)`

Also require the branch to be up to date before merge, enforce the policy for administrators, and prohibit force pushes and branch deletion. For a single-maintainer repository, approving reviews may remain optional, but pull requests and the required checks are not optional.

## Re-enable or audit

Change GitHub settings only with explicit repository-admin authorization. The configuration above is a reference; inspect the live repository before acting.

1. Inspect `master` protection and applicable repository/organization rulesets. Authentication, permission, or network failures do not prove that the branch is unprotected.
2. Save the previous configuration privately, including required check providers, bypass actors, and restrictions. Prepare a way to restore it before changing settings. Do not commit credentials or private evidence.
3. Confirm the check names against [CI](../.github/workflows/ci.yml) and an actual `master` run. Bind required checks to their GitHub Actions provider. Stop on ambiguous providers or conflicting rulesets.
4. Apply the required checks, up-to-date requirement, administrator enforcement, and force-push/deletion restrictions above. Require pull requests without bypass actors; approving reviews may remain optional for a single maintainer. Leave unrelated settings unchanged.
5. Read back the target and compare every changed setting, including check providers and bypass allowances. Confirm with a test pull request that pending or failing required checks prevent merging. A successful settings write alone is not verification.

Rulesets are separate from branch protection; changing them requires its own reviewed scope. This reference does not authorize enabling protection or changing rulesets.

## Rollback

Restore the saved configuration and verify it by reading the target again. If protection was previously disabled, remove only the protection added by this operation; preserve pre-existing rulesets and unrelated settings. Do not treat a failed read as successful rollback.

Keep the existing direct-to-`master` workflow until a protection change is explicitly authorized and verified. Production deployment still follows the separate [release checklist](RELEASE_CHECKLIST.md).
