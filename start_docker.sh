#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env_docker}"
IMAGE_NAME="${IMAGE_NAME:-upgrade-chess}"
CONTAINER_NAME="${CONTAINER_NAME:-upgrade-chess-app}"
PORT="${PORT:-8001}"

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required but was not found in PATH." >&2
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "Expected env file at $ENV_FILE, but it does not exist." >&2
    exit 1
fi

echo "Building Docker image: $IMAGE_NAME"
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "Removing existing container: $CONTAINER_NAME"
    docker rm -f "$CONTAINER_NAME"
fi

existing_image_id=$(docker image inspect "$IMAGE_NAME" --format '{{.Id}}' 2>/dev/null || true)
if [ -n "$existing_image_id" ]; then
    echo "Removing existing image: $IMAGE_NAME"
    docker image rm -f "$IMAGE_NAME"
fi

docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

echo "Starting container: $CONTAINER_NAME"
echo "App URL: http://localhost:$PORT"
echo "Mounted env file: $ENV_FILE"

set -- \
    -d \
    --name "$CONTAINER_NAME" \
    --env-file "$ENV_FILE" \
    -e "PORT=$PORT" \
    -p "$PORT:$PORT" \
    -v "$ENV_FILE:/app/.env:ro"

for var_name in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD FLASK_SECRET_KEY GOOGLE_CLIENT_ID; do
    eval "var_value=\${$var_name-}"
    if [ -n "${var_value}" ]; then
        set -- "$@" -e "$var_name=$var_value"
    fi
done

container_id=$(docker run "$@" "$IMAGE_NAME")

echo "Container started in detached mode: $container_id"
echo "View logs with: docker logs -f $CONTAINER_NAME"
echo "Stop it with: docker stop $CONTAINER_NAME"
