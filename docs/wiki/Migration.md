# Migrating to restless

Use `File > Migrate from…`, or the button in the import window. restless also offers this once on first launch if it finds an install.

## Insomnia and Insomnium

1. restless lists the installs it finds, with what each one holds.
2. Pick one and review what will move and what won't.
3. Choose **Import**, then read the report.

Close the other app first if it's open. Its latest changes may not be on disk yet.

Projects, collections, environments, cookies, certificates, API specs, mock routes and tests all move. Each source project becomes a local project.

## Bruno

Choose **Bruno** and pick a collection folder, or a folder holding many. Both `.bru` and YAML collections work.

Scripts are translated. If part of a script can't be, the original stays as a comment at the top and the report lists it. Check those scripts before relying on them.

Bruno's workspace-level global environments aren't read.

## Postman

Postman workspace dumps go through the import window, not the migration window: choose **Import**, then **From File**, and pick the `.zip` Postman exported.

Each collection and each environment in the dump becomes a workspace in the project you choose. Duplicate names stay as they are, and environments are separate workspaces, so pick the one with the variables you need before sending.

## What doesn't move

- **Secrets:** vault values, secret environment values and Bruno secrets are encrypted or stored elsewhere. Their names move, and the values must be entered again.
- **Tokens and credentials:** OAuth tokens, Git credentials and cloud credentials.
- **Git projects:** use `File > Open Folder…` on the repository.
- **Cloud projects:** only what's already on disk moves. Anything else must be synced in the other app first.
- **Settings and responses:** response history and app settings stay behind.
- **Local MCP access:** it's turned off on everything imported, so you grant it again yourself.

## Plugins

The report lists plugins found in the old install, each with its own install button. That's the only step that uses the network.

## Safety

restless never writes to the source install. It takes a backup of its own data before the first write. Running a migration again is safe: anything already imported is skipped, not overwritten.
