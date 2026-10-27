// Only trusted release metadata and successful checks for the exact commit
// authorize publishing. This file is tested with a mocked GitHub client.
module.exports = async function releaseImage({ github, context, core, revision }) {
  const release = context.payload.release;
  if (context.eventName !== "release" || context.payload.action !== "published" || !release || release.draft)
    throw new Error("Images are published only for published GitHub releases.");
  const tag = release.tag_name;
  const date = typeof tag === "string" && /^v([1-9]\d{3})\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])(?:-patch[1-9]\d*)?$/.exec(tag);
  const parsed = date && new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`);
  if (!date || date[0] !== tag || tag.length > 128 || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== `${date[1]}-${date[2]}-${date[3]}`)
    throw new Error("Use a valid calendar release tag such as v2026.10.27 or v2026.10.27-patch1.");
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Invalid checked-out commit.");
  const repo = context.repo;
  const { data: tagged } = await github.rest.repos.getCommit({ ...repo, ref: `tags/${tag}` });
  if (tagged.sha !== revision) throw new Error("The release tag changed during the build.");
  const { data: comparison } = await github.rest.repos.compareCommits({ ...repo, base: revision, head: "main" });
  if (!["ahead", "identical"].includes(comparison.status))
    throw new Error("The release commit must be part of main.");
  const { data: runs } = await github.rest.actions.listWorkflowRuns({
    ...repo, workflow_id: "checks.yml", head_sha: revision, branch: "main", event: "push", per_page: 100,
  });
  const latestRun = runs.workflow_runs.filter(run => run.head_sha === revision)
    .sort((a, b) => b.id - a.id)[0];
  if (!latestRun || latestRun.status !== "completed" || latestRun.conclusion !== "success")
    throw new Error("CI for this exact commit on main must pass first. Re-run publication after CI succeeds.");
  const checks = await github.paginate(github.rest.checks.listForRef, { ...repo, ref: revision, per_page: 100 });
  for (const name of ["Analyze (actions)", "Analyze (javascript-typescript)"]) {
    const check = checks.filter(check => check.name === name && check.app?.slug === "github-actions")
      .sort((a, b) => b.id - a.id)[0];
    if (!check || check.status !== "completed" || check.conclusion !== "success")
      throw new Error(`Required security analysis has not passed: ${name}`);
  }
  const metadata = {
    image: `ghcr.io/${repo.owner}/${repo.repo}`.toLowerCase(),
    tag, version: tag.slice(1), revision,
  };
  for (const [key, value] of Object.entries(metadata)) core.setOutput(key, value);
  return metadata;
};
