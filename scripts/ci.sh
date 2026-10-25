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
docker run --rm --user "$(id -u):$(id -g)" -v "$runtime:/run/config" beacon-tooling \
  pnpm exec tsx scripts/generate-push-keys.ts /run/config/test.env
compose up -d --wait db
compose run --rm --no-deps web pnpm db:migrate
compose run --rm --no-deps web pnpm typecheck
compose run --rm --no-deps web pnpm audit --audit-level low
compose run --rm --no-deps web pnpm test
compose run --rm --no-deps web pnpm exec tsx tests/browser-setup.ts
compose up -d --wait --wait-timeout 90 web realtime
docker run --rm --network host --env-file "$config" \
  -v "$runtime:/run/test" beacon-browser \
  pnpm exec tsx tests/browser.ts
# The chat test revokes a fixture session while testing passkey login.
compose run --rm --no-deps web pnpm exec tsx tests/browser-setup.ts
# Registration is mocked in headless Chromium: never send it to a push gateway.
compose stop realtime
docker run --rm --network host --env-file "$config" \
  -v "$runtime:/run/test" beacon-browser \
  pnpm exec tsx tests/browser-push.ts
