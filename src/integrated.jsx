import { createRoot } from 'react-dom/client';
import Calculator from './Calculator.jsx';

const root = document.getElementById('calculator-root');
let mounted = false;
function mountCalculator() {
  if (!mounted && root) { mounted = true; createRoot(root).render(<Calculator />); }
}
document.addEventListener('calculator:open', mountCalculator);
if (root && !root.closest('[hidden]')) mountCalculator();
