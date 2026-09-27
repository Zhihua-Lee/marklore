import test from "node:test";
import assert from "node:assert/strict";
import { chooseColumnWidths } from "../src/table-widths.js";

test("column allocation minimizes measured wraps within the available width", () => {
  const columns = [
    [
      { width: 40, cost: 0 },
      { width: 80, cost: 0 },
    ],
    [
      { width: 100, cost: 20 },
      { width: 200, cost: 8 },
      { width: 300, cost: 0 },
    ],
    [
      { width: 100, cost: 8 },
      { width: 200, cost: 4 },
      { width: 300, cost: 2 },
    ],
  ];
  const widths = chooseColumnWidths(columns, 540, 10);
  assert.deepEqual(widths, [40, 300, 200]);
  assert.equal(chooseColumnWidths(columns, 200, 10), null);
});
