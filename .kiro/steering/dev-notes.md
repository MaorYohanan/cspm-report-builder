# Dev Notes — What Works and What Doesn't

## Python Scripts via Terminal

**WORKS:** Writing file content using `python3` script files.

When `fsWrite` / `fsAppend` tools fail with large content (null schema errors), use this pattern instead:

1. Write a temp Python script file using `fsWrite` with small content
2. Run it with `executeBash`: `python3 tmp_script.py`
3. Delete the temp file after

**DOES NOT WORK:**
- `python3 -c "..."` with complex/long inline code — quoting issues cause hangs or failures
- `fsWrite` / `fsAppend` with large text content — tool fails silently or with null schema error
- `fsAppend` with large text — same issue
- Long bash heredocs (`cat << 'EOF' > file`) — hang in terminal

## File Editing

**WORKS:**
- `strReplace` for targeted edits to existing files — reliable for any size replacement
- `python3` script file approach for appending large blocks to files
- Small `fsWrite` calls (under ~50 lines) sometimes work

**DOES NOT WORK:**
- `fsWrite` with hundreds of lines of content
- `fsAppend` with large content blocks

## Git

- Always push to main (single-user tool, user confirmed this is fine)
- User's GitHub: `Metoraf007`, repo: `cspm-report-builder`
- After `app.py` changes: `docker compose up --build -d`
- Frontend files (JS/CSS/HTML) are volume-mounted — just refresh browser

## Cache Busting

- `index.html` uses `?v=N` on CSS/JS includes
- Bump CSS version after CSS changes, JS version after JS changes
- Current: JS `?v=48`, CSS `?v=20`
