@echo off
chcp 65001 >nul
echo ========================================================
echo   PoseStudio - 摄影师人像姿势库与AI骨骼图生成器
echo ========================================================
echo.
echo 正在启动本地摄影工作台服务...
echo 浏览器即将自动打开，请勿关闭此窗口。
echo.
start http://localhost:8080/index.html
python -m http.server 8080
pause
