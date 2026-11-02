const express = require("express");
const router = express.Router();

const user = require("../models/user.js");
const problem = require("../models/problem.js");

const auth = require("../middlewares/auth.js");

router.get("/", auth, function (req, res) {
  res.render("submit", {
    title: "Submit",
    user: req.user,
  });
});

router.post("/", auth, async function (req, res) {
  try {
    const rawQuestion = req.body.question;
    const answer = req.body.answer;
    const question = typeof rawQuestion === "string" ? rawQuestion.trim().toUpperCase() : "";

    if (!/^[A-Z]{2}\d{2}$/.test(question) || typeof answer !== "string") {
      throw new Error("Invalid submission");
    }

    const category = question.slice(0, 2);
    const id = question.slice(2);

    const score = problem.check(category, id, answer);
    await user.solve(req.user.id, question, score);

    req.session.success = `${question} solved!`;
    res.status(200).redirect("/submit");
  } catch (err) {
    req.session.error = err.message;
    res.status(400).redirect("/submit");
  }
});

module.exports = router;
