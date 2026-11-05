// Cross-cutting checks: secrets, CSRF, proxy settings, rate limiting and error pages. test.todo
// entries are known gaps, named after the baseline item they miss. Each body checks the behaviour
// the fix should produce, so fixing one means dropping ".todo".
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { start, Client, flash, PASSWORD } = require("./helpers/app.js");

let app;
before(async function () {
  app = await start();
  await new Client(app.baseUrl).signUp("alice");
});
after(() => app.stop());

// Runs the sandbox's app.js with only SESSION_SECRET set (the sandbox has no .env). A process
// still running at the timeout started; status is then null.
function bootWithSecret(secret) {
  return spawnSync(process.execPath, ["app.js"], {
    cwd: app.dir,
    env: { PATH: process.env.PATH, PORT: "0", SESSION_SECRET: secret },
    encoding: "utf8",
    timeout: 5000,
  });
}

test("the app refuses to start without a SESSION_SECRET", function () {
  const result = bootWithSecret("");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SESSION_SECRET/);
});

test.todo(
  "3.3 placeholder/short secret refused: a short or .env.example secret exits 1",
  function () {
    const example = fs.readFileSync(path.resolve(__dirname, "..", ".env.example"), "utf8");
    const placeholder = example.match(/^SESSION_SECRET=(.*)$/m)[1];
    for (const secret of ["too-short", placeholder].filter(Boolean)) {
      const result = bootWithSecret(secret);
      assert.equal(result.status, 1, JSON.stringify(secret));
    }
  },
);

test.todo(
  "3.3 paths relative to the app: it starts from another working directory",
  async function () {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "amazingrace-cwd-"));
    try {
      const result = spawnSync(process.execPath, [path.join(app.dir, "app.js")], {
        cwd,
        env: { PATH: process.env.PATH, PORT: "0", SESSION_SECRET: "s".repeat(48) },
        encoding: "utf8",
        timeout: 3000,
      });
      // Still running when the timeout kills it means it started.
      assert.equal(result.signal, "SIGTERM", result.stderr);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  },
);

test("a form POST without a CSRF token is refused", async function () {
  const client = new Client(app.baseUrl);
  await client.get("/signin");
  const res = await client.request("POST", "/users/signin", {
    form: { username: "alice", password: PASSWORD },
  });
  assert.equal(res.status, 403);
  assert.equal(await client.isSignedIn(), false);
});

test("a form POST with a wrong CSRF token is refused", async function () {
  const client = new Client(app.baseUrl);
  await client.get("/signin");
  const res = await client.request("POST", "/users/signin", {
    form: { csrfToken: "wrong", username: "alice", password: PASSWORD },
  });
  assert.equal(res.status, 403);
});

test.todo(
  "3.7 app-level 4-arg error handler: a CSRF failure shows no stack trace",
  async function () {
    const res = await new Client(app.baseUrl).request("POST", "/users/signin", {
      form: { username: "x", password: "y" },
    });
    assert.equal(res.status, 403);
    assert.doesNotMatch(res.text, /at \w+ \(|node_modules/);
  },
);

test.todo(
  "3.5 no query-string CSRF token: a token only in ?csrfToken= is refused",
  async function () {
    const client = new Client(app.baseUrl);
    await client.get("/signin");
    const res = await client.request(
      "POST",
      "/users/signin?csrfToken=" + encodeURIComponent(client.csrfToken),
      { form: { username: "alice", password: PASSWORD } },
    );
    assert.equal(res.status, 403);
  },
);

test.todo(
  "3.5 no query-string CSRF token: a token in the X-CSRF-Token header is accepted",
  async function () {
    const client = new Client(app.baseUrl);
    await client.get("/signin");
    const res = await client.request("POST", "/users/signin", {
      form: { username: "alice", password: PASSWORD },
      headers: { "x-csrf-token": client.csrfToken },
    });
    assert.equal(res.status, 302);
    assert.equal(await client.isSignedIn(), true);
  },
);

test.todo(
  "3.6 POST sign-out + destroy: GET is gone, POST needs the token and kills the session",
  async function () {
    const client = new Client(app.baseUrl);
    await client.signIn("alice");
    assert.equal((await client.get("/users/signout")).status, 404);
    assert.equal(await client.isSignedIn(), true);
    const noToken = await client.request("POST", "/users/signout", { form: {} });
    assert.equal(noToken.status, 403);
    const oldCookie = client.clone();
    const res = await client.post("/users/signout");
    assert.equal(res.status, 302);
    assert.equal(client.cookies["connect.sid"], undefined, "cookie should be cleared");
    assert.equal(await oldCookie.isSignedIn(), false, "old session cookie must not work");
  },
);

test.todo(
  "3.9 generic sign-in failure message: unknown user and wrong password look the same",
  async function () {
    const messages = [];
    for (const [username, password] of [
      ["nobody", PASSWORD],
      ["alice", "wrong-password"],
    ]) {
      const client = new Client(app.baseUrl);
      await client.signIn(username, password);
      messages.push(flash((await client.get("/signin")).text).error);
    }
    assert.equal(messages[0], messages[1]);
  },
);

test("page loads of /signin do not count toward the sign-in limit", async function () {
  const client = new Client(app.baseUrl);
  let res;
  for (let i = 0; i < 25; i++) res = await client.get("/signin");
  assert.equal(res.status, 200);
});

test("the sign-in limit stops the 21st attempt from one address", async function () {
  const limited = await start();
  try {
    let res;
    for (let i = 0; i < 21; i++) res = await new Client(limited.baseUrl).signIn("nobody", "x");
    assert.equal(res.status, 429);
  } finally {
    await limited.stop();
  }
});

test("TRUST_PROXY values true, false, 1 and loopback all boot", async function () {
  for (const value of ["true", "false", "1", "loopback"]) {
    const instance = await start({ TRUST_PROXY: value });
    try {
      assert.equal((await fetch(instance.baseUrl + "/")).status, 200, value);
    } finally {
      await instance.stop();
    }
  }
});

test.todo(
  "3.4 TRUST_PROXY for the Secure cookie: production issues a Secure cookie behind a proxy",
  async function () {
    const prod = await start({ NODE_ENV: "production", TRUST_PROXY: "1" });
    try {
      const res = await fetch(prod.baseUrl + "/", {
        headers: { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" },
      });
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith("connect.sid="));
      assert.ok(cookie, "no session cookie issued");
      assert.match(cookie, /;\s*Secure/i);
      assert.match(cookie, /;\s*HttpOnly/i);
    } finally {
      await prod.stop();
    }
  },
);

test.todo(
  "3.4 TRUST_PROXY for the Secure cookie: 21 failed sign-ins from one client do not lock out another",
  async function () {
    const proxied = await start({ TRUST_PROXY: "1" });
    try {
      const attempt = async (ip) => {
        const client = new Client(proxied.baseUrl);
        await client.get("/signin");
        return client.request("POST", "/users/signin", {
          form: { csrfToken: client.csrfToken, username: "nobody", password: "x" },
          headers: { "x-forwarded-for": ip },
        });
      };
      let res;
      for (let i = 0; i < 21; i++) res = await attempt("203.0.113.7");
      assert.equal(res.status, 429, "the limiter should stop the 21st attempt");
      res = await attempt("203.0.113.8");
      assert.equal(res.status, 302);
    } finally {
      await proxied.stop();
    }
  },
);
