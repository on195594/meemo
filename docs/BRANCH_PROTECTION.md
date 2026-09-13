# Master Branch Protection

`master` is the release branch. Changes must enter through a pull request after the validation checks below succeed. Repository administration is an external operation; a code or documentation commit does not enable this policy.

## Required checks

Require these exact GitHub check contexts:

- `quality`
- `integration`
- `docker (linux/amd64)`
- `docker (linux/arm64)`

Also require the branch to be up to date before merge. Do not allow force pushes or branch deletion. For a single-maintainer repository, approving reviews may remain optional, but pull requests and the required checks are not optional.

## Inspect current state

```sh
gh api repos/on195594/meemo/branches/master/protection > /secure/path/master-protection-before.json
gh api repos/on195594/meemo/rulesets > /secure/path/rulesets-before.json
```

A `404 Branch not protected` response means there is no branch protection object to preserve. Keep the response and current ruleset output as pre-change evidence.

## Apply

Run this only with explicit repository-admin authorization:

```sh
install -m 600 /dev/null /tmp/meemo-master-protection.json
python3 - <<'PY'
import json
from pathlib import Path

payload = {
    "required_status_checks": {
        "strict": True,
        "contexts": [
            "quality",
            "integration",
            "docker (linux/amd64)",
            "docker (linux/arm64)",
        ],
    },
    "enforce_admins": True,
    "required_pull_request_reviews": {
        "dismiss_stale_reviews": False,
        "require_code_owner_reviews": False,
        "required_approving_review_count": 0,
        "require_last_push_approval": False,
        "bypass_pull_request_allowances": {"users": [], "teams": [], "apps": []},
    },
    "restrictions": None,
    "required_linear_history": False,
    "allow_force_pushes": False,
    "allow_deletions": False,
    "block_creations": False,
    "required_conversation_resolution": False,
    "lock_branch": False,
    "allow_fork_syncing": True,
}
Path("/tmp/meemo-master-protection.json").write_text(json.dumps(payload))
PY
gh api --method PUT \
  repos/on195594/meemo/branches/master/protection \
  --input /tmp/meemo-master-protection.json
rm -f /tmp/meemo-master-protection.json
```

## Verify

Read back the exact target rather than relying on the write response:

```sh
gh api repos/on195594/meemo/branches/master/protection \
  --jq '{strict: .required_status_checks.strict, contexts: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, force_pushes: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled, pull_requests: (.required_pull_request_reviews != null)}'
```

Acceptance requires:

- `strict` is `true`;
- all four required contexts are present exactly once;
- admin enforcement is enabled;
- force pushes and deletion are disabled;
- pull requests are required.

Open a test pull request and confirm GitHub prevents merging while any required check is pending or failing. That behavioral check is part of completion.

## Rollback

If the branch was unprotected before the change, restore that state with:

```sh
gh api --method DELETE repos/on195594/meemo/branches/master/protection
```

If protection already existed, restore the recorded settings deliberately from `master-protection-before.json`; do not blindly submit GitHub's read representation as a write payload. Read back the target after rollback and retain both before/after evidence.
