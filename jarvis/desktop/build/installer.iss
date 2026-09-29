; Inno Setup 6 script for JARVIS.exe - build.ps1 compiles it: ISCC /DAppVersion=1.0.0 build\installer.iss
; Per-user install (no administrator rights), autostart in the tray, clean uninstall.
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6F1B2E53-4C7A-4F0E-9B1D-2A7E5C9D0E01}
AppName=JARVIS
AppVersion={#AppVersion}
AppPublisher=JARVIS
DefaultDirName={localappdata}\Programs\JARVIS
DefaultGroupName=JARVIS
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=JARVIS-Setup-{#AppVersion}
SetupIconFile=..\resources\jarvis.ico
UninstallDisplayIcon={app}\JARVIS.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
CloseApplications=force
CloseApplicationsFilter=JARVIS.exe

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Запускать JARVIS вместе с Windows (в трее, слушает «Hey Jarvis»)"; Flags: checkedonce
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\JARVIS\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\JARVIS"; Filename: "{app}\JARVIS.exe"
Name: "{autodesktop}\JARVIS"; Filename: "{app}\JARVIS.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "JARVIS"; \
  ValueData: """{app}\JARVIS.exe"" --background"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\JARVIS.exe"; Description: "Запустить JARVIS"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/IM JARVIS.exe /F"; Flags: runhidden; RunOnceId: "StopJarvis"
Filename: "{app}\JARVIS.exe"; Parameters: "--sign-out"; Flags: runhidden waituntilterminated; RunOnceId: "ForgetToken"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\JARVIS\app.log"
Type: files; Name: "{localappdata}\JARVIS\app-settings.txt"
