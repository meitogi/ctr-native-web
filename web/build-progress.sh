# web/build-progress.sh — sourced by the dev scripts (solo-dev.sh, share/dev.sh, online/dev.sh) :
#
#   build_with_progress <log> <command> [args…]
#
# Runs the command (a shell function is fine) with its output in <log>. On a terminal one line
# turns while it runs — a spinner, cmake's last [ NN%], the time spent so far — then
# « built in 1 min 12 s ». Elsewhere (CI, a log) only that last line. On failure : the last 20
# lines of the log, its path, and the command's status as the return value.

build_duration() {
  local s=$1
  if [ "$s" -ge 60 ]; then printf '%d min %02d s' $((s / 60)) $((s % 60)); else printf '%d s' "$s"; fi
}

build_with_progress() {
  local log=$1
  shift
  local start=$SECONDS rc=0
  if [ -t 1 ]; then
    "$@" > "$log" 2>&1 &
    local pid=$! frames='|/-\' i=0 pct
    while kill -0 "$pid" 2>/dev/null; do
      pct=$(grep -o '\[ *[0-9]*%\]' "$log" 2>/dev/null | tail -n 1 | tr -d ' ' || true)
      printf '\r\033[K   %s building %s %s' "${frames:i++ % 4:1}" "${pct:-}" "$(build_duration $((SECONDS - start)))"
      sleep 0.2
    done
    wait "$pid" || rc=$?
    printf '\r\033[K'
  else
    "$@" > "$log" 2>&1 || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    tail -n 20 "$log"
    echo "build failed after $(build_duration $((SECONDS - start))), full log $log" >&2
    return "$rc"
  fi
  echo "   built in $(build_duration $((SECONDS - start)))"
}
