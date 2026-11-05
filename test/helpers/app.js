// Starts the real app in a throwaway copy of the repo, so tests never touch ./database in the
// working tree. Static assets and node_modules are symlinked, not copied.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const repoRoot = path.resolve(__dirname, "..", "..");
const skip = new Set([".git", "node_modules", "database", "public", "test"]);

// The problems every suite starts with. AA01 is case-insensitive (its answers are stored in lower
// case, which is the only form that matches today), AB02 is case-sensitive.
exports.PROBLEMS = {
  AA: { "01": { answers: ["paris"], stars: 3 } },
  AB: { "02": { answers: ["H2O"], stars: 5, case_sensitive: true } },
};

exports.PASSWORD = "test-password-123";

function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function makeSandbox(problems) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amazingrace-test-"));
  for (const entry of fs.readdirSync(repoRoot)) {
    if (skip.has(entry) || entry.startsWith(".env")) continue;
    fs.cpSync(path.join(repoRoot, entry), path.join(dir, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.symlinkSync(path.join(repoRoot, "public"), path.join(dir, "public"), "dir");
  fs.mkdirSync(path.join(dir, "database"));
  fs.writeFileSync(path.join(dir, "database", "questions.json"), JSON.stringify(problems));
  return dir;
}

// Resolves once the server is listening. `env` adds variables; `problems` replaces PROBLEMS.
exports.start = async function (env = {}, { problems = exports.PROBLEMS } = {}) {
  const dir = makeSandbox(problems);
  const port = await freePort();
  // cwd must be the (copied) repo root: database/sessions.db, public/ and views/ are opened
  // relative to the working directory, not to app.js.
  const child = spawn(process.execPath, ["app.js"], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      SESSION_SECRET: "s".repeat(48),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise(function (resolve, reject) {
    const timer = setTimeout(() => reject(Error("App did not start:\n" + output)), 15000);
    function onData(chunk) {
      output += chunk;
      if (output.includes("Listening on port")) {
        clearTimeout(timer);
        resolve();
      }
    }
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", function (code) {
      clearTimeout(timer);
      reject(Error("App exited with code " + code + ":\n" + output));
    });
  });
  child.removeAllListeners("exit");
  return {
    dir,
    baseUrl: "http://127.0.0.1:" + port,
    output: () => output,
    // There is no admin sign-up: an operator sets users.admin in the database, as done here.
    promote(username) {
      const db = new Database(path.join(dir, "database", "users.db"));
      try {
        const result = db.prepare("UPDATE users SET admin = 1 WHERE username = ?").run(username);
        if (result.changes !== 1) throw Error("no such user: " + username);
      } finally {
        db.close();
      }
    },
    problemsOnDisk() {
      return JSON.parse(fs.readFileSync(path.join(dir, "database", "questions.json"), "utf8"));
    },
    stop: async function () {
      if (child.exitCode === null) {
        await new Promise(function (resolve) {
          child.once("exit", resolve);
          child.kill();
        });
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
};

// The flash messages rendered by the layout, or undefined.
exports.flash = function (text) {
  const read = (kind) => text.match(new RegExp(`<strong>${kind}: </strong>([^<]*)`))?.[1].trim();
  return { error: read("Error"), success: read("Success") };
};

// A tiny browser stand-in: keeps cookies and reads the CSRF token from rendered pages.
exports.Client = class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = {};
    this.csrfToken = null;
  }

  clone() {
    const copy = new Client(this.baseUrl);
    copy.cookies = { ...this.cookies };
    copy.csrfToken = this.csrfToken;
    return copy;
  }

  async request(method, url, { form, headers = {} } = {}) {
    const init = {
      method,
      redirect: "manual",
      headers: {
        cookie: Object.entries(this.cookies)
          .map(([k, v]) => k + "=" + v)
          .join("; "),
        ...headers,
      },
    };
    if (form) {
      init.body = new URLSearchParams(form).toString();
      init.headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const res = await fetch(this.baseUrl + url, init);
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      if (/expires=thu, 01 jan 1970/i.test(cookie)) delete this.cookies[name];
      else this.cookies[name] = pair.slice(pair.indexOf("=") + 1);
    }
    const text = await res.text();
    const token = text.match(/<meta name="csrf-token" content="([^"]+)">/);
    if (token) this.csrfToken = token[1];
    return {
      status: res.status,
      headers: res.headers,
      text,
      location: res.headers.get("location"),
    };
  }

  get(url) {
    return this.request("GET", url);
  }

  // Form post with the page's CSRF token in the body, as the site's own forms send it.
  post(url, fields = {}) {
    return this.request("POST", url, { form: { csrfToken: this.csrfToken, ...fields } });
  }

  // Posts, then loads the redirect target and returns its flash messages.
  async postAndFollow(url, fields) {
    const res = await this.post(url, fields);
    if (res.status !== 302) throw Error(`POST ${url}: expected a redirect, got ${res.status}`);
    const page = await this.get(res.location);
    return { location: res.location, ...exports.flash(page.text) };
  }

  // Registers through the form; any field can be overridden. Leaves the client signed in.
  async signUp(username, fields = {}) {
    await this.get("/register");
    return this.post("/users/signup", {
      username,
      password: exports.PASSWORD,
      name: "Name " + username,
      class: "19S6A",
      phone: "91234567",
      email: username + "@example.com",
      ...fields,
    });
  }

  async signIn(username, password = exports.PASSWORD) {
    await this.get("/signin");
    return this.post("/users/signin", { username, password });
  }

  async isSignedIn() {
    return (await this.get("/users/profile")).status === 200;
  }

  // Submits an answer and returns the flash messages shown on /submit afterwards.
  async submit(question, answer) {
    await this.get("/submit");
    return this.postAndFollow("/submit", { question, answer });
  }

  async score() {
    const res = await this.get("/users/profile");
    return Number(res.text.match(/<dt class="col-lg-6">Stars<\/dt>\s*<dd[^>]*>(\d+)</)[1]);
  }
};
