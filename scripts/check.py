"""检查站内文件引用、媒体分片及发布项目绑定；不访问网络。"""
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

REPO = Path(__file__).resolve().parents[1]
DIST = REPO / 'dist'


def main():
    errors = []
    manifest_text = (DIST / 'media-manifest.js').read_text(encoding='utf-8')
    prefix = 'window.FITGEN_MEDIA='
    if not manifest_text.startswith(prefix):
        raise ValueError('无法识别媒体清单格式。')
    media = json.loads(manifest_text[len(prefix):].strip().rstrip(';'))
    virtual_files = {(DIST / name).resolve() for name in media}
    chunks = 0
    for name, entry in media.items():
        if not entry.get('parts'):
            errors.append('媒体没有分片：' + name)
        for part in entry['parts']:
            chunks += 1
            if not (DIST / part).is_file():
                errors.append('缺少媒体分片：' + part)

    class References(HTMLParser):
        def __init__(self, source):
            super().__init__()
            self.source = source

        def handle_starttag(self, tag, attrs):
            for key, value in attrs:
                if key not in ('src', 'href') or not value:
                    continue
                parsed = urlsplit(value)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                path = unquote(parsed.path)
                target = ((DIST / path.lstrip('/')) if path.startswith('/') else (self.source.parent / path)).resolve()
                if not target.exists() and target not in virtual_files:
                    errors.append('{} 引用了不存在的文件：{}'.format(self.source.relative_to(REPO), value))

    pages = list(DIST.rglob('*.html'))
    for page in pages:
        References(page).feed(page.read_text(encoding='utf-8'))
    hosting = json.loads((REPO / '.openai' / 'hosting.json').read_text(encoding='utf-8'))
    if hosting.get('static', {}).get('directory') != 'dist':
        errors.append('静态发布目录必须为 dist。')
    if hosting.get('project_id') != 'appgprj_6ac9e341cf6c8191b547461c6464ecd0':
        errors.append('项目绑定与现有 FitGen Site 不一致。')
    if errors:
        for error in errors:
            print('错误：' + error, file=sys.stderr)
        return 1
    print('检查通过：{} 个 HTML 页面、{} 个媒体条目、{} 个媒体分片。'.format(len(pages), len(media), chunks))
    return 0


if __name__ == '__main__':
    sys.exit(main())
