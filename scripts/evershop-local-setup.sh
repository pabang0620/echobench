#!/usr/bin/env bash
# R1 on one machine, no system packages and no sudo: an unmodified EverShop next to EchoBench, with a
# local PostgreSQL from the embedded-postgres npm package. Everything lands in .evershop/ and .evershop-pg/
# (both git-ignored). EchoBench never edits EverShop's files; its settings come from the environment.
# Run from the app folder:  bash scripts/evershop-local-setup.sh
# Then:  node --env-file=.evershop-pg/evershop.env scripts/record-evershop.js
#        FORCE_MOCK=1 node --env-file=.evershop-pg/evershop.env scripts/run-ab.js
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
ES="$APP/.evershop"
PGDIR="$APP/.evershop-pg"
export HUSKY=0

[ -d "$ES" ] || bash "$APP/scripts/install-evershop.sh" "$ES"
mkdir -p "$PGDIR"
cd "$PGDIR"
[ -f package.json ] || echo '{"name":"evershop-pg","private":true,"type":"module"}' > package.json
[ -d node_modules/embedded-postgres ] || npm install --no-audit --no-fund embedded-postgres@18.6.0-beta.19
if [ ! -f pg.mjs ]; then
  cat > pg.mjs <<'JS'
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import path from 'node:path'
const dir = path.dirname(new URL(import.meta.url).pathname)
const pg = new EmbeddedPostgres({ databaseDir: path.join(dir, 'data'), user: 'postgres', password: 'postgres', port: 54329, persistent: true })
if (!existsSync(path.join(dir, 'data', 'PG_VERSION'))) await pg.initialise()
await pg.start()
process.stdout.write('postgres ready on 54329\n')
const stop = async () => { await pg.stop(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
setInterval(() => {}, 1 << 30)
JS
fi
if ! (exec 3<>/dev/tcp/127.0.0.1/54329) 2>/dev/null; then
  nohup node pg.mjs > pg.log 2>&1 &
  echo $! > pg.pid
  for _ in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/54329) 2>/dev/null && break; sleep 1; done
fi

cd "$ES"
if [ ! -d node_modules ]; then npm install --no-audit --no-fund --ignore-scripts; fi
mkdir -p config themes extensions public media
[ -d packages/evershop/dist ] || { npm run compile; npm run compile:db; }

# Database, a read-only role for EchoBench's state reads, and the env file the scripts load.
[ -f "$PGDIR/ro.secret" ] || (umask 077; node -e "process.stdout.write(require('crypto').randomBytes(12).toString('hex'))" > "$PGDIR/ro.secret")
cat > "$PGDIR/db.mjs" <<'JS'
import pg from '../.evershop/node_modules/pg/lib/index.js'
import { readFileSync } from 'node:fs'
const conn = (database) => new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', password: 'postgres', database })
const step = process.argv[2]
if (step === 'createdb') {
  const c = conn('postgres'); await c.connect()
  if (!(await c.query("select 1 from pg_database where datname='evershop'")).rowCount) await c.query('create database evershop')
  await c.end()
} else if (step === 'role') {
  const pw = readFileSync(new URL('./ro.secret', import.meta.url), 'utf8').trim()
  const c = conn('evershop'); await c.connect()
  if (!(await c.query("select 1 from pg_roles where rolname='echobench_ro'")).rowCount) await c.query(`CREATE ROLE echobench_ro LOGIN PASSWORD '${pw}'`)
  for (const q of ['GRANT USAGE ON SCHEMA public TO echobench_ro', 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO echobench_ro', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO echobench_ro']) await c.query(q)
  await c.end()
}
JS
node "$PGDIR/db.mjs" createdb
export DB_HOST=127.0.0.1 DB_PORT=54329 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=evershop DB_SSLMODE=disable SUPPRESS_NO_CONFIG_WARNING=1
[ -d .evershop ] || npm run build
# One start runs EverShop's migrations; it is stopped as soon as it answers.
PORT=3361 setsid node ./packages/evershop/dist/bin/start/index.js > "$PGDIR/evershop-migrate.log" 2>&1 &
ES_PID=$!
for _ in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:3361/ && break; sleep 1; done
kill -- -"$ES_PID" 2>/dev/null || true
node "$PGDIR/db.mjs" role

(umask 077; cat > "$PGDIR/evershop.env" <<ENV
EVERSHOP_DIR=$ES
EVERSHOP_DB_NAME=evershop
EVERSHOP_DB_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
EVERSHOP_DB_READONLY_URL=postgres://echobench_ro:$(cat "$PGDIR/ro.secret")@127.0.0.1:54329/evershop
EVERSHOP_PORT=3361
EVERSHOP_WEBHOOK_PATH=/api/paypal/webhook
EVERSHOP_START_CMD=node ./packages/evershop/dist/bin/start/index.js
ENV
)
cd "$APP"
[ -d node_modules/pg ] || npm install --no-save pg
node --env-file=.evershop-pg/evershop.env scripts/evershop-check-schema.js
echo "EverShop $(git -C "$ES" rev-parse --short HEAD) ready. Local PostgreSQL pid: $(cat "$PGDIR/pg.pid" 2>/dev/null || echo 'already running')"
