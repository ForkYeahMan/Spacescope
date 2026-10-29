.PHONY: run dev install uninstall test lint

run:        ## build (release) and launch
	./run.sh

dev:        ## debug build; frontend files are read from disk, so just refresh the browser
	cargo run -- --no-open

install:    ## install `spacescope` into ~/.cargo/bin
	cargo install --path . --locked --force

uninstall:
	cargo uninstall spacescope

test:
	cargo test

lint:
	cargo clippy --all-targets -- -D warnings
	cargo fmt --check
