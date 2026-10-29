#!/bin/sh
set -eu
site=/opt/1panel/apps/openresty/openresty/www/sites/schema-explorer.luo.sx
docker run --rm \
  -v /opt/schema-explorer/letsencrypt:/etc/letsencrypt \
  -v "$site/index":/webroot \
  certbot/certbot:latest renew --quiet --cert-name schema-explorer.luo.sx
install -m 644 /opt/schema-explorer/letsencrypt/live/schema-explorer.luo.sx/fullchain.pem "$site/ssl/fullchain.pem"
install -m 600 /opt/schema-explorer/letsencrypt/live/schema-explorer.luo.sx/privkey.pem "$site/ssl/privkey.pem"
docker exec 1Panel-openresty-PgDt nginx -t
docker exec 1Panel-openresty-PgDt nginx -s reload
