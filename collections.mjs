// Navigation order and collection capabilities. Keep the HTML tab/panel contract in sync.
export const COLLECTIONS = [
  { key:'posters', tabId:'poster-tab', panelId:'poster-panel', label:'포스터 디자인', kind:'image', root:'output/poster-styles/' },
  { key:'motion', tabId:'motion-tab', panelId:'motion-panel', label:'모션 디자인', kind:'image', root:'output/motion-styles/', zip:'output/motion-styles.zip' }
];

export const newestFirst = items => [...items].sort((a, b) => b.number - a.number);

// Permanent mapping from the retired animation collection to its new poster entries.
export const ANIMATION_POSTER_MAP = Object.freeze({
  1:90, 2:91, 3:92, 4:93, 5:94, 6:95, 7:96, 8:97, 9:98, 10:99,
  11:100, 12:101, 13:102, 14:103, 15:104, 16:105, 17:106, 18:107, 19:108, 20:109
});

export function resolveCollectionHash(hash) {
  const legacy = /^#animation(?:\/(\d{1,2}))?$/.exec(hash);
  if (legacy) return { key:'posters', number:ANIMATION_POSTER_MAP[Number(legacy[1])] ?? null };
  const match = /^#(posters|motion)(?:\/(\d+))?$/.exec(hash);
  if (!match) return { key:'posters', number:null };
  const number = Number(match[2]);
  return { key:match[1], number:Number.isSafeInteger(number) && number > 0 ? number : null };
}
