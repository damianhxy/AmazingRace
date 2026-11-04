const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const QUESTIONS_PATH = path.join(__dirname, "..", "database", "questions.json");
const LEGACY_PATH = path.join(__dirname, "..", "database", "questions.js");

let problems = {};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateProblems(value) {
  if (!isRecord(value)) throw new Error("Problem data must be an object");

  for (const [category, categoryProblems] of Object.entries(value)) {
    if (!/^[A-Z]{2}$/.test(category) || !isRecord(categoryProblems)) {
      throw new Error(`Invalid problem category: ${category}`);
    }

    for (const [id, problem] of Object.entries(categoryProblems)) {
      if (!/^\d{2}$/.test(id) || !isRecord(problem)) {
        throw new Error(`Invalid problem ID: ${category}${id}`);
      }
      // Omitted case_sensitive means case-insensitive, as in the original problem format.
      if (problem.case_sensitive !== undefined && typeof problem.case_sensitive !== "boolean") {
        throw new Error(`${category}${id} case_sensitive must be true or false`);
      }
      if (
        !Array.isArray(problem.answers) ||
        problem.answers.length === 0 ||
        problem.answers.some((answer) => typeof answer !== "string" || answer.length === 0)
      ) {
        throw new Error(`${category}${id} must have at least one non-empty answer`);
      }
      if (!Number.isSafeInteger(problem.stars) || problem.stars < 0) {
        throw new Error(`${category}${id} must have a non-negative integer star value`);
      }
    }
  }

  return value;
}

function loadProblems() {
  if (fs.existsSync(QUESTIONS_PATH)) {
    const content = fs.readFileSync(QUESTIONS_PATH, "utf8");
    problems = validateProblems(JSON.parse(content));
    return;
  }

  if (fs.existsSync(LEGACY_PATH)) {
    const content = fs.readFileSync(LEGACY_PATH, "utf8");
    const m = { exports: {} };
    new Function("module", "exports", content)(m, m.exports);
    problems = validateProblems(m.exports);
    fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(problems, null, 2));
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
  if (typeof data !== "string") throw new Error("Problem data is required");
  const parsed = validateProblems(JSON.parse(data));
  const temporaryPath = `${QUESTIONS_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsPromises.writeFile(temporaryPath, JSON.stringify(parsed, null, 2));
    await fsPromises.rename(temporaryPath, QUESTIONS_PATH);
  } catch (err) {
    await fsPromises.rm(temporaryPath, { force: true });
    throw err;
  }
  problems = parsed;
};
