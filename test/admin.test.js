// The admin pages: editing the problems, and clearing or deleting a player from their profile.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { start, Client, PROBLEMS } = require("./helpers/app.js");

let app;
let admin;
let player;
let playerId;
before(async function () {
  app = await start();
  admin = new Client(app.baseUrl);
  await admin.signUp("root", { name: "Root Admin" });
  app.promote("root");
  player = new Client(app.baseUrl);
  await player.signUp("alice", { name: "Alice Tan" });
  await player.submit("AA01", "paris");
  const board = await admin.get("/leaderboard");
  playerId = board.text.match(/href="\/users\/profile\/(\d+)">Alice Tan</)[1];
});
after(() => app.stop());

// Loads a page first so the client holds a current token, as the browser would.
async function adminPost(url, fields) {
  await admin.get("/admin");
  return admin.postAndFollow(url, fields);
}

test("non-admins cannot open or change the admin pages", async function () {
  for (const res of [await player.get("/admin"), await player.get(`/users/profile/${playerId}`)]) {
    assert.equal(res.status, 302);
    assert.equal(res.location, "/");
  }
  const update = { AA: { "01": { answers: ["x"], stars: 99 } } };
  const res = await player.post("/admin", { data: JSON.stringify(update) });
  assert.equal(res.location, "/");
  assert.deepEqual(app.problemsOnDisk(), PROBLEMS);
  for (const method of ["PUT", "DELETE"]) {
    const r = await player.post(`/users/${playerId}?_method=${method}`);
    assert.equal(r.location, "/", method);
  }
  assert.equal(await player.score(), 3);
});

test("the admin page shows the problems and an Admin link", async function () {
  const home = await admin.get("/");
  assert.match(home.text, /href="\/admin"/);
  const res = await admin.get("/admin");
  assert.equal(res.status, 200);
  const shown = res.text.match(/<textarea name="data" hidden>([\s\S]*?)<\/textarea>/)[1];
  assert.deepEqual(JSON.parse(shown.replaceAll("&quot;", '"')), PROBLEMS);
});

test("an admin can see a player's profile", async function () {
  const res = await admin.get(`/users/profile/${playerId}`);
  assert.equal(res.status, 200);
  for (const value of ["Alice Tan", "alice@example.com", "AA01"]) {
    assert.ok(res.text.includes(value), value);
  }
  assert.match(res.text, new RegExp(`action="/users/${playerId}\\?_method=DELETE"`));
  assert.match(res.text, new RegExp(`action="/users/${playerId}\\?_method=PUT"`));
});

test("editing the problems takes effect at once and is saved", async function () {
  const updated = { ...PROBLEMS, BA: { "07": { answers: ["42"], stars: 2 } } };
  const res = await adminPost("/admin", { data: JSON.stringify(updated) });
  assert.equal(res.location, "/admin");
  assert.equal(res.success, "Problem(s) updated!");
  assert.deepEqual(app.problemsOnDisk(), updated);
  assert.equal((await player.submit("BA07", "42")).success, "BA07 solved!");
  assert.equal(await player.score(), 5);
});

test("clearing a player resets their score and solved problems", async function () {
  const res = await adminPost(`/users/${playerId}?_method=PUT`);
  assert.equal(res.location, `/users/profile/${playerId}`);
  assert.equal(res.success, "Problems Cleared!");
  assert.equal(await player.score(), 0);
  assert.match((await player.get("/users/profile")).text, /No problems solved yet!/);
  assert.equal((await player.submit("AA01", "paris")).success, "AA01 solved!");
});

test("an admin cannot be deleted", async function () {
  const board = await admin.get("/leaderboard");
  const rootId = board.text.match(/href="\/users\/profile\/(\d+)">Root Admin</)[1];
  const res = await adminPost(`/users/${rootId}?_method=DELETE`);
  assert.equal(res.error, "User is an admin");
  assert.equal(await admin.isSignedIn(), true);
});

test("deleting a player removes them everywhere", async function () {
  const res = await adminPost(`/users/${playerId}?_method=DELETE`);
  assert.equal(res.location, "/leaderboard");
  assert.equal(res.success, "User Deleted!");
  assert.doesNotMatch((await admin.get("/leaderboard")).text, /Alice Tan/);
  assert.equal(await player.isSignedIn(), false);
  const again = await new Client(app.baseUrl).signIn("alice");
  assert.equal(again.location, "/signin");
  const gone = await admin.get(`/users/profile/${playerId}`);
  assert.equal(gone.location, "/leaderboard");
});

test.todo(
  "3.9 IDs and lookups: a malformed problem update is rejected and the live problems kept",
  async function () {
    const before = app.problemsOnDisk();
    const bad = { AA: { "01": { answers: "paris", stars: 3 } } };
    const res = await adminPost("/admin", { data: JSON.stringify(bad) });
    assert.ok(res.error, "no error shown");
    assert.deepEqual(app.problemsOnDisk(), before);
  },
);

test.todo(
  "Admin editor: ace's basePath serves the JSON mode and theme (no highlighting today)",
  async function () {
    const page = await admin.get("/admin");
    const basePath = page.text.match(/ace\.config\.set\("basePath", "([^"]+)"\)/)[1];
    if (!basePath.startsWith("/")) {
      // A CDN path is fine if it matches the ace.js version the page loads.
      assert.match(basePath, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/ace\/1\.39\.1\/?$/);
      return;
    }
    for (const file of ["mode-json.js", "theme-monokai.js"]) {
      assert.equal((await admin.get(`${basePath}/${file}`)).status, 200, file);
    }
  },
);
