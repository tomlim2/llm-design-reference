// Host for the 3D animation tab. Initialized lazily by gallery.js; drives one
// shared WebGL renderer: live thumbnails are rendered one after another and copied into each
// card's 2D canvas; the dialog viewer takes the renderer canvas over while it is open.
export function initializeAnimationGallery({ styles, onSelect, onClose }) {
  const data = styles;
  let active = false;
  let frameId = null;
  const $ = id => document.getElementById('animation-' + id);
  const pad = n => String(n).padStart(2, '0');
  const gallery = $('gallery');
  const dialog = $('dialog');
  const stage = $('stage');
  const notice = $('notice');
  const motionToggle = $('motion-toggle');
  const playToggle = $('toggle-play');
  const copyButton = $('copy-prompt');
  const announcement = $('viewer-announcement');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const THUMB_FPS = 30;
  // How many thumbnails may animate at once. The governor lowers it when a thumbnail pass takes
  // too long for the frame budget and raises it back slowly; running on battery caps it.
  const LIVE_MAX = 8, LIVE_MIN = 3;
  const governor = { budget: (navigator.hardwareConcurrency || 8) <= 4 ? 4 : LIVE_MAX, cap: LIVE_MAX, ema: 0, adjustedAt: 0 };

  // ---------------------------------------------------------------- cards and detail panel
  const cards = data.map((style, index) => {
    const article = document.createElement('article');
    article.className = 'study';
    article.id = 'style-' + pad(style.number);
    article.innerHTML =
      '<button class="scene-trigger" type="button" aria-haspopup="dialog">' +
        '<canvas class="scene-thumb" aria-hidden="true"></canvas><span class="scene-fallback"></span>' +
        '<span class="open-hint" aria-hidden="true">크게 보기 <span>↗</span></span></button>' +
      '<div class="caption"><span class="number mono"></span><h2></h2></div><p class="study-description"></p>';
    const button = article.querySelector('button');
    button.setAttribute('aria-label', style.ko + ' 애니메이션 크게 보기');
    article.querySelector('.number').textContent = pad(style.number);
    article.querySelector('h2').textContent = style.ko;
    article.querySelector('.study-description').textContent = style.description;
    gallery.appendChild(article);
    const canvas = article.querySelector('canvas');
    return {
      index, style, button, canvas, ctx2d: canvas.getContext('2d'),
      fallback: article.querySelector('.scene-fallback'),
      pointer: { x: 0, y: 0, tx: 0, ty: 0 },
      instance: null, visible: false, hovered: false, distance: 0, failed: false, needsFrame: true, t: 0
    };
  });

  let current = 0;
  let trigger = null;

  function showStyle(index) {
    current = Math.max(0, Math.min(data.length - 1, index));
    const style = data[current];
    $('detail-title').textContent = style.ko;
    $('english-name').textContent = style.title;
    $('detail-description').textContent = style.description + '.';
    $('viewer-counter').textContent = pad(current + 1) + ' / ' + data.length;
    $('technique').replaceChildren(...style.technique.map(name => { const li = document.createElement('li'); li.textContent = name; return li; }));
    $('prompt-text').textContent = style.prompt;
    $('prompt-details').open = false;
    copyButton.textContent = '프롬프트 복사';
    $('prev-style').disabled = current === 0;
    $('next-style').disabled = current === data.length - 1;
    announcement.textContent = (current + 1) + '번째 스타일, ' + style.ko;
    dialog.querySelector('.detail').scrollTop = 0;
    dialog.querySelector('.viewer').scrollTop = 0;
    onSelect(style.number);
  }

  // ---------------------------------------------------------------- shared renderer
  const three = { ready: false, THREE: null, renderer: null, canvas: null, builders: null, failure: '' };
  const thumb = { w: 1, h: 1, dpr: Math.min(window.devicePixelRatio || 1, 1.5) };
  const view = { instance: null, playing: !reducedMotion, t: 0, w: 1, h: 1, dpr: Math.min(window.devicePixelRatio || 1, 2), pointer: { x: 0, y: 0, tx: 0, ty: 0 }, mounted: false };
  let motionOn = !reducedMotion;
  let contextLost = false;
  let lastFrame = performance.now();
  let lastThumb = 0;

  function setMotion(on) {
    motionOn = on;
    motionToggle.setAttribute('aria-pressed', String(on));
    $('motion-toggle-label').textContent = on ? '미리보기 일시정지' : '미리보기 재생';
    $('instruction').textContent = on ? '카드를 열면 움직임을 크게 볼 수 있습니다.' : '미리보기를 멈췄습니다. 카드를 열면 크게 볼 수 있습니다.';
    cards.forEach(card => { card.needsFrame = true; });
  }

  function setPlaying(on) {
    view.playing = on;
    playToggle.setAttribute('aria-pressed', String(on));
    playToggle.textContent = on ? '일시정지' : '재생';
  }

  function failCard(card, error) {
    console.error('[' + card.style.slug + ']', error);
    card.failed = true;
    disposeInstance(card.instance);
    card.instance = null;
    card.button.classList.add('is-failed');
    card.fallback.textContent = '이 장면을 렌더링하지 못했습니다';
  }

  function degrade(message) {
    three.failure = message;
    notice.hidden = false;
    notice.textContent = message + ' 스타일 설명과 프롬프트는 카드를 클릭해 볼 수 있습니다.';
    $('instruction').textContent = '카드를 클릭하면 설명과 프롬프트를 볼 수 있습니다';
    cards.forEach(card => { card.failed = true; card.button.classList.add('is-failed'); card.fallback.textContent = '실시간 미리보기를 사용할 수 없습니다'; });
    if (dialog.open) showStageError(message);
  }

  function showStageError(message) {
    let box = stage.querySelector('.stage-error');
    if (!box) { box = document.createElement('p'); box.className = 'stage-error'; stage.prepend(box); }
    box.textContent = message;
  }
  function clearStageError() { const box = stage.querySelector('.stage-error'); if (box) box.remove(); }

  function disposeInstance(instance) {
    if (!instance) return;
    try {
      if (instance.dispose) instance.dispose();
      instance.scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        const own = texture => texture && texture.isTexture && !texture.isRenderTargetTexture && !(texture.userData && texture.userData.shared);
        materials.forEach(material => {
          Object.values(material).forEach(value => { if (own(value)) value.dispose(); });
          if (material.uniforms) Object.values(material.uniforms).forEach(uniform => { if (uniform && own(uniform.value)) uniform.value.dispose(); });
          material.dispose();
        });
      });
      const background = instance.scene.background;
      if (background && background.isTexture && !(background.userData && background.userData.shared)) background.dispose();
    } catch (error) { console.error(error); }
  }

  function sizeInstance(instance, w, h) {
    if (instance.resize) instance.resize(w, h);
    else if (instance.camera.isPerspectiveCamera) { instance.camera.aspect = w / h; instance.camera.updateProjectionMatrix(); }
  }

  function buildInstance(slug, pointer, quality, w, h) {
    const builder = three.builders.get(slug);
    if (!builder) throw new Error('No scene registered for ' + slug);
    const dpr = quality === 'full' ? view.dpr : thumb.dpr;
    const instance = builder.build({ THREE: three.THREE, renderer: three.renderer, pointer, quality, dpr, width: w, height: h });
    sizeInstance(instance, w, h);
    return instance;
  }

  function renderInstance(instance, t, dt) {
    const { renderer, THREE } = three;
    renderer.toneMapping = instance.toneMapping || THREE.NoToneMapping;
    renderer.toneMappingExposure = instance.exposure || 1;
    instance.update(t, dt);
    if (instance.render) instance.render(); else renderer.render(instance.scene, instance.camera);
  }

  function smoothPointer(pointer, k) {
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    return Math.abs(pointer.tx - pointer.x) + Math.abs(pointer.ty - pointer.y) > 0.002;
  }

  function applyThumbSize() {
    if (!active) return;
    const sample = cards[0].button;
    const w = Math.max(1, sample.clientWidth), h = Math.max(1, sample.clientHeight);
    const changed = w !== thumb.w || h !== thumb.h;
    thumb.w = w; thumb.h = h;
    cards.forEach(card => {
      const pw = Math.floor(w * thumb.dpr), ph = Math.floor(h * thumb.dpr);
      if (card.canvas.width !== pw || card.canvas.height !== ph) { card.canvas.width = pw; card.canvas.height = ph; card.needsFrame = true; }
      if (card.instance && changed) sizeInstance(card.instance, w, h);
    });
    if (three.ready && !view.mounted) { three.renderer.setPixelRatio(thumb.dpr); three.renderer.setSize(w, h, false); }
  }

  let lastVisibility = -1000;
  function updateVisibility(now) {
    if (now - lastVisibility < 150) return;
    lastVisibility = now;
    const margin = 160, height = window.innerHeight;
    cards.forEach(card => {
      const rect = card.button.getBoundingClientRect();
      card.visible = rect.bottom > -margin && rect.top < height + margin && rect.width > 0;
      card.distance = Math.abs((rect.top + rect.bottom) / 2 - height / 2);
    });
  }

  function adjustGovernor(now, cost) {
    governor.ema = governor.ema ? governor.ema * 0.9 + cost * 0.1 : cost;
    if (now - governor.adjustedAt < 2000) return;
    if (governor.ema > 12 && governor.budget > LIVE_MIN) { governor.budget--; governor.adjustedAt = now; }
    else if (governor.ema < 5 && governor.budget < governor.cap && now - governor.adjustedAt > 5000) { governor.budget++; governor.adjustedAt = now; }
  }
  if (navigator.getBattery) {
    navigator.getBattery().then(battery => {
      const apply = () => {
        governor.cap = battery.charging ? LIVE_MAX : battery.level <= 0.2 ? LIVE_MIN : 6;
        governor.budget = Math.min(governor.budget, governor.cap);
      };
      apply();
      battery.addEventListener('chargingchange', apply);
      battery.addEventListener('levelchange', apply);
    }).catch(() => {});
  }

  function renderThumbs(now) {
    if (view.mounted || contextLost) return;
    const elapsed = (now - lastThumb) / 1000;
    if (elapsed < 1 / (THUMB_FPS + 2)) return;
    lastThumb = now;
    updateVisibility(now);
    const dt = Math.min(elapsed, 0.1);
    // The hovered card and the cards nearest the viewport centre animate; the rest keep their last frame.
    const candidates = cards.filter(card => card.visible && !card.failed).sort((a, b) => (b.hovered - a.hovered) || (a.distance - b.distance));
    const start = performance.now();
    let builds = 0, rendered = 0;
    candidates.forEach((card, rank) => {
      const live = motionOn && rank < governor.budget;
      if (!card.instance) {
        if (builds > 0) return; // One expensive build (geometry + shader compile) per pass keeps scrolling smooth.
        builds++;
        try { card.instance = buildInstance(card.style.slug, card.pointer, 'thumb', thumb.w, thumb.h); } catch (error) { failCard(card, error); return; }
      }
      const pointerMoving = smoothPointer(card.pointer, 0.14);
      if (!live && !card.needsFrame && !pointerMoving) return;
      if (live) card.t += dt;
      try {
        renderInstance(card.instance, card.t, live ? dt : 0);
        card.ctx2d.drawImage(three.canvas, 0, 0, card.canvas.width, card.canvas.height);
        card.needsFrame = false;
        rendered++;
      } catch (error) { failCard(card, error); }
    });
    if (builds === 0 && rendered > 0) adjustGovernor(now, performance.now() - start);
  }

  function renderView(dt) {
    if (!view.instance || contextLost) return;
    if (view.playing) view.t += dt;
    smoothPointer(view.pointer, 0.1);
    try { renderInstance(view.instance, view.t, view.playing ? dt : 0); }
    catch (error) { console.error(error); disposeInstance(view.instance); view.instance = null; showStageError('이 장면을 렌더링하는 중 오류가 났습니다: ' + error.message); }
  }

  function frame(now) {
    frameId = null;
    if (!active || document.hidden) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (three.ready) { if (view.mounted) renderView(dt); else renderThumbs(now); }
    frameId = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- dialog viewer
  function mountView() {
    if (!three.ready || view.mounted) return;
    clearStageError();
    stage.prepend(three.canvas);
    view.mounted = true;
    view.pointer.x = view.pointer.y = view.pointer.tx = view.pointer.ty = 0;
    applyViewSize();
  }

  function applyViewSize() {
    if (!view.mounted) return;
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    view.w = w; view.h = h;
    three.renderer.setPixelRatio(view.dpr);
    three.renderer.setSize(w, h, false);
    if (view.instance) sizeInstance(view.instance, w, h);
    $('render-size').textContent = Math.floor(w * view.dpr) + ' × ' + Math.floor(h * view.dpr);
  }

  function loadView(index) {
    disposeInstance(view.instance);
    view.instance = null;
    view.t = 0;
    if (!three.ready) { if (three.failure) showStageError(three.failure); return; }
    mountView();
    try { view.instance = buildInstance(data[index].slug, view.pointer, 'full', view.w, view.h); clearStageError(); }
    catch (error) { console.error(error); showStageError('이 장면을 만들지 못했습니다: ' + error.message); }
  }

  function unmountView() {
    disposeInstance(view.instance);
    view.instance = null;
    if (view.mounted) { three.canvas.remove(); view.mounted = false; applyThumbSize(); }
    clearStageError();
  }

  function openDialog(index, source) {
    trigger = source || null;
    showStyle(index);
    setPlaying(motionOn);
    if (!dialog.open) { dialog.showModal(); document.body.classList.add('modal-open'); }
    loadView(current);
    dialog.querySelector('.viewer').scrollTop = 0;
  }

  function goTo(index) { showStyle(index); loadView(current); }

  cards.forEach(card => {
    card.button.addEventListener('click', () => openDialog(card.index, card.button));
    card.button.addEventListener('pointermove', event => {
      const rect = card.button.getBoundingClientRect();
      card.hovered = true;
      card.pointer.tx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      card.pointer.ty = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    });
    card.button.addEventListener('pointerleave', () => { card.hovered = false; card.pointer.tx = 0; card.pointer.ty = 0; });
  });
  stage.addEventListener('pointermove', event => {
    const rect = stage.getBoundingClientRect();
    view.pointer.tx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    view.pointer.ty = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  });
  stage.addEventListener('pointerleave', () => { view.pointer.tx = 0; view.pointer.ty = 0; });

  $('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // A queued close event must not affect a reopened viewer.
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    unmountView();
    if (active) onClose();
    if (trigger && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
  });
  let backdropPointer = false;
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', event => { backdropPointer = outside(event); });
  dialog.addEventListener('click', event => { if (backdropPointer && outside(event)) dialog.close(); backdropPointer = false; });
  $('prev-style').addEventListener('click', () => goTo(current - 1));
  $('next-style').addEventListener('click', () => goTo(current + 1));
  playToggle.addEventListener('click', () => setPlaying(!view.playing));
  $('restart').addEventListener('click', () => loadView(current));
  dialog.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' && current > 0) { event.preventDefault(); goTo(current - 1); }
    if (event.key === 'ArrowRight' && current < data.length - 1) { event.preventDefault(); goTo(current + 1); }
    if (event.key === ' ' && !event.target.closest('button,summary,a,input,textarea')) { event.preventDefault(); setPlaying(!view.playing); }
  });
  copyButton.addEventListener('click', async () => {
    const selected = current;
    const text = data[current].prompt;
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
    if (selected !== current || !dialog.open) return;
    copyButton.textContent = copied ? '복사했습니다 ✓' : '프롬프트를 선택해 복사해주세요';
    announcement.textContent = copied ? '프롬프트를 복사했습니다.' : '자동 복사를 할 수 없습니다. 위 텍스트를 선택해 복사해주세요.';
  });
  motionToggle.addEventListener('click', () => setMotion(!motionOn));

  function syncFrames() {
    if (active && !document.hidden) {
      lastFrame = performance.now();
      if (frameId === null) frameId = requestAnimationFrame(frame);
    } else if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  function close() { if (dialog.open) dialog.close(); }
  function setActive(on) {
    active = on;
    if (!on) {
      close();
      cards.forEach(card => { disposeInstance(card.instance); card.instance = null; card.needsFrame = true; });
    } else {
      lastVisibility = -1000;
      applyThumbSize();
    }
    syncFrames();
  }

  function openStyle(number) {
    const index = data.findIndex(style => style.number === number);
    if (index >= 0) { if (!dialog.open || index !== current) openDialog(index, null); }
    else close();
  }

  // ---------------------------------------------------------------- boot
  new ResizeObserver(() => applyThumbSize()).observe(gallery);
  new ResizeObserver(() => applyViewSize()).observe(stage);
  document.addEventListener('visibilitychange', syncFrames);
  setMotion(motionOn);

  (async () => {
    let THREE, module;
    try {
      [THREE, module] = await Promise.all([import('three'), import('./animation-styles.mjs?v=20261010-2')]);
    } catch (error) {
      console.error(error);
      degrade('Three.js를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 새로고침해 주세요.');
      return;
    }
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    } catch (error) {
      console.error(error);
      degrade('이 브라우저에서는 WebGL을 사용할 수 없습니다.');
      return;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(thumb.dpr);
    renderer.setSize(thumb.w, thumb.h, false);
    const canvas = renderer.domElement;
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { contextLost = false; cards.forEach(card => { card.needsFrame = true; }); });
    three.THREE = THREE;
    three.renderer = renderer;
    three.canvas = canvas;
    three.builders = new Map(module.createStyles(THREE).map(style => [style.slug, style]));
    three.ready = true;
    motionToggle.hidden = false;
    applyThumbSize();
    if (dialog.open) loadView(current);
  })();

  return { setActive, openStyle, close };
}
