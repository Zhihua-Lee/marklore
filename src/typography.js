// Keep ordinary text at its regular weight across zoom levels. Optical sizing
// handles small glyphs; a zoom change must not silently embolden the document.
export function readingWeight({ weight }) {
  if ([400, 450, 500, 600].includes(Number(weight))) return Number(weight);
  return 400;
}
