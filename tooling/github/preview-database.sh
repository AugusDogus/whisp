#!/usr/bin/env bash
set -euo pipefail

# Only PR-derived names are accepted, including on the destructive path.
if [[ ! ${PR_NUMBER:-} =~ ^[1-9][0-9]*$ ]]; then
  echo "PR_NUMBER must be a positive integer; no database was changed." >&2
  exit 1
fi
database="whisp-pr-${PR_NUMBER}"
: "${TURSO_API_TOKEN:?Set the TURSO_API_TOKEN GitHub secret.}"
: "${TURSO_ORGANIZATION:?Set the TURSO_ORGANIZATION GitHub variable.}"
if [[ ! $TURSO_ORGANIZATION =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "TURSO_ORGANIZATION must be a Turso organization slug." >&2
  exit 1
fi

base_url="https://api.turso.tech/v1/organizations/${TURSO_ORGANIZATION}/databases"
response=$(mktemp)
trap 'rm -f "$response"' EXIT

request() {
  local method=$1 url=$2
  shift 2
  if ! status=$(curl --silent --show-error --connect-timeout 10 --max-time 60 \
    --request "$method" --output "$response" --write-out '%{http_code}' \
    --header "Authorization: Bearer ${TURSO_API_TOKEN}" \
    --header 'Content-Type: application/json' "$url" "$@"); then
    echo "Turso ${method} failed for ${database}. Remote state is unknown; rerun the workflow to reconcile it." >&2
    exit 1
  fi
}

fail_request() {
  echo "Turso $1 failed for ${database} (HTTP ${status}). Check the API token, organization, and Turso status, then rerun the workflow." >&2
  exit 1
}

case "${1:-}" in
  destroy)
    request DELETE "${base_url}/${database}"
    case "$status" in
      200|204) echo "Deleted ${database}." ;;
      404) echo "${database} is already absent." ;;
      *) fail_request deletion ;;
    esac
    ;;
  ensure)
    : "${TURSO_SOURCE_DATABASE:?Set TURSO_SOURCE_DATABASE to the main Turso database name.}"
    if [[ ! $TURSO_SOURCE_DATABASE =~ ^[a-z0-9-]+$ || $TURSO_SOURCE_DATABASE == whisp-pr-* ]]; then
      echo "TURSO_SOURCE_DATABASE must be a database name outside the reserved whisp-pr- prefix." >&2
      exit 1
    fi
    : "${GITHUB_ENV:?Run provisioning inside GitHub Actions.}"
    request GET "${base_url}/${database}"
    case "$status" in
      200) echo "Reusing ${database}." ;;
      404)
        request GET "${base_url}/${TURSO_SOURCE_DATABASE}"
        [[ $status == 200 ]] || fail_request "source lookup (${TURSO_SOURCE_DATABASE})"
        if ! group=$(jq -er '.database.group | strings | select(test("^[a-zA-Z0-9_-]+$"))' "$response"); then
          echo "Turso returned no valid group for ${TURSO_SOURCE_DATABASE}. No branch was created; check the source database." >&2
          exit 1
        fi
        payload=$(jq -n --arg name "$database" --arg group "$group" \
          --arg source "$TURSO_SOURCE_DATABASE" \
          '{name: $name, group: $group, seed: {type: "database", name: $source}}')
        request POST "$base_url" --data "$payload"
        [[ $status == 200 || $status == 201 ]] || fail_request creation
        echo "Branched ${TURSO_SOURCE_DATABASE} into ${database}."
        ;;
      *) fail_request lookup ;;
    esac

    if ! hostname=$(jq -er '.database.Hostname | strings | select(test("^[a-zA-Z0-9.-]+$"))' "$response"); then
      echo "Turso returned no valid hostname for ${database}. No credentials were exported; inspect the database and rerun." >&2
      exit 1
    fi
    # The token lives as long as the PR database, so idle previews do not expire.
    request POST "${base_url}/${database}/auth/tokens?expiration=never&authorization=full-access"
    [[ $status == 200 ]] || fail_request 'token creation'
    if ! token=$(jq -er '.jwt | strings | select(test("^[a-zA-Z0-9_.-]+$"))' "$response"); then
      echo "Turso returned no valid token for ${database}. No credentials were exported; rerun token creation." >&2
      exit 1
    fi
    echo "::add-mask::${token}"
    {
      echo "DATABASE_URL=libsql://${hostname}"
      echo "DATABASE_TOKEN=${token}"
    } >> "$GITHUB_ENV"
    ;;
  *)
    echo "Usage: preview-database.sh ensure|destroy" >&2
    exit 1
    ;;
esac
