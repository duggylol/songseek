// SongSeek site — scroll reveal, sticky nav, hero settle, OS-aware download links.
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Staggered scroll reveal
  const items = document.querySelectorAll('.reveal')
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'))
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const siblings = [...entry.target.parentElement.children].filter((c) => c.classList.contains('reveal'))
          const i = Math.max(0, siblings.indexOf(entry.target))
          entry.target.style.transitionDelay = Math.min(i * 70, 350) + 'ms'
          entry.target.classList.add('in')
          io.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    )
    items.forEach((el) => io.observe(el))
  }

  // Nav background once scrolled
  const nav = document.getElementById('nav')
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 14)
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  // Hero screenshot settles from a tilt
  const shot = document.getElementById('shot')
  if (shot) {
    if (reduced) shot.classList.add('settled')
    else setTimeout(() => shot.classList.add('settled'), 260)
  }

  // Point the download buttons at the current release assets, and lead with
  // the visitor's own platform.
  const REPO = 'https://github.com/duggylol/songseek'
  const version = (document.querySelector('[data-version]') || {}).textContent
  const win = document.getElementById('dl-win')
  const mac = document.getElementById('dl-mac')
  if (version && win && mac) {
    const v = version.trim()
    win.href = `${REPO}/releases/download/v${v}/SongSeek-Setup-${v}.exe`
    mac.href = `${REPO}/releases/download/v${v}/SongSeek-${v}-arm64.dmg`
  }
  // Live download counter, straight from the GitHub release assets. Cached so a
  // visitor never burns GitHub's unauthenticated rate limit, and it simply stays
  // hidden if the request fails — better nothing than a wrong number.
  const countEl = document.getElementById('dl-count')
  const statEl = document.getElementById('dl-stat')
  const CACHE_KEY = 'ss-dl-count'
  const CACHE_MS = 30 * 60 * 1000

  const countUp = (to) => {
    if (to <= 0) return
    statEl.hidden = false
    if (reduced) { countEl.textContent = to.toLocaleString(); return }
    const dur = 1100
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      countEl.textContent = Math.round(to * eased).toLocaleString()
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  const showDownloads = async () => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (cached && Date.now() - cached.at < CACHE_MS) return countUp(cached.n)
    } catch {}
    try {
      const res = await fetch(`https://api.github.com/repos/duggylol/songseek/releases?per_page=100`)
      if (!res.ok) return
      const releases = await res.json()
      let n = 0
      releases.forEach((r) =>
        (r.assets || []).forEach((a) => {
          // Installers only — .yml/.blockmap are auto-updater plumbing.
          if (/\.(exe|dmg)$/i.test(a.name)) n += a.download_count || 0
        })
      )
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ n, at: Date.now() })) } catch {}
      countUp(n)
    } catch {
      /* offline or rate limited — leave the badge hidden */
    }
  }
  if (countEl && statEl) showDownloads()

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  if (isMac) {
    document.querySelectorAll('[data-dl]').forEach((a) => {
      if (a.dataset.dl === 'mac') a.parentElement.prepend(a)
    })
  }
})()
