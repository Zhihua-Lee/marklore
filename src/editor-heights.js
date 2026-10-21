import { ViewPlugin } from "@codemirror/view";

// CodeMirror measures only the lines near the screen and estimates the rest
// from a character count. With wrapped lines (more so Chinese, twice as wide
// as the characters it counts) the estimate fell short by 20–45%, so the
// scrollbar shrank and jumped all the way down a long note (50 times on an
// 1,800-line one). In idle time this walks the note once, a slice at a time,
// so every line has been measured: each slice scrolls, measures and puts the
// view back within one task, keeping the line at the top where it was, so
// nothing moves on screen. Again after the note or the width changes.
//
// view.measure() is CodeMirror's own (not public) synchronous measure; without
// it, nothing is done.
const MARGIN = 1000; // CodeMirror draws this far beyond the screen
const BUDGET = 12; // ms per idle slice

export const measureAllLines = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.next = 0;
      this.idle = null;
      this.width = -1;
      this.schedule(true);
    }
    update(update) {
      if (update.docChanged && update.changes.length > 2000)
        this.schedule(true);
      else if (update.geometryChanged) {
        const width = this.view.contentDOM.clientWidth;
        if (width && width !== this.width) this.schedule(true);
      }
    }
    schedule(restart) {
      if (typeof this.view.measure !== "function") return;
      if (restart) this.next = 0;
      if (this.idle !== null) return;
      this.idle = (window.requestIdleCallback || ((fn) => setTimeout(fn, 200)))(
        (deadline) => this.slice(deadline),
        { timeout: 2000 },
      );
    }
    slice(deadline) {
      this.idle = null;
      const { view } = this,
        scroller = view.scrollDOM;
      if (!view.dom.isConnected || !scroller.clientHeight) return;
      // Not while the reader drags, selects or types into the editor.
      if (view.composing || view.inView === false) return this.schedule();
      this.width = view.contentDOM.clientWidth;
      const start = performance.now(),
        budget = Math.max(
          4,
          Math.min(BUDGET, deadline?.timeRemaining() ?? BUDGET),
        );
      // The line at the top of the screen, and where its start is drawn (its
      // start: a character at a wrap is ambiguous). Taken before measuring,
      // which can itself move the view.
      const box = scroller.getBoundingClientRect(),
        x = view.contentDOM.getBoundingClientRect().left + 1,
        pos = view.state.doc.lineAt(
          view.posAtCoords({ x, y: box.top + 1 }, false),
        ).from,
        before = view.coordsAtPos(pos, 1)?.top;
      // What is on screen first, so the line kept at the top has its real
      // height (a scroll since the last frame may not have been measured).
      view.measure();
      const keep = scroller.scrollTop,
        line = view.lineBlockAt(pos).top;
      const step = scroller.clientHeight + MARGIN * 1.5;
      let y = this.next;
      while (y < scroller.scrollHeight && performance.now() - start < budget) {
        scroller.scrollTop = y;
        view.measure();
        y += step;
      }
      // Put that character back where it was: near it by the measured
      // heights, then exactly by where it is drawn.
      scroller.scrollTop = keep + view.lineBlockAt(pos).top - line;
      view.measure();
      const after = view.coordsAtPos(pos, 1)?.top;
      if (before !== undefined && after !== undefined && after !== before) {
        scroller.scrollTop += after - before;
        view.measure();
      }
      this.next = y;
      if (y < scroller.scrollHeight) this.schedule();
    }
    destroy() {
      if (this.idle === null) return;
      (window.cancelIdleCallback || clearTimeout)(this.idle);
      this.idle = null;
    }
  },
);
