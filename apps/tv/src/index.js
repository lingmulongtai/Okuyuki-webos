/* global ENACT_PACK_ISOMORPHIC */
import {createRoot, hydrateRoot} from 'react-dom/client';

import App from './App';

const appElement = (<App />);

if (typeof window !== 'undefined') {
	// Everything on screen is Japanese, popups too, which Sandstone draws outside the app's own element.
	document.documentElement.lang = 'ja';
	if (ENACT_PACK_ISOMORPHIC) {
		hydrateRoot(document.getElementById('root'), appElement);
	} else {
		createRoot(document.getElementById('root')).render(appElement);
	}
}

export default appElement;
