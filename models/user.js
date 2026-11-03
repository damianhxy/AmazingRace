const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const DB_DIR = path.join(__dirname, "..", "database");
const DB_PATH = path.join(DB_DIR, "users.db");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    class TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    solved TEXT NOT NULL DEFAULT '[]',
    latest INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    admin INTEGER NOT NULL DEFAULT 0
  )
`);

const bcrypt = require("bcryptjs");
const settings = require("../controllers/settings.js");

exports.db = db;

exports.add = function (req, username, password) {
  username = username.trim();

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    throw new Error("User already exists");
  }

  const hash = bcrypt.hashSync(password, settings.HASH_ROUNDS);

  const stmt = db.prepare(`
    INSERT INTO users (username, hash, name, class, phone, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    username,
    hash,
    req.body.name || "",
    req.body.class || "",
    req.body.phone || "",
    req.body.email || "",
  );

  return exports.get(result.lastInsertRowid);
};

exports.authenticate = function (username, password) {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) throw new Error("User does not exist");

  const match = bcrypt.compareSync(password, user.hash);
  if (!match) throw new Error("Wrong password");

  return exports._format(user);
};

exports.leaderboard = function () {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY admin ASC, score DESC, latest ASC, class ASC, name ASC")
    .all();
  return rows.map(exports._format);
};

exports.get = function (id) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? exports._format(row) : null;
};

exports.clear = function (id) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) throw new Error("User not found");

  db.prepare("UPDATE users SET solved = '[]', latest = 0, score = 0 WHERE id = ?").run(id);
  return exports.get(id);
};

exports.delete = function (id) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) throw new Error("User not found");
  if (user.admin) throw new Error("User is an admin");

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
};

exports.solve = function (id, question, score) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) throw new Error("User not found");

  const solved = JSON.parse(user.solved);
  if (solved.includes(question)) {
    throw new Error("Points already claimed");
  }

  solved.push(question);
  const latest = Date.now();
  const newScore = user.score + score;

  db.prepare("UPDATE users SET solved = ?, latest = ?, score = ? WHERE id = ?").run(
    JSON.stringify(solved),
    latest,
    newScore,
    id,
  );

  return exports.get(id);
};

exports._format = function (row) {
  return {
    _id: String(row.id),
    id: row.id,
    username: row.username,
    hash: row.hash,
    name: row.name,
    class: row.class,
    phone: row.phone,
    email: row.email,
    solved: JSON.parse(row.solved),
    latest: row.latest,
    score: row.score,
    admin: Boolean(row.admin),
  };
};
