import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const staticFiles = require('@fastify/static');

test('static server discovers nested assets and preserves HEAD and byte ranges', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'beacon-static-'));
  const app = Fastify();
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', 'sample.txt'), 'abcdef');
    await app.register(staticFiles, { root, wildcard: false });
    const response = await app.inject('/assets/sample.txt');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'abcdef');
    const head = await app.inject({ method: 'HEAD', url: '/assets/sample.txt' });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers['content-length'], '6');
    assert.equal(head.body, '');
    const range = await app.inject({ url: '/assets/sample.txt', headers: { range: 'bytes=1-3' } });
    assert.equal(range.statusCode, 206);
    assert.equal(range.body, 'bcd');
    assert.equal((await app.inject('/assets/missing.txt')).statusCode, 404);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
