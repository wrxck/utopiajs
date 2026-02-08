import { defineConfig } from 'vite'
import utopia from '@matthesketh/utopia-vite-plugin'

export default defineConfig({
  plugins: [utopia()],
})
