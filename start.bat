@echo off
setlocal
set "NODE_BIN=node"
where node >nul 2>nul
if %errorlevel% neq 0 if exist "C:\Users\31760\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_BIN=C:\Users\31760\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
%NODE_BIN% server.js
endlocal
