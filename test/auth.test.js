// Registration, sign-in and sign-out as they work today. Every test here shares one app, so it
// stays under the sign-up (10 per hour) and sign-in (20 per 15 minutes) limits per address.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { start, Client, flash, PASSWORD } = require("./helpers/app.js");

let app;
before(async function () {
  app = await start();
});
after(() => app.stop());

test("sign-up creates the account and signs the user in", async function () {
  const client = new Client(app.baseUrl);
  const res = await client.signUp("alice", { name: "Alice Tan", class: "18A1B" });
  assert.equal(res.status, 302);
  assert.equal(res.location, "/");
  const profile = await client.get("/users/profile");
  assert.equal(profile.status, 200);
  for (const value of ["Alice Tan", "alice", "alice@example.com", "18A1B", "91234567"]) {
    assert.ok(profile.text.includes(value), value);
  }
  assert.match(profile.text, /No problems solved yet!/);
});

test("sign-up trims the username", async function () {
  const client = new Client(app.baseUrl);
  await client.signUp("  bob  ", { email: "bob@example.com" });
  assert.equal(await client.isSignedIn(), true);
  const other = new Client(app.baseUrl);
  await other.signIn("bob");
  assert.equal(await other.isSignedIn(), true);
});

test("sign-up rejects invalid fields with the validation messages", async function () {
  const client = new Client(app.baseUrl);
  const res = await client.signUp("carol", { class: "20Z9Z", phone: "123", email: "nope" });
  assert.equal(res.location, "/register");
  const { error } = flash((await client.get("/register")).text);
  assert.equal(
    error,
    "Invalid class format. Phone must be exactly 8 digits. Invalid email address",
  );
  assert.equal(await client.isSignedIn(), false);
  assert.equal((await new Client(app.baseUrl).signIn("carol")).location, "/signin");
});

test("sign-up refuses a taken username", async function () {
  const client = new Client(app.baseUrl);
  await client.signUp("dave");
  const second = new Client(app.baseUrl);
  const res = await second.signUp("dave", { name: "Someone Else" });
  assert.equal(res.location, "/register");
  assert.equal(flash((await second.get("/register")).text).error, "User already exists");
  assert.equal(await second.isSignedIn(), false);
});

test("sign-in with the right password", async function () {
  const client = new Client(app.baseUrl);
  const res = await client.signIn("alice");
  assert.equal(res.status, 302);
  assert.equal(res.location, "/");
  const home = await client.get("/");
  assert.match(home.text, /href="\/users\/profile"><i class="fas fa-user"><\/i> Alice Tan/);
  assert.doesNotMatch(home.text, /href="\/admin"/);
});

test("sign-in with a wrong password", async function () {
  const client = new Client(app.baseUrl);
  const res = await client.signIn("alice", "wrong-password");
  assert.equal(res.location, "/signin");
  assert.equal(flash((await client.get("/signin")).text).error, "Wrong password");
  assert.equal(await client.isSignedIn(), false);
});

test("sign-in with an unknown user", async function () {
  const client = new Client(app.baseUrl);
  const res = await client.signIn("nobody", PASSWORD);
  assert.equal(res.location, "/signin");
  assert.equal(flash((await client.get("/signin")).text).error, "User does not exist");
  assert.equal(await client.isSignedIn(), false);
});

test("pages that need a sign-in redirect to the home page", async function () {
  const client = new Client(app.baseUrl);
  for (const url of ["/users/profile", "/submit", "/admin"]) {
    const res = await client.get(url);
    assert.equal(res.status, 302, url);
    assert.equal(res.location, "/", url);
  }
});

test("sign-out (a GET link today) ends the session", async function () {
  const client = new Client(app.baseUrl);
  await client.signIn("alice");
  assert.equal(await client.isSignedIn(), true);
  const res = await client.get("/users/signout");
  assert.equal(res.status, 302);
  assert.equal(res.location, "/");
  assert.equal(await client.isSignedIn(), false);
});

test("public pages render", async function () {
  const client = new Client(app.baseUrl);
  for (const [url, title] of [
    ["/", "Home"],
    ["/leaderboard", "Leaderboard"],
    ["/signin", "Sign In"],
    ["/register", "Register"],
  ]) {
    const res = await client.get(url);
    assert.equal(res.status, 200, url);
    assert.ok(res.text.includes(`<title>${title} | Science Race 2019</title>`), url);
  }
  const missing = await client.get("/no-such-page");
  assert.equal(missing.status, 404);
  assert.match(missing.text, /could not be found/);
  for (const asset of ["/css/main.css", "/js/main.js", "/img/logo.jpg", "/robots.txt"]) {
    assert.equal((await client.get(asset)).status, 200, asset);
  }
});
