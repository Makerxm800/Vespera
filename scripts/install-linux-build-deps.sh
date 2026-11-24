#!/usr/bin/env bash
# Install the native GTK/WebKit libraries needed by Tauri's Linux build.
# Package indexes and downloaded .debs live under RUNNER_TEMP so GitHub Actions
# can cache them without writing into root-owned system directories.
set -euo pipefail

cache_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/vespera-apt-cache"
lists_dir="$cache_root/lists"
archives_dir="$cache_root/archives"
updated_marker="$cache_root/index-updated-on"
today="$(date -u +%F)"

mkdir -p "$lists_dir/partial" "$archives_dir/partial"
sudo chown -R "$(id -u):$(id -g)" "$cache_root"
apt_opts=(
  -o "Dir::State::lists=$lists_dir"
  -o "Dir::Cache::archives=$archives_dir"
)

refresh_indexes() {
  sudo apt-get "${apt_opts[@]}" update \
    -o Acquire::Languages=none \
    -o Acquire::Retries=2 \
    -o Acquire::http::Timeout=30 \
    -o Acquire::https::Timeout=30
  printf '%s\n' "$today" > "$updated_marker"
}

if [[ "$(cat "$updated_marker" 2>/dev/null || true)" == "$today" ]]; then
  echo "Using cached Ubuntu package indexes from $today."
else
  echo "Refreshing Ubuntu package indexes (cached for the remaining UTC day)."
  refresh_indexes
fi

packages=(
  libwebkit2gtk-4.1-dev
  libgtk-3-dev
  libayatana-appindicator3-dev
  librsvg2-dev
  libjavascriptcoregtk-4.1-dev
)
install_packages() {
  sudo apt-get "${apt_opts[@]}" install -y --no-install-recommends "${packages[@]}"
}

# If a restored index is incomplete, refresh once and retry before failing.
if ! install_packages; then
  echo "Cached package indexes were insufficient; refreshing and retrying."
  refresh_indexes
  install_packages
fi

# apt runs as root; hand the cache back so actions/cache can archive it.
sudo chown -R "$(id -u):$(id -g)" "$cache_root"
