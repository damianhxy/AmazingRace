// Leaderboard order: most stars first, then whoever reached their score first; admins last,
// without a rank.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { start, Client } = require("./helpers/app.js");

let app;
before(async function () {
  app = await start();
});
after(() => app.stop());

// [rank, name, class, stars] for each row, in page order.
async function rows(client = new Client(app.baseUrl)) {
  const res = await client.get("/leaderboard");
  assert.equal(res.status, 200);
  const body = res.text.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/g)].map((cell) =>
      cell[2].replace(/<[^>]+>/g, "").trim(),
    ),
  );
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

test("an empty leaderboard says so", async function () {
  const res = await new Client(app.baseUrl).get("/leaderboard");
  assert.match(res.text, /No users on the leaderboard!/);
});

test("players are ranked by stars, then by who got there first", async function () {
  const players = {};
  for (const [username, cls] of [
    ["alice", "19S6A"],
    ["bob", "18A1B"],
    ["carol", "17S70"],
    ["dave", "19A6Q"],
  ]) {
    players[username] = new Client(app.baseUrl);
    await players[username].signUp(username, { name: username.toUpperCase(), class: cls });
  }
  // carol reaches 3 stars before alice; bob has the most; dave has none.
  await players.carol.submit("AA01", "paris");
  await pause();
  await players.alice.submit("AA01", "paris");
  await pause();
  await players.bob.submit("AB02", "H2O");

  assert.deepEqual(await rows(), [
    ["1", "BOB", "18A1B", "5"],
    ["2", "CAROL", "17S70", "3"],
    ["3", "ALICE", "19S6A", "3"],
    ["4", "DAVE", "19A6Q", "0"],
  ]);

  // alice overtakes everyone once she also solves AB02.
  await pause();
  await players.alice.submit("AB02", "H2O");
  assert.deepEqual(
    (await rows()).map((row) => row[1]),
    ["ALICE", "BOB", "CAROL", "DAVE"],
  );
});

test("admins are listed last, without a rank or score", async function () {
  const admin = new Client(app.baseUrl);
  await admin.signUp("root", { name: "ROOT" });
  app.promote("root");
  await admin.submit("AA01", "paris");
  const table = await rows();
  assert.deepEqual(table.at(-1), ["Admin", "ROOT", "19S6A", "N/A"]);
  assert.deepEqual(
    table.slice(0, -1).map((row) => row[0]),
    ["1", "2", "3", "4"],
  );
});

test("only admins see links to player profiles", async function () {
  const visitor = await new Client(app.baseUrl).get("/leaderboard");
  assert.doesNotMatch(visitor.text, /href="\/users\/profile\/\d+"/);
  const admin = new Client(app.baseUrl);
  await admin.signIn("root");
  const page = await admin.get("/leaderboard");
  assert.equal(page.text.match(/href="\/users\/profile\/\d+"/g).length, 5);
});
