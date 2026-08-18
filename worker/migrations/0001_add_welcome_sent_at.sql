-- Apply once to an existing D1 database before deploying the welcome-mail code.
ALTER TABLE subscribers ADD COLUMN welcome_sent_at TEXT DEFAULT NULL;
