"""Read native PE icon resources without installing or executing the installer."""
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import struct
import os

root = Path(__file__).resolve().parents[3]
output = root / os.environ.get('FRACTAL_ICON_OUTPUT', 'docs/implementation/desktop/stage3')
installer_directory = root / os.environ.get('FRACTAL_INSTALLER_DIRECTORY', 'dist/installer')
output.mkdir(parents=True, exist_ok=True)
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p, wintypes.DWORD]
kernel.LoadLibraryExW.restype = ctypes.c_void_p
kernel.FreeLibrary.argtypes = [ctypes.c_void_p]
kernel.FindResourceW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
kernel.FindResourceW.restype = ctypes.c_void_p
kernel.SizeofResource.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
kernel.SizeofResource.restype = wintypes.DWORD
kernel.LoadResource.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
kernel.LoadResource.restype = ctypes.c_void_p
kernel.LockResource.argtypes = [ctypes.c_void_p]
kernel.LockResource.restype = ctypes.c_void_p
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
kernel.EnumResourceNamesW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, callback_type, ctypes.c_void_p]
kernel.EnumResourceNamesW.restype = wintypes.BOOL

ico = (root / 'apps/desktop/assets/fractal.ico').read_bytes()
count = struct.unpack_from('<H', ico, 4)[0]
expected = {}
for i in range(count):
    width, height, _, _, _, _, size, offset = struct.unpack_from('<BBBBHHII', ico, 6 + i * 16)
    expected[(width or 256, height or 256)] = ico[offset:offset + size]

def resources(path):
    module = kernel.LoadLibraryExW(str(path), None, 2 | 32)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    def read(name, kind):
        resource = kernel.FindResourceW(module, name, kind)
        if not resource:
            raise ctypes.WinError(ctypes.get_last_error())
        size = kernel.SizeofResource(module, resource)
        pointer = kernel.LockResource(kernel.LoadResource(module, resource))
        return ctypes.string_at(pointer, size)
    groups = []
    @callback_type
    def callback(_module, _type, name, _param):
        data = read(name, 14)
        images = []
        for i in range(struct.unpack_from('<H', data, 4)[0]):
            width, height, _, _, _, _, _, identity = struct.unpack_from('<BBBBHHIH', data, 6 + i * 14)
            image = read(identity, 3)
            shape = (width or 256, height or 256)
            images.append({'width':shape[0], 'height':shape[1], 'sha256':hashlib.sha256(image).hexdigest(), 'equalsAcceptedIco': image == expected.get(shape)})
            if shape == (32, 32) and image == expected.get(shape) and image.startswith(b'\x89PNG'):
                (output / (path.stem + '-native-icon-32.png')).write_bytes(image)
        groups.append({'resourceId': name if name < 65536 else 'named', 'images':images})
        return True
    try:
        if not kernel.EnumResourceNamesW(module, 14, callback, None):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel.FreeLibrary(module)
    return groups

evidence = []
for relative in ['win-unpacked/Fractal.exe', 'Fractal Setup 0.1.0.exe']:
    path = installer_directory / relative
    groups = resources(path)
    matching = [group for group in groups if all(item['equalsAcceptedIco'] for item in group['images'])]
    assert matching, f'No accepted branch icon group in {path}'
    assert any(item['width'] == 32 for group in matching for item in group['images'])
    evidence.append({'path':str(path), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(), 'matchingBranchGroups':matching})
result = {'status':'passed', 'method':'LoadLibraryExW as data/image resource; native RT_GROUP_ICON/RT_ICON bytes match accepted ICO entries', 'installerInstalled':False, 'artifacts':evidence}
(output / 'native-icons.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print('Executable and NSIS native icon resources match accepted branch ICO.')
