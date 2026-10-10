import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { COLLECTIONS, newestFirst, resolveCollectionHash } from '../collections.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const html = await read('index.html');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const json = id => JSON.parse(html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`))[1]);
const data = { ...json('poster-data'), animation:json('animation-data').styles };
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'DOM IDs must be unique across collection viewers');
assert.equal((markup.match(/<header\b/g) || []).length, 1, 'Use one shared header');
assert.equal((markup.match(/<main\b/g) || []).length, 1, 'Use one shared main');
assert.equal((markup.match(/<footer\b/g) || []).length, 1, 'Use one shared footer');
assert(!/<style\b/.test(markup), 'Shared styles belong in site.css');
assert(!/href="animation\.html/.test(markup), 'Animation navigation belongs in the tab list');

const tabs = [...markup.matchAll(/<button\b[^>]*class="collection-tab"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
assert.deepEqual(tabs.map(tab => tab.match(/data-collection="([^"]+)"/)[1]), COLLECTIONS.map(item => item.key));
for (const [index, definition] of COLLECTIONS.entries()) {
  const { key, tabId, panelId, label } = definition;
  const tab = tabs[index];
  assert(tab.includes(`id="${tabId}"`) && tab.includes(`aria-controls="${panelId}"`) && tab.includes('role="tab"'), key + ' tab contract');
  assert(tab.includes(label), key + ' tab label');
  assert.equal(Number(tab.match(/<span>(\d+)<\/span>/)[1]), data[key].length, key + ' tab count');
  assert(markup.includes(`id="${panelId}" role="tabpanel" aria-labelledby="${tabId}"`), key + ' panel contract');
  assert.equal(new Set(data[key].map(item => item.number)).size, data[key].length, key + ' unique numbers');
  assert.equal(new Set(data[key].map(item => item.slug)).size, data[key].length, key + ' unique slugs');
  for (const item of data[key]) {
    assert(item.ko && item.title && item.description && item.prompt, key + ' complete metadata');
    if (definition.root) await access(new URL(definition.root + item.file, root));
  }
  if (definition.kind === 'image') {
    const start = markup.indexOf(`id="${panelId}"`);
    const end = markup.indexOf('</section>', start);
    const headings = [...markup.slice(start, end).matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1]);
    assert.deepEqual(headings, newestFirst(data[key]).map(item => item.ko), key + ' Korean titles in newest-first order');
  }
}
const total = Object.values(data).reduce((sum, items) => sum + items.length, 0);
assert(markup.includes(`컬렉션<sup>(${total})</sup>`), 'Collection total');

const builders = [...(await read('animation-styles.mjs')).matchAll(/STYLES\.push\(\{\s*slug:\s*'([^']+)'/g)].map(match => match[1]);
assert.deepEqual([...builders].sort(), data.animation.map(item => item.slug).sort(), 'Every 3D entry needs exactly one scene');
for (const [hash, expected] of [
  ['', { key:'posters', number:null }], ['#top', { key:'posters', number:null }],
  ['#motion', { key:'motion', number:null }], ['#animation', { key:'animation', number:null }],
  ['#animation/01', { key:'animation', number:1 }], ['#new-styles', { key:'posters', number:null }]
]) assert.deepEqual(resolveCollectionHash(hash), expected, 'Route ' + hash);

const workflow = await read('.github/workflows/deploy.yml');
const archive = workflow.match(/git archive HEAD([\s\S]*?)\| tar/)[1];
const assets = ['index.html', 'site.css', 'animation.css', 'gallery.js', 'collections.mjs', 'animation.mjs', 'animation-styles.mjs', 'animation.html'];
for (const asset of assets) {
  await access(new URL(asset, root));
  assert(archive.split(/\s+/).includes(asset), asset + ' must ship in the deployment archive');
}
const legacy = await read('animation.html');
assert(legacy.includes("location.replace('./index.html#animation'"), 'Keep legacy animation links working');
assert(!/<header\b|<style\b/.test(legacy), 'Do not recreate a separate animation shell');
console.log(`Collection contracts passed: ${COLLECTIONS.length} tabs, ${total} entries, unique IDs and complete deployment assets.`);
