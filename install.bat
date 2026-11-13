@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Crab Card Watcher - Install
set "LOG=%~dp0install-log.txt"
echo ==============================================
echo         大闸蟹蟹卡监控助手 - 安装
echo ==============================================
echo.
echo 当前目录：%CD%
echo 安装日志：%LOG%
echo.

if not exist "%~dp0package.json" (
  echo [错误] 找不到 package.json。
  echo 请先把下载的 ZIP 文件解压到普通文件夹，再运行 install.bat。
  goto :end
)

where.exe node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo 请安装 Node.js LTS：https://nodejs.org/zh-cn
  echo 安装完成后关闭此窗口，重新打开 install.bat。
  goto :end
)

where.exe npm >nul 2>&1
if errorlevel 1 (
  echo [错误] 找不到 npm。请重新安装 Node.js LTS，并勾选添加到 PATH。
  goto :end
)

echo Node.js 版本：
node --version
echo npm 版本：
call npm.cmd --version
echo.
echo [1/2] 正在安装程序依赖，请不要关闭窗口……
call npm.cmd install > "%LOG%" 2>&1
if errorlevel 1 (
  echo [错误] npm install 安装失败，详细信息如下：
  type "%LOG%"
  goto :end
)
type "%LOG%"

echo.
echo [2/2] 正在安装 Chromium 浏览器，请不要关闭窗口……
call npx.cmd playwright install chromium >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [错误] Chromium 安装失败，详细信息如下：
  type "%LOG%"
  goto :end
)

echo.
echo [成功] 安装完成！现在可以双击 start.bat。
goto :end

:end
echo.
echo 窗口将在你按任意键后关闭。
echo 如需排查，请把上面的错误内容或 install-log.txt 发给我。
pause >nul
endlocal
