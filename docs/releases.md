# Release images

Development continues in the existing development deployment. Publishing a
GitHub release is the only trigger for building a distributable Beacon image.
Ordinary commits, pull requests, draft releases and release-note edits do not
publish images or update any server.

## Publish a version

1. Merge the desired changes into `main` and wait for that commit's CI and both
   CodeQL analyses to succeed. The release workflow checks that exact commit,
   not an older successful run or only the checks from its pull request.
2. Create a GitHub release from that commit with a new tag such as `v1.2.3`.
   Pre-release tags such as `v1.2.3-rc.1` are also supported. Build metadata
   (`+...`) is not accepted in tags. Publish the release.
3. Open Actions → Release image. The workflow builds the Dockerfile's
   `production` target for Linux AMD64 and ARM64 and pushes one multi-platform
   image to `ghcr.io/<repository-owner>/<repository-name>:v1.2.3`.
4. After publication and provenance signing succeed, `beacon-image.json` is
   attached to the release. It records the version, source commit and immutable
   image reference (`ghcr.io/...@sha256:...`). The workflow summary also shows
   the reference. Save it for deployment.
5. Test that exact digest in preview and later use the same digest in production.
   Both environments provide their own runtime settings, databases and media.
   This workflow performs no deployment and needs no server/domain credentials.

The release version is embedded into the frontend's About page. Builds outside
this workflow retain the version from `package.json`. The image supports the
existing web, realtime and migration commands; their future Compose wiring is
separate from image publication.

## Authentication and permissions

Actions authenticates to GHCR with its short-lived `GITHUB_TOKEN`; no personal
access token or extra repository secret is required for publication. Permissions
are scoped by job: validation can read checks, publication can write packages,
provenance can request a signing identity, and only the final receipt job can
write release assets. Actions are pinned to full commit hashes and covered by
Dependabot's existing GitHub Actions configuration.

A newly created GHCR package is private by default. Package visibility and
production-server download credentials will be decided when deployment is
configured. Publishing an image does not make runtime secrets part of it: only
the public release version is passed as a build argument. Database credentials,
mail keys, domains and working environment files stay outside the build context.

BuildKit attaches build provenance and an SBOM; GitHub adds a signed provenance
attestation for the published digest. Verification can later use
`gh attestation verify oci://<image>@<digest> --repo <owner>/<repo>` with registry
access appropriate for the package.

## Failures and repeat runs

If the release was published before its commit's main checks finished, the
validation job fails without publishing. Wait for success, then re-run the
workflow. Do not remove checks or branch protection to get a release through.

Repeat runs reuse an image already tagged for the same release version and
commit. Different metadata under that tag is an error; the workflow will not
overwrite it. Registry errors other than a missing image also stop publication.
Do not move release tags or replace published images. Corrections get a new
release version; use image digests rather than `latest` to promote a build.

If a later signing or receipt job fails, re-run failed jobs after resolving its
cause. If the repository uses immutable releases, assets cannot be attached
following publication; this published-release workflow expects mutable release
assets. Enable release immutability only together with a revised draft/build/
publish flow. This does not affect the immutability of an image digest.

Production Compose, automatic migrations, backup policies, domains and server
setup are intentionally left for deployment configuration. A successful image
build is not a claim that an arbitrary database migration can be rolled back.
