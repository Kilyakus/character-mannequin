# Капсульный манекен + Three.js Rig Lab

Это единый архив с редактируемой Blender-моделью, экспортом FBX, исходным FBX,
скриптом повторной сборки, веб-демкой на Three.js и готовым статическим сайтом.
Вложенных ZIP, node_modules, кэшей, логов и временных файлов здесь нет.

## Где что лежит

- mannequin/capsule_mannequin.blend — открыть в Blender и редактировать персонажа.
- mannequin/capsule_mannequin.fbx — импортировать в другой 3D-пакет/движок.
- mannequin/build_capsule_character.py — заново создать персонажа на исходном скелете.
- mannequin/preview_*.png — изображения персонажа в исходной и пробной позах.
- threejs/ — исходники интерактивной демки, GLB с теми же 85 костями и инструкция.
- threejs/site/ — уже собранный сайт, не требующий установки npm.

## Быстрый запуск Three.js-демки без npm

Из распакованной папки capsule_mannequin_project:

    python -m http.server 8000 --directory threejs/site

Затем откройте http://localhost:8000. Для работы понадобится браузер с WebGL.
Нельзя открывать site/index.html двойным кликом: браузер заблокирует загрузку GLB
через file://. Сайт работает локально, без CDN и внешних API.

## Разработка Three.js-демки

    cd threejs
    npm install
    npm run dev

Или из threejs выполнить npm run build для повторной сборки сайта.
Экспортируйте новую web-модель из Blender по инструкции threejs/README.md.
Подробное управление костями, сохранение поз и технические детали — в README.md
в каждой из двух папок.
