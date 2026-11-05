CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  name        TEXT NOT NULL,
  relation    TEXT,
  place       TEXT,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  key        TEXT PRIMARY KEY,
  memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  caption    TEXT,
  width      INTEGER,
  height     INTEGER
);
CREATE INDEX IF NOT EXISTS memories_status ON memories(status, created_at);
