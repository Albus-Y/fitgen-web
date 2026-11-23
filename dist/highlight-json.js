// 保留 JSON 的原始空白、转义与标点，便于读者直接复制示例。
function highlightJson(code) {
  const source = code.textContent;
  if (!/^\s*[[{]/.test(source)) return;
  try {
    JSON.parse(source);
  } catch {
    return;
  }
  const tokens = /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(?:true|false|null)\b/g;
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const match of source.matchAll(tokens)) {
    fragment.append(source.slice(offset, match.index));
    const token = document.createElement('span');
    const [, key, string, number] = match;
    token.className = key ? 'json-key' : string ? 'json-string' : number ? 'json-number' : 'json-literal';
    token.textContent = match[0];
    fragment.append(token);
    offset = match.index + match[0].length;
  }
  fragment.append(source.slice(offset));
  code.classList.add('json-example');
  code.replaceChildren(fragment);
}

document.querySelectorAll('#module-2 pre > code, .prose pre > code').forEach(highlightJson);
