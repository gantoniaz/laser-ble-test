import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import 'vuetify/styles'
import App from './App.vue'

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'boschLight',
    themes: {
      boschLight: {
        dark: false,
        colors: {
          background: '#F4F7FA',
          surface: '#FFFFFF',
          'surface-variant': '#E6EEF5',
          primary: '#005691',
          secondary: '#007BC0',
          accent: '#E20015',
          success: '#2E7D32',
          warning: '#ED6C02',
          error: '#D32F2F',
          info: '#0288D1',
        },
      },
    },
  },
})

createApp(App).use(vuetify).mount('#app')
