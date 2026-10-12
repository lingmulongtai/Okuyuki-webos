import Spotlight from '@enact/spotlight';
import classnames from 'classnames';
import {useCallback, useEffect, useRef, useState} from 'react';

import {formatDate, qualityLabel} from '../components/format';
import {canPlay} from '../host/capabilities';
import {KEY, onBackKey} from '../platform/webos';
import {prepareWithWait} from '../state/prepare';

import css from './PhotoViewer.module.less';

const INFO_MS = 4000;
const FRAME_TIMEOUT_MS = 15000;

// How a still video gets its frame on screen: "play-pause" starts playback and pauses on the
// first frame, which hardware decoders handle most reliably; "first-frame" waits for loadeddata.
// Revisit with the results of the 4K still test on the TV.
const STILL_STRATEGY = 'play-pause';

function release (video) {
	if (!video || !video.getAttribute('src')) return;
	video.pause();
	video.removeAttribute('src');
	video.load();
}

/** Loads one still video. `promise` resolves true once its frame is ready to show. */
function loadStill (video, src) {
	let finish = null;
	const promise = new Promise((resolve) => {
		const events = {};
		let timer = null;
		finish = (ok) => {
			if (!finish) return;
			finish = null;
			clearTimeout(timer);
			Object.keys(events).forEach((type) => video.removeEventListener(type, events[type]));
			resolve(ok);
		};
		events.canplay = () => {
			if (STILL_STRATEGY !== 'play-pause') return;
			const played = video.play();
			if (played && played.catch) played.catch(() => finish && finish(false));
		};
		events.playing = () => {
			video.pause();
			finish(true);
		};
		events.loadeddata = () => {
			if (STILL_STRATEGY === 'first-frame') finish(true);
		};
		events.error = () => finish(false);
		Object.keys(events).forEach((type) => video.addEventListener(type, events[type]));
		timer = setTimeout(() => finish && finish(false), FRAME_TIMEOUT_MS);
		video.src = src;
		video.load();
	});
	return {
		promise,
		cancel: () => finish && finish(false)
	};
}

/** One photo (or a video's poster). Keyed by item, so everything here starts over per photo. */
const Photo = ({bestQuality, connection, item, nextId, onClose, onMove, onPlay, position}) => {
	const video = useRef(null);
	const retried = useRef(false);
	const wantsStill = bestQuality && item.kind === 'photo';
	const [still, setStill] = useState(null);
	const [preparing, setPreparing] = useState(wantsStill);
	const [infoVisible, setInfoVisible] = useState(true);
	const [displayState, setDisplayState] = useState('loading');
	// Built once: a session renewed in the background must not reload a photo already on screen.
	const [displaySrc, setDisplaySrc] = useState(() => connection.client.displayUrl(item.id));

	useEffect(() => {
		const timer = setTimeout(() => setInfoVisible(false), INFO_MS);
		return () => clearTimeout(timer);
	}, []);

	// Best quality: ask the phone for the 4K still and swap it in once its frame is ready.
	useEffect(() => {
		if (!wantsStill) return;
		const node = video.current;
		let cancelled = false;
		let loading = null;
		prepareWithWait(connection, item.id, 'still', () => cancelled).then((prepared) => {
			if (cancelled || !prepared || prepared.state !== 'ready' || !canPlay(prepared.mime, prepared.codecs)) return;
			loading = loadStill(node, connection.client.resolve(prepared.url));
			return loading.promise.then((ok) => {
				if (!cancelled && ok) setStill({width: prepared.width, height: prepared.height, hdr: prepared.hdr});
			});
		}).catch(() => {
			// The standard image stays on screen; that is all "best quality" can fall back to.
		}).then(() => {
			if (!cancelled) setPreparing(false);
		});
		return () => {
			cancelled = true;
			if (loading) loading.cancel();
			release(node);
		};
	}, [wantsStill, connection, item.id]);

	// While this 4K still is on screen, let the phone convert the next photo.
	useEffect(() => {
		if (still && nextId !== null) connection.request((client) => client.prepare(nextId, 'still')).catch(() => {});
	}, [still, nextId, connection]);

	const activate = useCallback(() => {
		if (item.kind === 'video') onPlay();
		else setInfoVisible((visible) => !visible);
	}, [item.kind, onPlay]);

	useEffect(() => onBackKey(onClose), [onClose]);

	useEffect(() => {
		const onKey = (event) => {
			switch (event.keyCode) {
				case KEY.LEFT:
					onMove(-1);
					break;
				case KEY.RIGHT:
					onMove(1);
					break;
				case KEY.OK:
					activate();
					break;
				case KEY.UP:
				case KEY.DOWN:
					setInfoVisible((visible) => !visible);
					break;
				case KEY.PLAY:
				case KEY.PLAY_PAUSE:
					if (item.kind === 'video') onPlay();
					break;
				default:
					return;
			}
			event.preventDefault();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activate, item.kind, onMove, onPlay]);

	const onLoad = useCallback(() => setDisplayState('loaded'), []);

	// A photo that fails to load gets one retry with a fresh media key: the phone may have
	// restarted and forgotten the old one.
	const onError = useCallback(() => {
		setDisplayState('error');
		if (retried.current) return;
		retried.current = true;
		connection.renewSession().then(() => {
			setDisplayState('loading');
			setDisplaySrc(connection.client.displayUrl(item.id));
		}, () => {});
	}, [connection, item.id]);

	const back = useCallback(() => onMove(-1), [onMove]);
	const forward = useCallback(() => onMove(1), [onMove]);

	const showingStill = still !== null;
	const badge = item.kind === 'video' ? '動画' : qualityLabel(still);

	return (
		<div
			className={classnames(css.viewer, showingStill ? css.still : css.standard)}
			data-display={displayState}
			data-item-id={item.id}
			data-quality={showingStill ? 'still' : 'standard'}
			data-testid="photo-viewer"
		>
			<video className={classnames(css.video, !showingStill && css.hidden)} muted playsInline preload="auto" ref={video} />
			<img
				alt=""
				className={classnames(css.display, showingStill && css.hidden)}
				onError={onError}
				onLoad={onLoad}
				src={displaySrc}
			/>
			<div className={css.zones}>
				<div className={css.zone} onClick={back} />
				<div className={css.zone} onClick={activate} />
				<div className={css.zone} onClick={forward} />
			</div>
			{item.kind === 'video' ? <div className={css.play} data-testid="play-hint">▶ 決定ボタンで再生</div> : null}
			{displayState !== 'loaded' && !showingStill ? (
				<div className={css.message}>{displayState === 'error' ? '写真を読み込めませんでした' : '読み込んでいます…'}</div>
			) : null}
			<div className={classnames(css.info, !infoVisible && css.infoHidden)} data-testid="photo-info">
				<span className={css.badge} data-testid="quality">{badge}</span>
				{preparing && !showingStill ? <span className={css.note}>4K を準備しています…</span> : null}
				{item.stereo ? <span className={css.badge}>3D（2D で表示）</span> : null}
				<span className={css.date}>{formatDate(item.takenAt)}</span>
				<span className={css.position}>{position}</span>
			</div>
		</div>
	);
};

const PhotoViewer = ({bestQuality, connection, index, items, onClose, onIndex, onNeedMore, onPlay, total}) => {
	const item = items[index];
	const next = items[index + 1];
	const previous = items[index - 1];

	// Hardware keys go straight to the viewer, so Spotlight stays out of the way meanwhile.
	useEffect(() => {
		Spotlight.pause();
		return () => Spotlight.resume();
	}, []);

	// Tell the phone what is on screen and warm up the neighbours' standard images.
	useEffect(() => {
		connection.send({type: 'viewing', itemId: item.id});
	}, [connection, item.id]);

	const nextDisplay = next ? next.id : null;
	const previousDisplay = previous ? previous.id : null;
	useEffect(() => {
		[nextDisplay, previousDisplay].forEach((id) => {
			if (id !== null) new window.Image().src = connection.client.displayUrl(id);
		});
	}, [connection, nextDisplay, previousDisplay]);

	useEffect(() => {
		if (index >= items.length - 5) onNeedMore();
	}, [index, items.length, onNeedMore]);

	const move = useCallback((delta) => {
		const target = index + delta;
		if (target >= 0 && target < items.length) onIndex(target);
	}, [index, items.length, onIndex]);

	return (
		<Photo
			bestQuality={bestQuality}
			connection={connection}
			item={item}
			key={item.id}
			nextId={next && next.kind === 'photo' ? next.id : null}
			onClose={onClose}
			onMove={move}
			onPlay={onPlay}
			position={total ? (index + 1) + ' / ' + total : ''}
		/>
	);
};

export default PhotoViewer;
