@echo off
cd /d "%~dp0"
start "Flight Career Manager" http://localhost:4174
"C:\Users\LAOXIAO\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.mjs
