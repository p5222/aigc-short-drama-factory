#!/usr/bin/env bash
# =============================================================================
# manjiao_remote.sh —— 在服务器上执行的部署助手（由 deploy_to_manjiao.ps1 scp 过来调用）。
# 纯 bash，无 PowerShell 插值，避开跨壳转义坑。用法：
#   bash manjiao_remote.sh backup      <RemoteDir> <BackupDir>
#   bash manjiao_remote.sh extract     <RemoteDir>              # 解压 /tmp/manjiao_release_HEAD.tar
#   bash manjiao_remote.sh merge_pipp  <RemoteDir>              # 合并 /tmp/pipp.env 到 .env.production
#   bash manjiao_remote.sh rebuild     <RemoteDir>
#   bash manjiao_remote.sh health
#   bash manjiao_remote.sh fingerprint
#   bash manjiao_remote.sh rollback    <RemoteDir> <BackupDir>
# =============================================================================
set -e
COMPOSE="docker compose -f docker-compose.prod.yml"
cmd="${1:-}"; RD="${2:-/opt/manjiao}"; BD="${3:-}"

case "$cmd" in
  backup)
    mkdir -p "$BD"; cd "$RD"
    $COMPOSE exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BD/aigc_drama.dump" || echo "WARN: pg_dump skipped"
    $COMPOSE exec -T api sh -lc 'cd /app && tar -czf - storage' > "$BD/storage.tar.gz" 2>/dev/null || echo "WARN: storage backup skipped"
    tar --exclude=node_modules --exclude=.git --exclude=storage --exclude=backups -czf "$BD/source.tgz" -C "$RD" . || true
    echo "BACKUP_DONE"; ls -la "$BD"
    ;;
  extract)
    cd "$RD"
    tar -xf /tmp/manjiao_release_HEAD.tar
    rm -f /tmp/manjiao_release_HEAD.tar
    echo "EXTRACTED"
    ;;
  merge_pipp)
    cd "$RD"; touch .env.production
    if [ ! -f /tmp/pipp.env ]; then echo "no pipp.env, skip"; exit 0; fi
    while IFS= read -r line; do
      case "$line" in ''|\#*) continue;; esac
      key="${line%%=*}"
      if grep -q "^${key}=" .env.production; then
        sed -i "s|^${key}=.*|${line}|" .env.production
      else
        echo "$line" >> .env.production
      fi
    done < /tmp/pipp.env
    rm -f /tmp/pipp.env
    if grep -q "^MANJIAO_TEXT_API_KEY=." .env.production; then echo "MANJIAO key present"; else echo "WARN: MANJIAO_TEXT_API_KEY empty"; fi
    echo "PIPP_MERGED"
    ;;
  rebuild)
    cd "$RD"
    $COMPOSE up web
    $COMPOSE up -d --force-recreate api
    $COMPOSE restart nginx
    echo "REBUILD_TRIGGERED"
    ;;
  health)
    curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true
    ;;
  fingerprint)
    curl -s http://127.0.0.1:8080/ | grep -oE 'assets/index-[A-Za-z0-9_-]+[.](js|css)' | tr '\n' ' ' || true
    ;;
  rollback)
    cd "$RD"
    tar --exclude=node_modules --exclude=.git --exclude=storage -xzf "$BD/source.tgz" -C "$RD"
    $COMPOSE up web || true
    $COMPOSE up -d --force-recreate api || true
    $COMPOSE restart nginx || true
    echo "ROLLED_BACK"
    ;;
  *)
    echo "unknown cmd: $cmd"; exit 2
    ;;
esac
