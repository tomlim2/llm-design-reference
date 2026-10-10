import { COLLECTIONS, newestFirst, resolveCollectionHash } from './collections.mjs?v=20261010';

(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('poster-data').textContent);
  data.animation = JSON.parse(document.getElementById('animation-data').textContent).styles;
  const collections = Object.fromEntries(COLLECTIONS.map(definition => [definition.key, {
    ...definition, items:newestFirst(data[definition.key])
  }]));
  const animationPrompts = URL.createObjectURL(new Blob([JSON.stringify({
    generationMode:'Three.js realtime scenes written as code',
    assetType:'Live 3D animation style studies',
    source:'Twenty animation style names supplied by the user',
    styles:data.animation
  }, null, 2)], { type:'application/json' }));
  let animationGallery = null;
  let animationLoading = null;
  let selectionRequest = 0;

  function updateHash(hash, replace = false) {
    if (location.hash === '#' + hash) return;
    try { history[replace ? 'replaceState' : 'pushState'](null, '', '#' + hash); } catch { /* Local files may restrict history changes. */ }
  }

  function loadAnimations() {
    if (!animationLoading) {
      animationLoading = import('./animation.mjs?v=20261010').then(module => {
        animationGallery = module.initializeAnimationGallery({
          styles:collections.animation.items,
          onSelect:number => updateHash('animation/' + String(number).padStart(2, '0'), true),
          onClose:() => { if (activeCollection === 'animation') updateHash('animation', true); }
        });
        return animationGallery;
      }).catch(error => {
        animationLoading = null;
        throw error;
      });
    }
    return animationLoading;
  }
  const dialog = document.getElementById('poster-dialog');
  const image = document.getElementById('detail-image');
  const promptDetails = document.getElementById('prompt-details');
  const copyButton = document.getElementById('copy-prompt');
  const previous = document.getElementById('prev-poster');
  const next = document.getElementById('next-poster');
  const announcement = document.getElementById('viewer-announcement');
  const tabs = [...document.querySelectorAll('.collection-tab')];
  let activeCollection = 'posters';
  let current = 0;
  let trigger = null;
  const collection = () => collections[activeCollection];

  function setCollection(key, updateUrl = false, styleNumber = null) {
    if (!collections[key]) return;
    const request = ++selectionRequest;
    if (dialog.open) dialog.close();
    activeCollection = key;
    current = 0;
    if (key !== 'animation') animationGallery?.setActive(false);
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
    prompts.href = key === 'animation' ? animationPrompts : selected.root + 'prompts.json';
    prompts.download = key + '-prompts.json';
    document.getElementById('collection-announcement').textContent = selected.label + ', ' + selected.items.length + '개 레퍼런스';
    if (updateUrl) updateHash(key);
    if (key === 'animation') {
      loadAnimations().then(controller => {
        // Ignore a slow load after the user has already selected another tab/route.
        if (request !== selectionRequest || activeCollection !== 'animation') return;
        controller.setActive(true);
        controller.openStyle(styleNumber);
      }).catch(error => {
        console.error(error);
        const notice = document.getElementById('animation-notice');
        notice.hidden = false;
        notice.textContent = '애니메이션을 불러오지 못했습니다. 다른 탭으로 이동했다가 다시 열어 주세요.';
      });
    }
  }

  function selectPoster(index) {
    const items = collection().items;
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
    document.getElementById('study-kind').textContent = isMotion ? '모션 디자인 · 정지 프레임' : '포스터 디자인';
    document.getElementById('viewer-counter').textContent = String(current + 1).padStart(2, '0') + ' / ' + items.length;
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
      trigger = button;
      const study = data[key][Number(button.dataset.poster)];
      selectPoster(collection().items.indexOf(study));
      dialog.showModal();
      document.body.classList.add('modal-open');
      dialog.querySelector('.viewer').scrollTop = 0;
    });
  });
  document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // A queued close event must not affect a reopened viewer.
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
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
    if (event.key === 'ArrowRight' && current < collection().items.length - 1) { event.preventDefault(); selectPoster(current + 1); }
  });
  copyButton.addEventListener('click', async () => {
    const selectedIndex = current;
    const selectedCollection = activeCollection;
    const text = collection().items[current].prompt;
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
    setCollection(route.key, false, route.number);
  }
  window.addEventListener('hashchange', collectionFromHash);
  collectionFromHash();
})();
