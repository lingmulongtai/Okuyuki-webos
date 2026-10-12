// What this TV can show, sent to the phone so it only converts what the TV cannot play as is.
import {deviceInfo} from '../platform/webos';

export const VIDEO_TYPES = [
	['hevc-main10', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
	['hevc-main', 'video/mp4; codecs="hvc1.1.6.L153.B0"'],
	['h264-high', 'video/mp4; codecs="avc1.640033"'],
	['av1-main10', 'video/mp4; codecs="av01.0.13M.10"'],
	['vp9-profile2', 'video/webm; codecs="vp09.02.51.10"'],
	['vp9', 'video/webm; codecs="vp9"'],
	['dolby-vision', 'video/mp4; codecs="dvh1.05.06"']
];

const HDR_PROBES = [
	['hdr10', 'pq', 'smpteSt2086'],
	['hlg', 'hlg', null]
];

const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

function probeImage (src) {
	return new Promise((resolve) => {
		const image = new window.Image();
		image.onload = () => resolve(image.naturalWidth > 0);
		image.onerror = () => resolve(false);
		image.src = src;
	});
}

async function probeHdr () {
	const found = [];
	const capabilities = navigator.mediaCapabilities;
	if (capabilities && typeof capabilities.decodingInfo === 'function') {
		for (const [name, transferFunction, hdrMetadataType] of HDR_PROBES) {
			const video = {
				contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
				width: 3840,
				height: 2160,
				bitrate: 40000000,
				framerate: 30,
				transferFunction,
				colorGamut: 'rec2020'
			};
			if (hdrMetadataType) video.hdrMetadataType = hdrMetadataType;
			try {
				const info = await capabilities.decodingInfo({type: 'file', video});
				if (info.supported) found.push(name);
			} catch (error) {
				// Older engines reject the HDR fields; fall back to the media query below.
			}
		}
	}
	if (!found.length && window.matchMedia && window.matchMedia('(dynamic-range: high)').matches) {
		found.push('hdr10', 'hlg');
	}
	return found;
}

function videoPlane (info) {
	const uhd = info.uhd === true || info.uhd === 'true' || info.UHD === 'true' || info.screenWidth >= 3840;
	if (uhd) return {videoWidth: 3840, videoHeight: 2160};
	const ratio = window.devicePixelRatio || 1;
	return {
		videoWidth: Math.round(((window.screen && window.screen.width) || window.innerWidth) * ratio),
		videoHeight: Math.round(((window.screen && window.screen.height) || window.innerHeight) * ratio)
	};
}

export async function detectCapabilities () {
	const info = deviceInfo();
	const probe = document.createElement('video');
	const video = VIDEO_TYPES.filter(([, type]) => probe.canPlayType(type) !== '').map(([name]) => name);
	const [hdr, webp] = await Promise.all([probeHdr(), probeImage(WEBP)]);
	return {
		screen: {graphicsWidth: window.innerWidth, graphicsHeight: window.innerHeight, ...videoPlane(info)},
		video,
		hdr,
		image: ['jpeg', 'png'].concat(webp ? ['webp'] : []),
		model: info.modelName || null,
		platformVersion: info.sdkVersion || info.platformVersion || null
	};
}

/** True when this TV can decode a prepared stream (`mime` plus `codecs` from the phone). */
export function canPlay (mime, codecs) {
	if (!mime) return false;
	const type = codecs ? mime + '; codecs="' + codecs + '"' : mime;
	return document.createElement('video').canPlayType(type) !== '';
}
