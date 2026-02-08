import { renderToString } from '@utopia/server'
import App from './App.utopia'

export function render(_url: string): { html: string; css: string } {
  return renderToString(App)
}
