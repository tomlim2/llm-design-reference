import { COLLECTIONS, POSTER_TAGS, filterByTags, newestFirst, resolveCollectionHash } from './collections.mjs?v=20261018-tags';

(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('poster-data').textContent);
  const collections = Object.fromEntries(COLLECTIONS.map(definition => [definition.key, {
    ...definition, items:newestFirst(data[definition.key])
  }]));

  function updateHash(hash, replace = false) {
    if (location.hash === '#' + hash) return;
    try { history[replace ? 'replaceState' : 'pushState'](null, '', '#' + hash); } catch { /* Local files may restrict history changes. */ }
  }

  const dialog = document.getElementById('poster-dialog');
  const image = document.getElementById('detail-image');
  const promptDetails = document.getElementById('prompt-details');
  const copyButton = document.getElementById('copy-prompt');
  const previous = document.getElementById('prev-poster');
  const next = document.getElementById('next-poster');
  const announcement = document.getElementById('viewer-announcement');
  const tabs = [...document.querySelectorAll('.collection-tab')];
  const selectedTags = new Set();
  const filterPanel = document.getElementById('tag-filters');
  const filterOptions = document.getElementById('tag-options');
  const posterCards = [...document.querySelectorAll('#poster-panel [data-poster]')].map(button => ({
    element:button.closest('.study'), study:data.posters[Number(button.dataset.poster)]
  }));
  let activeCollection = 'posters';
  let current = 0;
  let trigger = null;
  const collection = () => collections[activeCollection];
  const visibleItems = () => activeCollection === 'posters'
    ? filterByTags(collection().items, selectedTags) : collection().items;

  function tagElement(tag, interactive = false) {
    const element = document.createElement(interactive ? 'button' : 'span');
    element.className = 'tag';
    element.textContent = tag;
    if (interactive) {
      element.type = 'button';
      element.dataset.tag = tag;
      element.setAttribute('aria-pressed', 'false');
      const check = document.createElement('span');
      check.className = 'tag-check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      element.appendChild(check);
    }
    return element;
  }

  function applyTagFilter() {
    const matches = new Set(filterByTags(collections.posters.items, selectedTags));
    posterCards.forEach(({element, study}) => { element.hidden = !matches.has(study); });
    document.querySelectorAll('button[data-tag]').forEach(button => {
      button.setAttribute('aria-pressed', String(selectedTags.has(button.dataset.tag)));
    });
    const count = selectedTags.size;
    document.getElementById('tag-selection').textContent = count ? [...selectedTags].join(' · ') : '분위기를 골라보세요';
    document.getElementById('filter-count').textContent = count
      ? `${matches.size} / ${collections.posters.items.length}개 · 최신순` : '최신순';
    document.getElementById('filter-announcement').textContent = count
      ? `${[...selectedTags].join(', ')} 모두 포함: 포스터 ${matches.size}개` : `전체 포스터 ${matches.size}개`;
    document.getElementById('clear-tags').disabled = !count;
    document.getElementById('filter-empty').hidden = matches.size > 0;
    document.getElementById('new-styles').hidden = matches.size === 0;
  }

  POSTER_TAGS.forEach(tag => filterOptions.appendChild(tagElement(tag, true)));
  posterCards.forEach(({element, study}) => {
    const list = document.createElement('div');
    list.className = 'study-tags';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', study.ko + ' 키워드');
    study.tags.forEach(tag => list.appendChild(tagElement(tag, true)));
    element.appendChild(list);
  });
  document.getElementById('poster-panel').addEventListener('click', event => {
    const button = event.target.closest('button[data-tag]');
    if (!button) return;
    const tag = button.dataset.tag;
    if (selectedTags.has(tag)) selectedTags.delete(tag);
    else selectedTags.add(tag);
    applyTagFilter();
    if (button.closest('.study')) {
      filterPanel.open = true;
      filterPanel.scrollIntoView({block:'start'});
      [...filterOptions.children].find(option => option.dataset.tag === tag).focus({preventScroll:true});
    }
  });
  document.querySelectorAll('[data-clear-tags]').forEach(button => button.addEventListener('click', () => {
    selectedTags.clear();
    applyTagFilter();
    filterPanel.querySelector('summary').focus({preventScroll:true});
  }));
  filterPanel.hidden = false;
  document.getElementById('clear-tags').hidden = false;
  applyTagFilter();

  function setCollection(key, updateUrl = false, styleNumber = null) {
    if (!collections[key]) return;
    if (dialog.open) dialog.close();
    activeCollection = key;
    current = 0;
    tabs.forEach(tab => {
      const selected = tab.dataset.collection === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    });
    const selected = collection();
    const archive = document.getElementById('archive-download');
    archive.hidden = !selected.zip;
    if (selected.zip) {
      archive.href = selected.zip;
      document.getElementById('archive-label').textContent = `모션 ${selected.items.length}장 다운로드`;
    } else {
      archive.removeAttribute('href');
    }
    const prompts = document.getElementById('prompts-download');
    prompts.href = selected.root + 'prompts.json';
    prompts.download = key + '-prompts.json';
    document.getElementById('collection-announcement').textContent = selected.label + ', ' + selected.items.length + '개 레퍼런스';
    if (updateUrl) updateHash(key);
    if (styleNumber !== null) {
      // A shared link must open its target even if the current filter excludes it.
      if (key === 'posters' && selected.items.some(item => item.number === styleNumber)
          && !visibleItems().some(item => item.number === styleNumber)) {
        selectedTags.clear();
        applyTagFilter();
      }
      const index = visibleItems().findIndex(item => item.number === styleNumber);
      if (index >= 0) openPoster(index, document.getElementById(selected.tabId));
      else updateHash(key, true);
    }
  }

  function selectPoster(index) {
    const items = visibleItems();
    current = Math.max(0, Math.min(items.length - 1, index));
    const study = items[current];
    const isMotion = activeCollection === 'motion';
    const path = collection().root + study.file;
    dialog.classList.toggle('motion-view', isMotion);
    image.src = path;
    image.alt = study.ko + (isMotion ? ' 스타일 프레임: ' : ' 포스터: ') + study.description;
    image.width = study.width;
    image.height = study.height;
    document.getElementById('detail-title').textContent = study.ko;
    document.getElementById('english-name').textContent = study.title;
    document.getElementById('detail-description').textContent = study.description + '.';
    const detailTags = document.getElementById('detail-tags');
    detailTags.replaceChildren(...(study.tags || []).map(tag => tagElement(tag)));
    detailTags.hidden = isMotion;
    document.getElementById('study-kind').textContent = isMotion ? '모션 디자인 · 정지 프레임' : '포스터 디자인';
    document.getElementById('viewer-counter').textContent = (selectedTags.size && !isMotion ? '필터 결과 · ' : '')
      + String(current + 1).padStart(2, '0') + ' / ' + items.length;
    document.getElementById('motion-notes').hidden = !isMotion;
    document.getElementById('motion-direction').textContent = study.motion || '';
    document.getElementById('motion-rhythm').textContent = study.rhythm || '';
    document.getElementById('motion-usage').textContent = study.usage || '';
    document.getElementById('image-size').textContent = study.width + ' × ' + study.height;
    document.getElementById('image-format').textContent = isMotion ? '정지 스타일 프레임' : '2:3 세로형';
    const download = document.getElementById('download-image');
    download.hidden = !isMotion;
    if (isMotion) {
      download.href = path;
      download.download = study.file;
    } else {
      download.removeAttribute('href');
      download.removeAttribute('download');
    }
    document.getElementById('prompt-text').textContent = study.prompt;
    promptDetails.open = false;
    copyButton.textContent = '프롬프트 복사';
    previous.disabled = current === 0;
    next.disabled = current === items.length - 1;
    announcement.textContent = (current + 1) + '번째 레퍼런스, ' + study.ko;
    dialog.querySelector('.detail').scrollTop = 0;
    dialog.querySelector('.viewer').scrollTop = 0;
    updateHash(activeCollection + '/' + study.number, true);
  }

  function openPoster(index, source) {
    trigger = source;
    selectPoster(index);
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('modal-open');
    dialog.querySelector('.viewer').scrollTop = 0;
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setCollection(tab.dataset.collection, true));
    tab.addEventListener('keydown', event => {
      let target = index;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      else return;
      event.preventDefault();
      setCollection(tabs[target].dataset.collection, true);
      tabs[target].focus();
    });
  });

  document.querySelectorAll('[data-poster]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.collection || 'posters';
      if (key !== activeCollection) setCollection(key);
      const study = data[key][Number(button.dataset.poster)];
      openPoster(visibleItems().indexOf(study), button);
    });
  });
  document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // A queued close event must not affect a reopened viewer.
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    const route = resolveCollectionHash(location.hash);
    if (route.key === activeCollection && route.number === visibleItems()[current]?.number) updateHash(activeCollection, true);
    if (trigger && trigger.getClientRects().length) trigger.focus({preventScroll:true});
  });
  let backdropPointer = false;
  function outside(event) {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  dialog.addEventListener('pointerdown', event => { backdropPointer = outside(event); });
  dialog.addEventListener('click', event => {
    if (backdropPointer && outside(event)) dialog.close();
    backdropPointer = false;
  });
  previous.addEventListener('click', () => selectPoster(current - 1));
  next.addEventListener('click', () => selectPoster(current + 1));
  dialog.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' && current > 0) { event.preventDefault(); selectPoster(current - 1); }
    if (event.key === 'ArrowRight' && current < visibleItems().length - 1) { event.preventDefault(); selectPoster(current + 1); }
  });
  copyButton.addEventListener('click', async () => {
    const selectedIndex = current;
    const selectedCollection = activeCollection;
    const text = visibleItems()[current].prompt;
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
      dialog.appendChild(field);
      field.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      field.remove();
      copyButton.focus();
    }
    if (selectedIndex !== current || selectedCollection !== activeCollection || !dialog.open) return;
    copyButton.textContent = copied ? '복사했습니다 ✓' : '프롬프트를 선택해 복사해주세요';
    announcement.textContent = copied ? '생성 프롬프트를 복사했습니다.' : '자동 복사를 할 수 없습니다. 위 텍스트를 선택해 복사해주세요.';
  });
  function collectionFromHash() {
    const route = resolveCollectionHash(location.hash);
    if (location.hash.startsWith('#animation')) updateHash('posters' + (route.number === null ? '' : '/' + route.number), true);
    setCollection(route.key, false, route.number);
  }
  window.addEventListener('hashchange', collectionFromHash);
  collectionFromHash();
})();
