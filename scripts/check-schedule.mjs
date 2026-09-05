// Boundary tests for the school timetable resolver (assets/js/schedule.js).
// All expectations are in China Standard Time (UTC+8). Run: node scripts/check-schedule.mjs
import { chinaParts, describeDay, resolveStatus, statusText } from "../assets/js/schedule.js";

// 2026-09-07 is a Monday, 2026-09-05 a Saturday, 2026-09-06 a Sunday (UTC dates below).
const DAY = {
  monday: [2026, 8, 7],
  tuesday: [2026, 8, 8],
  friday: [2026, 8, 11],
  saturday: [2026, 8, 5],
  sunday: [2026, 8, 6],
};

// Build an absolute instant for HH:MM in CST on the given day.
function at(day, hhmm) {
  const [y, m, d] = DAY[day];
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m, d, h - 8, min));
}

const cases = [
  // Monday boundaries (Part 36 test table).
  ["monday", "06:49", "travel-to", null],
  ["monday", "06:50", "morning-reading", "english"],
  ["monday", "07:25", "break", null],
  ["monday", "07:30", "class", "chinese"],
  ["monday", "08:10", "break", null],
  ["monday", "08:20", "class", "math"],
  ["monday", "09:50", "eye-exercise", null],
  ["monday", "09:55", "big-break", null],
  ["monday", "10:30", "class", "chemistry"],
  ["monday", "11:10", "break", null],
  ["monday", "11:20", "class", "geography"],
  ["monday", "12:00", "lunch", null],
  ["monday", "14:20", "noon-reading", null],
  ["monday", "14:30", "class", "psychology"],
  ["monday", "16:00", "eye-exercise", null],
  ["monday", "16:10", "class", "classMeeting"],
  ["monday", "16:50", "activity", null],
  ["monday", "19:00", "tutoring", null],
  ["monday", "19:40", "self-study", null],
  ["monday", "21:20", "break", null],
  ["monday", "21:30", "self-study", null],
  ["monday", "22:30", "free", null],
  ["monday", "23:00", "sleep", null],
  // No stale subjects during gaps.
  ["monday", "08:15", "break", null],
  ["monday", "10:27", "break", null],
  // Sunday is always rest, never a subject.
  ["sunday", "00:00", "rest", null],
  ["sunday", "10:30", "rest", null],
  ["sunday", "23:59", "rest", null],
  // Saturday special timetable (never the weekday one).
  ["saturday", "06:50", "morning-reading", "chinese"],
  ["saturday", "07:30", "class", "chemistry"],
  ["saturday", "08:20", "class", "history"],
  ["saturday", "09:10", "class", "chinese"],
  ["saturday", "09:50", "big-break", null],
  ["saturday", "10:10", "class", "physics"],
  ["saturday", "11:00", "class", "politics"],
  ["saturday", "14:30", "class", "math"],
  ["saturday", "15:20", "class", "english"],
  ["saturday", "16:00", "activity", null],
  ["saturday", "16:20", "self-study", null],
  ["saturday", "17:40", "class", "geography"],
  ["saturday", "18:30", "class", "biology"],
  ["saturday", "19:10", "free", null],
  // Friday activity ends at 17:35, other weekdays at 17:40.
  ["friday", "17:34", "activity", null],
  ["friday", "17:35", "dinner", null],
  ["monday", "17:39", "activity", null],
  ["monday", "17:40", "dinner", null],
  // Travel windows (~20 min each way).
  ["monday", "06:30", "travel-to", null],
  ["monday", "22:40", "travel-home", null],
  ["saturday", "19:20", "travel-home", null],
];

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`  ❌ ${message}`);
};

for (const [day, time, kind, subject] of cases) {
  const status = resolveStatus(at(day, time));
  if (status.kind !== kind) {
    fail(`${day} ${time}: expected kind "${kind}", got "${status.kind}"`);
    continue;
  }
  if (subject && status.slot?.subject !== subject) {
    fail(`${day} ${time}: expected subject "${subject}", got "${status.slot?.subject}"`);
  }
  if (subject === null && status.slot?.subject && (kind === "class" || kind === "morning-reading")) {
    fail(`${day} ${time}: expected no stale subject, got "${status.slot.subject}"`);
  }
}

// Monday 19:00 tutoring must carry both evening subjects without inventing a split.
{
  const status = resolveStatus(at("monday", "19:10"));
  const subjects = status.subjects || [];
  if (status.kind !== "tutoring" || subjects.join(",") !== "chemistry,politics") {
    fail(`monday 19:10: expected combined tutoring [chemistry,politics], got ${JSON.stringify(status)}`);
  }
}

// Timezone independence: the same absolute instant resolves identically no
// matter which visitor timezone interprets it (Date is absolute; CST shift is fixed).
{
  const instant = new Date(Date.UTC(2026, 8, 6, 22, 50)); // Monday 06:50 CST
  const parts = chinaParts(instant);
  if (parts.weekday !== 1 || parts.hours !== 6 || parts.minutes !== 50) {
    fail(`chinaParts: expected Monday 06:50 CST, got weekday=${parts.weekday} ${parts.hours}:${parts.minutes}`);
  }
  const status = resolveStatus(instant);
  if (status.kind !== "morning-reading" || status.slot?.subject !== "english") {
    fail(`timezone check: expected Monday English reading, got ${JSON.stringify(status)}`);
  }
}

// Visitor-facing wording in all three locales.
{
  const status = resolveStatus(at("monday", "08:30"));
  const zh = statusText(status, "zh");
  const en = statusText(status, "en");
  const ja = statusText(status, "ja");
  if (zh !== "现在大概在上数学课") fail(`zh wording: got "${zh}"`);
  if (en !== "Probably in Mathematics class right now") fail(`en wording: got "${en}"`);
  if (ja !== "今は数学の授業中かも") fail(`ja wording: got "${ja}"`);
  const rest = statusText(resolveStatus(at("sunday", "10:00")), "zh");
  if (rest.includes("数学") || rest.includes("课")) fail(`sunday wording leaks a subject: "${rest}"`);
}

// Day view shape.
{
  const sunday = describeDay(at("sunday", "10:00"));
  if (!sunday.isRestDay || sunday.slots.length !== 0) fail("describeDay sunday should be a rest day with no slots");
  const monday = describeDay(at("monday", "10:00"));
  if (monday.isRestDay || monday.slots.length === 0) fail("describeDay monday should list timed slots");
  if (monday.slots.some((slot) => !slot.start || !slot.end || !slot.type)) fail("describeDay monday slots need start/end/type");
}

if (failures) {
  console.error(`check-schedule: ${failures} 个问题`);
  process.exit(1);
}
console.log(`check-schedule: OK（${cases.length} 个边界用例、三语文案与 CST 换算通过）`);
