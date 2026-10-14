// End-to-end smoke for the Balde connectors. Read-only by default (PULL: skills, context
// graph, commons). Set SMOKE_PUSH=1 to also test a contribution (PUSH to the curation queue).
//   BALDE_API_KEY=<token> [BALDE_BASE_URL=...] [SMOKE_PUSH=1] node examples/smoke.mjs
import {
  listSkills, getSkill, getSkillContext, readSkillContextFile,
  listCommons, readCommonsConcept, contributeContext, baldeBaseUrl
} from '../baldeClient.mjs';

console.log(`Balde: ${baldeBaseUrl()}`);

// --- PULL: skills ---
const skills = await listSkills();
console.log(`\nSkills (${skills.length}):`);
for (const s of skills) console.log(`  - ${s.id} — ${s.title} [${(s.tags || []).join(', ')}]`);

if (skills[0]) {
  const id = skills[0].id;
  const detail = await getSkill(id);
  const md = String(detail.markdown || '');
  const evals = Array.isArray(detail.evals) ? detail.evals.length : 0;
  const inline = Array.isArray(detail.context) ? detail.context.length : 0;
  console.log(`\nget "${id}": ${md.length} chars SKILL.md, ${evals} eval(s), ${inline} inline context file(s), contextMode=${detail.contextMode || 'n/a'}`);

  // --- PULL: context graph (walk one node on demand) ---
  try {
    const manifest = await getSkillContext(id);
    const files = manifest.files || [];
    console.log(`context manifest: ${files.length} file(s)`);
    if (files[0]) {
      const f = await readSkillContextFile(id, files[0].path);
      console.log(`  read "${files[0].path}": ${String(f.content || '').length} chars, links=${(f.links || []).length}`);
    }
  } catch (e) { console.log(`context manifest: ${e.message}`); }
}

// --- PULL: commons ---
try {
  const commons = await listCommons();
  console.log(`\nCommons (${commons.length}):`);
  for (const c of commons.slice(0, 5)) console.log(`  - ${c.path} — ${c.summary || ''}`);
  if (commons[0]) {
    const c = await readCommonsConcept(commons[0].path);
    console.log(`  read "${commons[0].path}": ${String(c.content || '').length} chars`);
  }
} catch (e) { console.log(`commons: ${e.message}`); }

// --- PUSH: contribute to the curation queue (opt-in; a curator reviews/merges) ---
if (process.env.SMOKE_PUSH === '1' && skills[0]) {
  const r = await contributeContext({
    skillId: skills[0].id,
    title: 'connector smoke',
    content: 'Smoke-test contribution from the AI connectors. Safe to reject.',
    tags: ['smoke']
  });
  console.log(`\nPUSH → queued: id=${r.id} status=${r.status} skill=${r.skillId}`);
} else {
  console.log('\n(push skipped — set SMOKE_PUSH=1 to test contributeContext)');
}
