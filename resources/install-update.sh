#!/bin/sh
# All paths are passed by the main process; no renderer input or downloaded script is executed.
set -eu
umask 077
target=$1
archive=$2
expected_hash=$3
parent_pid=$4
token=$5
data=$6
backups=$7
version=$8
demo=$9
cache="$data/update-cache/$token"
replacement="$(dirname "$target")/.eve-trader-new-$token"
previous="$(dirname "$target")/.eve-trader-old-$token.app"
result="$data/update-result.txt"
new_pid=''
rollback() {
  trap - EXIT INT TERM
  if [ -n "$new_pid" ] && kill -0 "$new_pid" 2>/dev/null; then
    kill "$new_pid" 2>/dev/null || true
    n=0
    while kill -0 "$new_pid" 2>/dev/null && [ "$n" -lt 10 ]; do sleep 1; n=$((n+1)); done
    kill -9 "$new_pid" 2>/dev/null || true
    wait "$new_pid" 2>/dev/null || true
  fi
  if [ -d "$previous" ]; then
    if [ -e "$target" ]; then mv "$target" "$cache/failed-app.app"; fi
    mv "$previous" "$target"
    for name in portfolio.sqlite demo.sqlite; do
      if [ -f "$backups/$name" ]; then
        for suffix in '' '-wal' '-shm'; do
          if [ -f "$data/$name$suffix" ]; then mv "$data/$name$suffix" "$cache/failed-$name$suffix"; fi
        done
        cp "$backups/$name" "$data/$name"
      fi
    done
  fi
  printf 'failed\n%s\n' "$version" > "$result"
  if [ -d "$replacement" ]; then rm -rf "$replacement"; fi
  EVE_USER_DATA="$data" EVE_DEMO="$demo" "$target/Contents/MacOS/EVE Trader" >/dev/null 2>&1 &
  exit 1
}
trap rollback EXIT INT TERM
n=0
while kill -0 "$parent_pid" 2>/dev/null; do
  n=$((n+1)); if [ "$n" -ge 90 ]; then exit 1; fi
  sleep 1
done
actual=$(/usr/bin/shasum -a 512 "$archive")
actual=${actual%% *}
[ "$actual" = "$expected_hash" ]
[ -d "$target/Contents/MacOS" ]
[ ! -e "$replacement" ] && [ ! -e "$previous" ]
mkdir "$replacement"
/usr/bin/ditto -x -k "$archive" "$replacement"
new="$replacement/EVE Trader.app"
[ -x "$new/Contents/MacOS/EVE Trader" ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$new/Contents/Info.plist")" = 'local.eve.trader' ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$new/Contents/Info.plist")" = "$version" ]
mv "$target" "$previous"
mv "$new" "$target"
EVE_USER_DATA="$data" EVE_DEMO="$demo" "$target/Contents/MacOS/EVE Trader" "--eve-update-token=$token" >> "$cache/launch.log" 2>&1 &
new_pid=$!
printf '%s\n' "$new_pid" > "$cache/new-pid"
n=0
while [ "$n" -lt 60 ]; do
  if [ -f "$cache/healthy" ] && [ "$(cat "$cache/healthy")" = "$version" ]; then
    printf 'installed\n%s\n' "$version" > "$result"
    trap - EXIT INT TERM
    rm -rf "$previous" "$replacement"
    exit 0
  fi
  kill -0 "$new_pid" 2>/dev/null || exit 1
  sleep 1
  n=$((n+1))
done
exit 1
