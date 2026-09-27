// Multiple-choice knapsack: choose measured column widths with the fewest wraps.
// Costs come from real browser layout, including CJK, emphasis and inline math.
export function chooseColumnWidths(columns, available, step = 6) {
  const capacity = Math.floor(available / step);
  let states = new Map([[0, { cost: 0, widths: [] }]]);
  for (const options of columns) {
    const next = new Map();
    for (const [used, state] of states)
      for (const option of options) {
        const width = Math.ceil(option.width / step),
          total = used + width;
        if (total > capacity) continue;
        const cost = state.cost + option.cost;
        if (!next.has(total) || cost < next.get(total).cost)
          next.set(total, { cost, widths: [...state.widths, width * step] });
      }
    states = next;
  }
  let best = null,
    used = 0;
  for (const [width, state] of states)
    if (
      !best ||
      state.cost < best.cost ||
      (state.cost === best.cost && width > used)
    ) {
      best = state;
      used = width;
    }
  return best?.widths || null;
}
