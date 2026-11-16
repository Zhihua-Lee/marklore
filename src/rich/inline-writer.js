// Writing the text of a block with its marks (bold, italic, strike, links,
// inline HTML such as highlight and colour, code) as Markdown.
//
// prosemirror-markdown opens marks in the order the schema ranks them and
// keeps a mark open while the next piece of text has it, so marks whose runs
// cross were written cut through each other's delimiters: a highlight over
// "Some bold" in `Some **bold $z$ words**` came out as
// `<mark>Some **bold **</mark>**$z$ words**`, whose first `**` never closes.
// Here the marks of each piece are put in an order that nests: a mark whose
// run holds another's is outside it; of two runs that cross, bold, italic,
// strike and links stay whole and inline HTML closes before their
// delimiters and opens again inside them (as Read mode's format bar does);
// of bold, italic and strike, bold stays whole, then italic; else the one
// going on longer stays whole. Code is innermost. Spaces at the
// edge of a run of bold, italic or strike go outside its delimiters also
// where the run is closed to let another mark close.
import { MarkdownSerializerState } from "prosemirror-markdown";

// The marks of each child of `parent` in writing order, outermost first.
export function markOrders(parent, { hardBreak = "hard_break", raw } = {}) {
  const lists = [];
  for (let index = 0; index < parent.childCount; index++) {
    const node = parent.child(index);
    let marks = node.marks;
    // A line break last in a mark is outside it (as prosemirror-markdown
    // has it), so the mark closes before the break.
    if (node.type.name === hardBreak)
      marks = marks.filter((m) => {
        if (index + 1 === parent.childCount) return false;
        const next = parent.child(index + 1);
        return m.isInSet(next.marks) && (!next.isText || /\S/.test(next.text));
      });
    lists.push(marks);
  }
  const runOf = (index, mark) => {
    let from = index,
      to = index;
    while (from > 0 && mark.isInSet(lists[from - 1])) from--;
    while (to + 1 < lists.length && mark.isInSet(lists[to + 1])) to++;
    return [from, to];
  };
  const orders = [];
  let before = [];
  lists.forEach((marks, index) => {
    const info = marks.map((mark, rank) => ({
      mark,
      rank,
      run: runOf(index, mark),
      raw: !!raw?.(mark),
      html: mark.type.name === "html",
      was: before.findIndex((m) => m.eq(mark)),
    }));
    info.sort((a, b) => {
      if (a.raw !== b.raw) return a.raw ? 1 : -1;
      const [af, at] = a.run;
      const [bf, bt] = b.run;
      if (af !== bf || at !== bt) {
        if (af <= bf && at >= bt) return -1;
        if (bf <= af && bt >= at) return 1;
        if (a.html !== b.html) return a.html ? 1 : -1;
        return a.mark.type.rank - b.mark.type.rank || bt - at;
      }
      if (a.was >= 0 && b.was >= 0) return a.was - b.was;
      if (a.was !== b.was) return a.was >= 0 ? -1 : 1;
      return a.rank - b.rank;
    });
    before = info.map((x) => x.mark);
    orders.push(before);
  });
  return orders;
}

const shared = (a, b, len = a.length) => {
  let k = 0;
  while (k < len && k < b.length && a[k].eq(b[k])) k++;
  return k;
};

export class InlineWriterState extends MarkdownSerializerState {
  renderInline(parent, fromBlockStart = true) {
    this.atBlockStart = fromBlockStart;
    const info = (mark) => this.getMark(mark.type.name);
    const orders = markOrders(parent, {
      hardBreak: this.options.hardBreakNodeName,
      raw: (mark) => info(mark).escape === false,
    });
    const expels = (mark) => info(mark)?.expelEnclosingWhitespace;
    let active = [],
      trailing = "";
    const progress = (node, index) => {
      let marks = node ? orders[index] : [];
      const inner = marks.length ? marks[marks.length - 1] : null;
      const noEsc = inner && info(inner).escape === false;
      const len = marks.length - (noEsc ? 1 : 0);
      const keep = shared(marks, active, Math.min(active.length, len));
      let leading = trailing;
      trailing = "";
      let gone = false;
      // A mark opened here: the spaces it starts with go before it.
      if (
        node?.isText &&
        marks.some((mark, i) => i < len && i >= keep && expels(mark))
      ) {
        const [, lead, rest] = /^(\s*)(.*)$/m.exec(node.text);
        if (lead) {
          leading += lead;
          node = rest ? node.withText(rest) : null;
          gone = !node;
        }
      }
      // A mark closed after this: the spaces it ends with go after it.
      if (node?.isText) {
        const next = index + 1 < parent.childCount ? orders[index + 1] : [];
        const stays = shared(marks, next, len);
        if (marks.some((mark, i) => i < len && i >= stays && expels(mark))) {
          const [, rest, trail] = /^(.*?)(\s*)$/m.exec(node.text);
          if (trail) {
            trailing = trail;
            node = rest ? node.withText(rest) : null;
            gone = !node;
          }
        }
      }
      if (node || gone || index === parent.childCount)
        while (keep < active.length)
          this.text(this.markString(active.pop(), false, parent, index), false);
      if (leading) this.text(leading);
      if (!node) return;
      while (active.length < len) {
        const add = marks[active.length];
        active.push(add);
        this.text(this.markString(add, true, parent, index), false);
        this.atBlockStart = false;
      }
      if (noEsc && node.isText)
        this.text(
          this.markString(inner, true, parent, index) +
            node.text +
            this.markString(inner, false, parent, index + 1),
          false,
        );
      else this.render(node, parent, index);
      this.atBlockStart = false;
    };
    parent.forEach((node, _offset, index) => progress(node, index));
    progress(null, parent.childCount);
    this.atBlockStart = false;
  }
}

// The serializer's own serialize(), with this state.
export function useInlineWriter(serializer) {
  serializer.serialize = function (content, options = {}) {
    const state = new InlineWriterState(this.nodes, this.marks, {
      ...this.options,
      ...options,
    });
    state.renderContent(content);
    return state.out;
  };
  return serializer;
}
