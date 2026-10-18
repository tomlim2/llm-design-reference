// Navigation order and collection capabilities. Keep the HTML tab/panel contract in sync.
export const COLLECTIONS = [
  { key:'posters', numberPrefix:'', tabId:'poster-tab', panelId:'poster-panel', label:'포스터 디자인', kind:'image', root:'output/poster-styles/', mediaLabel:'포스터', format:'2:3 세로형', tags:true },
  { key:'motion', numberPrefix:'M', tabId:'motion-tab', panelId:'motion-panel', label:'모션 디자인', kind:'image', root:'output/motion-styles/', mediaLabel:'정지 스타일 프레임', format:'정지 스타일 프레임', landscape:true, motionNotes:true, imageDownload:true, zip:'output/motion-styles.zip' },
  { key:'composition', numberPrefix:'C', tabId:'composition-tab', panelId:'composition-panel', label:'컴포지션', kind:'image', root:'output/composition-styles/', mediaLabel:'구도 예시', format:'8:5 가로형', landscape:true, guides:true }
];

export const newestFirst = items => [...items].sort((a, b) => b.number - a.number);

// Shared vocabulary for poster mood tags. Each poster carries 3–5 of these labels.
export const POSTER_TAGS = Object.freeze([
  '세련된', '모던한', '우아한', '섬세한', '몽환적인', '강렬한', '키치한',
  '깔끔한 조형', '힙한', '레트로', '컬러풀한', '깔끔한 구성', '빈티지',
  '파격적인', '화려한', '어두운', '암울한', '따뜻한', '귀여운', '유기적인',
  '기하학적인', '미래적인', '손맛이 있는', '차분한', '실험적인'
]);

// Multiple selections narrow the results: every selected keyword must match.
export function filterByTags(items, selectedTags) {
  const required = [...selectedTags];
  return items.filter(item => required.every(tag => item.tags?.includes(tag)));
}

// Permanent mapping from the retired animation collection to its new poster entries.
export const ANIMATION_POSTER_MAP = Object.freeze({
  1:90, 2:91, 3:92, 4:93, 5:94, 6:95, 7:96, 8:97, 9:98, 10:99,
  11:100, 12:101, 13:102, 14:103, 15:104, 16:105, 17:106, 18:107, 19:108, 20:109
});

export function resolveCollectionHash(hash) {
  const legacy = /^#animation(?:\/(\d{1,2}))?$/.exec(hash);
  if (legacy) return { key:'posters', number:ANIMATION_POSTER_MAP[Number(legacy[1])] ?? null };
  const match = /^#([a-z]+)(?:\/(\d+))?$/.exec(hash);
  if (!match || !COLLECTIONS.some(item => item.key === match[1])) return { key:'posters', number:null };
  const number = Number(match[2]);
  return { key:match[1], number:Number.isSafeInteger(number) && number > 0 ? number : null };
}
