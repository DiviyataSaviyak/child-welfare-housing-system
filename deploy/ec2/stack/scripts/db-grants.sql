-- The app's own database account (SEC-3), run by the owner after every migration (deploy.sh):
--
--   psql -U diviyata -d diviyata -v ON_ERROR_STOP=1 -v app_password=<APP_DB_PASSWORD> -f db-grants.sql
--
-- diviyata_app reads and writes rows, and nothing more: it owns nothing, so it can't create, alter
-- or drop a table, and it may only add audit rows, never change or remove them (HIS-3; the
-- trigger on audit_log refuses that to everyone, the owner too). Safe to run again.

SELECT format('CREATE ROLE diviyata_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diviyata_app')
\gexec

-- A new password in .env takes effect at the next deploy.
SELECT format('ALTER ROLE diviyata_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password')
\gexec

REVOKE ALL ON DATABASE diviyata FROM PUBLIC;
GRANT CONNECT ON DATABASE diviyata TO diviyata_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO diviyata_app;

-- Every table the migrations made, including any new one: rows only.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO diviyata_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO diviyata_app;

-- Audit rows are added, never changed or removed. The migrations' own record is the owner's alone.
-- (Both tables are missing only in an empty database, such as one put back from before the first deploy.)
SELECT 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM diviyata_app'
WHERE to_regclass('public.audit_log') IS NOT NULL
\gexec
SELECT 'REVOKE ALL ON _prisma_migrations FROM diviyata_app'
WHERE to_regclass('public._prisma_migrations') IS NOT NULL
\gexec
