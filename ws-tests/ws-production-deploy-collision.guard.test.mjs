import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('retired WS Deploy cannot be reintroduced; WS Server Deploy owns the validated mutation', () => {
  assert.equal(fs.existsSync('.github/workflows/ws-deploy.yml'), false);
  const source = fs.readFileSync('.github/workflows/ws-server-deploy.yml', 'utf8');
  assert.match(source, /appleboy\/scp-action@v0\.1\.7/);
  assert.match(source, /appleboy\/ssh-action@v1\.0\.3/);
  assert.match(source, /deploy:\n    needs: \[impact, validate\]/);
  assert.match(source, /needs\.impact\.outputs\.deploy_ws == 'true'/);
});
