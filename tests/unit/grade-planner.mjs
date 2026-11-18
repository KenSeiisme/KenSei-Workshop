import assert from "node:assert/strict";
import {
  gradeBook,
  gradeCourse,
  gradeAssessment,
  validateGradePlan,
  courseGoal,
  weightedGrade,
  gradePoints,
} from "../../src/tools/grade-planner-core.js";
const book = gradeBook("One");
const a = gradeCourse("A"),
  b = gradeCourse("B"),
  c = gradeCourse("Retake");
a.credits = 4;
a.confirmed = 80;
b.credits = 2;
b.confirmed = 69.99;
c.credits = 3;
c.forecast = 75;
book.terms[0].courses.push(a, b, c);
assert.equal(weightedGrade(book.terms[0].courses, book.scale).gpa, 20 / 6);
assert.equal(
  weightedGrade(book.terms[0].courses, book.scale, true).gpa,
  29 / 9,
);
a.excluded = true;
assert.equal(weightedGrade(book.terms[0].courses, book.scale).gpa, 2);
assert.equal(gradePoints(79.99, book.scale), 3);
const first = { ...gradeAssessment(), weight: 40, score: 80 };
const second = { ...gradeAssessment(), weight: 60 };
a.items = [first, second];
assert.equal(courseGoal(a).earned, 32);
assert.equal(courseGoal(a).remaining, 60);
assert.ok(Math.abs(courseGoal(a).required - 63.3333333333) < 1e-6);
second.absent = true;
assert.equal(courseGoal(a).state, "unreachable");
second.weight = 59;
assert.equal(courseGoal(a).state, "unallocated");
assert.deepEqual(validateGradePlan(book), book);
assert.throws(
  () => validateGradePlan({ ...book, scale: [{ minimum: 50, points: 3 }] }),
  /thresholds/,
);
console.log(
  "PASS weighted marks, pending vs absence, thresholds, GPA/CGPA, forecasts and retake exclusion",
);
