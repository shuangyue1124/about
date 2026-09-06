// Boundary tests for the school timetable resolver (assets/js/schedule.js).
// All expectations are in China Standard Time (UTC+8). Run: node scripts/check-schedule.mjs
import { chinaParts, describeDay, resolveStatus, statusText } from "../assets/js/schedule.js";

// 2026-09-07 is a Monday, 2026-09-05 a Saturday, 2026-09-06 a Sunday (UTC dates below).
const DAY = {
  monday: [2026, 8, 7],
  tuesday: [2026, 8, 8],
  wednesday: [2026, 8, 9],
  thursday: [2026, 8, 10],
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
  // Monday boundaries (new spec: flag ceremony 9:55-10:25, self-study 16:10,
  // class meeting 16:50-17:30, combined tutoring 17:30-19:00, dinner 19:00).
  ["monday", "06:49", "travel-to", null],
  ["monday", "06:50", "morning-reading", "english"],
  ["monday", "07:25", "break", null],
  ["monday", "07:30", "class", "chinese"],
  ["monday", "08:10", "break", null],
  ["monday", "08:20", "class", "math"],
  ["monday", "09:50", "eye-exercise", null],
  ["monday", "09:55", "flag-ceremony", null],
  ["monday", "10:25", "break", null],
  ["monday", "10:30", "class", "chemistry"],
  ["monday", "11:10", "break", null],
  ["monday", "11:20", "class", "geography"],
  ["monday", "12:00", "lunch", null],
  ["monday", "14:20", "noon-reading", null],
  ["monday", "14:30", "class", "psychology"],
  ["monday", "16:00", "eye-exercise", null],
  ["monday", "16:10", "self-study", null],
  ["monday", "16:50", "class", "classMeeting"],
  ["monday", "17:30", "tutoring", null],
  ["monday", "19:00", "dinner", null],
  ["monday", "19:40", "self-study", null],
  ["monday", "21:20", "break", null],
  ["monday", "21:30", "self-study", null],
  ["monday", "22:30", "free", null],
  ["monday", "23:00", "sleep", null],
  // No stale subjects during gaps.
  ["monday", "08:15", "break", null],
  ["monday", "10:27", "break", null],
  // Tuesday: physics noon reading, self-study 16:10, activity 16:50.
  ["tuesday", "06:50", "morning-reading", "chinese"],
  ["tuesday", "07:30", "class", "english"],
  ["tuesday", "09:55", "big-break", null],
  ["tuesday", "10:30", "class", "biology"],
  ["tuesday", "14:20", "noon-reading", "physics"],
  ["tuesday", "14:30", "class", "physics"],
  ["tuesday", "15:20", "class", "politics"],
  ["tuesday", "16:10", "self-study", null],
  ["tuesday", "16:50", "activity", null],
  ["tuesday", "17:30", "tutoring", null],
  ["tuesday", "19:00", "dinner", null],
  // Wednesday: English early reading, politics noon reading, art + music afternoon.
  ["wednesday", "06:50", "morning-reading", "english"],
  ["wednesday", "07:30", "class", "chinese"],
  ["wednesday", "08:20", "class", "chemistry"],
  ["wednesday", "14:20", "noon-reading", "politics"],
  ["wednesday", "14:30", "class", "art"],
  ["wednesday", "15:20", "class", "music"],
  ["wednesday", "16:10", "self-study", null],
  // Thursday: math first, PE 16:10, cleaning 16:50.
  ["thursday", "06:50", "morning-reading", "chinese"],
  ["thursday", "07:30", "class", "math"],
  ["thursday", "14:30", "class", "politics"],
  ["thursday", "15:20", "class", "biology"],
  ["thursday", "16:10", "class", "pe"],
  ["thursday", "16:50", "activity", "cleaning"],
  ["thursday", "17:30", "tutoring", null],
  // Friday: school courses then split tutoring 17:50/18:25.
  ["friday", "16:10", "class", "schoolCourse"],
  ["friday", "16:50", "break", null],
  ["friday", "17:00", "class", "schoolCourse"],
  ["friday", "17:40", "break", null],
  ["friday", "17:50", "tutoring", null],
  ["friday", "18:25", "tutoring", null],
  ["friday", "19:00", "dinner", null],
  // Sunday is always rest, never a subject.
  ["sunday", "00:00", "rest", null],
  ["sunday", "10:30", "rest", null],
  ["sunday", "23:59", "rest", null],
  // Saturday special timetable (never the weekday one).
  // 06:50 starts two back-to-back normal Chinese classes (not morning reading).
  ["saturday", "06:49", "travel-to", null],
  ["saturday", "06:50", "class", "chinese"],
  ["saturday", "07:29", "class", "chinese"],
  ["saturday", "07:30", "class", "chinese"],
  ["saturday", "08:10", "break", null],
  ["saturday", "08:20", "class", "chemistry"],
  ["saturday", "09:10", "class", "history"],
  ["saturday", "09:50", "activity", null],
  ["saturday", "10:10", "class", "physics"],
  ["saturday", "11:00", "class", "politics"],
  ["saturday", "11:40", "lunch", null],
  ["saturday", "14:30", "class", "math"],
  ["saturday", "15:20", "class", "english"],
  ["saturday", "16:00", "activity", null],
  ["saturday", "16:20", "self-study", null],
  ["saturday", "17:20", "dinner", null],
  ["saturday", "17:40", "class", "geography"],
  ["saturday", "18:30", "class", "biology"],
  ["saturday", "19:10", "travel-home", null],
  ["saturday", "19:30", "free", null],
  // Evening boundaries: tutoring ends 19:00 sharp, dinner 19:00-19:40.
  ["monday", "18:59", "tutoring", null],
  ["thursday", "18:59", "tutoring", null],
  ["friday", "18:59", "tutoring", null],
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

// Monday 17:30-19:00 tutoring must carry both evening subjects without
// inventing a split; Friday's sessions have exact times and are split.
{
  const status = resolveStatus(at("monday", "17:40"));
  const subjects = status.subjects || [];
  if (status.kind !== "tutoring" || subjects.join(",") !== "chemistry,politics") {
    fail(`monday 17:40: expected combined tutoring [chemistry,politics], got ${JSON.stringify(status)}`);
  }
  const thu = resolveStatus(at("thursday", "18:00"));
  if (thu.kind !== "tutoring" || (thu.subjects || []).join(",") !== "english,chinese") {
    fail(`thursday 18:00: expected combined tutoring [english,chinese], got ${JSON.stringify(thu)}`);
  }
  const fri1 = resolveStatus(at("friday", "18:00"));
  if (fri1.kind !== "tutoring" || (fri1.subjects || []).join(",") !== "geography") {
    fail(`friday 18:00: expected split tutoring [geography], got ${JSON.stringify(fri1)}`);
  }
  const fri2 = resolveStatus(at("friday", "18:30"));
  if (fri2.kind !== "tutoring" || (fri2.subjects || []).join(",") !== "biology") {
    fail(`friday 18:30: expected split tutoring [biology], got ${JSON.stringify(fri2)}`);
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
  const flag = statusText(resolveStatus(at("monday", "10:00")), "zh");
  if (flag !== "现在大概在参加升旗仪式") fail(`flag wording: got "${flag}"`);
  const rest = statusText(resolveStatus(at("sunday", "10:00")), "zh");
  if (rest.includes("数学") || rest.includes("课")) fail(`sunday wording leaks a subject: "${rest}"`);
  // Saturday 06:50 is a normal Chinese class, never morning reading.
  const satEarly = resolveStatus(at("saturday", "06:50"));
  if (satEarly.kind !== "class" || satEarly.slot?.subject !== "chinese") {
    fail(`saturday 06:50 wording precondition: got ${JSON.stringify(satEarly)}`);
  }
  const satZh = statusText(satEarly, "zh");
  const satEn = statusText(satEarly, "en");
  const satJa = statusText(satEarly, "ja");
  if (satZh !== "现在大概在上语文课") fail(`saturday zh wording: got "${satZh}"`);
  if (satEn !== "Probably in Chinese class right now") fail(`saturday en wording: got "${satEn}"`);
  if (satJa !== "今は中国語の授業中かも") fail(`saturday ja wording: got "${satJa}"`);
  if (satZh.includes("早读")) fail(`saturday 06:50 must not say 早读: "${satZh}"`);
}

// Day view shape.
{
  const sunday = describeDay(at("sunday", "10:00"));
  if (!sunday.isRestDay || sunday.slots.length !== 0) fail("describeDay sunday should be a rest day with no slots");
  const monday = describeDay(at("monday", "10:00"));
  if (monday.isRestDay || monday.slots.length === 0) fail("describeDay monday should list timed slots");
  if (monday.slots.some((slot) => !slot.start || !slot.end || !slot.type)) fail("describeDay monday slots need start/end/type");
  // Saturday day view: two opening Chinese classes, untimed math noon note.
  const saturday = describeDay(at("saturday", "10:00"));
  if (saturday.isRestDay || !saturday.isSaturday || saturday.slots.length === 0) fail("describeDay saturday should list timed slots");
  if (saturday.slots.some((slot) => slot.type === "morning-reading")) fail("describeDay saturday must not label 06:50 as morning-reading");
  const first = saturday.slots[0];
  const second = saturday.slots[1];
  if (!first || first.start !== "06:50" || first.type !== "class" || first.subject !== "chinese") fail(`describeDay saturday first slot: got ${JSON.stringify(first)}`);
  if (!second || second.start !== "07:30" || second.type !== "class" || second.subject !== "chinese") fail(`describeDay saturday second slot: got ${JSON.stringify(second)}`);
  if (!saturday.notes?.some((note) => note.kind === "noon-reading-note" && note.subject === "math")) fail("describeDay saturday should keep untimed math noon-reading note");
  if (saturday.slots.some((slot) => slot.type === "noon-reading")) fail("describeDay saturday must not invent a timed noon-reading slot");
}

if (failures) {
  console.error(`check-schedule: ${failures} 个问题`);
  process.exit(1);
}
console.log(`check-schedule: OK（${cases.length} 个边界用例、三语文案与 CST 换算通过）`);
