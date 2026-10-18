/**
 * BOSCH BLE LASER CORE (Framework-Agnostic)
 * -----------------------------------------
 * Modulo autonomo puro JavaScript (zero dipendenze da Vue/Vuetify/UI).
 * Gestisce:
 *  1. Accoppiamento Web Bluetooth e auto-riconnessione silenziosa
 *  2. Configurazione automatica del laser (Auto-Sync + Distanza & Angolo simultanei)
 *  3. Decodifica binaria protocollo Bosch GLM / PLR (MT-Protocol C0 55 ...)
 *  4. Classificazione geometrica automatica (LATO, ALTEZZA, FUORI BOLLA)
 *
 * Può essere copiato in qualsiasi app (preventivi, rilievi, ecc.) e usato
 * direttamente tramite:
 *   const laser = new BoschLaserClient()
 *   laser.on('measurement', (m) => console.log(m.distance, m.inclination, m.label))
 *   await laser.connect()
 */

export const PRIMARY_SERVICE_UUID = '00005301-0000-1000-8000-00805f9b34fb'
export const PRIMARY_CHAR_UUID = '00005302-0000-1000-8000-00805f9b34fb'

export const BOSCH_SERVICES = [
  PRIMARY_SERVICE_UUID,
  '00005301-0000-0041-5253-534f46540000',
  '0000fde8-0000-1000-8000-00805f9b34fb',
]

export const BOSCH_CHAR_UUIDS = [
  PRIMARY_CHAR_UUID,
  '00005302-0000-0041-5253-534f46540000',
  '00004301-0000-0041-5253-534f46540000',
  '00004302-0000-0041-5253-534f46540000',
  '02a6c0d1-0451-4000-b000-fb3210111989',
  '02a6c0d2-0451-4000-b000-fb3210111989',
]

export const BOSCH_NAME_REGEX = /(bosch|glm|plr|gis|ad\s*\d|mt\d|x\d{3,4})/i
export const STORAGE_KEY_DEVICE = 'bosch_ble_known_device'

// Comandi protocollo Bosch MT
export const AUTO_SYNC_CMD = new Uint8Array([0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a])
// Modalità Orizzontale Indiretta (0B E0 - coseno): invia distanza reale (val1) + angolo (val2)
export const INDIRECT_HORIZ_CMD = new Uint8Array([0xc0, 0x55, 0x02, 0xf1, 0x0b, 0xe0])
export const INDIRECT_HEIGHT_CMD = new Uint8Array([0xc0, 0x55, 0x02, 0xf1, 0x0a, 0x46])

// Soglie di inclinazione (in gradi)
export const LATO_MAX_DEG = 15.0
export const ALTEZZA_MIN_DEG = 75.0
export const ALTEZZA_MAX_DEG = 105.0

/**
 * Arrotonda i metri a 2 cifre decimali (es. 2.45)
 */
export function formatMeters(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '--.--'
  return Number(val).toFixed(2)
}

/**
 * Arrotonda i gradi a 0 cifre decimali con segno (es. +2, +89, 0)
 */
export function formatAngle(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '--'
  const rounded = Math.round(Number(deg))
  if (rounded === 0) return '0'
  return (rounded > 0 ? '+' : '') + rounded
}

/**
 * Classifica la misura in base all'angolo di inclinazione:
 * - LATO: |angolo| <= 15°
 * - ALTEZZA: 75° <= |angolo| <= 105°
 * - FUORI BOLLA: inclinazione intermedia (15° < |angolo| < 75° o > 105°)
 */
export function classifyAngle(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) {
    return {
      type: 'SOLO_DISTANZA',
      label: 'SOLO DISTANZA',
      color: 'grey',
      icon: 'mdi-ruler',
    }
  }

  const abs = Math.abs(Number(deg))
  if (abs <= LATO_MAX_DEG) {
    return {
      type: 'LATO',
      label: 'LATO',
      color: 'success',
      icon: 'mdi-arrow-left-right-bold',
    }
  }

  if (abs >= ALTEZZA_MIN_DEG && abs <= ALTEZZA_MAX_DEG) {
    return {
      type: 'ALTEZZA',
      label: 'ALTEZZA',
      color: 'info',
      icon: 'mdi-arrow-up-down-bold',
    }
  }

  return {
    type: 'FUORI_BOLLA',
    label: 'FUORI BOLLA',
    color: 'warning',
    icon: 'mdi-alert-outline',
  }
}

export function isValidDistance(val) {
  return Number.isFinite(val) && val >= 0.01 && val <= 250
}

export function isValidAngle(val) {
  return Number.isFinite(val) && val >= -180 && val <= 180
}

/**
 * Decodifica un DataView proveniente dalla caratteristica GATT Bosch BLE.
 * Restituisce { distance, inclination, needsModeReset } oppure null se è un ACK di controllo.
 */
export function parseBoschPacket(dataView) {
  if (!dataView || dataView.byteLength === 0) return null
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)

  let distance = null
  let inclination = null
  let needsModeReset = false

  if (bytes.length >= 11 && bytes[0] === 0xc0 && bytes[1] === 0x55) {
    const msgType = bytes[3]
    // Ignora pacchetti di handshake/echo comandi
    if (msgType === 0x01 || msgType === 0x02 || msgType === 0xf1) {
      return null
    }

    const val0 = bytes.length >= 11 ? dataView.getFloat32(7, true) : 0
    const val1 = bytes.length >= 15 ? dataView.getFloat32(11, true) : 0
    const val2 = bytes.length >= 19 ? dataView.getFloat32(15, true) : 0

    switch (msgType) {
      // Misura indiretta (Altezza / Orizzontale / Doppia / Parete):
      // val1 = ipotenusa (distanza lineare reale dal laser al bersaglio)
      // val2 = angolo di inclinazione in gradi (+ alto, - basso)
      case 0x29:
      case 0x2a:
      case 0x2d:
      case 0x2e:
      case 0x31:
      case 0x32:
      case 0x35:
      case 0x36:
        if (isValidDistance(val1)) distance = val1
        else if (isValidDistance(val0)) distance = val0
        if (isValidAngle(val2)) inclination = val2
        break

      // Misura singola o continua semplice
      case 0x05:
      case 0x06:
      case 0x09:
      case 0x0a:
        if (isValidDistance(val0)) distance = val0
        if (val2 !== 0 && isValidAngle(val2)) {
          inclination = val2
        } else {
          needsModeReset = true
        }
        break

      // Livella / Inclinometro puro
      case 0x21:
      case 0x58:
        if (isValidAngle(val0)) inclination = val0
        break

      default:
        if (isValidDistance(val1)) distance = val1
        else if (isValidDistance(val0)) distance = val0
        if (val2 !== 0 && isValidAngle(val2)) inclination = val2
        break
    }
  } else if (bytes.length >= 7 && bytes[0] === 0x00 && bytes[1] === 0x04) {
    // Fallback vecchio protocollo Bosch (0x00 0x04, unità 0.05 mm)
    const rawInt = dataView.getUint32(2, true)
    const distM = (rawInt * 0.05) / 1000
    if (isValidDistance(distM)) distance = distM
  }

  if (distance === null && inclination === null) {
    return null
  }

  return {
    distance,
    inclination,
    needsModeReset,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Classe principale del motore Bluetooth Bosch.
 * Eventi emessi:
 *  - 'status'      -> { status: 'disconnected'|'connecting'|'connected', isConnected, isConnecting, deviceName }
 *  - 'measurement' -> { id, distance, distanceFormatted, inclination, inclinationFormatted, type, label, color, icon, timestamp }
 *  - 'error'       -> string (messaggio di errore)
 */
export class BoschLaserClient {
  constructor() {
    this.bleDevice = null
    this.gattServer = null
    this.notifyChar = null
    this.writeChar = null
    this.status = 'disconnected'
    this.deviceName = ''
    this.userDisconnectedManually = false
    this.manualPairing = false
    this.lastPacketSig = ''
    this.lastPacketTime = 0
    this.listeners = {
      status: new Set(),
      measurement: new Set(),
      error: new Set(),
    }

    this._boundOnDisconnected = this._onDisconnected.bind(this)
    this._boundOnNotification = this._onNotification.bind(this)
  }

  /**
   * Verifica se il browser supporta Web Bluetooth
   */
  isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator
  }

  /**
   * Registra un listener per 'status', 'measurement' o 'error'.
   * Restituisce una funzione di unsubscribe.
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].add(callback)
    }
    return () => this.off(event, callback)
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].delete(callback)
    }
  }

  _emit(event, payload) {
    if (!this.listeners[event]) return
    for (const cb of this.listeners[event]) {
      try {
        cb(payload)
      } catch (err) {
        console.error(`[BoschLaserClient] Errore listener ${event}:`, err)
      }
    }
  }

  _setStatus(newStatus) {
    this.status = newStatus
    this._emit('status', {
      status: newStatus,
      isConnected: newStatus === 'connected',
      isConnecting: newStatus === 'connecting',
      deviceName: this.deviceName,
    })
  }

  /**
   * Legge il dispositivo salvato in precedenza da localStorage
   */
  getSavedDeviceMeta() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DEVICE)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  _saveDeviceMeta(device) {
    try {
      localStorage.setItem(
        STORAGE_KEY_DEVICE,
        JSON.stringify({
          id: device.id || '',
          name: device.name || 'Bosch BLE',
        })
      )
    } catch {
      // ignore
    }
  }

  /**
   * Tenta la riconnessione automatica silenziosa (senza popup) se il browser
   * supporta navigator.bluetooth.getDevices() o se abbiamo già l'oggetto device in sessione.
   */
  async tryAutoReconnect(silent = true) {
    if (!this.isSupported()) return false

    if (this.bleDevice) {
      try {
        if (!silent) this._setStatus('connecting')
        await this._attachToDevice(this.bleDevice)
        return true
      } catch {
        if (!silent) this._setStatus('disconnected')
      }
    }

    if (typeof navigator.bluetooth?.getDevices !== 'function') {
      return false
    }

    try {
      const devices = await navigator.bluetooth.getDevices()
      if (!devices || devices.length === 0) return false

      const savedMeta = this.getSavedDeviceMeta()
      let target = null
      if (savedMeta?.id) {
        target = devices.find((d) => d.id === savedMeta.id)
      }
      if (!target && savedMeta?.name) {
        target = devices.find((d) => d.name === savedMeta.name)
      }
      if (!target) {
        const boschCandidates = devices.filter((d) => !d.name || BOSCH_NAME_REGEX.test(d.name))
        target = boschCandidates[0] || devices[0]
      }
      if (!target) return false

      if (!silent) this._setStatus('connecting')
      const ok = await this._connectWithWatch(target, silent ? 3500 : 2500)
      if (!ok && !silent) this._setStatus('disconnected')
      return ok
    } catch {
      if (!silent) this._setStatus('disconnected')
      return false
    }
  }

  /**
   * Avvia la connessione al laser (tenta prima in automatico se manualPairing=false,
   * altrimenti mostra il selettore Web Bluetooth filtrato sui dispositivi Bosch BLE).
   */
  async connect({ manualPairing = false } = {}) {
    if (!this.isSupported()) {
      this._emit('error', 'Web Bluetooth non supportato in questo browser.')
      return false
    }

    this.manualPairing = manualPairing
    this.userDisconnectedManually = false
    this._emit('error', '')
    this._setStatus('connecting')

    try {
      if (!manualPairing) {
        const reconnected = await this.tryAutoReconnect(false)
        if (reconnected && this.status === 'connected') {
          return true
        }
      }

      const requestOptions = manualPairing
        ? {
            acceptAllDevices: true,
            optionalServices: BOSCH_SERVICES,
          }
        : {
            filters: [
              { services: [PRIMARY_SERVICE_UUID] },
              { services: ['00005301-0000-0041-5253-534f46540000'] },
              { services: ['0000fde8-0000-1000-8000-00805f9b34fb'] },
              { namePrefix: 'Bosch' },
              { namePrefix: 'BOSCH' },
              { namePrefix: 'GLM' },
              { namePrefix: 'PLR' },
              { namePrefix: 'GIS' },
              { namePrefix: 'AD' },
            ],
            optionalServices: BOSCH_SERVICES,
          }

      const selectedDevice = await navigator.bluetooth.requestDevice(requestOptions)
      await this._attachToDevice(selectedDevice)
      return true
    } catch (err) {
      if (err?.name !== 'NotFoundError') {
        this._emit('error', `Errore BLE: ${err?.message || err}`)
      }
      this._onDisconnected()
      return false
    }
  }

  /**
   * Disconnette il laser
   */
  disconnect(manual = true) {
    this.userDisconnectedManually = manual
    try {
      if (this.notifyChar) {
        this.notifyChar.removeEventListener('characteristicvaluechanged', this._boundOnNotification)
      }
      if (this.bleDevice && this.bleDevice.gatt?.connected) {
        this.bleDevice.gatt.disconnect()
      }
    } catch {
      // ignore
    } finally {
      this.notifyChar = null
      this.writeChar = null
      this.gattServer = null
      this._setStatus('disconnected')
    }
  }

  async _connectWithWatch(device, timeoutMs = 3500) {
    try {
      await this._attachToDevice(device)
      return true
    } catch {
      // Se gatt.connect() diretto fallisce, prova watchAdvertisements
    }

    if (typeof device.watchAdvertisements === 'function') {
      try {
        const abortCtrl = new AbortController()
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            abortCtrl.abort()
            resolve(false)
          }, timeoutMs)

          device.addEventListener(
            'advertisementreceived',
            () => {
              clearTimeout(timer)
              abortCtrl.abort()
              resolve(true)
            },
            { once: true, signal: abortCtrl.signal }
          )

          device.watchAdvertisements({ signal: abortCtrl.signal }).catch(() => {
            clearTimeout(timer)
            resolve(false)
          })
        })
      } catch {
        // continue
      }
    }

    try {
      await this._attachToDevice(device)
      return true
    } catch {
      return false
    }
  }

  async _attachToDevice(device) {
    this.bleDevice = device
    this.deviceName = device.name || this.getSavedDeviceMeta()?.name || 'Bosch BLE'
    this._saveDeviceMeta(device)

    device.removeEventListener('gattserverdisconnected', this._boundOnDisconnected)
    device.addEventListener('gattserverdisconnected', this._boundOnDisconnected)

    this.gattServer = await device.gatt.connect()

    let targetService = null
    try {
      targetService = await this.gattServer.getPrimaryService(PRIMARY_SERVICE_UUID)
    } catch {
      const services = await this.gattServer.getPrimaryServices()
      targetService =
        services.find(
          (s) => s.uuid.toLowerCase().includes('5301') || s.uuid.toLowerCase().includes('fde8')
        ) || services[0]
    }

    if (!targetService) {
      throw new Error('Servizio Bosch BLE non trovato.')
    }

    let targetChar = null
    try {
      targetChar = await targetService.getCharacteristic(PRIMARY_CHAR_UUID)
    } catch {
      const chars = await targetService.getCharacteristics()
      targetChar =
        chars.find((c) => BOSCH_CHAR_UUIDS.includes(c.uuid.toLowerCase())) ||
        chars.find((c) => c.properties.notify || c.properties.indicate) ||
        chars[0]

      this.writeChar =
        chars.find((c) => c.properties.write || c.properties.writeWithoutResponse) || targetChar
    }

    if (!targetChar) {
      throw new Error('Caratteristica GATT non trovata.')
    }

    this.notifyChar = targetChar
    if (!this.writeChar) {
      this.writeChar = targetChar
    }

    await this.notifyChar.startNotifications()
    this.notifyChar.removeEventListener('characteristicvaluechanged', this._boundOnNotification)
    this.notifyChar.addEventListener('characteristicvaluechanged', this._boundOnNotification)

    this._setStatus('connected')

    // Attiva Auto-Sync e imposta la modalità Distanza + Angolo simultanei
    await this._writeBytes(AUTO_SYNC_CMD)
    await sleep(400)
    await this.enableDistanceAndAngleMode()
  }

  async _writeBytes(bytes) {
    const char = this.writeChar || this.notifyChar
    if (!char) return false
    try {
      if (typeof char.writeValueWithResponse === 'function' && char.properties?.write) {
        await char.writeValueWithResponse(bytes)
      } else if (typeof char.writeValue === 'function') {
        await char.writeValue(bytes)
      } else {
        await char.writeValueWithoutResponse(bytes)
      }
      return true
    } catch {
      try {
        await char.writeValueWithoutResponse(bytes)
        return true
      } catch {
        return false
      }
    }
  }

  async enableDistanceAndAngleMode() {
    const ok = await this._writeBytes(INDIRECT_HORIZ_CMD)
    if (!ok) {
      await this._writeBytes(INDIRECT_HEIGHT_CMD)
    }
  }

  _onDisconnected() {
    this.notifyChar = null
    this.writeChar = null
    this.gattServer = null
    this._setStatus('disconnected')

    if (!this.userDisconnectedManually && !this.manualPairing && this.bleDevice) {
      this._connectWithWatch(this.bleDevice, 60000)
    }
  }

  _onNotification(event) {
    const dataView = event.target?.value
    const parsed = parseBoschPacket(dataView)
    if (!parsed) return

    if (parsed.needsModeReset && this.status === 'connected') {
      this.enableDistanceAndAngleMode()
    }

    const { distance, inclination } = parsed
    const now = Date.now()
    const sig = `${distance !== null ? distance.toFixed(3) : 'n'}_${inclination !== null ? inclination.toFixed(1) : 'n'}`
    if (sig === this.lastPacketSig && now - this.lastPacketTime < 350) {
      return
    }
    this.lastPacketSig = sig
    this.lastPacketTime = now

    const classification = classifyAngle(inclination)

    const measurement = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      distance,
      distanceFormatted: formatMeters(distance),
      inclination,
      inclinationFormatted: formatAngle(inclination),
      type: classification.type,
      label: classification.label,
      color: classification.color,
      icon: classification.icon,
      timestamp: now,
    }

    this._emit('measurement', measurement)
  }
}
