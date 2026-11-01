#!/usr/bin/env bash
# يصغّر ملفات لوحة الإدارة ويرفع رقم الإصدار. شغّله قبل كل رفع.
set -e
cd "$(dirname "$0")"
ESB="${ESBUILD:-esbuild}"
$ESB admin/assets/app.js --minify --target=es2020 --charset=utf8 --outfile=admin/assets/app.min.js --log-level=warning
$ESB admin/assets/styles.css --minify --charset=utf8 --outfile=admin/assets/styles.min.css --log-level=warning
V=$(date +%s)
sed -i -E "s/\?v=[0-9]+/?v=$V/g" admin/index.html home/index.html
echo "built v=$V"
