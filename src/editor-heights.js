import { ViewPlugin } from "@codemirror/view";
import { composing } from "./composing.js";

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
const QUIET_MS = 600; // Wait after typing, keys, or pointer interaction.

export const measureAllLines = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.next = 0;
      this.idle = null;
      this.delay = 0;
      this.width = -1;
      this.pointerDown = false;
      this.quietAt = 0;
      this.onPointerDown = () => {
        this.pointerDown = true;
        this.defer();
      };
      this.onPointerUp = () => {
        this.pointerDown = false;
        this.defer();
      };
      this.onInputActivity = () => this.defer();
      view.dom.addEventListener("pointerdown", this.onPointerDown, true);
      view.win.addEventListener("pointerup", this.onPointerUp, true);
      view.win.addEventListener("pointercancel", this.onPointerUp, true);
      for (const name of ["keydown", "beforeinput", "input"])
        view.dom.addEventListener(name, this.onInputActivity, true);
      this.schedule(true);
    }
    defer() {
      this.quietAt = performance.now() + QUIET_MS;
      if (this.idle !== null || this.delay) {
        this.cancel();
        this.schedule();
      }
    }
    update(update) {
      if (update.docChanged && update.changes.length > 2000) {
        this.quietAt = performance.now() + QUIET_MS;
        this.cancel();
        this.schedule(true);
        return;
      }
      if (update.docChanged || update.selectionSet) {
        this.defer();
        return;
      }
      if (update.geometryChanged) {
        const width = this.view.contentDOM.clientWidth;
        if (width && width !== this.width) this.schedule(true);
      }
    }
    schedule(restart) {
      if (typeof this.view.measure !== "function") return;
      if (restart) this.next = 0;
      if (this.idle !== null || this.delay) return;
      const wait = Math.max(0, this.quietAt - performance.now());
      if (wait > 0 || this.pointerDown) {
        this.delay = setTimeout(
          () => {
            this.delay = 0;
            this.schedule();
          },
          Math.max(80, wait),
        );
        return;
      }
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
      // Not while the reader drags, selects, composes or types into the editor:
      // moving scrollTop mid-keystroke causes DOMObserver.onScroll -> flush(false)
      // before selectionchange updates, jumping the caret back one character.
      if (
        view.composing ||
        composing() ||
        view.inView === false ||
        this.pointerDown ||
        performance.now() < this.quietAt ||
        view.observer?.delayedFlush >= 0 ||
        view.observer?.selectionChanged
      )
        return this.schedule();
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
      let y = this.next,
        moved = false;
      while (
        y < scroller.scrollHeight &&
        (!moved || performance.now() - start < budget)
      ) {
        moved = true;
        scroller.scrollTop = y;
        view.measure();
        y += step;
      }
      if (moved) {
        // Put that character back where it was: near it by the measured
        // heights, then exactly by where it is drawn.
        scroller.scrollTop = keep + view.lineBlockAt(pos).top - line;
        view.measure();
        const after = view.coordsAtPos(pos, 1)?.top;
        if (before !== undefined && after !== undefined && after !== before) {
          scroller.scrollTop += after - before;
          view.measure();
        }
        const targetTop = scroller.scrollTop;
        scroller._measureTop = targetTop;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (scroller._measureTop === targetTop) scroller._measureTop = null;
          }),
        );
      }
      this.next = y;
      if (y < scroller.scrollHeight) this.schedule();
    }
    cancel() {
      if (this.delay) {
        clearTimeout(this.delay);
        this.delay = 0;
      }
      if (this.idle !== null) {
        (window.cancelIdleCallback || clearTimeout)(this.idle);
        this.idle = null;
      }
    }
    destroy() {
      this.cancel();
      this.view.dom.removeEventListener(
        "pointerdown",
        this.onPointerDown,
        true,
      );
      this.view.win.removeEventListener("pointerup", this.onPointerUp, true);
      this.view.win.removeEventListener(
        "pointercancel",
        this.onPointerUp,
        true,
      );
      for (const name of ["keydown", "beforeinput", "input"])
        this.view.dom.removeEventListener(name, this.onInputActivity, true);
    }
  },
);
