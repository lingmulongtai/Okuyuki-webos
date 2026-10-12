import Spinner from '@enact/sandstone/Spinner';
import Spotlight from '@enact/spotlight';
import classnames from 'classnames';
import {useCallback, useEffect, useRef, useState} from 'react';

import {longDate, qualityLabel} from '../components/format';
import Glyph from '../components/Glyph';
import {canPlay} from '../host/capabilities';
import {KEY, onBackKey} from '../platform/webos';
import {prepareWithWait} from '../state/prepare';

import css from './PhotoViewer.module.less';

const INFO_MS = 5000;
const EDGE_MS = 1600;
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
const Photo = ({bestQuality, connection, hasNext, hasPrevious, item, nextId, onClose, onMove, onPlay, position, single}) => {
	const video = useRef(null);
	const retried = useRef(false);
	const wantsStill = bestQuality && item.kind === 'photo';
	const [still, setStill] = useState(null);
	const [preparing, setPreparing] = useState(wantsStill);
	// `shown` changes whenever the details are shown again, which restarts the time until they hide.
	const [info, setInfo] = useState({visible: true, shown: 0});
	const [edge, setEdge] = useState(null);
	const [displayState, setDisplayState] = useState('loading');
	// Built once: a session renewed in the background must not reload a photo already on screen.
	const [displaySrc, setDisplaySrc] = useState(() => connection.client.displayUrl(item.id));

	useEffect(() => {
		if (!info.visible) return;
		const timer = setTimeout(() => setInfo((current) => ({...current, visible: false})), INFO_MS);
		return () => clearTimeout(timer);
	}, [info]);

	useEffect(() => {
		if (!edge) return;
		const timer = setTimeout(() => setEdge(null), EDGE_MS);
		return () => clearTimeout(timer);
	}, [edge]);

	const toggleInfo = useCallback(() => setInfo((current) => ({visible: !current.visible, shown: current.shown + 1})), []);

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
				if (cancelled || !ok) return;
				setStill({width: prepared.width, height: prepared.height, hdr: prepared.hdr});
				// Show the details again, so the badge turning to "4K" is seen.
				setInfo((current) => ({visible: true, shown: current.shown + 1}));
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
		else toggleInfo();
	}, [item.kind, onPlay, toggleInfo]);

	const kind = item.kind === 'video' ? '動画' : '写真';
	const back = useCallback(() => {
		if (hasPrevious) onMove(-1);
		else if (!single) setEdge('いちばん新しい' + kind + 'です');
	}, [hasPrevious, kind, onMove, single]);
	const forward = useCallback(() => {
		if (hasNext) onMove(1);
		else if (!single) setEdge('いちばん古い' + kind + 'です');
	}, [hasNext, kind, onMove, single]);

	useEffect(() => onBackKey(onClose), [onClose]);

	useEffect(() => {
		const onKey = (event) => {
			switch (event.keyCode) {
				case KEY.LEFT:
					back();
					break;
				case KEY.RIGHT:
					forward();
					break;
				case KEY.OK:
					activate();
					break;
				case KEY.UP:
				case KEY.DOWN:
					toggleInfo();
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
	}, [activate, back, forward, item.kind, onPlay, toggleInfo]);

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

	const showingStill = still !== null;
	const isVideo = item.kind === 'video';
	const waiting = displayState !== 'loaded' && !showingStill;

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
			{waiting && displayState === 'error' && !isVideo ? (
				<div className={css.center}>
					<Glyph className={css.problem} name="alert" />
					<p className={css.centerText}>写真を読み込めませんでした。</p>
					<p className={css.centerNote}>左右のボタンで、ほかの写真に移れます。</p>
				</div>
			) : null}
			{waiting && displayState === 'loading' ? (
				<div className={css.center}>
					<Spinner className={css.spinner} />
				</div>
			) : null}
			{isVideo ? (
				<div className={css.center} data-testid="play-hint">
					<span className={css.playButton}><Glyph className={css.playGlyph} name="play" /></span>
					<p className={css.centerText}>決定ボタンで再生</p>
				</div>
			) : null}
			<div className={classnames(css.overlay, !info.visible && css.overlayHidden)} data-testid="photo-info">
				<div className={css.top}>
					<div>
						<div className={css.date}>{longDate(item.takenAt)}</div>
						<div className={css.position}>{position}</div>
					</div>
					<div className={css.badges}>
						{preparing && !showingStill ? (
							<span className={css.preparing}>
								<Spinner className={css.smallSpinner} size="small" />
								4K を準備しています…
							</span>
						) : null}
						{item.stereo ? <span className={css.badge}>3D（平面で表示）</span> : null}
						<span className={classnames(css.badge, showingStill && css.best)} data-testid="quality">
							{isVideo ? '動画' : qualityLabel(still)}
						</span>
					</div>
				</div>
				<div className={css.bottom}>
					<span className={css.hint}>
						<span className={css.key}><Glyph className={css.keyGlyph} name="chevronLeft" /><Glyph className={css.keyGlyph} name="chevronRight" /></span>
						前後へ
					</span>
					<span className={css.hint}><span className={css.key}>決定</span>{isVideo ? '再生' : '情報を隠す'}</span>
					<span className={css.hint}><span className={css.key}>戻る</span>一覧へ</span>
				</div>
			</div>
			{edge ? <div className={css.toast} role="status">{edge}</div> : null}
			<div className={css.zones}>
				<div className={css.zone} onClick={back}>
					{hasPrevious ? <span className={css.arrow}><Glyph className={css.arrowGlyph} name="chevronLeft" /></span> : null}
				</div>
				<div className={css.zone} onClick={activate} />
				<div className={classnames(css.zone, css.right)} onClick={forward}>
					{hasNext ? <span className={css.arrow}><Glyph className={css.arrowGlyph} name="chevronRight" /></span> : null}
				</div>
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

	// At the ends of the list there is no arrow that way, and the remote trying to go past one
	// is told so, unless there is only the one item.
	const count = total || items.length;

	return (
		<Photo
			bestQuality={bestQuality}
			connection={connection}
			hasNext={index < count - 1}
			hasPrevious={index > 0}
			item={item}
			key={item.id}
			nextId={next && next.kind === 'photo' ? next.id : null}
			onClose={onClose}
			onMove={move}
			onPlay={onPlay}
			position={total ? (index + 1) + ' / ' + total : ''}
			single={count <= 1}
		/>
	);
};

export default PhotoViewer;
