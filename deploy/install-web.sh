#!/usr/bin/env bash
set -Eeuo pipefail
release=${1:?usage: install-web.sh RELEASE}
[[ "$release" =~ ^[0-9a-f]{12}-[0-9]{13}$ ]] || { echo 'Invalid release' >&2; exit 1; }
[[ $(pwd -P) == "/opt/skillludo/web/releases/$release" ]] || { echo 'Unexpected release directory' >&2; exit 1; }
image="docker.io/skillludo/web:$release"
previous=$(kubectl -n skillludo get deployment web -o jsonpath='{.spec.template.spec.containers[0].image}' --ignore-not-found)
had_ingress=$(kubectl -n skillludo get ingress web -o name --ignore-not-found)
rollback() {
  trap - ERR
  echo 'Web deployment failed; restoring previous frontend route/image.' >&2
  if [[ -n "$previous" ]]; then
    kubectl -n skillludo set image deployment/web "web=$previous"
    kubectl -n skillludo rollout status deployment/web --timeout=120s || true
  fi
  if [[ -z "$had_ingress" ]]; then kubectl -n skillludo delete ingress web --ignore-not-found; fi
  exit 1
}
trap rollback ERR
docker build --network=none -f deploy/Dockerfile -t "$image" .
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --network=none --add-host server:127.0.0.1 "$image" -t
docker save "$image" | k3s ctr images import --no-unpack -
sed "s|__WEB_IMAGE__|$image|g" deploy/web.yaml | kubectl apply -f -
kubectl -n skillludo rollout status deployment/web --timeout=120s
kubectl apply -f deploy/ingress.yaml
# Allow Traefik a bounded reconciliation interval, then verify both services.
verified=false
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 5 http://127.0.0.1/version.json | grep -Fq "$release" && curl -fsS --max-time 5 http://127.0.0.1/readyz >/dev/null; then
    verified=true; break
  fi
  sleep 2
done
[[ "$verified" == true ]]
mkdir -p /opt/skillludo/web
printf '%s\n' "$previous" > /opt/skillludo/web/previous-image
printf '%s\n' "$image" > /opt/skillludo/web/current-image
echo "Published frontend: $image"
curl -fsS --max-time 5 http://127.0.0.1/version.json
