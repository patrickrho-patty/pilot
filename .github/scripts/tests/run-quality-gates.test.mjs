import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExistingComment } from '../run-quality-gates.mjs';

test('findExistingComment: paginates until it finds the commitpilot comment', async () => {
  const seenPaths = [];
  const comment = await findExistingComment(async (path) => {
    seenPaths.push(path);
    if (path.endsWith('page=1')) {
      return Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        user: { login: 'someone-else' },
        body: 'unrelated',
      }));
    }
    if (path.endsWith('page=2')) {
      return [{
        id: 200,
        user: { login: 'commitpilot[bot]' },
        body: 'Looks good.\n\n— commitpilot',
      }];
    }
    return [];
  }, 'token', 'pilotai/pilot', 6469);

  assert.equal(comment.id, 200);
  assert.deepEqual(seenPaths, [
    '/repos/pilotai/pilot/issues/6469/comments?per_page=100&page=1',
    '/repos/pilotai/pilot/issues/6469/comments?per_page=100&page=2',
  ]);
});

test('findExistingComment: returns null when no signed comment exists', async () => {
  const comment = await findExistingComment(async () => ([
    {
      id: 1,
      user: { login: 'commitpilot[bot]' },
      body: 'Unsigned status update',
    },
  ]), 'token', 'pilotai/pilot', 6469);

  assert.equal(comment, null);
});
