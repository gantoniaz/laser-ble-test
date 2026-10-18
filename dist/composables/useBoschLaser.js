/**
 * VUE 3 COMPOSABLE: useBoschLaser
 * -------------------------------
 * Adattatore reattivo Vue 3 per BoschLaserClient (src/core/boschLaserCore.js).
 * Espone stato reattivo, storico persistente e callback per integrare
 * il laser in un'app di preventivi o rilievi con una sola riga:
 *
 *   const { connect, disconnect, isConnected, latestMeasurement, history } = useBoschLaser()
 */

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  BoschLaserClient,
  formatMeters,
  formatAngle,
  classifyAngle,
} from '../core/boschLaserCore.js'

const STORAGE_KEY_HISTORY = 'bosch_ble_history_v1'

export function useBoschLaser(options = {}) {
  const {
    autoReconnectOnMount = true,
    persistHistory = true,
    onMeasurementCallback = null,
  } = options

  const client = new BoschLaserClient()

  const isBleSupported = ref(client.isSupported())
  const status = ref('disconnected')
  const isConnected = computed(() => status.value === 'connected')
  const isConnecting = computed(() => status.value === 'connecting')
  const deviceName = ref(client.getSavedDeviceMeta()?.name || '')
  const manualPairing = ref(false)
  const errorMessage = ref('')

  const currentDistanceMeters = ref(null)
  const currentInclinationDeg = ref(null)
  const flashUpdate = ref(false)
  const history = ref([])

  const formattedPrimaryDistance = computed(() => formatMeters(currentDistanceMeters.value))
  const formattedInclination = computed(() => formatAngle(currentInclinationDeg.value))

  const currentClassification = computed(() => {
    if (currentDistanceMeters.value === null && currentInclinationDeg.value === null) {
      return {
        type: 'IN_ATTESA',
        label: 'IN ATTESA',
        color: 'grey',
        icon: 'mdi-minus',
      }
    }
    return classifyAngle(currentInclinationDeg.value)
  })

  function loadHistory() {
    if (!persistHistory) return
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
  }

  function saveHistory() {
    if (!persistHistory) return
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history.value))
    } catch {
      // ignore
    }
  }

  function clearHistory() {
    history.value = []
    saveHistory()
  }

  const unsubStatus = client.on('status', (payload) => {
    status.value = payload.status
    if (payload.deviceName) {
      deviceName.value = payload.deviceName
    }
  })

  const unsubError = client.on('error', (msg) => {
    errorMessage.value = msg
  })

  const unsubMeasurement = client.on('measurement', (m) => {
    if (m.distance !== null) currentDistanceMeters.value = m.distance
    if (m.inclination !== null) currentInclinationDeg.value = m.inclination

    flashUpdate.value = true
    setTimeout(() => {
      flashUpdate.value = false
    }, 400)

    history.value = [
      {
        id: m.id,
        distance: m.distance,
        inclination: m.inclination,
        type: m.type,
        label: m.label,
      },
      ...history.value,
    ]
    saveHistory()

    if (typeof onMeasurementCallback === 'function') {
      onMeasurementCallback(m)
    }
  })

  async function connectLaser() {
    return await client.connect({ manualPairing: manualPairing.value })
  }

  function disconnectLaser(manual = true) {
    client.disconnect(manual)
  }

  onMounted(async () => {
    loadHistory()
    if (autoReconnectOnMount && isBleSupported.value && !manualPairing.value) {
      await client.tryAutoReconnect(true)
    }
  })

  onBeforeUnmount(() => {
    unsubStatus()
    unsubError()
    unsubMeasurement()
    client.disconnect(true)
  })

  return {
    // Istanza core (per uso avanzato)
    client,
    // Stato connessione
    isBleSupported,
    status,
    isConnected,
    isConnecting,
    deviceName,
    manualPairing,
    errorMessage,
    // Dati misura
    currentDistanceMeters,
    currentInclinationDeg,
    formattedPrimaryDistance,
    formattedInclination,
    currentClassification,
    flashUpdate,
    history,
    // Azioni
    connectLaser,
    disconnectLaser,
    clearHistory,
    // Utilità di formattazione/classificazione
    formatMeters,
    formatAngle,
    classifyAngle,
  }
}
