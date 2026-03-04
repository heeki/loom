FRONTEND_PORT ?= 5173

install:
	npm install

dev:
	npm run dev -- --port $(FRONTEND_PORT)

build:
	npm run build

preview:
	npm run preview -- --port $(FRONTEND_PORT)

typecheck:
	npx tsc -b --noEmit

clean:
	rm -rf dist node_modules/.tmp
