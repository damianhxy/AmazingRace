const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const QUESTIONS_PATH = path.join(__dirname, "..", "database", "questions.json");
const LEGACY_PATH = path.join(__dirname, "..", "database", "questions.js");

let problems = {};

function loadProblems() {
  try {
    const content = fs.readFileSync(QUESTIONS_PATH, "utf8");
    problems = JSON.parse(content);
  } catch {
    try {
      const content = fs.readFileSync(LEGACY_PATH, "utf8");
      const m = { exports: {} };
      new Function("module", "exports", content)(m, m.exports);
      problems = m.exports;
      fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(problems, null, 2));
    } catch {
      problems = {};
    }
  }
}

loadProblems();

exports.all = function () {
  return problems;
};

exports.check = function (category, id, answer) {
  if (!Object.hasOwn(problems, category)) {
    throw new Error("Category does not exist");
  }
  if (!Object.hasOwn(problems[category], id)) {
    throw new Error("Problem with that ID does not exist");
  }
  const problem = problems[category][id];
  const answerMatches = problem.case_sensitive
    ? problem.answers.includes(answer)
    : problem.answers.some((candidate) => candidate.toLowerCase() === answer.toLowerCase());
  if (!answerMatches) {
    throw new Error("Wrong answer");
  }
  return problem.stars;
};

exports.update = async function (data) {
  const parsed = JSON.parse(data);
  await fsPromises.writeFile(QUESTIONS_PATH, JSON.stringify(parsed, null, 2));
  problems = parsed;
};
