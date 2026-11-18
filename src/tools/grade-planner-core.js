const nameLimit = 100;
const clamp = (v, min, max) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const percentage = (v) => clamp(v, 0, 100);
const title = (value, limit = nameLimit) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  [...value.trim()].length <= limit;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const uniqueRows = (rows, max) =>
  Array.isArray(rows) &&
  rows.length <= max &&
  rows.every((r) => r && typeof r.id === "string" && uuid.test(r.id)) &&
  new Set(rows.map((r) => r.id)).size === rows.length;

export function gradeAssessment(name = "Assessment") {
  return {
    id: crypto.randomUUID(),
    name,
    weight: 0,
    max: 100,
    score: null,
    absent: false,
  };
}
export function gradeCourse(name = "Course") {
  return {
    id: crypto.randomUUID(),
    name,
    credits: 3,
    target: 70,
    confirmed: null,
    forecast: null,
    excluded: false,
    items: [],
  };
}
export function gradeTerm(name = "Semester 1") {
  return { id: crypto.randomUUID(), name, courses: [] };
}
export function gradeBook(name = "Grade plan") {
  return {
    version: 1,
    name,
    terms: [gradeTerm()],
    scale: [
      { minimum: 80, points: 4 },
      { minimum: 70, points: 3 },
      { minimum: 60, points: 2 },
      { minimum: 50, points: 1 },
      { minimum: 0, points: 0 },
    ],
  };
}
export function courseGoal({ items, target }) {
  const weights = items.reduce((sum, item) => sum + item.weight, 0);
  const recorded = items.filter((item) => item.absent || item.score !== null);
  const completed = recorded.reduce((sum, item) => sum + item.weight, 0);
  const earned = recorded.reduce(
    (sum, item) =>
      sum + item.weight * (item.absent ? 0 : item.score / item.max),
    0,
  );
  const remaining = Math.max(0, 100 - completed);
  const need = Math.max(0, target - earned);
  const required = remaining > 1e-9 ? (need * 100) / remaining : Infinity;
  const totalValid = Math.abs(weights - 100) < 1e-9;
  const state =
    weights > 100 + 1e-9
      ? "overweight"
      : !totalValid
        ? "unallocated"
        : need <= 1e-9
          ? "reached"
          : required > 100 + 1e-9
            ? "unreachable"
            : "needed";
  return { weights, earned, remaining, required, state };
}
export function gradePoints(score, scale) {
  let previous = null;
  for (const row of scale) {
    if (row.minimum <= score && (!previous || row.minimum > previous.minimum))
      previous = row;
  }
  return previous?.points ?? null;
}
export function weightedGrade(courses, scale, projected = false) {
  let credits = 0,
    points = 0;
  for (const course of courses) {
    const score = projected
      ? (course.forecast ?? course.confirmed)
      : course.confirmed;
    if (course.excluded || score === null) continue;
    const grade = gradePoints(score, scale);
    if (grade === null) continue;
    credits += course.credits;
    points += grade * course.credits;
  }
  return { credits, gpa: credits > 0 ? points / credits : null };
}

export function validateGradePlan(data) {
  if (
    !data ||
    data.version !== 1 ||
    !title(data.name) ||
    !uniqueRows(data.terms, 24)
  )
    throw Error("Choose a valid grade plan and name.");
  const scale = data.scale;
  if (
    !Array.isArray(scale) ||
    !scale.length ||
    scale.length > 30 ||
    !scale.every(
      (row) => row && percentage(row.minimum) && clamp(row.points, 0, 10),
    ) ||
    !scale.some((row) => row.minimum === 0) ||
    new Set(scale.map((row) => row.minimum)).size !== scale.length
  )
    throw Error(
      "The grading scale needs unique thresholds, including 0%, and points from 0 to 10.",
    );
  const terms = data.terms.map((term) => {
    if (!title(term.name) || !uniqueRows(term.courses, 40))
      throw Error("Use a valid semester name and up to 40 courses.");
    const courses = term.courses.map((course) => {
      if (
        !title(course.name) ||
        !clamp(course.credits, 0.01, 100) ||
        !percentage(course.target) ||
        ![course.confirmed, course.forecast].every(
          (value) => value === null || percentage(value),
        ) ||
        typeof course.excluded !== "boolean" ||
        !uniqueRows(course.items, 30)
      )
        throw Error("Check course credits, scores and settings.");
      const items = course.items.map((item) => {
        if (
          !title(item.name, 200) ||
          !percentage(item.weight) ||
          !clamp(item.max, 0.01, 100000) ||
          (item.score !== null && !clamp(item.score, 0, item.max)) ||
          typeof item.absent !== "boolean"
        )
          throw Error("Check each assessment name, weight, score and maximum.");
        return {
          id: item.id,
          name: item.name.trim(),
          weight: item.weight,
          max: item.max,
          score: item.score,
          absent: item.absent,
        };
      });
      return {
        id: course.id,
        name: course.name.trim(),
        credits: course.credits,
        target: course.target,
        confirmed: course.confirmed,
        forecast: course.forecast,
        excluded: course.excluded,
        items,
      };
    });
    return { id: term.id, name: term.name.trim(), courses };
  });
  const result = {
    version: 1,
    name: data.name.trim(),
    terms,
    scale: scale
      .map((x) => ({ minimum: x.minimum, points: x.points }))
      .sort((a, b) => b.minimum - a.minimum),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 500000)
    throw Error("Grade plans may use up to 500 KB.");
  return result;
}
