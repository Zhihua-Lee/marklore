const paths = {
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
