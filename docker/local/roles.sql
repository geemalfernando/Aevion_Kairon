-- Local Docker stack only: give the API and Auth service roles the database password.
\set pgpass `echo "$POSTGRES_PASSWORD"`
alter user authenticator with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
