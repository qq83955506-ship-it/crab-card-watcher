@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Crab Card Watcher - Start
echo ==============================================
echo         大闸蟹蟹卡监控助手 - 启动
echo ==============================================
echo.
echo 当前目录：%CD%
echo.

if not exist "%~dp0package.json" (
  echo [错误] 找不到 package.json。
  echo 请先把 ZIP 解压到普通文件夹，再运行 start.bat。
  goto :end
)

where.exe node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。请先安装 Node.js LTS。
  goto :end
)

if not exist "%~dp0node_modules\playwright\package.json" (
  echo [错误] 没有找到 Playwright 依赖。
  echo 请先双击 install.bat 完成安装。
  goto :end
)

echo 正在启动程序……
echo 浏览器打开后，请在浏览器内手动登录和填写信息。
echo.
call npm.cmd start
set "EXITCODE=%ERRORLEVEL%"
echo.
echo 程序已退出，退出代码：%EXITCODE%
goto :end

:end
echo.
echo 按任意键关闭窗口。
pause >nul
endlocal
