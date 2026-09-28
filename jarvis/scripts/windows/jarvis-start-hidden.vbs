' Runs jarvis-start.ps1 with no visible window at all (used by the logon task).
' Extra arguments (e.g. -OpenApp) are passed through.
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
    args = args & " " & a
Next
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\jarvis-start.ps1""" & args, 0, False
