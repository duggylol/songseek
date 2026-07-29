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
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  if (isMac) {
    document.querySelectorAll('[data-dl]').forEach((a) => {
      if (a.dataset.dl === 'mac') a.parentElement.prepend(a)
    })
  }
})()
