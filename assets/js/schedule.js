// Centralized high-school timetable (owner's normal schedule).
//
// All times are "HH:MM" in Asia/Shanghai (China Standard Time, UTC+8 all year;
// China has no daylight-saving time). The resolver always converts the given
// instant to UTC+8 first, so a visitor's own timezone never affects the result.
//
// Only timed school periods carry subjects. Gaps between periods resolve to
// break / meal / travel / free / sleep estimates, never to a stale subject.
// Sunday is always a rest day. Saturday uses its own special timetable.
// Dinner is 19:00-19:40 every weekday, followed by night self-study
// 19:40-21:20 and 21:30-22:30.

export const SUBJECTS = {
  chinese: { zh: "语文", ja: "中国語", en: "Chinese" },
  math: { zh: "数学", ja: "数学", en: "Mathematics" },
  english: { zh: "英语", ja: "英語", en: "English" },
  chemistry: { zh: "化学", ja: "化学", en: "Chemistry" },
  geography: { zh: "地理", ja: "地理", en: "Geography" },
  physics: { zh: "物理", ja: "物理", en: "Physics" },
  politics: { zh: "政治", ja: "政治", en: "Politics" },
  history: { zh: "历史", ja: "歴史", en: "History" },
  biology: { zh: "生物", ja: "生物", en: "Biology" },
  psychology: { zh: "心理/生涯规划", ja: "心理・キャリア", en: "Psychology / Career Planning" },
  classMeeting: { zh: "班会", ja: "ホームルーム", en: "Class Meeting" },
  art: { zh: "美术", ja: "美術", en: "Art" },
  pe: { zh: "体育", ja: "体育", en: "Physical Education" },
  music: { zh: "音乐", ja: "音楽", en: "Music" },
  schoolCourse: { zh: "校本课程", ja: "学校設定科目", en: "School-based Course" },
  selfStudy: { zh: "自习", ja: "自習", en: "Self-study" },
  activity: { zh: "活动", ja: "活動", en: "Activity" },
  cleaning: { zh: "大扫除", ja: "清掃", en: "Cleaning" },
};

// Slot: { start, end, type, subject?, subjects? }
// type: morning-reading | class | noon-reading | eye-exercise | big-break |
//       flag-ceremony | activity | tutoring | self-study
// Undetermined noon reading uses subject: null.
// Evening tutoring Mon-Thu is one combined 17:30-19:00 block carrying both
// subjects: the source gives only that single range, so no finer split is
// invented. Friday's two tutoring sessions do have exact times and are split.
// Dinner (19:00-19:40) is a routine gap kind, not a timed slot.
function morningSlots(subjects, flagCeremony) {
  const slots = [
    { start: "06:50", end: "07:25", type: "morning-reading", subject: subjects.early },
    { start: "07:30", end: "08:10", type: "class", subject: subjects.p1 },
    { start: "08:20", end: "09:00", type: "class", subject: subjects.p2 },
    { start: "09:10", end: "09:50", type: "class", subject: subjects.p3 },
    { start: "09:50", end: "09:55", type: "eye-exercise" },
  ];
  // Monday holds the half-hour flag-raising ceremony; other weekdays rest.
  slots.push(flagCeremony
    ? { start: "09:55", end: "10:25", type: "flag-ceremony" }
    : { start: "09:55", end: "10:25", type: "big-break" });
  slots.push(
    { start: "10:30", end: "11:10", type: "class", subject: subjects.p4 },
    { start: "11:20", end: "12:00", type: "class", subject: subjects.p5 },
  );
  return slots;
}

function afternoonSlots(subjects) {
  const slots = [];
  if (subjects.noon) slots.push({ start: "14:20", end: "14:30", type: "noon-reading", subject: subjects.noon });
  else slots.push({ start: "14:20", end: "14:30", type: "noon-reading" });
  slots.push(
    { start: "14:30", end: "15:10", type: "class", subject: subjects.p6 },
    { start: "15:20", end: "16:00", type: "class", subject: subjects.p7 },
    { start: "16:00", end: "16:05", type: "eye-exercise" },
  );
  return slots;
}

// Per weekday subjects.
// Order: early, p1-p5, noon (null = undetermined), p6, p7, p8 (+p8type),
// extra (+extratype), tutoring: [session1, session2].
// Only Tuesday pins a noon-reading subject (physics); the other weekdays leave
// noon reading undetermined, and only Friday splits tutoring into timed halves.
const WEEKDAY_SUBJECTS = {
  // Monday (09:55-10:25 is the flag-raising ceremony, not a big break)
  1: { early: "english", p1: "chinese", p2: "math", p3: "english", p4: "chemistry", p5: "geography", noon: null, p6: "psychology", p7: "physics", p8: "selfStudy", p8type: "self-study", extra: "classMeeting", extratype: "class", tutoring: ["chemistry", "politics"] },
  // Tuesday
  2: { early: "chinese", p1: "english", p2: "chinese", p3: "history", p4: "biology", p5: "math", noon: "physics", p6: "physics", p7: "politics", p8: "selfStudy", p8type: "self-study", extra: "activity", extratype: "activity", tutoring: ["math", "math"] },
  // Wednesday
  3: { early: "english", p1: "chinese", p2: "chemistry", p3: "math", p4: "english", p5: "physics", noon: null, p6: "art", p7: "music", p8: "selfStudy", p8type: "self-study", extra: "activity", extratype: "activity", tutoring: ["physics", "history"] },
  // Thursday
  4: { early: "chinese", p1: "math", p2: "chinese", p3: "english", p4: "physics", p5: "chemistry", noon: null, p6: "politics", p7: "biology", p8: "pe", p8type: "class", extra: "cleaning", extratype: "activity", tutoring: ["english", "chinese"] },
  // Friday (school course 2 and split tutoring have their own exact times)
  5: { early: "english", p1: "english", p2: "history", p3: "chinese", p4: "math", p5: "geography", noon: null, p6: "pe", p7: "pe", p8: "schoolCourse" },
};

// Saturday special timetable (fully timed entries, no template).
const SATURDAY_SLOTS = [
  { start: "06:50", end: "07:30", type: "morning-reading", subject: "chinese" },
  { start: "07:30", end: "08:10", type: "class", subject: "chemistry" },
  { start: "08:20", end: "09:00", type: "class", subject: "history" },
  { start: "09:10", end: "09:50", type: "class", subject: "chinese" },
  { start: "09:50", end: "10:10", type: "big-break", subject: "activity" },
  { start: "10:10", end: "10:50", type: "class", subject: "physics" },
  { start: "11:00", end: "11:40", type: "class", subject: "politics" },
  // Midday gap 11:40-14:20 resolves to lunch. The source lists a Saturday noon
  // reading (Mathematics) without a time range, so it is shown as an untimed
  // note in the day view, not as an invented timed slot.
  { start: "14:30", end: "15:10", type: "class", subject: "math" },
  { start: "15:20", end: "16:00", type: "class", subject: "english" },
  { start: "16:00", end: "16:20", type: "activity", subject: "activity" },
  { start: "16:20", end: "17:20", type: "self-study", subject: "selfStudy" },
  { start: "17:40", end: "18:20", type: "class", subject: "geography" },
  { start: "18:30", end: "19:10", type: "class", subject: "biology" },
];

export const SATURDAY_NOON_READING = "math";

function toMinutes(value) {
  const [h, m] = String(value).split(":").map(Number);
  return h * 60 + m;
}

// Convert any instant to China Standard Time parts. China is UTC+8 year-round
// (no daylight saving), so a fixed +8h shift of the UTC timestamp is exact.
export function chinaParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return {
    weekday: shifted.getUTCDay(), // 0 = Sunday
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    totalMinutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function formatChinaTime(date = new Date()) {
  const parts = chinaParts(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(parts.hours)}:${pad(parts.minutes)}`;
}

const WEEKDAY_NAMES = {
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  ja: ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export function chinaWeekdayName(date = new Date(), lang = "zh") {
  const names = WEEKDAY_NAMES[lang] || WEEKDAY_NAMES.zh;
  return names[chinaParts(date).weekday];
}

const NIGHT_SLOTS = [
  { start: "19:40", end: "21:20", type: "self-study", subject: "selfStudy" },
  { start: "21:30", end: "22:30", type: "self-study", subject: "selfStudy" },
];

function expandWeekday(weekday) {
  // Friday has its own exact evening times (see below).
  if (weekday === 5) return expandFriday();
  const subjects = WEEKDAY_SUBJECTS[weekday];
  return [
    ...morningSlots(subjects, weekday === 1),
    ...afternoonSlots(subjects),
    { start: "16:10", end: "16:50", type: subjects.p8type, subject: subjects.p8 },
    { start: "16:50", end: "17:30", type: subjects.extratype, subject: subjects.extra },
    // One combined block: the source names two tutoring sessions but only
    // gives the single range 17:30-19:00, so both subjects share this entry
    // instead of inventing a split.
    { start: "17:30", end: "19:00", type: "tutoring", subjects: subjects.tutoring },
    ...NIGHT_SLOTS.map((slot) => ({ ...slot })),
  ];
}

// Friday: school course 1 at 16:10, school course 2 at the exact range
// 17:00-17:40, then split tutoring 17:50-18:25 (geography) and 18:25-19:00
// (biology). Dinner 19:00-19:40 and night self-study follow the normal plan.
function expandFriday() {
  const subjects = WEEKDAY_SUBJECTS[5];
  return [
    ...morningSlots(subjects, false),
    ...afternoonSlots(subjects),
    { start: "16:10", end: "16:50", type: "class", subject: "schoolCourse" },
    { start: "17:00", end: "17:40", type: "class", subject: "schoolCourse" },
    { start: "17:50", end: "18:25", type: "tutoring", subjects: ["geography"] },
    { start: "18:25", end: "19:00", type: "tutoring", subjects: ["biology"] },
    ...NIGHT_SLOTS.map((slot) => ({ ...slot })),
  ];
}

function findSlot(slots, totalMinutes) {
  return slots.find((slot) => totalMinutes >= toMinutes(slot.start) && totalMinutes < toMinutes(slot.end)) || null;
}

// Resolve the estimated status for one instant. Returns a small plain object:
// { kind, slot?, subjects?, totalMinutes, weekday }
// kind: rest | sleep | travel-to | travel-home | class | morning-reading |
//       noon-reading | self-study | tutoring | activity | eye-exercise |
//       big-break | flag-ceremony | break | lunch | dinner | free
export function resolveStatus(date = new Date()) {
  const parts = chinaParts(date);
  const { weekday, totalMinutes } = parts;

  // Sunday: complete rest day, no subjects at any time.
  if (weekday === 0) {
    return { kind: "rest", weekday, totalMinutes };
  }

  const slots = weekday === 6 ? SATURDAY_SLOTS : expandWeekday(weekday);
  const slot = findSlot(slots, totalMinutes);
  if (slot) {
    if (slot.type === "tutoring") {
      return { kind: "tutoring", slot, subjects: slot.subjects, weekday, totalMinutes };
    }
    const kinds = new Set(["morning-reading", "noon-reading", "class", "self-study", "activity", "eye-exercise", "big-break", "flag-ceremony"]);
    if (kinds.has(slot.type)) {
      return { kind: slot.type, slot, weekday, totalMinutes };
    }
  }

  if (weekday === 6) return saturdayRoutine(totalMinutes);
  return weekdayRoutine(weekday, totalMinutes);
}

function weekdayRoutine(weekday, t) {
  const at = (weekday, totalMinutes) => ({ weekday, totalMinutes });
  if (t < 6 * 60 + 30) return { kind: "sleep", ...at(weekday, t) };
  if (t < 6 * 60 + 50) return { kind: "travel-to", ...at(weekday, t) };
  if (t < 12 * 60) return { kind: "break", ...at(weekday, t) };
  if (t < 14 * 60 + 20) return { kind: "lunch", ...at(weekday, t) };
  // Dinner is uniformly 19:00-19:40; other daytime gaps are plain breaks.
  // (Friday's last timed session also ends at 19:00.)
  if (t < 19 * 60) return { kind: "break", ...at(weekday, t) };
  if (t < 19 * 60 + 40) return { kind: "dinner", ...at(weekday, t) };
  if (t < 22 * 60 + 30) return { kind: "break", ...at(weekday, t) };
  // Night self-study ends at 22:30. Keep the exact boundary instant as free
  // time (spec test table), then a ~20 minute travel-home estimate.
  if (t < 22 * 60 + 35) return { kind: "free", ...at(weekday, t) };
  if (t < 22 * 60 + 55) return { kind: "travel-home", ...at(weekday, t) };
  if (t < 23 * 60) return { kind: "free", ...at(weekday, t) };
  return { kind: "sleep", ...at(weekday, t) };
}

function saturdayRoutine(t) {
  const at = (totalMinutes) => ({ weekday: 6, totalMinutes });
  if (t < 6 * 60 + 30) return { kind: "sleep", ...at(t) };
  if (t < 6 * 60 + 50) return { kind: "travel-to", ...at(t) };
  if (t < 11 * 60 + 40) return { kind: "break", ...at(t) };
  if (t < 14 * 60 + 30) return { kind: "lunch", ...at(t) };
  if (t < 15 * 60 + 20 && t >= 15 * 60 + 10) return { kind: "break", ...at(t) };
  if (t < 17 * 60 + 40 && t >= 17 * 60 + 20) return { kind: "dinner", ...at(t) };
  if (t >= 18 * 60 + 20 && t < 18 * 60 + 30) return { kind: "break", ...at(t) };
  // Evening classes end at 19:10. Keep the exact boundary instant as free
  // time (spec test table), then a ~20 minute travel-home estimate.
  if (t >= 19 * 60 + 10 && t < 19 * 60 + 15) return { kind: "free", ...at(t) };
  if (t >= 19 * 60 + 15 && t < 19 * 60 + 35) return { kind: "travel-home", ...at(t) };
  if (t >= 19 * 60 + 35 && t < 23 * 60) return { kind: "free", ...at(t) };
  if (t >= 23 * 60) return { kind: "sleep", ...at(t) };
  return { kind: "break", ...at(t) };
}

function subjectName(key, lang) {
  if (!key) return "";
  return SUBJECTS[key]?.[lang] || SUBJECTS[key]?.zh || "";
}

function joinSubjects(keys, lang) {
  const names = [...new Set(keys)].map((key) => subjectName(key, lang)).filter(Boolean);
  return lang === "en" ? names.join(" / ") : lang === "ja" ? names.join("・") : names.join("、");
}

// Visitor-facing one-line estimate. Wording is deliberately probabilistic:
// this is a public timetable estimate, never live tracking.
export function statusText(status, lang = "zh") {
  const l = ["zh", "ja", "en"].includes(lang) ? lang : "zh";
  const subject = subjectName(status.slot?.subject, l);
  switch (status.kind) {
    case "rest":
      return l === "en" ? "Resting today" : l === "ja" ? "今日はお休み" : "今天休息";
    case "sleep":
      return l === "en" ? "Likely sleeping" : l === "ja" ? "たぶん寝ているところ" : "大概在睡觉";
    case "travel-to":
      return l === "en" ? "Probably on the way to school" : l === "ja" ? "たぶん登校中" : "大概在上学路上";
    case "travel-home":
      return l === "en" ? "Probably on the way home" : l === "ja" ? "たぶん帰宅中" : "大概在回家路上";
    case "free":
      return l === "en" ? "Probably free time right now" : l === "ja" ? "今は自由時間かも" : "现在大概在自由活动";
    case "break":
      return l === "en" ? "Probably on a break right now" : l === "ja" ? "今は休み時間かも" : "现在大概在课间休息";
    case "big-break": {
      if (subject && status.slot?.subject !== "activity") {
        return l === "en" ? `Probably on a big break right now` : l === "ja" ? "今は大休憩中かも" : "现在大概在大课间休息";
      }
      if (status.slot?.subject === "activity") {
        return l === "en" ? "Probably at a morning activity right now" : l === "ja" ? "今は朝の活動中かも" : "现在大概在参加课间活动";
      }
      return l === "en" ? "Probably on a big break right now" : l === "ja" ? "今は大休憩中かも" : "现在大概在大课间休息";
    }
    case "flag-ceremony":
      return l === "en" ? "Probably at the flag-raising ceremony right now" : l === "ja" ? "今は国旗掲揚式に参加中かも" : "现在大概在参加升旗仪式";
    case "lunch":
      return l === "en" ? "Probably having lunch right now" : l === "ja" ? "今はお昼ごはん中かも" : "现在大概在吃午饭";
    case "dinner":
      return l === "en" ? "Probably having dinner right now" : l === "ja" ? "今は夜ごはん中かも" : "现在大概在吃晚饭";
    case "eye-exercise":
      return l === "en" ? "Probably doing eye exercises" : l === "ja" ? "今は目の体操中かも" : "现在大概在做眼保健操";
    case "morning-reading":
      if (subject) return l === "en" ? `Probably at morning reading (${subject}) right now` : l === "ja" ? `今は朝読書中かも（${subject}）` : `现在大概在早读（${subject}）`;
      return l === "en" ? "Probably at morning reading right now" : l === "ja" ? "今は朝読書中かも" : "现在大概在早读";
    case "noon-reading":
      if (subject) return l === "en" ? `Probably at noon reading (${subject}) right now` : l === "ja" ? `今は昼読書中かも（${subject}）` : `现在大概在午读（${subject}）`;
      return l === "en" ? "Probably at noon reading right now" : l === "ja" ? "今は昼読書中かも" : "现在大概在午读";
    case "class":
      if (subject) return l === "en" ? `Probably in ${subject} class right now` : l === "ja" ? `今は${subject}の授業中かも` : `现在大概在上${subject}课`;
      return l === "en" ? "Probably in class right now" : l === "ja" ? "今は授業中かも" : "现在大概在上课";
    case "self-study":
      return l === "en" ? "Probably studying right now" : l === "ja" ? "今は自習中かも" : "现在大概在自习";
    case "tutoring": {
      const names = joinSubjects(status.subjects || [], l);
      if (names) return l === "en" ? `Probably in evening tutoring (${names}) right now` : l === "ja" ? `今は夜の補習中かも（${names}）` : `现在大概在晚辅导（${names}）`;
      return l === "en" ? "Probably in evening tutoring right now" : l === "ja" ? "今は夜の補習中かも" : "现在大概在晚辅导";
    }
    case "activity": {
      const key = status.slot?.subject;
      if (key === "cleaning") return l === "en" ? "Probably cleaning right now" : l === "ja" ? "今は清掃中かも" : "现在大概在大扫除";
      if (key === "schoolCourse") return l === "en" ? "Probably in a school-based course right now" : l === "ja" ? "今は学校設定科目の授業中かも" : "现在大概在上校本课程";
      return l === "en" ? "Probably at an extracurricular activity right now" : l === "ja" ? "今は課外活動中かも" : "现在大概在参加课外活动";
    }
    default:
      return l === "en" ? "Probably free time right now" : l === "ja" ? "今は自由時間かも" : "现在大概在自由活动";
  }
}

// Short label for one timetable row, e.g. "早读 · 英语".
export function slotLabel(slot, lang = "zh") {
  const l = ["zh", "ja", "en"].includes(lang) ? lang : "zh";
  const names = {
    "morning-reading": { zh: "早读", ja: "朝読書", en: "Morning reading" },
    class: { zh: "上课", ja: "授業", en: "Class" },
    "noon-reading": { zh: "午读", ja: "昼読書", en: "Noon reading" },
    "eye-exercise": { zh: "眼保健操", ja: "目の体操", en: "Eye exercise" },
    "big-break": { zh: "大课间", ja: "大休憩", en: "Morning break" },
    "flag-ceremony": { zh: "升旗仪式", ja: "国旗掲揚式", en: "Flag-raising ceremony" },
    activity: { zh: "课外活动", ja: "課外活動", en: "Activity" },
    tutoring: { zh: "晚辅导", ja: "夜の補習", en: "Evening tutoring" },
    "self-study": { zh: "自习", ja: "自習", en: "Self-study" },
  };
  const base = names[slot.type]?.[l] || slot.type;
  const subject = slot.subjects ? joinSubjects(slot.subjects, l) : subjectName(slot.subject, l);
  if (!subject) return base;
  if (slot.type === "class" || slot.type === "morning-reading" || slot.type === "noon-reading" || slot.type === "tutoring") {
    return l === "en" ? `${base} · ${subject}` : `${base} · ${subject}`;
  }
  if (slot.type === "activity" || slot.type === "big-break") {
    if (slot.subject === "activity") return base;
    return `${base} · ${subject}`;
  }
  return base;
}

// Day view for the timetable panel: timed school slots plus untimed notes.
// Sunday returns { isRestDay: true, slots: [] }.
export function describeDay(date = new Date()) {
  const parts = chinaParts(date);
  const { weekday } = parts;
  if (weekday === 0) return { weekday, isRestDay: true, isSaturday: false, slots: [], notes: [] };
  if (weekday === 6) {
    return {
      weekday,
      isRestDay: false,
      isSaturday: true,
      slots: SATURDAY_SLOTS.map((slot) => ({ ...slot })),
      notes: [{ kind: "lunch-note" }, { kind: "noon-reading-note", subject: SATURDAY_NOON_READING }],
    };
  }
  return {
    weekday,
    isRestDay: false,
    isSaturday: false,
    slots: expandWeekday(weekday),
    notes: [{ kind: "lunch-note" }, { kind: "dinner-note" }],
  };
}
