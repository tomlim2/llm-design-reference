// Navigation order and collection capabilities. Keep the HTML tab/panel contract in sync.
export const COLLECTIONS = [
  { key:'posters', tabId:'poster-tab', panelId:'poster-panel', label:'포스터 디자인', kind:'image', root:'output/poster-styles/' },
  { key:'motion', tabId:'motion-tab', panelId:'motion-panel', label:'모션 디자인', kind:'image', root:'output/motion-styles/', zip:'output/motion-styles.zip' },
  { key:'animation', tabId:'animation-tab', panelId:'animation-panel', label:'3D 애니메이션', kind:'animation' }
];

export const newestFirst = items => [...items].sort((a, b) => b.number - a.number);

export function resolveCollectionHash(hash) {
  const match = /^#animation(?:\/(\d{1,2}))?$/.exec(hash);
  if (match) return { key:'animation', number:match[1] ? Number(match[1]) : null };
  const key = hash.slice(1);
  return { key:COLLECTIONS.some(item => item.key === key) ? key : 'posters', number:null };
}
