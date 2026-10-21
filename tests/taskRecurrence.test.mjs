import assert from "node:assert/strict";
import { test } from "node:test";
import { rolldown } from "rolldown";

// Bundle the production TypeScript and its local imports without writing build files.
async function loadModule(path) {
  const bundle = await rolldown({ input: path, platform: "node" });
  try {
    const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
    return await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
  } finally {
    await bundle.close();
  }
}

const { parseTaskRecurrence, recurrenceDraft, recurrenceMatches, recurrenceLabel, stampRecurrence, calendarPlansOnDay } =
  await loadModule("src/lib/taskRecurrence.ts");
const { translate } = await loadModule("src/lib/i18n.ts");
const parse = (rule) => parseTaskRecurrence(JSON.stringify(rule));

test("existing monthly dates default to forward counting and keep their start date", () => {
  const raw = JSON.stringify({ kind: "monthly-day", days: [1, 31], since: "2026-01-01" });
  const rule = parseTaskRecurrence(raw);
  assert.equal(rule.direction, "forward");
  assert.equal(recurrenceMatches(rule, new Date(2026, 3, 1)), true);
  assert.equal(recurrenceMatches(rule, new Date(2026, 3, 30)), false);
  const saved = parseTaskRecurrence(stampRecurrence(raw, recurrenceDraft(rule), new Date(2026, 9, 16)));
  assert.equal(saved.since, "2026-01-01");
});

test("backward monthly dates follow month length, including leap February", () => {
  const last = parse({ kind: "monthly-day", direction: "backward", days: [1] });
  for (const [year, month, end] of [[2026, 0, 31], [2026, 3, 30], [2026, 1, 28], [2028, 1, 29], [2026, 11, 31]]) {
    assert.equal(recurrenceMatches(last, new Date(year, month, end)), true);
    assert.equal(recurrenceMatches(last, new Date(year, month, end - 1)), false);
  }
  const multiple = parse({ kind: "monthly-day", direction: "backward", days: [1, 2, 31] });
  assert.equal(recurrenceMatches(multiple, new Date(2026, 3, 29)), true);
  assert.equal(recurrenceMatches(multiple, new Date(2026, 3, 1)), false);
  assert.equal(recurrenceMatches(multiple, new Date(2026, 0, 1)), true);
});

test("changing direction resets the start date and persists through editing", () => {
  const raw = JSON.stringify({ kind: "monthly-day", days: [1], since: "2026-01-01" });
  const rule = parseTaskRecurrence(stampRecurrence(raw, {
    kind: "monthly-day", direction: "backward", days: [1],
  }, new Date(2026, 9, 16)));
  assert.equal(rule.since, "2026-10-16");
  assert.deepEqual(recurrenceDraft(rule), { kind: "monthly-day", direction: "backward", days: [1] });
  assert.equal(recurrenceLabel(rule, "zh", (key, vars) => translate("zh", key, vars)), "每月倒数第1天");
  assert.equal(recurrenceLabel(rule, "en", (key, vars) => translate("en", key, vars)), "Day 1 from the end of each month");
});

test("calendar plans use backward dates for both task and habit templates", () => {
  const recurrence = JSON.stringify({ kind: "monthly-day", direction: "backward", days: [1], since: "2026-10-01" });
  const tasks = [
    { id: "task", title: "Task", category_id: null, parent_id: null, recurrence, start_at: null },
    { id: "habit", title: "Habit", category_id: "checkin", parent_id: null, recurrence, start_at: null },
  ];
  const now = new Date(2026, 9, 16);
  assert.deepEqual(calendarPlansOnDay(tasks, new Date(2026, 9, 31), now).map(({ task }) => task.id), ["task", "habit"]);
  assert.deepEqual(calendarPlansOnDay(tasks, new Date(2026, 9, 30), now), []);
});
