const { predict } = require("./ai");

function createMultiTableTracker() {
  const tables = new Map();

  function update(room, history, reset = false) {
    const latest = history.at(-1);
    if (!latest) {
      tables.delete(room);
      return null;
    }

    const { shoeKey, roundIndex, eventKey } = latest;
    let current = tables.get(room);
    if (!reset && current?.eventKey === eventKey && current.result === latest.result) {
      return current;
    }

    if (reset || !current || current.shoeKey !== shoeKey || roundIndex <= current.roundIndex) {
      current = null;
    }
    const settled = current && history.find(record =>
      record.shoeKey === shoeKey && record.roundIndex === current.nextRound
    );
    let correct = current?.correct || 0;
    let incorrect = current?.incorrect || 0;
    if (settled && settled.result !== "和" && ["莊", "閒"].includes(current.prediction)) {
      const hit = settled.result === current.prediction;
      correct = hit ? correct + 1 : 0;
      incorrect = hit ? 0 : incorrect + 1;
    }

    const next = {
      shoeKey,
      roundIndex,
      eventKey,
      result: latest.result,
      nextRound: roundIndex + 1,
      prediction: predict(history.slice(-50).map(record => record.result)),
      correct,
      incorrect,
    };
    tables.set(room, next);
    return next;
  }

  return { update };
}

module.exports = { createMultiTableTracker };
