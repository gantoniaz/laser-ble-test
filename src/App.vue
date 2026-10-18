<template>
  <v-app>
    <v-main>
      <v-container class="py-3 px-3" style="max-width: 520px;">
        <!-- 1. Barra Connessione Compatta -->
        <v-card variant="outlined" class="rounded-lg surface-card mb-3">
          <div class="d-flex flex-wrap align-center justify-space-between px-3 py-2 ga-2">
            <div class="d-flex align-center ga-2">
              <v-btn
                v-if="!isConnected"
                color="primary"
                size="small"
                prepend-icon="mdi-bluetooth"
                :loading="isConnecting"
                :disabled="!isBleSupported"
                class="font-weight-bold"
                @click="connectLaser"
              >
                Connetti Laser
              </v-btn>

              <template v-else>
                <v-chip
                  size="small"
                  color="success"
                  variant="tonal"
                  class="font-weight-bold"
                  prepend-icon="mdi-bluetooth-connect"
                >
                  {{ deviceName || 'Bosch BLE' }}
                </v-chip>
                <v-btn
                  color="error"
                  size="x-small"
                  variant="text"
                  icon="mdi-bluetooth-off"
                  title="Disconnetti"
                  @click="disconnectLaser(true)"
                />
              </template>
            </div>

            <v-checkbox
              v-model="manualPairing"
              density="compact"
              hide-details
              color="primary"
              label="Accoppia manuale"
              class="compact-checkbox"
            />
          </div>
        </v-card>

        <!-- Avvisi -->
        <v-alert
          v-if="!isBleSupported"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3 text-caption"
        >
          Web Bluetooth non supportato. Usa Chrome o Edge.
        </v-alert>

        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          closable
          class="mb-3 text-caption"
          @click:close="errorMessage = ''"
        >
          {{ errorMessage }}
        </v-alert>

        <!-- 2. Display Compatto Live: Misura (m, 2 decimali) + Angolo (°, 0 decimali) + Chip Tipo -->
        <v-card
          variant="outlined"
          class="rounded-lg surface-card mb-3 pa-3"
          :class="{ 'pulse-border': flashUpdate }"
        >
          <div class="d-flex align-center justify-space-between">
            <div>
              <div class="text-caption text-medium-emphasis">Misura</div>
              <div class="compact-readout mono-text" :class="{ 'text-disabled': currentDistanceMeters === null }">
                {{ formattedPrimaryDistance }}<span class="compact-unit">m</span>
              </div>
            </div>

            <div class="text-center px-2">
              <div class="text-caption text-medium-emphasis">Angolo</div>
              <div class="compact-readout-angle mono-text" :class="{ 'text-disabled': currentInclinationDeg === null }">
                {{ formattedInclination }}<span class="compact-unit">°</span>
              </div>
            </div>

            <div class="text-right">
              <v-chip
                :color="currentClassification.color"
                variant="flat"
                size="default"
                class="font-weight-bold px-3"
                :prepend-icon="currentClassification.icon"
              >
                {{ currentClassification.label }}
              </v-chip>
            </div>
          </div>
        </v-card>

        <!-- 3. Storico Rilievi che si espande liberamente: Misura, Angolo, Tipo -->
        <v-card variant="outlined" class="rounded-lg surface-card">
          <div class="d-flex align-center justify-space-between px-3 py-2 border-b">
            <span class="text-caption font-weight-bold text-uppercase">
              Storico Rilievi ({{ history.length }})
            </span>
            <v-btn
              v-if="history.length > 0"
              size="x-small"
              variant="text"
              color="error"
              icon="mdi-delete-outline"
              density="compact"
              title="Svuota storico"
              @click="clearHistory"
            />
          </div>

          <v-table density="compact" class="bg-transparent compact-table">
            <thead>
              <tr>
                <th class="text-left">Misura</th>
                <th class="text-left">Angolo</th>
                <th class="text-right">Tipo</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="history.length === 0">
                <td colspan="3" class="text-center text-caption text-medium-emphasis py-6">
                  Premi il tasto sul laser per registrare le misure nello storico.
                </td>
              </tr>
              <tr v-for="item in history" :key="item.id">
                <td class="font-weight-bold mono-text">
                  {{ item.distance !== null ? Number(item.distance).toFixed(2) + ' m' : '—' }}
                </td>
                <td class="mono-text">
                  {{ item.inclination !== null ? formatSignedAngle(Number(item.inclination)) + '°' : '—' }}
                </td>
                <td class="text-right">
                  <v-chip
                    size="x-small"
                    :color="classifyMeasurement(item.inclination).color"
                    variant="tonal"
                    class="font-weight-bold"
                    :prepend-icon="classifyMeasurement(item.inclination).icon"
                  >
                    {{ classifyMeasurement(item.inclination).label }}
                  </v-chip>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const PRIMARY_SERVICE_UUID = '00005301-0000-1000-8000-00805f9b34fb'
const PRIMARY_CHAR_UUID = '00005302-0000-1000-8000-00805f9b34fb'

const BOSCH_SERVICES = [
  PRIMARY_SERVICE_UUID,
  '00005301-0000-0041-5253-534f46540000',
  '0000fde8-0000-1000-8000-00805f9b34fb',
]

const BOSCH_CHAR_UUIDS = [
  PRIMARY_CHAR_UUID,
  '00005302-0000-0041-5253-534f46540000',
  '00004301-0000-0041-5253-534f46540000',
  '00004302-0000-0041-5253-534f46540000',
  '02a6c0d1-0451-4000-b000-fb3210111989',
  '02a6c0d2-0451-4000-b000-fb3210111989',
]

const BOSCH_NAME_REGEX = /(bosch|glm|plr|gis|ad\s*\d|mt\d|x\d{3,4})/i
const STORAGE_KEY_HISTORY = 'bosch_ble_history_v1'

const AUTO_SYNC_COMMAND = new Uint8Array([0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a])
// Modalità Orizzontale Indiretta (0B E0 - coseno): invia distanza reale (val1) + angolo (val2)
const INDIRECT_HORIZ_CMD = new Uint8Array([0xc0, 0x55, 0x02, 0xf1, 0x0b, 0xe0])
const INDIRECT_HEIGHT_CMD = new Uint8Array([0xc0, 0x55, 0x02, 0xf1, 0x0a, 0x46])

// Soglie di inclinazione:
// - LATO: |angolo| <= 15° (orizzontale)
// - ALTEZZA: 75° <= |angolo| <= 105° (verticale)
// - FUORI BOLLA: inclinazione intermedia tra 15° e 75°
const LATO_MAX_DEG = 15.0
const ALTEZZA_MIN_DEG = 75.0
const ALTEZZA_MAX_DEG = 105.0

const isBleSupported = ref(false)
const isConnected = ref(false)
const isConnecting = ref(false)
const manualPairing = ref(false)
const deviceName = ref('')
const errorMessage = ref('')

let bleDevice = null
let gattServer = null
let notifyCharacteristic = null
let writeCharacteristic = null
let userDisconnectedManually = false

const currentDistanceMeters = ref(null)
const currentInclinationDeg = ref(null)
const flashUpdate = ref(false)
const history = ref([])

onMounted(async () => {
  isBleSupported.value = typeof navigator !== 'undefined' && 'bluetooth' in navigator

  try {
    const saved = localStorage.getItem(STORAGE_KEY_HISTORY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        history.value = parsed
        currentDistanceMeters.value = parsed[0].distance
        currentInclinationDeg.value = parsed[0].inclination
      }
    }
  } catch {
    // ignore
  }

  if (isBleSupported.value && !manualPairing.value) {
    await trySilentAutoConnect()
  }
})

onBeforeUnmount(() => {
  disconnectLaser(true)
})

function saveHistoryToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history.value))
  } catch {
    // ignore
  }
}

function clearHistory() {
  history.value = []
  saveHistoryToStorage()
}

// Arrotonda a 2 cifre decimali per i metri
const formattedPrimaryDistance = computed(() => {
  if (currentDistanceMeters.value === null || Number.isNaN(Number(currentDistanceMeters.value))) {
    return '--.--'
  }
  return Number(currentDistanceMeters.value).toFixed(2)
})

// Arrotonda a 0 decimali per i gradi
function formatSignedAngle(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '--'
  const rounded = Math.round(Number(deg))
  if (rounded === 0) return '0'
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}`
}

const formattedInclination = computed(() => formatSignedAngle(currentInclinationDeg.value))

function classifyMeasurement(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) {
    return {
      label: 'SOLO DISTANZA',
      color: 'grey',
      icon: 'mdi-ruler',
    }
  }

  const absDeg = Math.abs(Number(deg))

  if (absDeg <= LATO_MAX_DEG) {
    return {
      label: 'LATO',
      color: 'success',
      icon: 'mdi-arrow-left-right-bold',
    }
  }

  if (absDeg >= ALTEZZA_MIN_DEG && absDeg <= ALTEZZA_MAX_DEG) {
    return {
      label: 'ALTEZZA',
      color: 'info',
      icon: 'mdi-arrow-up-down-bold',
    }
  }

  return {
    label: 'FUORI BOLLA',
    color: 'warning',
    icon: 'mdi-alert-outline',
  }
}

const currentClassification = computed(() => {
  if (currentDistanceMeters.value === null && currentInclinationDeg.value === null) {
    return {
      label: 'IN ATTESA',
      color: 'grey',
      icon: 'mdi-minus',
    }
  }
  return classifyMeasurement(currentInclinationDeg.value)
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function connectWithAdvertisementWatch(device, timeoutMs = 4000) {
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
    await attachToBleDevice(device)
    return true
  } catch {
    return false
  }
}

async function trySilentAutoConnect() {
  if (bleDevice) {
    try {
      isConnecting.value = true
      await attachToBleDevice(bleDevice)
      return true
    } catch {
      // fall through
    } finally {
      isConnecting.value = false
    }
  }

  if (typeof navigator.bluetooth?.getDevices !== 'function') return false
  try {
    const devices = await navigator.bluetooth.getDevices()
    if (!devices || devices.length === 0) return false

    const boschCandidates = devices.filter((d) => !d.name || BOSCH_NAME_REGEX.test(d.name))
    const target =
      boschCandidates.length === 1
        ? boschCandidates[0]
        : devices.length === 1
        ? devices[0]
        : boschCandidates[0]
    if (!target) return false

    isConnecting.value = true
    return await connectWithAdvertisementWatch(target)
  } catch {
    return false
  } finally {
    isConnecting.value = false
  }
}

async function connectLaser() {
  errorMessage.value = ''
  userDisconnectedManually = false
  isConnecting.value = true

  try {
    if (!manualPairing.value) {
      const connectedSilently = await trySilentAutoConnect()
      if (connectedSilently && isConnected.value) {
        return
      }
    }

    const requestOptions = manualPairing.value
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
    await attachToBleDevice(selectedDevice)
  } catch (err) {
    if (err?.name !== 'NotFoundError') {
      errorMessage.value = `Errore BLE: ${err.message || err}`
    }
    onDisconnected()
  } finally {
    isConnecting.value = false
  }
}

async function attachToBleDevice(device) {
  bleDevice = device
  deviceName.value = bleDevice.name || 'Bosch BLE'
  bleDevice.removeEventListener('gattserverdisconnected', onDisconnected)
  bleDevice.addEventListener('gattserverdisconnected', onDisconnected)

  gattServer = await bleDevice.gatt.connect()

  let targetService = null
  try {
    targetService = await gattServer.getPrimaryService(PRIMARY_SERVICE_UUID)
  } catch {
    const services = await gattServer.getPrimaryServices()
    targetService =
      services.find((s) => s.uuid.toLowerCase().includes('5301') || s.uuid.toLowerCase().includes('fde8')) ||
      services[0]
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

    writeCharacteristic =
      chars.find((c) => c.properties.write || c.properties.writeWithoutResponse) || targetChar
  }

  if (!targetChar) {
    throw new Error('Caratteristica GATT non trovata.')
  }

  notifyCharacteristic = targetChar
  if (!writeCharacteristic) {
    writeCharacteristic = targetChar
  }

  await notifyCharacteristic.startNotifications()
  notifyCharacteristic.removeEventListener('characteristicvaluechanged', handleGattNotification)
  notifyCharacteristic.addEventListener('characteristicvaluechanged', handleGattNotification)
  isConnected.value = true

  await writeBytesToLaser(AUTO_SYNC_COMMAND)
  await sleep(400)
  await enableDistanceAndAngleMode()
}

function onDisconnected() {
  isConnected.value = false
  notifyCharacteristic = null
  writeCharacteristic = null
  gattServer = null

  if (!userDisconnectedManually && !manualPairing.value && bleDevice) {
    connectWithAdvertisementWatch(bleDevice, 60000)
  }
}

function disconnectLaser(manual = true) {
  userDisconnectedManually = manual
  try {
    if (notifyCharacteristic) {
      notifyCharacteristic.removeEventListener('characteristicvaluechanged', handleGattNotification)
    }
    if (bleDevice && bleDevice.gatt?.connected) {
      bleDevice.gatt.disconnect()
    }
  } catch {
    // ignore
  } finally {
    isConnected.value = false
    notifyCharacteristic = null
    writeCharacteristic = null
    gattServer = null
  }
}

async function writeBytesToLaser(bytes) {
  const char = writeCharacteristic || notifyCharacteristic
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

async function enableDistanceAndAngleMode() {
  const ok = await writeBytesToLaser(INDIRECT_HORIZ_CMD)
  if (!ok) {
    await writeBytesToLaser(INDIRECT_HEIGHT_CMD)
  }
}

function handleGattNotification(event) {
  const dataView = event.target.value
  if (!dataView || dataView.byteLength === 0) return
  decodeBoschPacket(dataView)
}

function decodeBoschPacket(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)

  let distance = null
  let inclination = null

  if (bytes.length >= 11 && bytes[0] === 0xc0 && bytes[1] === 0x55) {
    const msgType = bytes[3]

    if (msgType === 0x01 || msgType === 0x02 || msgType === 0xf1) {
      return
    }

    const val0 = bytes.length >= 11 ? dataView.getFloat32(7, true) : 0
    const val1 = bytes.length >= 15 ? dataView.getFloat32(11, true) : 0
    const val2 = bytes.length >= 19 ? dataView.getFloat32(15, true) : 0

    switch (msgType) {
      case 0x29:
      case 0x2a:
      case 0x2d:
      case 0x2e:
      case 0x31:
      case 0x32:
      case 0x35:
      case 0x36: {
        if (isValidDistance(val1)) distance = val1
        else if (isValidDistance(val0)) distance = val0
        if (isValidAngle(val2)) inclination = val2
        break
      }

      case 0x05:
      case 0x06:
      case 0x09:
      case 0x0a: {
        if (isValidDistance(val0)) distance = val0
        if (val2 !== 0 && isValidAngle(val2)) {
          inclination = val2
        } else if (isConnected.value) {
          enableDistanceAndAngleMode()
        }
        break
      }

      case 0x21:
      case 0x58: {
        if (isValidAngle(val0)) inclination = val0
        break
      }

      default: {
        if (isValidDistance(val1)) distance = val1
        else if (isValidDistance(val0)) distance = val0
        if (val2 !== 0 && isValidAngle(val2)) inclination = val2
        break
      }
    }
  } else if (bytes.length >= 7 && bytes[0] === 0x00 && bytes[1] === 0x04) {
    const rawInt = dataView.getUint32(2, true)
    const distM = (rawInt * 0.05) / 1000
    if (isValidDistance(distM)) distance = distM
  }

  if (distance !== null || inclination !== null) {
    if (distance !== null) currentDistanceMeters.value = distance
    if (inclination !== null) currentInclinationDeg.value = inclination

    flashUpdate.value = true
    setTimeout(() => {
      flashUpdate.value = false
    }, 400)

    history.value = [
      {
        id: Date.now() + Math.random(),
        distance,
        inclination,
      },
      ...history.value,
    ]
    saveHistoryToStorage()
  }
}

function isValidDistance(val) {
  return Number.isFinite(val) && val >= 0.01 && val <= 250
}

function isValidAngle(val) {
  return Number.isFinite(val) && val >= -180 && val <= 180
}
</script>

<style scoped>
.mono-text {
  font-family: 'JetBrains Mono', monospace !important;
}

.surface-card {
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.pulse-border {
  border-color: rgb(var(--v-theme-primary)) !important;
  box-shadow: 0 0 0 2px rgba(0, 86, 145, 0.25) !important;
}

.compact-readout {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.03em;
}

.compact-readout-angle {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.compact-unit {
  font-size: 0.95rem;
  font-weight: 500;
  opacity: 0.7;
  margin-left: 2px;
}

.compact-checkbox :deep(.v-selection-control) {
  min-height: 28px !important;
}

.compact-table th,
.compact-table td {
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}
</style>
