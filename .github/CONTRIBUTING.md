# Contributing

Contributions are released under the open source license of this project.

## Submitting a pull request

1. Fork https://github.com/on195594/meemo and clone your fork.
2. Create a branch: `git checkout -b my-branch-name`.
3. Make your changes.
4. Run `npm ci && npm test`.
5. Ensure the current repository source builds successfully with `docker build .`.
6. Commit and push your changes.
7. Open a pull request against https://github.com/on195594/meemo.

Docker CI only builds and tests images locally. Repository workflows do not publish images to a remote registry.
