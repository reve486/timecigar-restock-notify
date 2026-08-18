CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'unsubscribed')),
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  welcome_sent_at TEXT
);
