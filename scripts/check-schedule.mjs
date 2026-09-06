// Boundary tests for the school timetable resolver (assets/js/schedule.js).
// All expectations are in China Standard Time (UTC+8). Run: node scripts/check-schedule.mjs
import { chinaParts, describeDay, resolveStatus, slotLabel, statusText } from "../assets/js/schedule.js";

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
  // Monday boundaries (authoritative spec: flag ceremony 9:55-10:25,
  // self-study 16:10, class meeting 16:50-17:30, split tutoring
  // 17:30-18:10 / 18:20-19:00, dinner 19:00-19:40).
  ["monday", "06:49", "travel-to", null],
  ["monday", "06:50", "morning-reading", "english"],
  ["monday", "07:25", "break", null],
  ["monday", "07:30", "class", "chinese"],
  ["monday", "08:10", "break", null],
  ["monday", "08:20", "class", "math"],
  ["monday", "09:10", "class", "english"],
  ["monday", "09:50", "eye-exercise", null],
  ["monday", "09:55", "flag-ceremony", null],
  ["monday", "10:25", "break", null],
  ["monday", "10:30", "class", "chemistry"],
  ["monday", "11:10", "break", null],
  ["monday", "11:20", "class", "geography"],
  ["monday", "12:00", "lunch", null],
  ["monday", "14:20", "noon-reading", null],
  ["monday", "14:30", "class", "psychology"],
  ["monday", "15:10", "break", null],
  ["monday", "15:20", "class", "physics"],
  ["monday", "16:00", "eye-exercise", null],
  ["monday", "16:05", "break", null],
  ["monday", "16:10", "self-study", null],
  ["monday", "16:50", "class", "classMeeting"],
  ["monday", "17:30", "tutoring", null],
  ["monday", "18:10", "break", null],
  ["monday", "18:20", "tutoring", null],
  ["monday", "19:00", "dinner", null],
  ["monday", "19:40", "self-study", null],
  ["monday", "21:20", "break", null],
  ["monday", "21:30", "self-study", null],
  ["monday", "22:30", "travel-home", null],
  ["monday", "22:50", "free", null],
  ["monday", "23:00", "sleep", null],
  // No stale subjects during gaps.
  ["monday", "08:15", "break", null],
  ["monday", "10:27", "break", null],
  ["monday", "16:05", "break", null],
  // Tuesday: physics noon reading, self-study 16:10, activity 16:50,
  // split math tutoring 17:30 / 18:20.
  ["tuesday", "06:50", "morning-reading", "chinese"],
  ["tuesday", "07:30", "class", "english"],
  ["tuesday", "08:20", "class", "chinese"],
  ["tuesday", "09:10", "class", "history"],
  ["tuesday", "09:55", "big-break", null],
  ["tuesday", "10:30", "class", "biology"],
  ["tuesday", "11:20", "class", "math"],
  ["tuesday", "14:20", "noon-reading", "physics"],
  ["tuesday", "14:30", "class", "physics"],
  ["tuesday", "15:20", "class", "politics"],
  ["tuesday", "16:10", "self-study", null],
  ["tuesday", "16:50", "activity", null],
  ["tuesday", "17:30", "tutoring", null],
  ["tuesday", "18:10", "break", null],
  ["tuesday", "18:20", "tutoring", null],
  ["tuesday", "19:00", "dinner", null],
  // Wednesday: English early reading, politics noon reading, art + music afternoon.
  ["wednesday", "06:50", "morning-reading", "english"],
  ["wednesday", "07:30", "class", "chinese"],
  ["wednesday", "08:20", "class", "chemistry"],
  ["wednesday", "09:10", "class", "math"],
  ["wednesday", "10:30", "class", "english"],
  ["wednesday", "11:20", "class", "physics"],
  ["wednesday", "14:20", "noon-reading", "politics"],
  ["wednesday", "14:30", "class", "art"],
  ["wednesday", "15:20", "class", "music"],
  ["wednesday", "16:10", "self-study", null],
  ["wednesday", "16:50", "activity", null],
  ["wednesday", "17:30", "tutoring", null],
  ["wednesday", "18:10", "break", null],
  ["wednesday", "18:20", "tutoring", null],
  // Thursday: math first, politics noon reading, PE 16:10, cleaning 16:50.
  ["thursday", "06:50", "morning-reading", "chinese"],
  ["thursday", "07:30", "class", "math"],
  ["thursday", "08:20", "class", "chinese"],
  ["thursday", "09:10", "class", "english"],
  ["thursday", "10:30", "class", "physics"],
  ["thursday", "11:20", "class", "chemistry"],
  ["thursday", "14:20", "noon-reading", "politics"],
  ["thursday", "14:30", "class", "politics"],
  ["thursday", "15:20", "class", "biology"],
  ["thursday", "16:10", "class", "pe"],
  ["thursday", "16:50", "activity", "cleaning"],
  ["thursday", "17:30", "tutoring", null],
  ["thursday", "18:10", "break", null],
  ["thursday", "18:20", "tutoring", null],
  // Friday: school course 1 at 16:10-17:00, course 2 at 17:00-17:40,
  // then split tutoring 17:50 geography / 18:25 biology.
  ["friday", "06:50", "morning-reading", "english"],
  ["friday", "07:30", "class", "english"],
  ["friday", "08:20", "class", "history"],
  ["friday", "09:10", "class", "chinese"],
  ["friday", "10:30", "class", "math"],
  ["friday", "11:20", "class", "geography"],
  ["friday", "14:20", "noon-reading", null],
  ["friday", "14:30", "class", "pe"],
  ["friday", "15:20", "class", "pe"],
  ["friday", "16:10", "class", "schoolCourse"],
  ["friday", "16:50", "class", "schoolCourse"],
  ["friday", "17:00", "class", "schoolCourse"],
  ["friday", "17:40", "break", null],
  ["friday", "17:50", "tutoring", null],
  ["friday", "18:25", "tutoring", null],
  ["friday", "19:00", "dinner", null],
  ["friday", "19:40", "self-study", null],
  ["friday", "21:30", "self-study", null],
  ["friday", "22:30", "travel-home", null],
  // Sunday is always rest, never a subject.
  ["sunday", "00:00", "rest", null],
  ["sunday", "10:30", "rest", null],
  ["sunday", "19:40", "rest", null],
  ["sunday", "21:30", "rest", null],
  ["sunday", "23:59", "rest", null],
  // Saturday special timetable (never the weekday one, never night study).
  // 06:50 is Chinese morning reading, 11:40-14:20 is lunch/rest,
  // 14:20-14:30 is Mathematics noon reading, 14:30 is Mathematics class,
  // 17:20 is a short break, and 19:10 onward is free time.
  ["saturday", "06:49", "travel-to", null],
  ["saturday", "06:50", "morning-reading", "chinese"],
  ["saturday", "07:29", "morning-reading", "chinese"],
  ["saturday", "07:30", "class", "chinese"],
  ["saturday", "08:10", "break", null],
  ["saturday", "08:20", "class", "chemistry"],
  ["saturday", "09:10", "class", "history"],
  ["saturday", "09:50", "activity", null],
  ["saturday", "10:10", "class", "physics"],
  ["saturday", "10:50", "break", null],
  ["saturday", "11:00", "class", "politics"],
  ["saturday", "11:40", "lunch", null],
  ["saturday", "12:00", "lunch", null],
  ["saturday", "14:19", "lunch", null],
  ["saturday", "14:20", "noon-reading", "math"],
  ["saturday", "14:25", "noon-reading", "math"],
  ["saturday", "14:29", "noon-reading", "math"],
  ["saturday", "14:30", "class", "math"],
  ["saturday", "15:10", "break", null],
  ["saturday", "15:19", "break", null],
  ["saturday", "15:20", "class", "english"],
  ["saturday", "16:00", "activity", null],
  ["saturday", "16:20", "self-study", null],
  ["saturday", "17:19", "self-study", null],
  ["saturday", "17:20", "break", null],
  ["saturday", "17:39", "break", null],
  ["saturday", "17:40", "class", "geography"],
  ["saturday", "18:20", "break", null],
  ["saturday", "18:30", "class", "biology"],
  ["saturday", "19:10", "free", null],
  ["saturday", "19:40", "free", null],
  ["saturday", "21:30", "free", null],
  // Evening boundaries: tutoring ends 19:00 sharp, dinner 19:00-19:40.
  ["monday", "17:40", "tutoring", null],
  ["monday", "18:30", "tutoring", null],
  ["monday", "18:59", "tutoring", null],
  ["thursday", "18:59", "tutoring", null],
  ["friday", "18:00", "tutoring", null],
  ["friday", "18:59", "tutoring", null],
  // Travel windows (~20 min each way on weekdays).
  ["monday", "06:30", "travel-to", null],
  ["monday", "22:40", "travel-home", null],
  ["friday", "22:40", "travel-home", null],
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

// Monday-Thursday tutoring is split per the authoritative timetable:
// 17:30-18:10 session 1, 18:10-18:20 break, 18:20-19:00 session 2.
// Friday's sessions have their own exact times and are split as well.
{
  const mon1 = resolveStatus(at("monday", "17:40"));
  if (mon1.kind !== "tutoring" || (mon1.subjects || []).join(",") !== "chemistry") {
    fail(`monday 17:40: expected split tutoring [chemistry], got ${JSON.stringify(mon1)}`);
  }
  const mon2 = resolveStatus(at("monday", "18:30"));
  if (mon2.kind !== "tutoring" || (mon2.subjects || []).join(",") !== "politics") {
    fail(`monday 18:30: expected split tutoring [politics], got ${JSON.stringify(mon2)}`);
  }
  const monGap = resolveStatus(at("monday", "18:15"));
  if (monGap.kind !== "break") {
    fail(`monday 18:15: expected break between tutoring sessions, got ${JSON.stringify(monGap)}`);
  }
  const tue1 = resolveStatus(at("tuesday", "17:40"));
  if (tue1.kind !== "tutoring" || (tue1.subjects || []).join(",") !== "math") {
    fail(`tuesday 17:40: expected split tutoring [math], got ${JSON.stringify(tue1)}`);
  }
  const wed2 = resolveStatus(at("wednesday", "18:30"));
  if (wed2.kind !== "tutoring" || (wed2.subjects || []).join(",") !== "history") {
    fail(`wednesday 18:30: expected split tutoring [history], got ${JSON.stringify(wed2)}`);
  }
  const thu1 = resolveStatus(at("thursday", "18:00"));
  if (thu1.kind !== "tutoring" || (thu1.subjects || []).join(",") !== "english") {
    fail(`thursday 18:00: expected split tutoring [english], got ${JSON.stringify(thu1)}`);
  }
  const thu2 = resolveStatus(at("thursday", "18:30"));
  if (thu2.kind !== "tutoring" || (thu2.subjects || []).join(",") !== "chinese") {
    fail(`thursday 18:30: expected split tutoring [chinese], got ${JSON.stringify(thu2)}`);
  }
  const fri1 = resolveStatus(at("friday", "18:00"));
  if (fri1.kind !== "tutoring" || (fri1.subjects || []).join(",") !== "geography") {
    fail(`friday 18:00: expected split tutoring [geography], got ${JSON.stringify(fri1)}`);
  }
  const fri2 = resolveStatus(at("friday", "18:30"));
  if (fri2.kind !== "tutoring" || (fri2.subjects || []).join(",") !== "biology") {
    fail(`friday 18:30: expected split tutoring [biology], got ${JSON.stringify(fri2)}`);
  }
  // Friday school course 1 runs 16:10-17:00 (not 16:10-16:50).
  const friCourse = resolveStatus(at("friday", "16:50"));
  if (friCourse.kind !== "class" || friCourse.slot?.subject !== "schoolCourse") {
    fail(`friday 16:50: expected school-based course 1, got ${JSON.stringify(friCourse)}`);
  }
  // Thursday noon reading is politics.
  const thuNoon = resolveStatus(at("thursday", "14:20"));
  if (thuNoon.kind !== "noon-reading" || thuNoon.slot?.subject !== "politics") {
    fail(`thursday 14:20: expected politics noon reading, got ${JSON.stringify(thuNoon)}`);
  }
  // Saturday has no night self-study at any evening hour.
  for (const time of ["19:40", "21:20", "21:30", "22:30"]) {
    const evening = resolveStatus(at("saturday", time));
    if (evening.kind === "self-study" || evening.slot?.subject === "selfStudy") {
      fail(`saturday ${time}: must not show night self-study, got ${JSON.stringify(evening)}`);
    }
    if (evening.kind !== "free") {
      fail(`saturday ${time}: expected free time, got ${JSON.stringify(evening)}`);
    }
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
  // Saturday 06:50 is Chinese morning reading per the authoritative timetable.
  const satEarly = resolveStatus(at("saturday", "06:50"));
  if (satEarly.kind !== "morning-reading" || satEarly.slot?.subject !== "chinese") {
    fail(`saturday 06:50 wording precondition: got ${JSON.stringify(satEarly)}`);
  }
  const satZh = statusText(satEarly, "zh");
  const satEn = statusText(satEarly, "en");
  const satJa = statusText(satEarly, "ja");
  if (satZh !== "现在大概在早读（语文）") fail(`saturday zh wording: got "${satZh}"`);
  if (satEn !== "Probably at morning reading (Chinese) right now") fail(`saturday en wording: got "${satEn}"`);
  if (satJa !== "今は朝読書中かも（中国語）") fail(`saturday ja wording: got "${satJa}"`);
  // Saturday 14:20-14:30 is Mathematics noon reading (lunch ends at 14:20).
  const satNoon = resolveStatus(at("saturday", "14:25"));
  if (satNoon.kind !== "noon-reading" || satNoon.slot?.subject !== "math") {
    fail(`saturday 14:25 wording precondition: got ${JSON.stringify(satNoon)}`);
  }
  const noonZh = statusText(satNoon, "zh");
  const noonEn = statusText(satNoon, "en");
  const noonJa = statusText(satNoon, "ja");
  if (noonZh !== "现在大概在午读（数学）") fail(`saturday noon zh wording: got "${noonZh}"`);
  if (noonEn !== "Probably at noon reading (Mathematics) right now") fail(`saturday noon en wording: got "${noonEn}"`);
  if (noonJa !== "今は昼読書中かも（数学）") fail(`saturday noon ja wording: got "${noonJa}"`);
  const noonLabelZh = slotLabel(satNoon.slot, "zh");
  const noonLabelEn = slotLabel(satNoon.slot, "en");
  const noonLabelJa = slotLabel(satNoon.slot, "ja");
  if (noonLabelZh !== "午读 · 数学") fail(`saturday noon zh label: got "${noonLabelZh}"`);
  if (noonLabelEn !== "Noon reading · Mathematics") fail(`saturday noon en label: got "${noonLabelEn}"`);
  if (noonLabelJa !== "昼読書 · 数学") fail(`saturday noon ja label: got "${noonLabelJa}"`);
  // Saturday 14:19 is still lunch, 14:30 is already Mathematics class.
  const satLunch = resolveStatus(at("saturday", "14:19"));
  if (satLunch.kind !== "lunch") fail(`saturday 14:19 should stay lunch, got ${JSON.stringify(satLunch)}`);
  const satMath = resolveStatus(at("saturday", "14:30"));
  if (satMath.kind !== "class" || satMath.slot?.subject !== "math") {
    fail(`saturday 14:30 should be math class, got ${JSON.stringify(satMath)}`);
  }
}

// Day view shape.
{
  const sunday = describeDay(at("sunday", "10:00"));
  if (!sunday.isRestDay || sunday.slots.length !== 0) fail("describeDay sunday should be a rest day with no slots");
  const monday = describeDay(at("monday", "10:00"));
  if (monday.isRestDay || monday.slots.length === 0) fail("describeDay monday should list timed slots");
  if (monday.slots.some((slot) => !slot.start || !slot.end || !slot.type)) fail("describeDay monday slots need start/end/type");
  // Saturday day view: Chinese morning reading first, then a normal class;
  // noon reading is a timed 14:20-14:30 Mathematics slot.
  const saturday = describeDay(at("saturday", "10:00"));
  if (saturday.isRestDay || !saturday.isSaturday || saturday.slots.length === 0) fail("describeDay saturday should list timed slots");
  const first = saturday.slots[0];
  const second = saturday.slots[1];
  if (!first || first.start !== "06:50" || first.type !== "morning-reading" || first.subject !== "chinese") fail(`describeDay saturday first slot: got ${JSON.stringify(first)}`);
  if (!second || second.start !== "07:30" || second.type !== "class" || second.subject !== "chinese") fail(`describeDay saturday second slot: got ${JSON.stringify(second)}`);
  const noon = saturday.slots.find((slot) => slot.start === "14:20");
  if (!noon || noon.end !== "14:30" || noon.type !== "noon-reading" || noon.subject !== "math") fail(`describeDay saturday noon slot: got ${JSON.stringify(noon)}`);
  if (saturday.slots.some((slot) => slot.type === "self-study" && slot.start === "19:40")) fail("describeDay saturday must not include weekday night self-study");
  // Monday 09:55-10:25 must be the flag-raising ceremony, not a plain break.
  const mondaySlots = monday.slots;
  const flag = mondaySlots.find((slot) => slot.start === "09:55");
  if (!flag || flag.end !== "10:25" || flag.type !== "flag-ceremony") fail(`describeDay monday flag slot: got ${JSON.stringify(flag)}`);
  // Friday evening must use the special timing, not the Mon-Thu split.
  const friday = describeDay(at("friday", "10:00"));
  const course1 = friday.slots.find((slot) => slot.start === "16:10");
  if (!course1 || course1.end !== "17:00" || course1.subject !== "schoolCourse") fail(`describeDay friday course1: got ${JSON.stringify(course1)}`);
}

if (failures) {
  console.error(`check-schedule: ${failures} 个问题`);
  process.exit(1);
}
console.log(`check-schedule: OK（${cases.length} 个边界用例、三语文案与 CST 换算通过）`);
