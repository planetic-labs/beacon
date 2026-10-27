#!/bin/sh
set -eu
umask 077
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
    image: beacon-production-check
    command: [pnpm, start]
    volumes:
      - ${CI_RUNTIME:?Set fixture directory}:/run/test
  realtime:
    image: beacon-tooling
EOF
export CI_RUNTIME="$runtime"
docker build --target base -t beacon-tooling .
docker build --target production -t beacon-production-check .
docker build -f Dockerfile.test -t beacon-browser .
# Static PWA lifecycle checks use synthetic API data and no database.
docker run --rm beacon-browser pnpm exec tsx tests/browser-pwa.ts
# Search, receipt and mention UI use synthetic users on desktop and mobile.
docker run --rm beacon-browser pnpm exec tsx tests/browser-chat-features.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-attachments.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-community-chats.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-chat-media.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-emoji.ts
docker run --rm beacon-browser pnpm exec tsx tests/browser-settings.ts
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
