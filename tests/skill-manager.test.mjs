import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSkillManager, SkillManagerError } from '../adapters/runtime-dsh/skill-manager.mjs';

const tempRoot = join(process.cwd(), '.sciencescope-local', 'temp');
const valid = (name = 'sample-skill', description = 'A sample') => `---\nname: ${name}\ndescription: ${description}\n---\n\n# Body\n`;

async function fixture() {
  await mkdir(tempRoot, { recursive: true });
  const home = await mkdtemp(join(tempRoot, 'skill-manager-'));
  const manager = await createSkillManager({ home });
  return { home, manager };
}

async function cleanup(home, manager) {
  await manager.close();
  await rm(home, { recursive: true, force: true });
}

test('creates, lists, reads, edits and preserves resources across disable/re-enable/remove', async () => {
  const { home, manager } = await fixture();
  try {
    assert.deepEqual((await manager.list()).skills, []);
    assert.deepEqual(await manager.save({ markdown: valid() }), { name: 'sample-skill', enabled: true });
    await writeFile(join(home, 'skills', 'sample-skill', 'resource.txt'), 'keep');
    assert.equal((await manager.read({ name: 'sample-skill' })).markdown, valid());
    await manager.save({ name: 'sample-skill', markdown: valid('sample-skill', 'Edited') });
    assert.equal(await readFile(join(home, 'skills', 'sample-skill', 'resource.txt'), 'utf8'), 'keep');
    await manager.setEnabled({ name: 'sample-skill', enabled: false });
    assert.equal((await manager.read({name:'sample-skill'})).enabled,false);
    await manager.save({name:'sample-skill',markdown:valid('sample-skill','Edited while disabled')});
    const disabled=(await manager.list()).skills[0];assert.equal(disabled.enabled,false);assert.equal(disabled.valid,true);assert.equal(disabled.description,'Edited while disabled');
    await manager.setEnabled({ name: 'sample-skill', enabled: true });
    assert.equal(await readFile(join(home, 'skills', 'sample-skill', 'resource.txt'), 'utf8'), 'keep');
    await manager.setEnabled({name:'sample-skill',enabled:false});
    const removed = await manager.remove({ name: 'sample-skill' });
    assert.equal(removed.removed, true);
    assert.equal(await readFile(join(removed.recoveryPath, 'resource.txt'), 'utf8'), 'keep');
  } finally { await cleanup(home, manager); }
});

test('rejects malformed content without overwriting an existing skill', async () => {
  const { home, manager } = await fixture();
  try {
    await manager.save({ markdown: valid() });
    await assert.rejects(() => manager.save({ name: 'sample-skill', markdown: 'not frontmatter' }), (error) => error instanceof SkillManagerError && error.status === 400);
    assert.equal((await manager.read({ name: 'sample-skill' })).markdown, valid());
    assert.deepEqual(await readdir(join(home,'management-temp')),[]);
    await assert.rejects(()=>manager.save({markdown:valid()}),{status:409});
    await assert.rejects(()=>manager.save({name:'missing',markdown:valid('missing')}),{status:404});
    assert.deepEqual(await readdir(join(home,'management-temp')),[]);
  } finally { await cleanup(home, manager); }
});

test('rejects invalid names and oversized markdown', async () => {
  const { manager, home } = await fixture();
  try {
    await assert.rejects(() => manager.save({ name: '../escape', markdown: valid() }), { status: 400 });
    await assert.rejects(() => manager.save({ markdown: 'x'.repeat(128 * 1024 + 1) }), { status: 400 });
  } finally { await cleanup(home, manager); }
});
