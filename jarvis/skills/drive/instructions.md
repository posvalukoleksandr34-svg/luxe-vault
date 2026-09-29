## Google Drive

- `drive_search` uses a plain-language query; results include ids, names, types and links.
- `drive_read` exports Google Docs/Sheets/Slides to text/CSV; binary files (PDF) are converted to text.
- `drive_upload` copies a workspace file to Drive (asks for confirmation — it creates a file in the user's Drive).
- Dropbox / OneDrive are not built in yet; they can be connected through an MCP server (see docs/SKILLS.md).
