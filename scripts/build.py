"""从仓库内的 Markdown 与模板生成 OpenSim 汇报；仅使用 Python 标准库。"""
from pathlib import Path
import html
import json
import re
import shutil

REPO = Path(__file__).resolve().parents[1]
CONTENT = REPO / 'content' / 'opensim-note'
ROOT = REPO / 'dist' / 'opensim-note'
SECOND_CONTENT = REPO / 'content' / 'pamela-kyrapro' / 'index.md'
SECOND_ROOT = REPO / 'dist' / 'pamela-kyrapro-report'
image_files = json.loads((CONTENT / 'images.json').read_text(encoding='utf-8'))

def inline(text):
    # 数学公式与代码先整体保护，避免公式中的下划线等被当成 Markdown。
    tokens = []
    def protect(match):
        tokens.append(match.group())
        return f'\x00{len(tokens)-1}\x00'
    text = re.sub(r'`[^`]+`|\$[^$\n]+\$', protect, text)
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    for i, token in enumerate(tokens):
        value = '<code>' + html.escape(token[1:-1]) + '</code>' if token.startswith('`') else html.escape(token)
        text = text.replace(f'\x00{i}\x00', value)
    return text

def render_markdown(md):
    lines = md.splitlines()
    out, i = [], 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line == '$$':
            block = []
            i += 1
            while i < len(lines) and lines[i].strip() != '$$':
                block.append(lines[i])
                i += 1
            out.append('<div class="math-block">$$\n' + html.escape('\n'.join(block)) + '\n$$</div>')
        elif line.startswith('```'):
            block = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                block.append(lines[i])
                i += 1
            out.append('<pre><code>' + html.escape('\n'.join(block)) + '</code></pre>')
        elif match := re.fullmatch(r'!\[\[(.+?)\]\]', line):
            name = match[1]
            path = 'assets/' + image_files[name]
            alt = 'MTU几何与动力学关系图解' if name.startswith('MTU') else '原文问题截图'
            out.append(f'<figure><button class="image-button" aria-label="放大{alt}"><img src="{path}" alt="{alt}"></button><figcaption>{alt} · 点击放大</figcaption></figure>')
        elif line.startswith('#'):
            match = re.match(r'(#{1,6})\s*(.+)', line)
            # 源文第三级标题在独立页面内仍保留层级。
            level = len(match[1])
            out.append(f'<h{level}>{inline(match[2])}</h{level}>')
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = lines[i].strip()
                if not re.fullmatch(r'[|\s:\-]+', row):
                    rows.append([inline(c.strip()) for c in row.strip('|').split('|')])
                i += 1
            out.append('<div class="table-wrap"><table><thead><tr>' + ''.join('<th>'+c+'</th>' for c in rows[0]) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+c+'</td>' for c in row)+'</tr>' for row in rows[1:]) + '</tbody></table></div>')
            continue
        elif re.match(r'^(- |\d+\. )', line):
            ordered = bool(re.match(r'^\d+\.', line))
            tag = 'ol' if ordered else 'ul'
            items = []
            pattern = r'^\d+\.\s+' if ordered else r'^-\s+'
            while i < len(lines) and re.match(pattern, lines[i].strip()):
                items.append('<li>' + inline(re.sub(pattern, '', lines[i].strip())) + '</li>')
                i += 1
            start_number = re.match(r"^(\d+)", line)[1] if ordered else None
            start = ' start="{}"'.format(start_number) if ordered else ''
            out.append(f'<{tag}{start}>' + ''.join(items) + f'</{tag}>')
            continue
        else:
            out.append('<p>' + inline(line) + '</p>')
        i += 1
    return '\n'.join(out)

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    template = (REPO / 'templates' / 'opensim-note.html').read_text(encoding='utf-8')
    metadata = json.loads((CONTENT / 'pages.json').read_text(encoding='utf-8'))
    pages = []
    for page in metadata:
        raw = (CONTENT / page['source']).read_text(encoding='utf-8')
        heading, _, body = raw.partition('\n')
        if not heading.startswith('# '):
            raise ValueError('页面必须以一级标题开头：' + page['source'])
        pages.append((page['filename'], page['short'], heading[2:], body.strip()))
    total_pages = len(pages)
    for index, (filename, short, title, md) in enumerate(pages):
        links = []
        for n, page in enumerate(pages):
            current = 'aria-current="page"' if n == index else ''
            active = 'active' if n == index else ''
            links.append('<a href="{}" class="nav-item {}" {}><span class="nav-number">0{}</span><span>{}</span><span class="nav-arrow">↗</span></a>'.format(page[0], active, current, n + 1, html.escape(page[1])))
        prev = '<a href="{}"><small>← 上一页</small><span>{}</span></a>'.format(pages[index-1][0], html.escape(pages[index-1][1])) if index else '<span></span>'
        nxt = '<a class="next" href="{}"><small>下一页 →</small><span>{}</span></a>'.format(pages[index+1][0], html.escape(pages[index+1][1])) if index < len(pages)-1 else '<a class="next" href="index.html"><small>返回首页 ↗</small><span>完整链路</span></a>'
        values = {'body': render_markdown(md), 'page_number': str(index+1), 'total_pages': str(total_pages), 'title': html.escape(title), 'short': html.escape(short), 'nav': ''.join(links), 'prev': prev, 'next': nxt}
        document = re.sub(r'\{\{([a-z_]+)\}\}', lambda m: values[m[1]], template)
        (ROOT / filename).write_text(document, encoding='utf-8')
        print('已生成 dist/opensim-note/' + filename)
    shutil.copyfile(CONTENT / '原文.md', ROOT / '原文.md')
    build_second_report()

def build_second_report():
    """Build the independent 2026-10-26 report using the shared report style."""
    raw = SECOND_CONTENT.read_text(encoding='utf-8')
    heading, _, body = raw.partition('\n')
    if not heading.startswith('# '):
        raise ValueError('第二次汇报必须以一级标题开头：' + str(SECOND_CONTENT))
    SECOND_ROOT.mkdir(parents=True, exist_ok=True)
    template = (REPO / 'templates' / 'pamela-report.html').read_text(encoding='utf-8')
    values = {
        'title': html.escape(heading[2:]),
        'body': render_markdown(body.strip()),
    }
    document = re.sub(r'\{\{([a-z_]+)\}\}', lambda m: values[m[1]], template)
    (SECOND_ROOT / 'index.html').write_text(document, encoding='utf-8')
    shutil.copyfile(SECOND_CONTENT, SECOND_ROOT / '原文.md')
    print('已生成 dist/pamela-kyrapro-report/index.html')

if __name__ == '__main__':
    main()
