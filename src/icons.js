const paths = {
  highlight: '<path d="m14 3 7 7-8 8-7-7 8-8ZM6 11l-3 6 4 4 6-3M3 21h7"/>',
  textColor: '<path d="m6 17 6-14 6 14M8 12h8M4 21h16"/>',
  pencil: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  listBullet: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  listOrdered:
    '<path d="M10 6h11M10 12h11M10 18h11M3 3h1v6M3 9h3M3 13c4-2 4 1 1 3l-1 2h4"/>',
  task: '<rect x="3" y="5" width="7" height="7" rx="1"/><path d="m4 8 2 2 5-6M14 8h7M3 18h18"/>',
  quote:
    '<path d="M10 6H4v7h6V6Zm0 7c0 4-2 6-5 6M20 6h-6v7h6V6Zm0 7c0 4-2 6-5 6"/>',
  codeBlock:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m8 9-3 3 3 3m8-6 3 3-3 3m-3-7-2 10"/>',
  link: '<path d="m10 14 4-4m-6 2-2 2a4 4 0 0 0 6 6l3-3m1-5 2-2a4 4 0 0 0-6-6L9 7"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  table:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  export:
    '<path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  width: '<path d="M3 5v14M21 5v14M6 12h12m-9-3-3 3 3 3m6-6 3 3-3 3"/>',
  chevronLeft: '<path d="m14 6-6 6 6 6"/>',
  chevronRight: '<path d="m10 6 6 6-6 6"/>',
  outline: '<path d="M8 6h13M8 12h13M8 18h9M3 6h.1M3 12h.1M3 18h.1"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--panel)"/><circle cx="15" cy="17" r="3" fill="var(--panel)"/>',
  eye: '<path d="M2.5 12c2.6-4.5 5.7-6.8 9.5-6.8s6.9 2.3 9.5 6.8c-2.6 4.5-5.7 6.8-9.5 6.8S5.1 16.5 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  sidebar:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.7 8h.6m-.6 4h.6m-.6 4h.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6.5 6.5 11 11m0-11-11 11"/>',
  folder:
    '<path d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4H9l2 3h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V8Z"/><path d="M3 10h18"/>',
  open: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M13 11l8-8m-6 0h6v6"/>',
  save: '<path d="M18 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-3Z"/><path d="M7 3v6h9V3M7 21v-7h10v7M13 5v2"/>',
  refresh:
    '<path d="M20 9a8.3 8.3 0 0 0-14-3L3 9m0-5v5h5M4 15a8.3 8.3 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  theme:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/>',
};

export function icon(name) {
  const content = Object.hasOwn(paths, name) ? paths[name] : "";
  return content
    ? `<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`
    : "";
}
