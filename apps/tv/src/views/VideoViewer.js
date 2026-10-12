import ProgressBar from '@enact/sandstone/ProgressBar';
import Spinner from '@enact/sandstone/Spinner';
import VideoPlayer from '@enact/sandstone/VideoPlayer';
import Spotlight from '@enact/spotlight';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import Action from '../components/Action';
import Copy from '../components/Copy';
import {formatDuration, longDate} from '../components/format';
import Glyph from '../components/Glyph';
import {canPlay} from '../host/capabilities';
import {onBackKey} from '../platform/webos';
import {describeError} from '../state/connection';
import {prepareWithWait} from '../state/prepare';

import css from './VideoViewer.module.less';

export const VIDEO_MESSAGES = {
	unsupported: 'この動画はこのテレビで再生できない形式です。',
	failed: 'スマホで動画を準備できませんでした。',
	playback: '動画を再生できませんでした。'
};

const HDR_LABELS = {hdr10: 'HDR10', hdr10plus: 'HDR10+', hlg: 'HLG', dolbyvision: 'Dolby Vision'};

function videoType (prepared) {
	return prepared.codecs ? prepared.mime + '; codecs="' + prepared.codecs + '"' : prepared.mime;
}

function describe (prepared) {
	const parts = [];
	if (prepared.width && prepared.height) parts.push(prepared.width >= 3840 ? '4K' : prepared.width + '×' + prepared.height);
	if (HDR_LABELS[prepared.hdr]) parts.push(HDR_LABELS[prepared.hdr]);
	return parts.join('  ');
}

const Waiting = ({failure, onClose, onRetry, progress}) => {
	// After a failure the remote starts on "もう一度".
	useEffect(() => {
		if (failure) Spotlight.focus('[data-action="video-retry"]');
	}, [failure]);

	if (failure) {
		return (
			<div className={css.waiting} data-testid="video-failure">
				<div className={css.card}>
					<Glyph className={css.problem} name="alert" />
					<p className={css.text}><Copy>{failure}</Copy></p>
					<div className={css.buttons}>
						<Action data-action="video-retry" kind="primary" onClick={onRetry}>もう一度</Action>
						<Action onClick={onClose}>戻る</Action>
					</div>
				</div>
			</div>
		);
	}
	return (
		<div className={css.waiting} data-testid="video-preparing">
			<div className={css.card}>
				<Spinner className={css.spinner} />
				<p className={css.text}>{progress === null ? '動画を読み込んでいます…' : 'スマホで動画を準備しています…'}</p>
				{progress === null ? null : (
					<div className={css.meter}>
						<ProgressBar className={css.progress} progress={progress} />
						{/* Nothing until the phone reports some progress: a lone 0% reads as stuck. */}
						<span className={css.percent}>{progress > 0 ? Math.round(progress * 100) + '%' : ''}</span>
					</div>
				)}
			</div>
		</div>
	);
};

/** One attempt at playing one video. Keyed, so a retry starts from a clean slate. */
const VideoSession = ({connection, item, onClose, onRetry, retried}) => {
	const root = useRef(null);
	const player = useRef(null);
	const [prepared, setPrepared] = useState(null);
	const [progress, setProgress] = useState(null);
	const [failure, setFailure] = useState(null);
	// Built once: the media key inside must not change under a playing video.
	const [poster] = useState(() => connection.client.displayUrl(item.id));
	const source = useMemo(() => prepared && connection.client.resolve(prepared.url), [connection, prepared]);

	useEffect(() => {
		let cancelled = false;
		prepareWithWait(connection, item.id, 'video', () => cancelled, setProgress).then((result) => {
			if (cancelled || !result) return;
			if (result.state !== 'ready') setFailure(result.state === 'unsupported' ? VIDEO_MESSAGES.unsupported : VIDEO_MESSAGES.failed);
			else if (!canPlay(result.mime, result.codecs)) setFailure(VIDEO_MESSAGES.unsupported);
			else setPrepared(result);
		}, (error) => {
			if (!cancelled) setFailure(describeError(error));
		});
		return () => {
			cancelled = true;
		};
	}, [connection, item.id]);

	// Back hides the playback controls first, then leaves the video.
	useEffect(() => onBackKey(() => {
		if (player.current && player.current.areControlsVisible()) player.current.hideControls();
		else onClose();
	}), [onClose]);

	// Load errors fire on the <source> element and do not bubble, so listen in the capture phase.
	// The first failure gets one retry with a fresh media key, in case the phone restarted.
	useEffect(() => {
		const node = root.current;
		const onError = (event) => {
			const tag = event.target && event.target.tagName;
			if (tag !== 'SOURCE' && tag !== 'VIDEO') return;
			if (retried) {
				setPrepared(null);
				setFailure(VIDEO_MESSAGES.playback);
				return;
			}
			connection.renewSession().catch(() => {}).then(() => onRetry(true));
		};
		node.addEventListener('error', onError, true);
		return () => node.removeEventListener('error', onError, true);
	}, [connection, onRetry, retried]);

	const retry = useCallback(() => onRetry(false), [onRetry]);

	return (
		<div className={css.viewer} data-item-id={item.id} data-testid="video-viewer" ref={root}>
			{source && !failure ? (
				<VideoPlayer
					autoCloseTimeout={5000}
					backButtonAriaLabel="戻る"
					className={css.player}
					onBack={onClose}
					poster={poster}
					ref={player}
					title={longDate(item.takenAt)}
				>
					<source src={source} type={videoType(prepared)} />
					<infoComponents>{[describe(prepared), formatDuration(item.durationMs)].filter(Boolean).join('  ')}</infoComponents>
				</VideoPlayer>
			) : (
				<Waiting failure={failure} onClose={onClose} onRetry={retry} progress={progress} />
			)}
		</div>
	);
};

const VideoViewer = ({connection, item, onClose}) => {
	// automatic: the retry after a load error, which happens once; manual ones reset that.
	const [attempt, setAttempt] = useState({count: 0, automatic: false});

	useEffect(() => {
		connection.send({type: 'viewing', itemId: item.id});
	}, [connection, item.id]);

	const retry = useCallback((automatic) => {
		setAttempt((current) => ({count: current.count + 1, automatic}));
	}, []);

	return (
		<VideoSession
			connection={connection}
			item={item}
			key={item.id + ':' + attempt.count}
			onClose={onClose}
			onRetry={retry}
			retried={attempt.automatic}
		/>
	);
};

export default VideoViewer;
