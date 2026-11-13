@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 蟹卡预约助手
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js，请先运行 install.bat 并按提示安装。
  pause
  exit /b 1
)
if not exist node_modules\playwright (
  echo [提示] 尚未安装依赖，请先双击 install.bat。
  pause
  exit /b 1
)
call npm start
pause
