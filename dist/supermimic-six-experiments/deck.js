const pages = [...document.querySelectorAll('.slide')];
const selector = document.querySelector('#page');
const previous = document.querySelector('#prev');
const next = document.querySelector('#next');
const notes = document.querySelector('#notes');
let current = 0;

function displayPage() {
  const index = pages.findIndex(page => page.id === location.hash.slice(1));
  current = index < 0 ? 0 : index;
  pages.forEach((page, i) => {
    page.hidden = i !== current;
    if (page.hidden) page.querySelector('video')?.pause();
  });
  selector.value = pages[current].id;
  previous.disabled = current === 0;
  next.disabled = current === pages.length - 1;
  document.querySelector('#position').textContent =
    String(current + 1).padStart(2, '0') + ' / ' + pages.length;
  document.title = selector.selectedOptions[0].textContent.trim() + ' | SuperMimic 六组实验 | FitGen';
  window.scrollTo(0, 0);
}

function move(offset) {
  const target = pages[current + offset];
  if (target) location.hash = target.id;
}
selector.addEventListener('change', () => { location.hash = selector.value; });
previous.addEventListener('click', () => move(-1));
next.addEventListener('click', () => move(1));
window.addEventListener('hashchange', displayPage);
document.addEventListener('keydown', event => {
  if (notes.open || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest('select, input, textarea, video, [contenteditable="true"]')) return;
  if (event.key === ' ' && event.target.closest('a,button')) return;
  if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
    event.preventDefault();
    move(1);
  } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
    event.preventDefault();
    move(-1);
  }
});
document.querySelector('#sources').addEventListener('click', () => {
  notes.querySelector('p').replaceChildren(pages[current].querySelector('.source').content.cloneNode(true));
  notes.showModal();
});
displayPage();

const cohorts = {
  full: [
    ['311 段', '0.317', '0.326', '0.180', '46.01%'],
    ['327 段', '0.403', '0.377', '0.245', '40.12%'],
    '模型各自取完整无跌倒集，集合不同。'
  ],
  strict: [
    ['31 段', '0.715', '0.719', '0.693', '23.74%'],
    ['40 段', '0.517', '0.500', '0.485', '34.83%'],
    '严格跟踪要求完整无跌倒、无数值失败，每 0.01 秒均满足 17 点与核心 4 点平均误差各 ≤ 25 cm、骨盆朝向误差 ≤ 1 rad。'
  ],
  formal: [
    ['227 段', '0.310', '0.283', '0.206', '42.21%'],
    ['230 段', '0.433', '0.392', '0.275', '41.31%'],
    '正式完成检查完整无跌倒、数值有效及原训练身体位置、根位置、根朝向偏差条件。'
  ],
  recovered: [
    ['36 段', '0.705', '0.716', '0.675', '22.99%'],
    ['43 段', '0.483', '0.447', '0.453', '34.46%'],
    '历史起步修正另纳入通过固定水平位移复核的 5 / 3 段。两组原始严格通过数分别为 31 / 40。'
  ]
};
const cohort = document.querySelector('#cohort');
cohort.addEventListener('change', () => {
  const [pure, mixed, description] = cohorts[cohort.value];
  const rows = document.querySelector('.correlations tbody').rows;
  [pure, mixed].forEach((values, i) => {
    values.forEach((value, j) => { rows[i].cells[j + 1].textContent = value; });
  });
  document.querySelector('#cohort-note').textContent = description +
    ' 模型与设备来自不同研究，数值只作参照。— 表示该项未报告。';
});
