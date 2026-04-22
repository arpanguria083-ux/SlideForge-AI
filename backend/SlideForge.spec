# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

hidden_imports = []
hidden_imports += collect_submodules('uvicorn')
hidden_imports += collect_submodules('fastapi')
hidden_imports += collect_submodules('chromadb')
hidden_imports += collect_submodules('pptx')
hidden_imports += collect_submodules('langchain_core')
hidden_imports += collect_submodules('langgraph')
hidden_imports += collect_submodules('pydantic')
hidden_imports += ['app.main']

datas = [
    ('static', 'static'),
]
datas += collect_data_files('chromadb')
datas += collect_data_files('pptx')
datas += collect_data_files('langchain_core')
datas += collect_data_files('langgraph')

a = Analysis(
    ['app\\main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SlideForge',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='SlideForge',
)
