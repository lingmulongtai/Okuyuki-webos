// Thin wrappers around the webOS TV runtime, so the rest of the app also runs in a desktop browser.

export const KEY = {
	LEFT: 37,
	UP: 38,
	RIGHT: 39,
	DOWN: 40,
	OK: 13,
	BACK: 461,
	ESC: 27,
	BACKSPACE: 8,
	PLAY: 415,
	PAUSE: 19,
	PLAY_PAUSE: 10252
};

export function isBackKey (event) {
	const code = event.keyCode;
	if (code === KEY.BACK || code === KEY.ESC) return true;
	const target = event.target;
	const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
	return code === KEY.BACKSPACE && !typing;
}

/**
 * Calls `handler` when Back is pressed, on keydown. The matching keyup is swallowed as well, so
 * Enact's own cancel handling (which acts on keyup) never sees a press that was already handled.
 */
export function onBackKey (handler) {
	const down = (event) => {
		if (!isBackKey(event)) return;
		event.preventDefault();
		event.stopPropagation();
		if (!event.repeat) handler(event);
	};
	const up = (event) => {
		if (!isBackKey(event)) return;
		event.preventDefault();
		event.stopPropagation();
	};
	window.addEventListener('keydown', down, true);
	window.addEventListener('keyup', up, true);
	return () => {
		window.removeEventListener('keydown', down, true);
		window.removeEventListener('keyup', up, true);
	};
}

function system () {
	return typeof window === 'undefined' ? null : (window.webOSSystem || window.PalmSystem || null);
}

function parse (value) {
	if (!value) return {};
	if (typeof value === 'object') return value;
	try {
		return JSON.parse(value) || {};
	} catch (error) {
		return {};
	}
}

/** Launch parameters given by the phone through SSAP (`{host, port, deviceId}`), if any. */
export function launchParams () {
	const current = system();
	return parse(current && current.launchParams);
}

/** Calls `handler` with the parameters of every later launch while the app is running. */
export function onLaunch (handler) {
	const listener = (event) => handler(parse(event.detail));
	document.addEventListener('webOSLaunch', listener, true);
	document.addEventListener('webOSRelaunch', listener, true);
	return () => {
		document.removeEventListener('webOSLaunch', listener, true);
		document.removeEventListener('webOSRelaunch', listener, true);
	};
}

export function deviceInfo () {
	const current = system();
	return parse(current && current.deviceInfo);
}

/** Leaves the app the way the TV's own Back key would. */
export function exitApp () {
	const current = system();
	if (current && typeof current.platformBack === 'function') current.platformBack();
	else window.close();
}
