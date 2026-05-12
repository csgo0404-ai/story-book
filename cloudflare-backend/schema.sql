CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  studentNum TEXT,
  studentName TEXT,
  status TEXT,
  characterName TEXT,
  personality TEXT,
  storyPlace TEXT,
  storyTime TEXT,
  goal TEXT,
  obstacle TEXT,
  helper TEXT,
  process TEXT,
  lesson TEXT,
  ending TEXT,
  storyTitle TEXT,
  structure TEXT,
  story TEXT,
  coverUrl TEXT,
  message TEXT DEFAULT '',
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS students (
  code TEXT PRIMARY KEY,
  num TEXT,
  name TEXT
);

CREATE TABLE IF NOT EXISTS covers (
  id TEXT PRIMARY KEY,
  workId TEXT NOT NULL,
  studentNum TEXT,
  studentName TEXT,
  imageUrl TEXT NOT NULL,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS examples (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  coverUrl TEXT,
  coverBackUrl TEXT,
  chapter TEXT DEFAULT '모험',
  ord INTEGER DEFAULT 0,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS ai_usage (
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, kind)
);

CREATE TABLE IF NOT EXISTS student_ai_daily (
  date TEXT NOT NULL,
  studentNum TEXT NOT NULL,
  studentName TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, studentNum, studentName)
);

CREATE TABLE IF NOT EXISTS options (
  category TEXT NOT NULL,
  ord INTEGER NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (category, ord)
);

CREATE INDEX IF NOT EXISTS idx_works_student ON works(studentNum);
CREATE INDEX IF NOT EXISTS idx_works_updated ON works(updatedAt);
CREATE INDEX IF NOT EXISTS idx_covers_work ON covers(workId);
