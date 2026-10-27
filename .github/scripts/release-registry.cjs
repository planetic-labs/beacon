const { execFileSync } = require('node:child_process');

// Use exact digests and reuse completed publications on workflow re-runs.
module.exports = function existingReleaseImage({image,tag,revision,version,core,
  inspect = args => execFileSync('docker', ['buildx','imagetools','inspect',`${image}:${tag}`,...args], {encoding:'utf8',stdio:['ignore','pipe','pipe']}),
}) {
  let raw;
  try { raw = inspect(['--raw']); }
  catch (error) {
    const stderr = String(error.stderr ?? '');
    if (/manifest unknown|manifest_unknown|name_unknown|: not found/i.test(stderr)) {
      core.setOutput('exists','false'); return;
    }
    throw new Error('Cannot check the release image in GHCR; publication stopped.', {cause:error});
  }
  const annotations = JSON.parse(raw).annotations;
  if (annotations?.['org.opencontainers.image.revision'] !== revision || annotations?.['org.opencontainers.image.version'] !== version)
    throw new Error('The release image already exists with different metadata; refusing to overwrite it.');
  const digest = inspect(['--format','{{.Manifest.Digest}}']).trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid existing image digest.');
  core.setOutput('exists','true');
  core.setOutput('digest',digest);
};
