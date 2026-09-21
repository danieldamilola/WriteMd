from PIL import Image

master = Image.open('build/icon.png').convert('RGBA')
SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40),
         (48, 48), (64, 64), (96, 96), (128, 128), (256, 256)]

# App + installer exe icon (replaces the default Electron atom)
master.save('build/icon.ico', sizes=SIZES)
print('wrote build/icon.ico')

# macOS bundle icon
master.save('build/icon.icns', sizes=[(16, 16), (32, 32), (128, 128), (256, 256), (512, 512)])
print('wrote build/icon.icns')
