@echo off
setlocal
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
cl /nologo /std:c++17 /O2 /MT /EHsc RouteBridge.cpp /Fe:SkylineVA.MsfsRouteBridge.exe
copy /y "..\msfs-scene-bridge\SimConnect.dll" "SimConnect.dll" >nul
endlocal
