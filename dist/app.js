const modules = window.FITGEN_MODULES;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const chevron = '<svg class="disclosure-chevron" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const collapseAction = label => '<div class="collapse-footer"><button type="button" data-collapse>' + label + ' ↑</button></div>';
const number = id => String(id).padStart(2, '0');
document.querySelector('#module-nav').innerHTML = modules.map(m => '<a href="#module-' + m.id + '"><span>' + number(m.id) + '</span>' + escapeHTML(m.short) + (m.id === 7 ? '<i>基础</i>' : m.id === 8 ? '<i>计算</i>' : '') + '</a>').join('');
function paragraphs(items, placeholder) {
  return items.length ? items.map(p => '<p>' + escapeHTML(p) + '</p>').join('') : '<p class="placeholder">' + placeholder + '</p>';
}
function inlineCode(value) {
  return escapeHTML(value).replace(/`([^`\n]+)`/g, '<code>$1</code>');
}
function detailedContent(module) {
  if (!module.detailSections?.length) return '';
  return '<div class="technical-document"><p class="detail-meta">' + inlineCode(module.detailMeta || '') + '</p>' +
    module.detailSections.map(section => {
      const table = section.table ? '<div class="technical-table-scroll"><table><thead><tr>' +
        section.table.headers.map(header => '<th scope="col">' + escapeHTML(header) + '</th>').join('') +
        '</tr></thead><tbody>' + section.table.rows.map(row => '<tr>' +
          row.map(cell => '<td>' + inlineCode(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '';
      return '<section class="technical-section"><h4>' + escapeHTML(section.title) + '</h4>' +
        (section.steps?.length ? '<ol class="pipeline-steps">' +
          section.steps.map(step => '<li>' + escapeHTML(step) + '</li>').join('') + '</ol>' : '') +
        (section.paragraphs || []).map(p => '<p>' + inlineCode(p) + '</p>').join('') + table +
        (section.math ? '<div class="math-display">$$' + escapeHTML(section.math) + '$$</div>' : '') +
        (section.code ? '<pre><code>' + escapeHTML(section.code) + '</code></pre>' : '') +
        (section.links?.length ? '<div class="technical-links">' +
          section.links.filter(link => /^https:\/\//.test(link.url)).map(link =>
            '<a href="' + escapeHTML(link.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(link.label) + ' ↗</a>').join('') + '</div>' : '') +
        (section.sources?.length ? '<div class="technical-sources"><span>代码依据</span>' +
          section.sources.map(source => '<code>' + escapeHTML(source) + '</code>').join('') + '</div>' : '') +
        '</section>';
    }).join('') + '</div>';
}
function moduleContent(module) {
  const summaryContent = '<div class="details-content"><div><h4>具体实现</h4>' +
    paragraphs(module.implementation, '预留实现步骤、关键逻辑与代码说明。') +
    '</div><div><h4>技术细节</h4>' + paragraphs(module.technicalDetails, '预留算法选型、数据格式、接口约定与验证方法。') +
    '</div></div>';
  if (!module.overviewSections?.length) return summaryContent + detailedContent(module);
  const overview = detailedContent({ ...module, detailMeta: module.overviewMeta, detailSections: module.overviewSections });
  if (!module.detailSections?.length) return overview;
  return overview + '<details class="advanced-details"><summary><span><span class="when-closed">深入技术细节</span><span class="when-open">收起技术细节</span> <small>' + module.detailSections.length + ' 节 · 参数、字段、代码与评测</small></span>' + chevron + '</summary>' +
    summaryContent + detailedContent(module) + collapseAction('收起技术细节') + '</details>';
}

function renderModule(module) {
  const { id, title, english, description, input, output, next } = module;
  const type = id === 7 ? '数据基础' : id === 8 ? '能耗计算' : '生成流水线';
  const status = module.status || (module.implementation.length || module.technicalDetails.length ?
    '已补充' : module.overviewSections?.length ? '职责已梳理' : '待补充');
  const design = module.designUrl ? `<a class="design-tab" href="${escapeHTML(module.designUrl)}">设计全文</a>` : '';
  const demo = module.demoUrl ? `
    <div class="module-demo">
      <div><strong>${escapeHTML(module.demoTitle || '音乐分析 Demo')}</strong>
      <p>${escapeHTML(module.demoDescription || '播放 4 首音乐，查看节拍、段落与八拍网格。')}</p></div>
      <a href="${escapeHTML(module.demoUrl)}">进入 Demo 展示</a>
    </div>` : '';
  const list = items => items.map(value => `<li>${escapeHTML(value)}</li>`).join('');
  return `<article class="module-card" id="module-${id}">
    <div class="module-top">
      <div class="module-number">${number(id)}</div>
      <div class="module-title"><div class="module-eyebrow">${escapeHTML(english)}</div>
        <h3>${escapeHTML(title)}</h3><span class="module-status">${escapeHTML(status)}</span>
        <p>${escapeHTML(description)}</p>${design}
      </div>
      <span class="module-type">${type}</span>
    </div>
    <div class="io-grid">
      <div><h4><span>↘</span> 输入</h4><ul>${list(input)}</ul></div>
      <div><h4><span>↗</span> 输出</h4><ul>${list(output)}</ul></div>
      <div class="handoff"><h4>数据流向</h4><p>${escapeHTML(next)}</p></div>
    </div>
    ${demo}
    <details class="module-disclosure">
      <summary><span><span class="when-closed">查看方案与实现</span><span class="when-open">收起方案与实现</span></span>${chevron}</summary>
      ${moduleContent(module)}${collapseAction('收起本模块')}
    </details>
  </article>`;
}
document.querySelector('#modules').innerHTML = modules.map(renderModule).join('');

// 旧路线图的候选筛选链接继续定位到合并后的编排模块。
function resolveLegacyModule() {
  if (location.hash !== '#module-3') return;
  history.replaceState(history.state, '', '#module-2');
  document.getElementById('module-2').scrollIntoView();
}
window.addEventListener('hashchange', resolveLegacyModule);
resolveLegacyModule();

const toggle = document.querySelector('#toggle-all');
const closeOpen = document.querySelector('#close-open');
const disclosures = Array.from(document.querySelectorAll('.module-disclosure'));
function updateToggle() {
  const count = disclosures.filter(detail => detail.open).length;
  toggle.textContent = count === disclosures.length ? '收起全部细节' : '展开全部细节';
  closeOpen.hidden = count === 0 || count === disclosures.length;
}
function setDisclosures(open) {
  disclosures.forEach(detail => { detail.open = open; });
  if (!open) document.querySelectorAll('.advanced-details[open]').forEach(detail => { detail.open = false; });
  updateToggle();
}
toggle.addEventListener('click', () => setDisclosures(disclosures.some(detail => !detail.open)));
closeOpen.addEventListener('click', () => setDisclosures(false));
disclosures.forEach(detail => detail.addEventListener('toggle', updateToggle));
updateToggle();

// TeX 原文以 $ / $$ 保存；代码示例和来源路径保持代码格式。
renderMathInElement(document.querySelector("main"), {
  delimiters: [{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],
  throwOnError: false, trust: false,
});
