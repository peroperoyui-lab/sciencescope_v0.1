import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ProfileStore } from '../scripts/chat-store.mjs';

const ownedRoots = [];
const handles=[];
after(async () => {for(const handle of handles)handle.close();for (const root of ownedRoots) await rm(root, { recursive: true, force: true }); });

async function store() {
  const base = path.resolve('.sciencescope-local', 'temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'sciencescope-profile-'));
  ownedRoots.push(root);
  const handle=await new ProfileStore({ stateDir: root }).init();handles.push(handle);return handle;
}

test('profile defaults, validates, persists and reopens from project-local state', async () => {
  const profiles = await store();
  assert.deepEqual(profiles.getProfile(), { displayName: '用户', bio: '' });
  await assert.rejects(profiles.updateProfile({ displayName: '   ', bio: '' }), /Invalid profile/);
  await assert.rejects(profiles.updateProfile({ displayName: 'x', bio: 'a'.repeat(2001) }), /Invalid profile/);
  await assert.rejects(profiles.updateProfile({ displayName: 'x' }), /Invalid profile/);
  const saved = await profiles.updateProfile({ displayName: '  Alice  ', bio: 'A short bio' });
  assert.deepEqual(saved, { displayName: 'Alice', bio: 'A short bio' });
  assert.deepEqual({...profiles.db.db.prepare('SELECT display_name AS displayName,bio FROM profile WHERE id=1').get()},saved);
  const reopened = await new ProfileStore({ stateDir: profiles.stateDir }).init();
  handles.push(reopened);
  assert.deepEqual(reopened.getProfile(), saved);
});
