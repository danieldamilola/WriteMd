from PIL import Image

master = Image.open('build/icon.png').convert('RGBA')
BG = (20, 20, 20)  # app panel background

# 1. Installer + uninstaller ICOs (multi-size)
for name in ('build/installer-icon.ico', 'build/uninstaller-icon.ico'):
    master.save(
        name,
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40),
               (48, 48), (64, 64), (96, 96), (128, 128), (256, 256)],
    )
    print('wrote', name)

# 2. Header BMP 150x57, logo fitted to height 45 on brand background
header = Image.new('RGB', (150, 57), BG)
logo = master.copy()
logo.thumbnail((120, 45), Image.LANCZOS)
header.paste(logo, ((150 - logo.width) // 2, (57 - logo.height) // 2), logo)
header.save('build/installer-header.bmp')
print('wrote build/installer-header.bmp', header.size)

# 3. Sidebar BMP 164x314, logo 128 centered in upper third
side = Image.new('RGB', (164, 314), BG)
logo2 = master.resize((128, 128), Image.LANCZOS)
side.paste(logo2, ((164 - 128) // 2, 48), logo2)
side.save('build/installer-sidebar.bmp')
print('wrote build/installer-sidebar.bmp', side.size)
