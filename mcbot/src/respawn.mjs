/**
 * Driver respawn — SATU tempat yang menangani "bot mati, tolong bangunkan lagi".
 *
 * Kenapa modul terpisah: logika ini dulu hanya hidup di src/index.mjs, sehingga
 * smoke test (yang memakai loop secara langsung) tidak pernah mengujinya. Akibatnya
 * bug "bot tersangkut di hp 0" lolos. Sekarang dipakai oleh index.mjs DAN smoke.
 *
 * Mineflayer tidak otomatis meminta respawn — server menunggu paket
 * `client_command` (aksi 0) dari klien. Kita kirim berulang sampai HP kembali.
 */

/**
 * @param {object} bot instance mineflayer
 * @param {object} [opts]
 * @param {object} [opts.logger] logger internal (opsional)
 * @param {object|Function} [opts.loop] loop OODA (atau fungsi yang mengembalikannya) untuk pause/resume
 * @param {number} [opts.intervalMs] jeda antar percobaan respawn
 * @param {boolean} [opts.auto] `false` = pemanggil yang mengirim respawn sendiri
 * @returns {{stop: Function, isDead: Function, respawns: number}}
 */
export function installRespawn (bot, { logger = null, loop = null, intervalMs = 2000, auto = true } = {}) {
  let timer = null
  let spawnCount = 0
  let respawns = 0
  let dead = false

  const log = (level, msg) => logger?.[level]?.(msg)
  // loop bisa diberikan sebagai fungsi karena di index.mjs loop baru dibuat
  // setelah event 'spawn' pertama.
  const currentLoop = () => (typeof loop === 'function' ? loop() : loop)

  const requestRespawn = () => {
    if (!bot || bot.health > 0) return
    try {
      bot.respawn()
    } catch (err) {
      log('debug', `respawn gagal: ${err.message}`)
    }
  }

  const stop = () => {
    clearInterval(timer)
    timer = null
  }

  const markAlive = (why) => {
    if (!dead) return
    dead = false
    respawns++
    log('info', `hidup lagi (${why}) — loop dilanjutkan`)
    logger?.event?.('respawn', { count: respawns, via: why })
    currentLoop()?.resume()
    currentLoop()?.trigger('respawned')
  }

  const onSpawn = () => markAlive('event spawn')

  // Jaring kedua: sebagian server (flying-squid) mengembalikan HP tanpa memicu
  // event 'spawn' di klien. Kalau hanya mengandalkan 'spawn', bot hidup kembali
  // tapi loop-nya tetap tertidur.
  const onHealth = () => {
    if (dead && Number.isFinite(bot.health) && bot.health > 0) markAlive('hp pulih')
  }

  const onDeath = () => {
    dead = true
    log('warn', 'bot died — respawning')
    logger?.event?.('death')
    currentLoop()?.pause('dead')
    if (!auto) return
    stop()
    timer = setInterval(() => {
      if (!bot || bot.health > 0) { stop(); return }
      requestRespawn()
    }, intervalMs)
    setTimeout(requestRespawn, 800) // percobaan cepat pertama
  }

  bot.on('spawn', onSpawn)
  bot.on('health', onHealth)
  bot.on('death', onDeath)

  return {
    stop () {
      stop()
      bot.removeListener('spawn', onSpawn)
      bot.removeListener('health', onHealth)
      bot.removeListener('death', onDeath)
    },
    isDead: () => dead,
    requestRespawn,
    get respawns () { return respawns }
  }
}
