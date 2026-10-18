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
                  {{ item.distance !== null ? formatMeters(item.distance) + ' m' : '—' }}
                </td>
                <td class="mono-text">
                  {{ item.inclination !== null ? formatAngle(item.inclination) + '°' : '—' }}
                </td>
                <td class="text-right">
                  <v-chip
                    size="x-small"
                    :color="classifyAngle(item.inclination).color"
                    variant="tonal"
                    class="font-weight-bold"
                    :prepend-icon="classifyAngle(item.inclination).icon"
                  >
                    {{ classifyAngle(item.inclination).label }}
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
import { useBoschLaser } from './composables/useBoschLaser.js'

const {
  isBleSupported,
  isConnected,
  isConnecting,
  deviceName,
  manualPairing,
  errorMessage,
  currentDistanceMeters,
  currentInclinationDeg,
  formattedPrimaryDistance,
  formattedInclination,
  currentClassification,
  flashUpdate,
  history,
  connectLaser,
  disconnectLaser,
  clearHistory,
  formatMeters,
  formatAngle,
  classifyAngle,
} = useBoschLaser()
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
