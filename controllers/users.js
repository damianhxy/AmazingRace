const express = require("express");
const passport = require("passport");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const user = require("../models/user.js");

const auth = require("../middlewares/auth.js");
const admin = require("../middlewares/admin.js");

const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many sign-in attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many registration attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const registerValidation = [
  body("username")
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username must be 3-30 alphanumeric characters or underscores"),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("class")
    .trim()
    .matches(/^1[7-9][AS][167][0-9A-Q]$/)
    .withMessage("Invalid class format"),
  body("phone")
    .trim()
    .matches(/^\d{8}$/)
    .withMessage("Phone must be exactly 8 digits"),
  body("email").isEmail().withMessage("Invalid email address"),
];

router.get("/profile", auth, function (req, res) {
  res.render("profile", {
    title: "Profile",
    user: req.user,
    data: req.user,
  });
});

router.get("/profile/:id", admin, async function (req, res, next) {
  try {
    const userData = await user.get(req.params.id);
    if (!userData) {
      req.session.error = "User not found";
      return res.redirect("/leaderboard");
    }
    res.render("profile", {
      title: "Profile",
      user: req.user,
      data: userData,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", admin, async function (req, res) {
  try {
    await user.clear(req.params.id);
    req.session.success = "Problems Cleared!";
    res.status(200).redirect(`/users/profile/${req.params.id}`);
  } catch (err) {
    req.session.error = err.message;
    res.status(400).redirect(`/users/profile/${req.params.id}`);
  }
});

router.delete("/:id", admin, async function (req, res) {
  try {
    await user.delete(req.params.id);
    req.session.success = "User Deleted!";
    res.status(200).redirect("/leaderboard");
  } catch (err) {
    req.session.error = err.message;
    res.status(400).redirect("/leaderboard");
  }
});

router.post(
  "/signin",
  signinLimiter,
  passport.authenticate("local-signin", {
    successRedirect: "/",
    failureRedirect: "/signin",
  }),
);

router.post(
  "/signup",
  signupLimiter,
  registerValidation,
  function (req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.error = errors
        .array()
        .map((e) => e.msg)
        .join(". ");
      return res.redirect("/register");
    }
    next();
  },
  passport.authenticate("local-signup", {
    successRedirect: "/",
    failureRedirect: "/register",
  }),
);

router.post("/signout", auth, function (req, res, next) {
  req.logout(function (err) {
    if (err) return next(err);
    req.session.destroy(function (destroyErr) {
      if (destroyErr) return next(destroyErr);
      res.clearCookie("connect.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: req.app.get("env") === "production",
      });
      res.redirect("/");
    });
  });
});

module.exports = router;
