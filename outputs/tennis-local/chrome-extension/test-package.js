import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const files=JSON.parse(fs.readFileSync(new URL('../../../runtime-files.json',import.meta.url),'utf8'));
test('production package has a closed runtime dependency graph and no test overrides',()=>{
 assert.equal(new Set(files).size,files.length);
 const manifest=JSON.parse(fs.readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.host_permissions,['https://tennistowerhamlets.com/*','https://js.stripe.com/*']);
 assert.deepEqual(manifest.permissions,['storage','alarms','notifications']);
 for(const file of files){
  assert.match(file,/^[a-z0-9.-]+$/i);assert.ok(fs.existsSync(new URL(file,import.meta.url)));
  assert.ok(!file.includes('fixture')&&!file.includes('scenario')&&!file.includes('fake-'));
  if(!file.endsWith('.js'))continue;
  const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/localhost|127\.0\.0\.1|fake-payment|TEST_ONLY/);
  for(const [,dep] of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))assert.ok(files.includes(dep),`Unpackaged dependency ${dep}`);
 }
});
