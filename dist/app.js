const modules = window.FITGEN_MODULES;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const chevron = '<svg class="disclosure-chevron" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const collapseAction = label => '<div class="collapse-footer"><button type="button" data-collapse>' + label + ' ↑</button></div>';
const number = id => String(id).padStart(2, '0');
document.querySelector('#module-nav').innerHTML = modules.map(m => '<a href="#module-' + m.id + '"><span>' + number(m.id) + '</span>' + escapeHTML(m.short) + (m.id === 7 ? '<i>基础</i>' : m.id === 8 ? '<i>计算</i>' : '') + '</a>').join('');
function paragraphs(items, placeholder) {
  return items.length ? items.map(p => '<p>' + escapeHTML(p) + '</p>').join('') : '<p class="placeholder">' + placeholder + '</p>';
}
function detailedContent(module) {
  if (!module.detailSections?.length) return '';
  return '<div class="technical-document"><p class="detail-meta">' + escapeHTML(module.detailMeta || '') + '</p>' +
    module.detailSections.map(section => {
      const table = section.table ? '<div class="technical-table-scroll"><table><thead><tr>' +
        section.table.headers.map(header => '<th scope="col">' + escapeHTML(header) + '</th>').join('') +
        '</tr></thead><tbody>' + section.table.rows.map(row => '<tr>' +
          row.map(cell => '<td>' + escapeHTML(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '';
      return '<section class="technical-section"><h4>' + escapeHTML(section.title) + '</h4>' +
        (section.paragraphs || []).map(p => '<p>' + escapeHTML(p) + '</p>').join('') + table +
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
  const demo = module.demoUrl ? '<div class="module-demo"><div><strong>' + escapeHTML(module.demoTitle || '音乐分析 Demo') + '</strong><p>' + escapeHTML(module.demoDescription || '播放 4 首音乐，查看节拍、段落与八拍网格。') + '</p></div><a href="' + escapeHTML(module.demoUrl) + '" target="_blank" rel="noopener noreferrer">进入 Demo 展示 ↗</a></div>' : '';
  if (!module.detailSections?.length) return overview + demo;
  return overview + demo + '<details class="advanced-details"><summary><span><span class="when-closed">深入技术细节</span><span class="when-open">收起技术细节</span> <small>' + (module.detailSections?.length || 0) + ' 节 · 参数、字段、代码与评测</small></span>' + chevron + '</summary>' +
    summaryContent + detailedContent(module) + collapseAction('收起技术细节') + '</details>';
}
document.querySelector('#modules').innerHTML = modules.map(m => '<article class="module-card ' + (m.id >= 7 ? 'foundation' : '') + '" id="module-' + m.id + '"><div class="module-top"><div class="module-number">' + number(m.id) + '</div><div class="module-title"><div class="module-eyebrow">' + escapeHTML(m.english) + '</div><h3>' + escapeHTML(m.title) + '</h3><span class="module-status">' + escapeHTML(m.status || (m.implementation.length || m.technicalDetails.length ? '已补充' : m.overviewSections?.length ? '职责已梳理' : '待补充')) + '</span><p>' + escapeHTML(m.description) + '</p></div><span class="module-type">' + (m.id === 7 ? '数据基础' : m.id === 8 ? '能耗计算' : '生成流水线') + '</span></div><div class="io-grid"><div><h4><span>↘</span> 输入</h4><ul>' + m.input.map(v => '<li>' + escapeHTML(v) + '</li>').join('') + '</ul></div><div><h4><span>↗</span> 输出</h4><ul>' + m.output.map(v => '<li>' + escapeHTML(v) + '</li>').join('') + '</ul></div><div class="handoff"><h4>数据流向</h4><p>' + escapeHTML(m.next) + '</p></div></div><details class="module-disclosure"><summary><span><span class="when-closed">查看方案与实现</span><span class="when-open">收起方案与实现</span></span>' + chevron + '</summary>' + moduleContent(m) + collapseAction('收起本模块') + '</details></article>').join('');
// 旧路线图的候选筛选链接继续定位到合并后的编排模块。
function resolveLegacyModule() {
  if (location.hash !== '#module-3') return;
  history.replaceState(history.state, '', '#module-2');
  document.getElementById('module-2').scrollIntoView();
}
window.addEventListener('hashchange', resolveLegacyModule);
resolveLegacyModule();

const toggle = document.querySelector('#toggle-all');
function updateToggle() {
  const allOpen = [...document.querySelectorAll('.module-card > details')].every(d => d.open);
  toggle.innerHTML = allOpen ? '收起全部细节 <span>−</span>' : '展开全部细节 <span>＋</span>';
}
toggle.addEventListener('click', () => {
  const open = ![...document.querySelectorAll('.module-card > details')].every(d => d.open);
  document.querySelectorAll('.module-card > details').forEach(d => d.open = open);
  updateToggle();
});
document.querySelectorAll('.module-card > details').forEach(d => d.addEventListener('toggle', updateToggle));
const observer = new IntersectionObserver(entries => {
  const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top);
  if (!visible.length) return;
  document.querySelectorAll('#module-nav a').forEach(a => a.classList.toggle('active', a.hash === '#' + visible[0].target.id));
}, {rootMargin: '-10% 0px -55% 0px', threshold: 0});
document.querySelectorAll('.module-card').forEach(card => observer.observe(card));

// TeX 原文以 $ / $$ 保存；代码示例和来源路径保持代码格式。
renderMathInElement(document.querySelector("main"), {
  delimiters: [{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],
  throwOnError: false, trust: false,
});

// 长内容提供底部入口，并在滚动越过标题后显示当前模块的收起按钮。
const floatingCollapse = document.createElement('button');
floatingCollapse.type = 'button';
floatingCollapse.className = 'floating-collapse';
floatingCollapse.hidden = true;
document.body.append(floatingCollapse);
let currentDisclosure = null;
function collapseAndReturn(detail) {
  detail.open = false;
  const target = detail.classList.contains('module-disclosure') ? detail.closest('.module-card') : detail;
  target.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start'});
  detail.querySelector(':scope > summary').focus({preventScroll:true});
  updateFloatingCollapse();
}
function updateFloatingCollapse() {
  currentDisclosure = [...document.querySelectorAll('.module-disclosure[open]')].find(detail => {
    const summary = detail.querySelector(':scope > summary').getBoundingClientRect();
    const bounds = detail.getBoundingClientRect();
    return summary.bottom < 0 && bounds.bottom > 100;
  });
  floatingCollapse.hidden = !currentDisclosure;
  if (currentDisclosure) {
    const card = currentDisclosure.closest('.module-card');
    floatingCollapse.textContent = '收起 ' + card.querySelector('.module-number').textContent + ' · ' + card.querySelector('h3').textContent + ' ↑';
  }
}
document.querySelectorAll('[data-collapse]').forEach(button => button.addEventListener('click', () => collapseAndReturn(button.closest('details'))));
floatingCollapse.addEventListener('click', () => { if (currentDisclosure) collapseAndReturn(currentDisclosure); });
let collapseFrame = false;
window.addEventListener('scroll', () => {
  if (!collapseFrame) { collapseFrame = true; requestAnimationFrame(() => {updateFloatingCollapse(); collapseFrame = false;}); }
}, {passive:true});
document.querySelectorAll('.module-card details').forEach(detail => detail.addEventListener('toggle', updateFloatingCollapse));
