const settings = require("./settings.js");

const user = require("../models/user.js");

const { csrfSync } = require("csrf-sync");
const helmet = require("helmet");
const morgan = require("morgan");
const passport = require("passport");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const exphbs = require("express-handlebars");
const LocalStrategy = require("passport-local");
const SqliteStore = require("better-sqlite3-session-store")(session);
const Database = require("better-sqlite3");
const methodOverride = require("method-override");

function formatTimestamp() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

module.exports = function (app, express) {
  morgan.token("time", formatTimestamp);

  const sessionDb = new Database("./database/sessions.db");
  const isProduction = app.get("env") === "production";

  // Behind an HTTPS proxy, req.secure (needed for the Secure session cookie) and
  // req.ip (used by the rate limiters) only reflect the client when the proxy is trusted.
  if (settings.TRUST_PROXY) {
    const hops = Number(settings.TRUST_PROXY);
    app.set("trust proxy", Number.isInteger(hops) ? hops : settings.TRUST_PROXY);
  } else if (isProduction) {
    console.warn("WARNING: TRUST_PROXY is not set; production session cookies need an HTTPS proxy");
  }

  // Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(express.static("public"));
  app.use(morgan("[:time] :method :url :status :response-time ms"));
  app.use(cookieParser(settings.SECRET));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: settings.SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
      },
      store: new SqliteStore({
        client: sessionDb,
        expired: {
          clear: true,
          intervalMs: 900000, // 15 minutes
        },
      }),
    }),
  );
  app.use(methodOverride("_method"));
  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF protection — adds req.csrfToken() and validates on state-changing requests
  const csrf = csrfSync({
    getTokenFromRequest: (req) => req.body?.csrfToken || req.query?.csrfToken,
  });
  app.use(csrf.csrfSynchronisedProtection);
  app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
  });

  // Strategies
  passport.use(
    "local-signin",
    new LocalStrategy({ passReqToCallback: true }, async function (req, username, password, done) {
      try {
        const userData = await user.authenticate(username, password);
        console.log("Signed in", userData.username);
        done(null, userData);
      } catch (err) {
        console.error(err);
        req.session.error = err.message;
        done(null, false);
      }
    }),
  );

  passport.use(
    "local-signup",
    new LocalStrategy({ passReqToCallback: true }, async function (req, username, password, done) {
      try {
        const userData = await user.add(req, username, password);
        console.log("Signed up", userData.username);
        done(null, userData);
      } catch (err) {
        console.error(err);
        req.session.error = err.message;
        done(null, false);
      }
    }),
  );

  // Serialization
  passport.serializeUser(function (user, done) {
    done(null, user.id);
  });

  passport.deserializeUser(function (id, done) {
    try {
      const userData = user.get(id);
      if (!userData) return done(null, false);
      done(null, userData);
    } catch (err) {
      done(err, false);
    }
  });

  const hbs = exphbs.create({
    defaultLayout: "default",
    helpers: {
      math: require("../helpers/math.js"),
    },
  });

  app.enable("case sensitive routing");
  app.enable("strict routing");
  app.disable("x-powered-by");
  app.engine("handlebars", hbs.engine);
  app.set("view engine", "handlebars");
};
