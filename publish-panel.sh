#!/usr/bin/env bash
# Publica el panel: copia blacklane-logger/panel.html a despacho/index.html y
# le vuelve a poner las credenciales embebidas (el fuente las tiene vacías).
set -euo pipefail
SRC=/home/claude/blacklane-logger/panel.html
DST="$(dirname "$0")/despacho/index.html"
cp "$SRC" "$DST"
python3 - "$DST" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='const EMBED_URL = "", EMBED_KEY = "";'
new='const EMBED_URL = "https://lqeulxlxcbvkvkjozujf.supabase.co", EMBED_KEY = "sb_publishable_vvjypcxf4-rvnWco3zDKIQ_Knb9z8_S";'
assert s.count(old)==1, f"no encontré EMBED vacío ({s.count(old)})"
open(p,"w").write(s.replace(old,new,1))
print("credenciales embebidas OK")
PY
