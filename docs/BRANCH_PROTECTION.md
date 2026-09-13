# Master Branch Protection

`master` is the release branch. Changes must enter through a pull request after the validation checks below succeed. Repository administration is an external operation; this runbook does not claim that the policy has been applied.

## Required checks

Require these exact GitHub Actions check contexts:

- `quality`
- `integration`
- `docker (linux/amd64)`
- `docker (linux/arm64)`

Also require the branch to be up to date before merge, enforce the policy for administrators, and prohibit force pushes and branch deletion. For a single-maintainer repository, approving reviews may remain optional, but pull requests and the required checks are not optional.

## Inspect current state and prepare rollback

Choose a private evidence directory. The inspection accepts only GitHub's two expected unprotected-branch errors (`404 Not Found` and `404 Branch not protected`); authentication, authorization, network, parsing, and all other failures stop the procedure.

```bash
set -euo pipefail
EVIDENCE_DIR=/secure/path/meemo-branch-protection-YYYYMMDDTHHMMSSZ
install -d -m 700 "$EVIDENCE_DIR"
protection="$EVIDENCE_DIR/master-protection-before.json"
error="$EVIDENCE_DIR/master-protection-before.stderr"

if gh api repos/on195594/meemo/branches/master/protection \
  >"$protection" 2>"$error"; then
  printf '%s\n' protected >"$EVIDENCE_DIR/master-protection-before.state"
else
  if python3 - "$protection" "$error" <<'PY'
import json
import sys
from pathlib import Path

body = Path(sys.argv[1]).read_text()
stderr = Path(sys.argv[2]).read_text()
try:
    message = json.loads(body).get("message")
except (json.JSONDecodeError, AttributeError):
    message = None
accepted = {"Not Found", "Branch not protected"}
stderr_match = any(f"gh: {value} (HTTP 404)" in stderr for value in accepted)
if "(HTTP 404)" not in stderr or not (message in accepted or stderr_match):
    sys.exit(1)
PY
  then
    printf '%s\n' unprotected >"$EVIDENCE_DIR/master-protection-before.state"
  else
    cat "$error" >&2
    exit 1
  fi
fi

gh api repos/on195594/meemo/rulesets \
  >"$EVIDENCE_DIR/rulesets-before.json"
chmod 600 "$EVIDENCE_DIR"/*
```

If the branch is protected, convert the read representation into a payload that the update endpoint can execute during rollback. This preserves the writable branch-protection fields, including check providers and existing bypass allowances.

```bash
set -euo pipefail
EVIDENCE_DIR=/secure/path/meemo-branch-protection-YYYYMMDDTHHMMSSZ

if grep -qx protected "$EVIDENCE_DIR/master-protection-before.state"; then
  python3 - "$EVIDENCE_DIR/master-protection-before.json" \
    "$EVIDENCE_DIR/master-protection-rollback.json" <<'PY'
import json
import sys
from pathlib import Path

source = json.loads(Path(sys.argv[1]).read_text())

def enabled(name, default=False):
    value = source.get(name)
    return value.get("enabled", default) if isinstance(value, dict) else default

def names(items, key):
    return sorted(item[key] for item in items or [])

status = source.get("required_status_checks")
if status is None:
    required_status_checks = None
elif status.get("checks") is not None:
    required_status_checks = {
        "strict": status["strict"],
        "checks": sorted([
            {"context": check["context"], "app_id": check.get("app_id")}
            for check in status["checks"]
        ], key=lambda check: check["context"]),
    }
else:
    required_status_checks = {
        "strict": status["strict"],
        "contexts": sorted(status.get("contexts", [])),
    }

reviews = source.get("required_pull_request_reviews")
if reviews is not None:
    bypass = reviews.get("bypass_pull_request_allowances", {})
    dismissals = reviews.get("dismissal_restrictions", {})
    dismissal_restrictions = {
        "users": names(dismissals.get("users"), "login"),
        "teams": names(dismissals.get("teams"), "slug"),
        "apps": names(dismissals.get("apps"), "slug"),
    }
    reviews = {
        "dismiss_stale_reviews": reviews.get("dismiss_stale_reviews", False),
        "require_code_owner_reviews": reviews.get("require_code_owner_reviews", False),
        "required_approving_review_count": reviews.get("required_approving_review_count", 0),
        "require_last_push_approval": reviews.get("require_last_push_approval", False),
        "bypass_pull_request_allowances": {
            "users": names(bypass.get("users"), "login"),
            "teams": names(bypass.get("teams"), "slug"),
            "apps": names(bypass.get("apps"), "slug"),
        },
    }
    if any(dismissal_restrictions.values()):
        reviews["dismissal_restrictions"] = dismissal_restrictions

restrictions = source.get("restrictions")
if restrictions is not None:
    restrictions = {
        "users": names(restrictions.get("users"), "login"),
        "teams": names(restrictions.get("teams"), "slug"),
        "apps": names(restrictions.get("apps"), "slug"),
    }

payload = {
    "required_status_checks": required_status_checks,
    "enforce_admins": enabled("enforce_admins"),
    "required_pull_request_reviews": reviews,
    "restrictions": restrictions,
    "required_linear_history": enabled("required_linear_history"),
    "allow_force_pushes": enabled("allow_force_pushes"),
    "allow_deletions": enabled("allow_deletions"),
    "block_creations": enabled("block_creations"),
    "required_conversation_resolution": enabled("required_conversation_resolution"),
    "lock_branch": enabled("lock_branch"),
    "allow_fork_syncing": enabled("allow_fork_syncing"),
}
Path(sys.argv[2]).write_text(json.dumps(payload, indent=2) + "\n")
PY
  chmod 600 "$EVIDENCE_DIR/master-protection-rollback.json"
fi
```

Review `rulesets-before.json` before applying. Repository or organization rulesets are a separate control plane: stop if an applicable ruleset grants an unintended bypass or conflicts with this policy. This procedure does not modify rulesets.

## Apply

Run this only with explicit repository-admin authorization. The payload pins every required context to the GitHub Actions App ID observed on `master`; it aborts if a required check has no unambiguous GitHub Actions provider.

```bash
set -euo pipefail
EVIDENCE_DIR=/secure/path/meemo-branch-protection-YYYYMMDDTHHMMSSZ
checks="$EVIDENCE_DIR/master-check-runs-before.jsonl"
payload="$EVIDENCE_DIR/master-protection-request.json"
expected="$EVIDENCE_DIR/master-protection-expected.json"

state=$(<"$EVIDENCE_DIR/master-protection-before.state")
if [[ "$state" == protected ]]; then
  test -s "$EVIDENCE_DIR/master-protection-rollback.json"
elif [[ "$state" != unprotected ]]; then
  printf 'invalid saved state: %s\n' "$state" >&2
  exit 1
fi

gh api --paginate \
  'repos/on195594/meemo/commits/master/check-runs?per_page=100' \
  --jq '.check_runs[]' >"$checks"
python3 - "$checks" "$payload" "$expected" <<'PY'
import json
import sys
from pathlib import Path

contexts = [
    "quality",
    "integration",
    "docker (linux/amd64)",
    "docker (linux/arm64)",
]
runs = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
checks = []
for context in contexts:
    app_ids = {
        run["app"]["id"]
        for run in runs
        if run["name"] == context and run.get("app", {}).get("slug") == "github-actions"
    }
    if len(app_ids) != 1:
        raise SystemExit(f"expected one GitHub Actions provider for {context!r}, got {sorted(app_ids)}")
    checks.append({"context": context, "app_id": app_ids.pop()})

payload = {
    "required_status_checks": {"strict": True, "checks": checks},
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
Path(sys.argv[2]).write_text(json.dumps(payload, indent=2) + "\n")
Path(sys.argv[3]).write_text(json.dumps({"checks": checks}, indent=2) + "\n")
PY
chmod 600 "$checks" "$payload" "$expected"
gh api --method PUT repos/on195594/meemo/branches/master/protection \
  --input "$payload" >"$EVIDENCE_DIR/master-protection-write-response.json"
```

## Verify

Read back the exact target and machine-assert the complete policy rather than relying on the write response.

```bash
set -euo pipefail
EVIDENCE_DIR=/secure/path/meemo-branch-protection-YYYYMMDDTHHMMSSZ
after="$EVIDENCE_DIR/master-protection-after.json"

gh api repos/on195594/meemo/branches/master/protection >"$after"
python3 - "$EVIDENCE_DIR/master-protection-expected.json" "$after" <<'PY'
import json
import sys
from pathlib import Path

expected = json.loads(Path(sys.argv[1]).read_text())["checks"]
actual = json.loads(Path(sys.argv[2]).read_text())
status = actual.get("required_status_checks") or {}
checks = status.get("checks") or []
expected_pairs = [(item["context"], item["app_id"]) for item in expected]
actual_pairs = [(item.get("context"), item.get("app_id")) for item in checks]
assert status.get("strict") is True, "required checks are not strict"
assert len(actual_pairs) == 4, f"expected exactly four checks, got {actual_pairs!r}"
assert sorted(actual_pairs) == sorted(expected_pairs), \
    f"check contexts/providers differ: {actual_pairs!r}"
assert actual.get("enforce_admins", {}).get("enabled") is True, "admins are not enforced"
assert actual.get("allow_force_pushes", {}).get("enabled") is False, "force pushes are allowed"
assert actual.get("allow_deletions", {}).get("enabled") is False, "branch deletion is allowed"
reviews = actual.get("required_pull_request_reviews")
assert reviews is not None, "pull requests are not required"
bypass = reviews.get("bypass_pull_request_allowances") or {}
for actor_type in ("users", "teams", "apps"):
    assert bypass.get(actor_type, []) == [], f"PR bypass exists for {actor_type}"
print("branch protection matches the required policy")
PY
chmod 600 "$after"
```

Open a test pull request and confirm GitHub prevents merging while any required check is pending or failing. That behavioral check is part of completion.

## Rollback and verify

Use the state file created during inspection. A previously protected branch is restored with the generated writable payload; a previously unprotected branch is returned to an unprotected state. Both paths read back and machine-assert the result.

```bash
set -euo pipefail
EVIDENCE_DIR=/secure/path/meemo-branch-protection-YYYYMMDDTHHMMSSZ
state=$(<"$EVIDENCE_DIR/master-protection-before.state")
rollback_after="$EVIDENCE_DIR/master-protection-rollback-after.json"
rollback_error="$EVIDENCE_DIR/master-protection-rollback-after.stderr"

if [[ "$state" == protected ]]; then
  gh api --method PUT repos/on195594/meemo/branches/master/protection \
    --input "$EVIDENCE_DIR/master-protection-rollback.json" \
    >"$EVIDENCE_DIR/master-protection-rollback-response.json"
  gh api repos/on195594/meemo/branches/master/protection >"$rollback_after"
  python3 - "$EVIDENCE_DIR/master-protection-rollback.json" "$rollback_after" <<'PY'
import json
import sys
from pathlib import Path

expected = json.loads(Path(sys.argv[1]).read_text())
actual = json.loads(Path(sys.argv[2]).read_text())

def enabled(name, default=False):
    value = actual.get(name)
    return value.get("enabled", default) if isinstance(value, dict) else default

def names(items, key):
    return sorted(item[key] for item in items or [])

status = actual.get("required_status_checks")
if status is None:
    required_status_checks = None
elif status.get("checks") is not None:
    required_status_checks = {
        "strict": status["strict"],
        "checks": sorted([
            {"context": check["context"], "app_id": check.get("app_id")}
            for check in status["checks"]
        ], key=lambda check: check["context"]),
    }
else:
    required_status_checks = {
        "strict": status["strict"],
        "contexts": sorted(status.get("contexts", [])),
    }
reviews = actual.get("required_pull_request_reviews")
if reviews is not None:
    bypass = reviews.get("bypass_pull_request_allowances", {})
    dismissals = reviews.get("dismissal_restrictions", {})
    dismissal_restrictions = {
        "users": names(dismissals.get("users"), "login"),
        "teams": names(dismissals.get("teams"), "slug"),
        "apps": names(dismissals.get("apps"), "slug"),
    }
    reviews = {
        "dismiss_stale_reviews": reviews.get("dismiss_stale_reviews", False),
        "require_code_owner_reviews": reviews.get("require_code_owner_reviews", False),
        "required_approving_review_count": reviews.get("required_approving_review_count", 0),
        "require_last_push_approval": reviews.get("require_last_push_approval", False),
        "bypass_pull_request_allowances": {
            "users": names(bypass.get("users"), "login"),
            "teams": names(bypass.get("teams"), "slug"),
            "apps": names(bypass.get("apps"), "slug"),
        },
    }
    if any(dismissal_restrictions.values()):
        reviews["dismissal_restrictions"] = dismissal_restrictions
restrictions = actual.get("restrictions")
if restrictions is not None:
    restrictions = {
        "users": names(restrictions.get("users"), "login"),
        "teams": names(restrictions.get("teams"), "slug"),
        "apps": names(restrictions.get("apps"), "slug"),
    }
normalized = {
    "required_status_checks": required_status_checks,
    "enforce_admins": enabled("enforce_admins"),
    "required_pull_request_reviews": reviews,
    "restrictions": restrictions,
    "required_linear_history": enabled("required_linear_history"),
    "allow_force_pushes": enabled("allow_force_pushes"),
    "allow_deletions": enabled("allow_deletions"),
    "block_creations": enabled("block_creations"),
    "required_conversation_resolution": enabled("required_conversation_resolution"),
    "lock_branch": enabled("lock_branch"),
    "allow_fork_syncing": enabled("allow_fork_syncing"),
}
assert normalized == expected, "rollback read-back differs from the saved writable policy"
print("previous branch protection restored")
PY
elif [[ "$state" == unprotected ]]; then
  gh api --method DELETE repos/on195594/meemo/branches/master/protection
  if gh api repos/on195594/meemo/branches/master/protection \
    >"$rollback_after" 2>"$rollback_error"; then
    printf '%s\n' 'rollback failed: branch is still protected' >&2
    exit 1
  fi
  python3 - "$rollback_after" "$rollback_error" <<'PY'
import json
import sys
from pathlib import Path

body = Path(sys.argv[1]).read_text()
stderr = Path(sys.argv[2]).read_text()
try:
    message = json.loads(body).get("message")
except (json.JSONDecodeError, AttributeError):
    message = None
accepted = {"Not Found", "Branch not protected"}
stderr_match = any(f"gh: {value} (HTTP 404)" in stderr for value in accepted)
assert "(HTTP 404)" in stderr and (message in accepted or stderr_match), \
    f"unexpected rollback read-back error: {stderr!r}"
print("previous unprotected state restored")
PY
else
  printf 'invalid saved state: %s\n' "$state" >&2
  exit 1
fi
chmod 600 "$EVIDENCE_DIR"/*
```
