build-push:
	docker buildx build \
	--platform linux/amd64 \
	-t leodouglas/eiwa-home:$(shell date +%Y%m%d-%H%M) \
	-t leodouglas/eiwa-home:latest \
	--push .

run:
	eiwa run

build:
	eiwa build
