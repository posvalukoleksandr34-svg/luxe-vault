# PyInstaller spec for JARVIS.exe (one folder, no console window).
#   cd desktop ; pyinstaller build\jarvis.spec --noconfirm --clean
# build.ps1 runs this for you and then packs the folder into an installer with Inno Setup.
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

block_cipher = None
ROOT = SPECPATH + "\\.."  # desktop\

datas = [(ROOT + "\\resources", "resources")]
datas += collect_data_files("openwakeword")        # wake-word models downloaded by build.ps1
datas += collect_data_files("_sounddevice_data")   # PortAudio DLL
binaries = collect_dynamic_libs("onnxruntime")

a = Analysis(
    [ROOT + "\\jarvis_app.py"],
    pathex=[ROOT, ROOT + "\\..\\satellite"],
    binaries=binaries,
    datas=datas,
    hiddenimports=[
        "jarvis_desktop", "jarvis_satellite",
        "keyring.backends.Windows", "win32ctypes.core",
        "pystray._win32", "PIL.ImageGrab",
        "pycaw.pycaw", "comtypes.stream",
        *collect_submodules("openwakeword"),
    ],
    excludes=["tkinter.test", "matplotlib", "pandas", "scipy", "torch"],
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="JARVIS",
    icon=ROOT + "\\resources\\jarvis.ico",
    console=False,            # tray app: no black window
    version=SPECPATH + "\\version.txt",
    upx=False,                # UPX-packed executables trigger antivirus false positives
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name="JARVIS", upx=False)
