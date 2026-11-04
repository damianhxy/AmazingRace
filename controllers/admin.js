const express = require("express");
const router = express.Router();

const problem = require("../models/problem.js");

const admin = require("../middlewares/admin.js");

router.get("/", admin, function (req, res) {
  res.render("admin", {
    title: "Admin",
    user: req.user,
    problems: JSON.stringify(problem.all(), null, 4),
  });
});

router.post("/", admin, async function (req, res) {
  try {
    await problem.update(req.body.data);
    req.session.success = "Problem(s) updated!";
    res.status(200).redirect("/admin");
  } catch (err) {
    req.session.error = err.message;
    res.status(400).redirect("/admin");
  }
});

module.exports = router;
