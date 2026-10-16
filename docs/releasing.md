# Release preparation

The current release is **v0.2.0**. Numbering restarted at v0.1.0. The package version is the source for About, What's new, and installer filenames. Existing settings, notes, and AI sessions keep their current formats.

1. Complete the checks in [phases.md](phases.md). Keep new work under Unreleased until the next release is cut.
2. Confirm the package version and dated changelog heading agree, and update the README's download status when installers become available. The release workflow rejects a tag that does not match package.json.
3. Build requested installers with the existing platform build commands. Artifact names derive from `${version}` in electron-builder.yml.
4. Publish or modify GitHub releases only when requested. Resetting local metadata does not remove existing tags, releases, installers, or updater feeds.

The previous 1.x builds have higher semantic versions than 0.2.0. Their updater will not offer 0.2.0 as an upgrade; existing users need to install the restarted release manually. Before publishing, select the restarted release as GitHub's latest release and verify its platform updater files. An old 1.x latest feed would otherwise advertise the old build to a new 0.2.0 installation.

Windows releases include the setup `.exe`, its `.blockmap`, and `latest.yml`. Verify the installer's SHA-512 and byte count against that feed before publishing. Release notes should describe the current changelog section and identify platforms actually built.

TypeScript 7 runs as the `@typescript/native` alias, while `typescript` supplies Microsoft's TypeScript 6 compatibility API for ESLint, following [Microsoft's migration guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0). jsdom remains pinned to 30.1.1 because 30.1.2 breaks the existing shadow-DOM keyboard-focus checks; those checks remain enabled.

Earlier records remain in [legacy-changelog.md](legacy-changelog.md), [legacy-phases.md](legacy-phases.md), and the historical UI screenshot directories.
