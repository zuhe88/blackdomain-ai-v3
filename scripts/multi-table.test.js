const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createMultiTableTracker } = require("../modules/baccarat/multiTable");

function history(results, shoeKey = "shoe-1") {
  return Array.from(results, (result, index) => ({
    result, shoeKey, roundIndex: index + 1, eventKey: `${shoeKey}:${index + 1}`,
  }));
}

test("multi-table scores only issued rounds, independently by table and shoe", () => {
  const tracker = createMultiTableTracker();
  const prefix = "莊莊莊莊莊莊";
  const first = tracker.update("A", history(prefix));
  assert.match(first.prediction, /^[莊閒]$/);
  const other = tracker.update("B", history(prefix));
  const next = tracker.update("A", history(prefix + first.prediction + "和和"));
  assert.equal(next.correct, 1);
  assert.equal(next.incorrect, 0);
  assert.equal(tracker.update("A", history(prefix + first.prediction + "和和")), next);
  assert.equal(tracker.update("B", history(prefix)), other);
  assert.equal(other.correct, 0);
  const opposite = other.prediction === "莊" ? "閒" : "莊";
  const missed = tracker.update("B", history(prefix + opposite));
  assert.equal(missed.correct, 0);
  assert.equal(missed.incorrect, 1);
  assert.equal(tracker.update("A", history(prefix, "shoe-2")).correct, 1);
  assert.equal(tracker.update("A", history(prefix, "shoe-2"), true).correct, 1);
  assert.equal(tracker.update("A", []).correct, 1);
  tracker.resetAtEmptyShoe("A");
  assert.equal(tracker.get("A").correct, 0);
  assert.equal(tracker.update("A", history(prefix, "shoe-3")).correct, 0);
  assert.equal(tracker.get("B").incorrect, 1);
});
