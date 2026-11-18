/** The list item a `?param` selects; an unknown or missing param selects the first item. */
export function pickSelected<T extends { id: string }>(items: T[], param: string | undefined): { selected: T | null; fromParam: boolean } {
  const hit = param ? items.find(i => i.id === param) : undefined
  return hit ? { selected: hit, fromParam: true } : { selected: items[0] ?? null, fromParam: false }
}
