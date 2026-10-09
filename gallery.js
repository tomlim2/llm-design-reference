(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('poster-data').textContent);
  // Numbers follow the order in which studies were added to each collection.
  const newestFirst = items => [...items].sort((a, b) => b.number - a.number);
  const collections = {
    posters: { items:newestFirst(data.posters), root:'output/poster-styles/', label:'포스터 디자인' },
    motion: { items:newestFirst(data.motion), root:'output/motion-styles/', zip:'output/motion-styles.zip', label:'모션 디자인', downloadLabel:`모션 ${data.motion.length}장 다운로드` }
  };
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

  function setCollection(key, updateHash = false) {
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
    const archive = document.getElementById('archive-download');
    archive.hidden = !collection().zip;
    if (collection().zip) {
      archive.href = collection().zip;
      document.getElementById('archive-label').textContent = collection().downloadLabel;
    } else {
      archive.removeAttribute('href');
    }
    document.getElementById('prompts-download').href = collection().root + 'prompts.json';
    document.getElementById('collection-announcement').textContent = collection().label + ', ' + collection().items.length + '개 레퍼런스';
    if (updateHash) {
      try { history.replaceState(null, '', '#' + key); } catch { /* Local files may restrict history changes. */ }
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
    document.body.classList.remove('modal-open');
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
    const key = location.hash.slice(1);
    if (collections[key]) setCollection(key);
    else if (key === 'new-styles') setCollection('posters');
  }
  window.addEventListener('hashchange', collectionFromHash);
  collectionFromHash();
})();
