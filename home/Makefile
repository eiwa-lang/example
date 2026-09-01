build-push:
	docker buildx build \
	--platform linux/amd64 \
	-t eiwac/eiwa-home:$(shell date +%Y%m%d-%H%M) \
	-t eiwac/eiwa-home:latest \
	--push .

run:
	eiwa run

build:
	eiwa build
