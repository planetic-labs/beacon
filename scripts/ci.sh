#!/bin/sh
set -eu
umask 077
mode=${1:-full}
case "$mode" in
  docs) printf 'Documentation/metadata only; no application tests.\n'; exit 0 ;;
  full|quick|selective) ;;
  *) printf 'Unknown CI mode.\n' >&2; exit 1 ;;
esac
if [ "$mode" != full ] && [ ! -f "${2:-}" ]; then
  printf 'Selective/quick checks require a generated CI plan.\n' >&2; exit 1
fi
if [ "${CI_TOOLING_READY:-false}" != true ]; then
  docker build --target base -t beacon-tooling .
fi
browsers=''
integration=false
if [ "$mode" != full ]; then
  plan=$(realpath "$2")
  browsers=$(docker run --rm -v "$plan:/run/ci-plan.json:ro" beacon-tooling node scripts/ci-plan.mjs --field browsers /run/ci-plan.json "$mode")
  integration=$(docker run --rm -v "$plan:/run/ci-plan.json:ro" beacon-tooling node scripts/ci-plan.mjs --field integration /run/ci-plan.json "$mode")
  docker run --rm beacon-tooling pnpm typecheck
  docker run --rm beacon-tooling pnpm audit --audit-level low
  docker run --rm beacon-tooling node scripts/unit-tests.mjs
  if [ -n "$browsers" ]; then
    docker build -f Dockerfile.test -t beacon-browser .
    for suite in $browsers; do
      docker run --rm beacon-browser pnpm exec tsx "tests/$suite"
    done
  fi
  if [ "$integration" = false ]; then exit 0; fi
fi
runtime=$(mktemp -d)
project="beacon-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
config="$runtime/test.env"
override="$runtime/docker-compose.ci.yml"
compose() {
  docker compose -p "$project" --env-file "$config" -f docker-compose.yml -f "$override" "$@"
}
cleanup() {
  compose down --volumes --remove-orphans || true
  rm -rf "$runtime"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# This directory contains disposable test fixtures only, never deployment secrets.
chmod 0777 "$runtime"
cat > "$config" <<'EOF'
APP_ENV=test
APP_PORT=51030
SOCKET_PORT=51031
APP_URL=http://localhost:51030
POSTGRES_USER=beacon
POSTGRES_DB=beacon
POSTGRES_PASSWORD=ci-only-database-password
BETTER_AUTH_SECRET=ci-only-authentication-secret-not-for-deployment
EMAIL_FROM=test@example.com
RESEND_API_KEY=test-only
EOF
cat > "$override" <<'EOF'
services:
  web:
    image: ${CI_TEST_IMAGE:-beacon-production-check}
    command: [pnpm, start]
    volumes:
      - ${CI_RUNTIME:?Set fixture directory}:/run/test
  realtime:
    image: beacon-tooling
EOF
export CI_RUNTIME="$runtime"
if [ "$mode" != full ]; then
  export CI_TEST_IMAGE=beacon-tooling
  compose up -d --wait db
  compose run --rm --no-deps web pnpm db:migrate
  compose run --rm --no-deps web pnpm exec tsx --test tests/integration.test.ts tests/email-normalization.test.ts
  compose run --rm --no-deps web pnpm exec tsx tests/storage-integration.ts
  compose run --rm --no-deps web pnpm exec tsx tests/chat-selection-integration.ts
  compose run --rm --no-deps web pnpm exec tsx tests/mentions-integration.ts
  exit 0
fi
docker build --cache-from beacon-tooling --build-arg "RELEASE_VERSION=${CI_RELEASE_VERSION:-}" --target production -t beacon-production-check .
docker build -f Dockerfile.test -t beacon-browser .
# Static PWA lifecycle checks use synthetic API data and no database.
docker run --rm beacon-browser pnpm exec tsx tests/browser-pwa.ts
# Search, receipt and mention UI use synthetic users on desktop and mobile.
docker run --rm beacon-browser pnpm exec tsx tests/browser-chat-features.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-message-layout.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-chat-swipes.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-chat-list-selection.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-chat-scroll.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-offline.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-attachments.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-community-chats.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-chat-media.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-emoji.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-settings.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-storage.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-stickers.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-sticker-ownership.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-passkey-registration.ts
# Native recording UI checks use fake devices and synthetic API responses.
docker run --rm beacon-browser pnpm exec tsx tests/browser-recordings.ts
docker run --rm --user "$(id -u):$(id -g)" -v "$runtime:/run/config" beacon-tooling \
  pnpm exec tsx scripts/generate-push-keys.ts /run/config/test.env
compose up -d --wait db
compose run --rm --no-deps web pnpm db:migrate
compose run --rm --no-deps web pnpm typecheck
compose run --rm --no-deps web pnpm audit --audit-level low
compose run --rm --no-deps web pnpm test
compose run --rm --no-deps web pnpm exec tsx tests/storage-integration.ts
compose run --rm --no-deps web pnpm exec tsx tests/browser-setup.ts
compose up -d --wait --wait-timeout 90 web realtime
compose run --rm --no-deps -e TEST_API_URL=http://web:3000 -e TEST_SOCKET_URL=http://realtime:3001 web pnpm exec tsx tests/realtime-chat-features.ts
docker run --rm --network host --env-file "$config" \
  -v "$runtime:/run/test" beacon-browser \
  pnpm exec tsx tests/browser.ts
# Private draft/pin sync uses fresh disposable sessions before the authentication test revokes one.
compose run --rm --no-deps web pnpm exec tsx tests/browser-setup.ts
docker run --rm --network host --env-file "$config" -e TEST_SOCKET_URL=http://localhost:51031 \
  -v "$runtime:/run/test" beacon-browser pnpm exec tsx tests/browser-chat-preferences.ts
# The chat test revokes a fixture session while testing passkey login.
compose run --rm --no-deps web pnpm exec tsx tests/browser-setup.ts
# Registration is mocked in headless Chromium: never send it to a push gateway.
compose stop realtime
docker run --rm --network host --env-file "$config" \
  -v "$runtime:/run/test" beacon-browser \
  pnpm exec tsx tests/browser-push.ts
# Validate the same-port Vite development setup separately from production.
cat > "$runtime/docker-compose.dev-check.yml" <<'EOF'
services:
  web:
    command: [pnpm, dev]
EOF
docker compose -p "$project" --env-file "$config" -f docker-compose.yml -f "$override" \
  -f "$runtime/docker-compose.dev-check.yml" up -d --no-deps --wait --wait-timeout 90 web
docker run --rm --network host --env-file "$config" \
  -v "$runtime:/run/test" beacon-browser \
  pnpm exec tsx tests/browser-dev.ts

# Message ownership and mention routing are checked after fixture browser scenarios.
compose run --rm --no-deps web pnpm exec tsx tests/chat-selection-integration.ts
compose run --rm --no-deps web pnpm exec tsx tests/mentions-integration.ts
