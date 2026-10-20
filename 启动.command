#!/bin/zsh
cd -- "$(dirname -- "$0")"
if /usr/bin/curl --silent --fail http://127.0.0.1:8768/ | /usr/bin/grep -q '苏州小学数学知识地图'; then
  open 'http://127.0.0.1:8768/'
else
  (sleep 1; open 'http://127.0.0.1:8768/') &
  python3 scripts/serve.py --port 8768
fi
