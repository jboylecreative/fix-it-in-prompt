' Silent launcher for AEImageGen helper on Windows.
' Called by the AE panel via system.callSystem().
' Runs Node.js without any visible command window.
Dim WshShell, helperDir, logDir, logFile, nodePath, cmd

WshShell = CreateObject("WScript.Shell")

' Resolve paths relative to this script's location
helperDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
logDir    = WshShell.ExpandEnvironmentStrings("%APPDATA%") & "\AEImageGen\logs"
logFile   = logDir & "\helper.log"

' Ensure log directory exists
CreateObject("Scripting.FileSystemObject").CreateFolder(logDir)

' Run node with hidden window (0 = hidden, False = don't wait)
cmd = "cmd /c node """ & helperDir & "\src\server.js"" >> """ & logFile & """ 2>&1"
WshShell.Run cmd, 0, False
