import { fixture, start, request } from './fixture.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve('artifacts', 'browser-fixture');
await mkdir(root, { recursive: true });
const f = await fixture(root, Date.now().toString(), true);
await start(f, resolve('runtime'));
for (let index = 0; index < 26; index++)
  await request(f, '/api/queue/submit', {
    method: 'POST',
    body: {
      skillId: 'audit-skill',
      title: `Contribuição de teste ${index + 1}`,
      content: 'Conteúdo sintético para revisão. '.repeat(80),
      source: 'web'
    }
  });
await writeFile(
  join(root, 'active.json'),
  JSON.stringify({ url: f.url, token: f.env.BALDE_WEB_SESSION_KEY, pid: f.child.pid, dir: f.dir, repo: f.repo })
);
console.log(f.url + '/?balde=queue#session=' + f.env.BALDE_WEB_SESSION_KEY);
process.on('SIGINT', () => {
  f.child.kill();
  process.exit();
});
await new Promise((resolve) => f.child.once('exit', resolve));
