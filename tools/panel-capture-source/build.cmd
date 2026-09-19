@echo off
setlocal
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
cd /d "%~dp0"
if not exist obj mkdir obj
if not exist ..\panel-capture mkdir ..\panel-capture
pushd obj
cl /nologo /c /O2 /MT /I..\vendor\minhook-1.3.4\include ..\vendor\minhook-1.3.4\src\buffer.c ..\vendor\minhook-1.3.4\src\hook.c ..\vendor\minhook-1.3.4\src\trampoline.c ..\vendor\minhook-1.3.4\src\hde\hde64.c ..\vtable.c
if errorlevel 1 exit /b 1
cl /nologo /std:c++20 /EHsc /O2 /MT /DUNICODE /D_UNICODE /DNOMINMAX /LD /I..\vendor\minhook-1.3.4\include ..\capture.cpp buffer.obj hook.obj trampoline.obj hde64.obj vtable.obj /Fe:..\..\panel-capture\MofeiCapture.dll /link d3d12.lib dxgi.lib
if errorlevel 1 exit /b 1
cl /nologo /std:c++20 /EHsc /O2 /MT /DUNICODE /D_UNICODE /DNOMINMAX ..\host.cpp /Fe:..\..\panel-capture\MofeiCaptureHost.exe /link ole32.lib oleaut32.lib windowscodecs.lib
if errorlevel 1 exit /b 1
cl /nologo /std:c++20 /EHsc /O2 /MT /DNOMINMAX ..\test-target.cpp /Fe:..\MofeiCaptureTest.exe /link d3d12.lib dxgi.lib
if errorlevel 1 exit /b 1
popd
copy /y vendor\minhook-1.3.4\LICENSE.txt ..\panel-capture\MinHook-LICENSE.txt >nul
