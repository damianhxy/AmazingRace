// Answer submission and scoring, with the problems in helpers/app.js (AA01: "paris", 3 stars,
// case-insensitive; AB02: "H2O", 5 stars, case-sensitive).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { start, Client } = require("./helpers/app.js");

let app;
before(async function () {
  app = await start();
});
after(() => app.stop());

async function newPlayer(username) {
  const client = new Client(app.baseUrl);
  await client.signUp(username);
  return client;
}

test("a signed-out visitor cannot submit", async function () {
  const client = new Client(app.baseUrl);
  await client.get("/");
  const res = await client.post("/submit", { question: "AA01", answer: "paris" });
  assert.equal(res.status, 302);
  assert.equal(res.location, "/");
});

test("a correct answer scores the problem's stars", async function () {
  const client = await newPlayer("alice");
  assert.equal(await client.score(), 0);
  const res = await client.submit("AA01", "paris");
  assert.equal(res.location, "/submit");
  assert.equal(res.success, "AA01 solved!");
  assert.equal(await client.score(), 3);
  const profile = await client.get("/users/profile");
  assert.match(profile.text, /<li class="list-inline-item">AA01<\/li>/);
});

test("resubmitting a solved problem scores nothing", async function () {
  const client = new Client(app.baseUrl);
  await client.signIn("alice");
  const res = await client.submit("AA01", "paris");
  assert.equal(res.error, "Points already claimed");
  assert.equal(await client.score(), 3);
});

test("a wrong answer scores nothing and can be retried", async function () {
  const client = await newPlayer("bob");
  assert.equal((await client.submit("AA01", "london")).error, "Wrong answer");
  assert.equal(await client.score(), 0);
  assert.equal((await client.submit("AA01", "paris")).success, "AA01 solved!");
  assert.equal(await client.score(), 3);
});

test("case-insensitive problems ignore the case of the answer", async function () {
  const client = await newPlayer("carol");
  assert.equal((await client.submit("AA01", "PaRiS")).success, "AA01 solved!");
});

test("case-sensitive problems need the exact case", async function () {
  const client = await newPlayer("dave");
  assert.equal((await client.submit("AB02", "h2o")).error, "Wrong answer");
  assert.equal((await client.submit("AB02", "H2O")).success, "AB02 solved!");
  assert.equal(await client.score(), 5);
});

test("scores add up across problems", async function () {
  const client = await newPlayer("erin");
  await client.submit("AA01", "paris");
  await client.submit("AB02", "H2O");
  assert.equal(await client.score(), 8);
});

test("unknown categories and problem IDs are reported", async function () {
  const client = await newPlayer("frank");
  assert.equal((await client.submit("ZZ01", "paris")).error, "Category does not exist");
  assert.equal((await client.submit("AA99", "paris")).error, "Problem with that ID does not exist");
  assert.equal(await client.score(), 0);
});

test.todo(
  "3.9 IDs and lookups: a case-insensitive answer configured with capitals can be solved",
  async function () {
    const custom = await start(
      {},
      { problems: { AC: { "03": { answers: ["Paris"], stars: 1 } } } },
    );
    try {
      const client = new Client(custom.baseUrl);
      await client.signUp("grace");
      assert.equal((await client.submit("AC03", "paris")).success, "AC03 solved!");
    } finally {
      await custom.stop();
    }
  },
);

test.todo("3.9 IDs and lookups: a lower-case question ID is accepted", async function () {
  const client = new Client(app.baseUrl);
  await client.signIn("frank");
  assert.match((await client.submit("aa01", "paris")).success ?? "", /solved/);
});

test.todo("3.9 IDs and lookups: inherited property names are not problem IDs", async function () {
  const client = new Client(app.baseUrl);
  await client.signIn("frank");
  assert.equal((await client.submit("AAconstructor", "x")).error, "Invalid submission");
});
