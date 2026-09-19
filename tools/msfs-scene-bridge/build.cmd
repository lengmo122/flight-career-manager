@echo off
setlocal
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
cl /nologo /std:c++17 /O2 /MT /EHsc SceneBridge.cpp /Fe:SkylineVA.MsfsSceneBridge.exe
endlocal
