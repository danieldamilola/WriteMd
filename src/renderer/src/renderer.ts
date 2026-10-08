import './styles/global.css'
import './styles/themes.css'
import '@awesome.me/webawesome/dist/styles/themes/default.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/space-grotesk/latin-400.css'
import '@fontsource/space-grotesk/latin-600.css'
import './styles/primitives.css'
import './design/monocode.css'
import { applyMotionPreference } from './utils/motion'
import './components/App'

// Put the attribute on <html> before anything renders, so a preference of
// "never" or a system that asks for less motion is in force for the first frame
// rather than from the time settings finish loading.
applyMotionPreference()
