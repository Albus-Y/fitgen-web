(() => {
  'use strict';

  const home = document.body.classList.contains('workspace');
  const details = Array.from(document.querySelectorAll('main details'));
  const mobileMenu = document.querySelector('.reader-menu');
  const root = document.documentElement;
  const transferKey = 'fitgen.navigation.v1';
  const navEntry = performance.getEntriesByType('navigation')[0];
  const links = Array.from(document.links);
  const moduleLinks = Array.from(document.querySelectorAll('#module-nav a'));
  const chapterLinks = Array.from(document.querySelectorAll('.sidebar a[href^="#"]'));
  const sectionLinks = Array.from(document.querySelectorAll('.mast-nav a'));
  const opened = () => details.flatMap((detail, index) => detail.open ? [index] : []);

  function setMenu(open, refocus = false) {
    if (!mobileMenu) return;
    root.classList.toggle('menu-open', open);
    mobileMenu.setAttribute('aria-expanded', String(open));
    mobileMenu.textContent = open ? '关闭目录' : '目录';
    if (refocus) mobileMenu.focus();
  }

  if (mobileMenu) {
    mobileMenu.hidden = false;
    root.classList.add('menu-ready');
    mobileMenu.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')));
    document.addEventListener('click', event => {
      if (mobileMenu.contains(event.target)) return;
      if (event.target.closest('#reader-index a') || !event.target.closest('#reader-index')) setMenu(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root.classList.contains('menu-open')) setMenu(false, true);
    });
    matchMedia('(max-width: 700px)').addEventListener('change', () => setMenu(false));
  }

  // 快照跟随具体历史条目。同一 URL 的两次访问可以保留不同的阅读位置。
  function snapshot(link) {
    return {
      url: location.href, key: window.navigation?.currentEntry?.key,
      y: window.scrollY, open: opened(), link: link ? links.indexOf(link) : -1,
      offset: link ? link.getBoundingClientRect().top : 0
    };
  }

  function save(view) {
    history.replaceState({ ...history.state, fitgenView: view }, '');
  }

  function transfer(value) {
    try { sessionStorage.setItem(transferKey, JSON.stringify(value)); } catch { /* 本地文件或隐私模式仍可使用普通链接。 */ }
  }

  function receive() {
    try {
      const value = JSON.parse(sessionStorage.getItem(transferKey));
      sessionStorage.removeItem(transferKey);
      return value?.to === location.href && Date.now() - value.time < 60000 ? value : null;
    } catch { return null; }
  }

  const incoming = receive();
  const pageOrigin = incoming?.origin || history.state?.fitgenOrigin;
  function keepOrigin() {
    if (pageOrigin && !history.state?.fitgenOrigin) {
      history.replaceState({ ...history.state, fitgenOrigin: pageOrigin }, '');
    }
  }
  keepOrigin();
  window.addEventListener('hashchange', keepOrigin);
  const restore = incoming?.restore || ((navEntry?.type === 'back_forward' || navEntry?.type === 'reload') && history.state?.fitgenView);

  function restoreView(view) {
    if (!view || view.url !== location.href) return;
    details.forEach((detail, index) => { detail.open = view.open.includes(index); });
    window.scrollTo({ top: view.y, behavior: 'instant' });
    const link = links[view.link];
    if (link && link.getClientRects().length) {
      window.scrollBy({ top: link.getBoundingClientRect().top - view.offset, behavior: 'instant' });
      link.focus({ preventScroll: true });
    }
  }

  if (restore) restoreView(restore);
  window.addEventListener('pageshow', event => {
    const view = event.persisted ? history.state?.fitgenView : restore;
    if (view) requestAnimationFrame(() => restoreView(view));
  });

  let leaving = null;
  let pendingJump = null;
  let returnPosition = null;
  window.addEventListener('hashchange', () => {
    if (pendingJump?.to === location.href) {
      history.replaceState({ ...history.state, fitgenJump: pendingJump.from }, '');
    }
    pendingJump = null;
    if (returnPosition?.url === location.href) restoreView(returnPosition);
    returnPosition = null;
    schedule();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (link.hasAttribute('download') || link.target === '_blank') return;
    const to = new URL(link.getAttribute('href'), document.baseURI);
    if (to.origin !== location.origin || to.protocol !== location.protocol) return;
    const sameDocument = to.pathname === location.pathname && to.search === location.search;
    if (sameDocument) {
      if (to.hash && to.href !== location.href && !link.matches('.skip-link')) {
        pendingJump = { to: to.href, from: snapshot(link) };
        save(pendingJump.from);
      }
      return;
    }
    leaving = snapshot(link);
    save(leaving);
    const origin = home ? leaving : pageOrigin;
    if (!home && origin && (link.hasAttribute('data-return') || link.matches('.page-navigation a[href^="../index.html"]'))) {
      const originalUrl = new URL(origin.url);
      if (originalUrl.origin !== location.origin || originalUrl.protocol !== location.protocol) return;
      event.preventDefault();
      const entry = window.navigation?.entries().find(item => item.key === origin.key && item.url === origin.url);
      if (entry) window.navigation.traverseTo(entry.key);
      else {
        transfer({ to: origin.url, time: Date.now(), restore: origin });
        location.assign(origin.url);
      }
      return;
    }
    transfer({ to: to.href, time: Date.now(), origin });
  });

  window.addEventListener('pagehide', () => {
    save(leaving || snapshot());
    leaving = null;
    setMenu(false);
  });

  // 长文中先收起当前的小节，也可以一步收起整个模块。
  const actions = document.createElement('div');
  actions.className = 'collapse-tools';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', '阅读操作');
  actions.hidden = true;
  document.body.append(actions);

  function collapse(detail) {
    detail.querySelectorAll('details[open]').forEach(child => { child.open = false; });
    detail.open = false;
    const summary = detail.querySelector(':scope > summary');
    const target = detail.classList.contains('module-disclosure') ? detail.closest('.module-card') : summary;
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    summary.focus({ preventScroll: true });
    refresh();
  }

  for (const detail of details) {
    if (detail.closest('.prose')) {
      const summary = detail.querySelector('summary');
      const original = summary.textContent;
      const update = () => { summary.textContent = detail.open ? original.replace(/^展开[：:]/, '收起：') : original; };
      detail.addEventListener('toggle', update);
      update();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'report-collapse';
      button.dataset.collapse = '';
      button.textContent = '收起本节';
      detail.append(button);
    }
    detail.addEventListener('toggle', schedule);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-collapse]');
    if (button) collapse(button.closest('details'));
  });

  function mark(anchors, id) {
    for (const anchor of anchors) {
      if (anchor.hash === '#' + id) anchor.setAttribute('aria-current', 'location');
      else anchor.removeAttribute('aria-current');
    }
  }

  function activeSection(anchors, line) {
    let current = '';
    for (const link of anchors) {
      const heading = document.getElementById(link.hash.slice(1));
      if (heading && heading.getBoundingClientRect().top <= line) current = heading.id;
    }
    return current;
  }

  const jumpBack = document.createElement('button');
  jumpBack.type = 'button';
  jumpBack.textContent = '返回跳转处';
  jumpBack.addEventListener('click', () => {
    returnPosition = history.state?.fitgenJump;
    if (returnPosition) history.back();
  });
  let shown = [];
  let showJump = false;
  function refresh() {
    const bar = document.querySelector('.mast, .reader-mast')?.getBoundingClientRect().height || 0;
    const line = bar + 30;
    const active = details.filter(detail => {
      if (!detail.open) return false;
      const bounds = detail.getBoundingClientRect();
      return bounds.bottom > line + 30 && detail.querySelector('summary').getBoundingClientRect().bottom < line;
    }).reverse();
    const canReturn = Boolean(history.state?.fitgenJump);
    if (canReturn !== showJump || active.length !== shown.length || active.some((detail, index) => shown[index] !== detail)) {
      showJump = canReturn;
      shown = active;
      actions.replaceChildren(...active.map(detail => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = detail.classList.contains('module-disclosure') ? '收起本模块' :
          detail.classList.contains('advanced-details') ? '收起技术细节' : '收起本节';
        button.addEventListener('click', () => collapse(detail));
        return button;
      }));
      if (canReturn) actions.prepend(jumpBack);
      actions.hidden = !canReturn && !active.length;
    }
    mark(moduleLinks, activeSection(moduleLinks, line + 50));
    mark(chapterLinks, activeSection(chapterLinks, line + 50));
    mark(sectionLinks, activeSection(sectionLinks, line + 50));
  }

  let frame;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  refresh();
})();
