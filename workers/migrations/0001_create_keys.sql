CREATE TABLE IF NOT EXISTS access_keys (
  role TEXT PRIMARY KEY CHECK (role IN ('site_access', 'upload')),
  salt TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  role TEXT NOT NULL CHECK (role IN ('site_access', 'upload')),
  client_hash TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (role, client_hash)
);
