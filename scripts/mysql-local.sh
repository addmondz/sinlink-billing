#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# An isolated development-only instance. Does not relink or stop installed database services.
SINLINK_MYSQL_BIN="${SINLINK_MYSQL_BIN:-/opt/homebrew/opt/mysql@8.4/bin}"
SINLINK_MYSQL_DATA="$PWD/storage/mysql"
mkdir -p "$SINLINK_MYSQL_DATA"
if [ ! -d "$SINLINK_MYSQL_DATA/mysql" ]; then
  "$SINLINK_MYSQL_BIN/mysqld" --no-defaults --initialize-insecure --datadir="$SINLINK_MYSQL_DATA" --log-error="$SINLINK_MYSQL_DATA/error.log"
fi
exec "$SINLINK_MYSQL_BIN/mysqld" --no-defaults --datadir="$SINLINK_MYSQL_DATA" --port=3308 --bind-address=127.0.0.1 --socket="$SINLINK_MYSQL_DATA/mysql.sock" --pid-file="$SINLINK_MYSQL_DATA/mysql.pid" --log-error="$SINLINK_MYSQL_DATA/error.log"
