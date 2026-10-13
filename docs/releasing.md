# Release preparation

Release numbering restarts at **v0.1.0**. The package version is the source for About, What's new, and installer filenames. Existing settings, notes, and AI sessions keep their current formats.

1. Complete the checks in [phases.md](phases.md). Keep new work under Unreleased until the next release is cut.
2. Confirm the package version, README badge, and dated changelog heading agree. The reset baseline uses `0.1.0` and `v0.1.0` for its eventual tag. The release workflow rejects a tag that does not match package.json.
3. Build requested installers with the existing platform build commands. Artifact names derive from `${version}` in electron-builder.yml.
4. Publish or modify GitHub releases only when requested. Resetting local metadata does not remove existing tags, releases, installers, or updater feeds.

The previous 1.x builds have higher semantic versions than 0.1.0. Their updater will not offer 0.1.0 as an upgrade; existing users need to install the restarted release manually. Before publishing, select the restarted release as GitHub's latest release and verify its platform updater files. An old 1.x latest feed would otherwise advertise the old build to a new 0.1.0 installation.

Earlier records remain in [legacy-changelog.md](legacy-changelog.md), [legacy-phases.md](legacy-phases.md), and the historical UI screenshot directories.
