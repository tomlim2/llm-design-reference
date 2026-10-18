import assert from 'node:assert/strict';
import { readFile, access, open } from 'node:fs/promises';
import { COLLECTIONS, ANIMATION_POSTER_MAP, POSTER_TAGS, filterByTags, newestFirst, resolveCollectionHash } from '../collections.mjs';
import { GUIDE_TYPES, compositionPaths } from '../composition-guides.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const html = await read('index.html');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const json = id => JSON.parse(html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`))[1]);
const data = json('poster-data');
assert.deepEqual(Object.keys(data).sort(), COLLECTIONS.map(item => item.key).sort(), 'Every data collection must have a tab');
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'DOM IDs must be unique across collection viewers');
assert.equal((markup.match(/<header\b/g) || []).length, 1, 'Use one shared header');
assert.equal((markup.match(/<main\b/g) || []).length, 1, 'Use one shared main');
assert.equal((markup.match(/<footer\b/g) || []).length, 1, 'Use one shared footer');
assert(!/<style\b/.test(markup), 'Shared styles belong in site.css');
assert(!/animation-tab|animation-panel|animation-dialog|animation-data|type="importmap"/.test(html), 'The retired animation UI and runtime must not return');
assert(!/animation\.mjs|\bthree\b/.test(await read('gallery.js')), 'The gallery must not load a 3D runtime');

const tabs = [...markup.matchAll(/<button\b[^>]*class="collection-tab"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
assert.deepEqual(tabs.map(tab => tab.match(/data-collection="([^"]+)"/)[1]), COLLECTIONS.map(item => item.key));
for (const [index, definition] of COLLECTIONS.entries()) {
  const { key, tabId, panelId, label } = definition;
  assert(definition.mediaLabel && definition.format && typeof definition.numberPrefix === 'string', key + ' explicit presentation metadata');
  assert.deepEqual(resolveCollectionHash('#' + key), {key, number:null}, key + ' list route');
  for (const item of data[key]) {
    assert.deepEqual(resolveCollectionHash(`#${key}/${item.number}`), {key, number:item.number}, key + ' detail route');
  }
  const tab = tabs[index];
  assert(tab.includes(`id="${tabId}"`) && tab.includes(`aria-controls="${panelId}"`) && tab.includes('role="tab"'), key + ' tab contract');
  assert(tab.includes(label), key + ' tab label');
  assert.equal(Number(tab.match(/<span>(\d+)<\/span>/)[1]), data[key].length, key + ' tab count');
  assert(markup.includes(`id="${panelId}" role="tabpanel" aria-labelledby="${tabId}"`), key + ' panel contract');
  assert.equal(new Set(data[key].map(item => item.number)).size, data[key].length, key + ' unique numbers');
  assert.equal(new Set(data[key].map(item => item.slug)).size, data[key].length, key + ' unique slugs');
  for (const item of data[key]) {
    assert(item.ko && item.title && item.description && item.prompt, key + ' complete metadata');
    if (item.variantOf !== undefined) {
      assert(Number.isInteger(item.variantOf) && item.variantOf < item.number, key + ' variants must reference an earlier entry');
      assert(data[key].some(original => original.number === item.variantOf), key + ' variant source must exist in the same collection');
    }
    if (definition.root) await access(new URL(definition.root + item.file, root));
  }
  if (definition.kind === 'image') {
    const start = markup.indexOf(`id="${panelId}"`);
    const end = markup.indexOf('</section>', start);
    const headings = [...markup.slice(start, end).matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1]);
    assert.deepEqual(headings, newestFirst(data[key]).map(item => item.ko), key + ' Korean titles in newest-first order');
    const cards = [...markup.slice(start, end).matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match => match[0]);
    assert.equal(cards.length, data[key].length, key + ' card count');
    for (const [cardIndex, card] of cards.entries()) {
      const item = newestFirst(data[key])[cardIndex];
      const number = definition.numberPrefix + String(item.number).padStart(2, '0');
      assert(card.includes(`<span class="number mono">${number}</span>`), key + ' visible number ' + number);
      const itemIndex = data[key].indexOf(item);
      assert.equal(card.match(/data-collection="([^"]+)"/)?.[1] || 'posters', key, key + ' card collection');
      assert(card.includes(`data-poster="${itemIndex}"`), key + ' card opens the correct item');
      assert(card.includes(`src="${definition.root}${item.file}"`), key + ' card image identity');
    }
  }
}
const total = Object.values(data).reduce((sum, items) => sum + items.length, 0);
assert(markup.includes(`컬렉션<sup>(${total})</sup>`), 'Collection total');

const migrated = data.posters.filter(item => item.migratedFrom?.collection === 'animation');
assert.equal(migrated.length, 20, 'All twenty animation styles must remain as posters');
assert.deepEqual(migrated.map(item => item.migratedFrom.number).sort((a, b) => a - b), Array.from({length:20}, (_, i) => i + 1));
assert.equal(new Set(migrated.map(item => item.migratedFrom.slug)).size, 20, 'Migration identities must be unique');
assert.deepEqual(Object.fromEntries(migrated.map(item => [item.migratedFrom.number, item.number])), ANIMATION_POSTER_MAP, 'Legacy route map must match migrated poster identities');
const prompts = (await read('output/poster-styles/prompts.json'));
const recorded = JSON.parse(prompts).styles;
const manifest = JSON.parse(await read('output/poster-styles/manifest.json'));
assert.equal(recorded.length, data.posters.length, 'Poster prompt count');
assert.equal(manifest.length, data.posters.length, 'Poster manifest count');
assert.equal(new Set(POSTER_TAGS).size, POSTER_TAGS.length, 'Keyword vocabulary must be unique');
for (const item of data.posters) {
  assert(Array.isArray(item.tags) && item.tags.length >= 3 && item.tags.length <= 5, `Poster ${item.number} needs 3–5 keywords`);
  assert.equal(new Set(item.tags).size, item.tags.length, `Poster ${item.number} has duplicate keywords`);
  assert(item.tags.every(tag => POSTER_TAGS.includes(tag)), `Poster ${item.number} has an unregistered keyword`);
  assert.deepEqual(recorded.find(entry => entry.number === item.number), item, `Poster ${item.number} prompt metadata must match the gallery`);
  assert.deepEqual(manifest.find(entry => entry.number === item.number)?.tags, item.tags, `Poster ${item.number} manifest keywords`);
}
assert(POSTER_TAGS.every(tag => data.posters.some(item => item.tags.includes(tag))), 'Do not offer empty keyword categories');

const composition = COLLECTIONS.find(item => item.key === 'composition');
const compositionPrompts = JSON.parse(await read(composition.root + 'prompts.json')).styles;
const compositionManifest = JSON.parse(await read(composition.root + 'manifest.json'));
assert.deepEqual(compositionPrompts, data.composition, 'Composition prompt metadata must match the gallery');
assert.equal(compositionManifest.length, data.composition.length, 'Composition manifest count');
assert.equal(new Set(compositionManifest.map(item => item.number)).size, data.composition.length, 'Composition manifest identities');
for (const item of data.composition) {
  assert(item.principle && GUIDE_TYPES.includes(item.guide?.type), 'Composition needs a principle and known guide');
  const paths = compositionPaths(item.guide);
  assert(paths.length && paths.every(path => path.d && !/NaN|undefined|Infinity/.test(path.d)), 'Composition guide coordinates');
  const entry = compositionManifest.find(entry => entry.number === item.number);
  assert.equal(entry.status, 'complete', 'Composition image generation completed');
  for (const field of ['file', 'width', 'height', 'guide', 'reference', 'variantOf']) {
    assert.deepEqual(entry[field], item[field], `Composition ${item.number} manifest ${field}`);
  }
  const file = await open(new URL(composition.root + item.file, root), 'r');
  try {
    const header = Buffer.alloc(24);
    await file.read(header, 0, header.length, 0);
    assert.equal(header.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([header.readUInt32BE(16), header.readUInt32BE(20)], [item.width, item.height], 'Composition PNG dimensions');
  } finally { await file.close(); }
}
assert.deepEqual(compositionPaths({type:'unknown'}), [], 'Unknown guides are not rendered');
assert.equal(compositionPaths({type:'golden'}).length, 16, 'Eight golden squares with quarter-circle arcs');
assert.equal(compositionPaths({type:'radial'}).length, 12, 'Twelve radial spokes');
assert.deepEqual(COLLECTIONS.filter(item => item.imageDownload).map(item => item.key), ['motion'], 'Image downloads belong only to motion');

// Filtering must intersect selections, preserve newest-first order and never mutate source data.
const samples = Object.freeze([
  Object.freeze({number:3, tags:Object.freeze(['레트로', '미래적인'])}),
  Object.freeze({number:2, tags:Object.freeze(['레트로', '따뜻한'])}),
  Object.freeze({number:1, tags:Object.freeze(['미래적인', '어두운'])})
]);
assert.deepEqual(filterByTags(samples, []), samples, 'No filter returns every item');
assert.deepEqual(filterByTags(samples, ['레트로']).map(item => item.number), [3, 2], 'One tag keeps source order');
assert.deepEqual(filterByTags(samples, new Set(['레트로', '미래적인'])).map(item => item.number), [3], 'Multiple tags use AND');
assert.deepEqual(filterByTags(samples, ['따뜻한', '어두운']), [], 'Nonmatching combination returns no items');
assert.deepEqual(filterByTags(samples, ['없는 태그']), [], 'Unknown keyword cannot broaden results');
assert.deepEqual(filterByTags(samples, []), samples, 'Clearing a filter restores all entries');
for (const item of migrated) {
  assert.deepEqual(recorded.find(entry => entry.number === item.number), item, 'Migrated poster prompt metadata');
  const file = manifest.find(entry => entry.number === item.number);
  assert(file && file.status === 'complete' && file.file === item.file, 'Migrated poster must have a completed image');
  assert.deepEqual(file.migratedFrom, item.migratedFrom, 'Manifest migration identity');
  assert.equal(file.variantOf, item.variantOf, 'Manifest variant identity');
  assert.deepEqual(resolveCollectionHash('#animation/' + String(item.migratedFrom.number).padStart(2, '0')), {key:'posters', number:item.number});
}
for (const [hash, expected] of [
  ['', { key:'posters', number:null }], ['#top', { key:'posters', number:null }],
  ['#motion', { key:'motion', number:null }], ['#animation', { key:'posters', number:null }],
  ['#animation/01', { key:'posters', number:90 }], ['#animation/20', { key:'posters', number:109 }],
  ['#posters/109', { key:'posters', number:109 }], ['#motion/5', { key:'motion', number:5 }],
  ['#animation/99', { key:'posters', number:null }], ['#posters/0', { key:'posters', number:null }],
  ['#unknown', { key:'posters', number:null }], ['#new-styles', { key:'posters', number:null }]
]) assert.deepEqual(resolveCollectionHash(hash), expected, 'Route ' + hash);

const workflow = await read('.github/workflows/deploy.yml');
const archive = workflow.match(/git archive HEAD([\s\S]*?)\| tar/)[1];
const assets = ['index.html', 'site.css', 'gallery.js', 'collections.mjs', 'composition-guides.mjs', 'animation.html', ...COLLECTIONS.map(item => item.root.replace(/\/$/, ''))];
for (const asset of assets) {
  await access(new URL(asset, root));
  assert(archive.split(/\s+/).includes(asset), asset + ' must ship in the deployment archive');
}
const legacy = await read('animation.html');
assert(legacy.includes("location.replace('./index.html#posters'") && legacy.includes('resolveCollectionHash'), 'Legacy animation links must use the shared poster migration map');
assert(!/<header\b|<style\b/.test(legacy), 'Do not recreate a separate animation shell');
assert(!/animation\.css|animation\.mjs|animation-styles\.mjs/.test(workflow), 'Retired runtime files must not ship');
console.log(`Collection contracts passed: ${COLLECTIONS.length} tabs, ${total} entries, unique IDs and complete deployment assets.`);
