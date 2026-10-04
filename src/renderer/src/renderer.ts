import './styles/global.css'
import './styles/themes.css'
import { applyMotionPreference } from './utils/motion'
import './components/App'

// Put the attribute on <html> before anything renders, so a preference of
// "never" or a system that asks for less motion is in force for the first frame
// rather than from the time settings finish loading.
applyMotionPreference()