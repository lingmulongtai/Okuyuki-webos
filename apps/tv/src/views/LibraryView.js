import Popup from '@enact/sandstone/Popup';
import Spinner from '@enact/sandstone/Spinner';
import SwitchItem from '@enact/sandstone/SwitchItem';
import {VirtualGridList} from '@enact/sandstone/VirtualList';
import Spotlight from '@enact/spotlight';
import Spottable from '@enact/spotlight/Spottable';
import ri from '@enact/ui/resolution';
import classnames from 'classnames';
import {useCallback, useEffect, useRef, useState} from 'react';

import appInfo from '../../webos-meta/appinfo.json';
import Action from '../components/Action';
import {BrandMark} from '../components/Brand';
import Copy from '../components/Copy';
import {shortDate, tileBadges} from '../components/format';
import Glyph from '../components/Glyph';
import {onBackKey} from '../platform/webos';

import css from './LibraryView.module.less';

const FILTERS = [
	['all', 'すべて'],
	['photo', '写真'],
	['video', '動画'],
	['stereo', '3D']
];

const EMPTY = {
	all: ['photo', '写真や動画がありません', 'スマホのギャラリーにある写真と動画が、ここに新しい順に並びます。'],
	photo: ['photo', '写真がありません', 'スマホのギャラリーにある写真が、ここに新しい順に並びます。'],
	video: ['play', '動画がありません', 'スマホのギャラリーにある動画が、ここに新しい順に並びます。'],
	stereo: ['cube', '3D 写真がありません', 'Galaxy で撮った 3D 写真がここに並びます。テレビでは平面で表示します。']
};

// Start loading the next page while this many items are still below the last one drawn.
const PREFETCH_ITEMS = 18;

const Message = ({action, body, icon, title, tone}) => (
	<div className={css.message}>
		<div className={classnames(css.bubble, tone === 'error' && css.error)}>
			<Glyph className={css.bubbleGlyph} name={icon} />
		</div>
		<h2 className={css.messageTitle}>{title}</h2>
		<p className={css.messageBody}><Copy>{body}</Copy></p>
		{action}
	</div>
);

const Empty = ({filter, list, onRetry}) => {
	if (list.error) {
		return (
			<Message
				action={<Action kind="primary" onClick={onRetry}>もう一度読み込む</Action>}
				body={list.error}
				icon="alert"
				title="一覧を読み込めませんでした"
				tone="error"
			/>
		);
	}
	if (!list.loaded || list.loading) {
		return (
			<div className={css.message}>
				<Spinner className={css.spinner} />
				<p className={css.messageBody}>読み込んでいます…</p>
			</div>
		);
	}
	const [icon, title, body] = EMPTY[filter];
	return <Message body={body} icon={icon} title={title} />;
};

const Chip = ({filter, label, onFilter, selected}) => {
	const handleClick = useCallback(() => onFilter(filter), [filter, onFilter]);
	return <Action data-filter={filter} kind="chip" onClick={handleClick} selected={selected}>{label}</Action>;
};

/** A thumbnail fades in once it has arrived; one that cannot be shown keeps a placeholder. */
const Thumb = ({src}) => {
	const [state, setState] = useState('loading');
	const handleLoad = useCallback(() => setState('loaded'), []);
	const handleError = useCallback(() => setState('error'), []);
	if (state === 'error') return <Glyph className={css.missing} name="photo" />;
	return (
		<img
			alt=""
			className={classnames(css.thumb, state === 'loaded' && css.loaded)}
			onError={handleError}
			onLoad={handleLoad}
			src={src}
		/>
	);
};

const TileBase = ({className, client, index, item, nearEnd, onLoadMore, onOpen, ...rest}) => {
	// Items are recycled while scrolling, so this runs whenever an item near the end is drawn.
	useEffect(() => {
		if (nearEnd) onLoadMore();
	}, [nearEnd, onLoadMore]);
	const handleClick = useCallback(() => onOpen(index), [index, onOpen]);
	const {duration, marks} = tileBadges(item);
	const date = shortDate(item.takenAt);
	return (
		<div
			{...rest}
			aria-label={[item.kind === 'video' ? '動画' : '写真', duration, ...marks, date].filter(Boolean).join(' ')}
			className={classnames(css.tile, className)}
			data-item-id={item.id}
			onClick={handleClick}
			role="button"
		>
			<div className={css.picture}>
				<Thumb key={item.id} src={client.thumbUrl(item.id)} />
				{marks.length ? (
					<div className={css.marks}>
						{marks.map((mark) => <span className={css.badge} key={mark}>{mark}</span>)}
					</div>
				) : null}
				{duration ? (
					<span className={classnames(css.badge, css.duration)}>
						<Glyph className={css.play} name="play" />
						{duration}
					</span>
				) : null}
			</div>
			<div className={css.caption}>{date}</div>
		</div>
	);
};

const Tile = Spottable(TileBase);

function updateMessage (update) {
	if (update.status === 'checking') return '更新を確認中…';
	if (update.status === 'error') return '更新を確認できませんでした。';
	if (update.status === 'available') return '新しいバージョン ' + update.version + ' があります。';
	return '最新版です。';
}

const Settings = ({onClose, onDisconnect, onSettings, onUpdateCheck, phone, settings, update}) => {
	const toggleBestQuality = useCallback(() => {
		onSettings({...settings, bestQuality: !settings.bestQuality});
	}, [onSettings, settings]);
	const disconnect = useCallback(() => {
		onClose();
		onDisconnect();
	}, [onClose, onDisconnect]);
	return (
		<div className={css.settings}>
			<h2 className={css.sheetTitle}>設定</h2>
			<section className={css.group}>
				<h3 className={css.groupTitle}>表示</h3>
				<SwitchItem className={css.switch} onToggle={toggleBestQuality} selected={settings.bestQuality}>
					写真を最高画質（4K）で表示する
				</SwitchItem>
				<p className={css.note}>
					オンにすると、まず標準画質で出し、スマホで 4K の準備ができたら切り替えます。オフにすると、標準画質（1920×1080）だけで表示します。
				</p>
			</section>
			<section className={css.group}>
				<h3 className={css.groupTitle}>つないでいるスマホ</h3>
				<div className={css.device}>
					<Glyph className={css.deviceGlyph} name="phone" />
					<div>
						<div className={css.deviceName}>{phone.deviceName || 'スマホ'}</div>
						<div className={css.note}>{phone.host + ':' + phone.port}</div>
					</div>
				</div>
				<Action className={css.disconnect} onClick={disconnect}>切断</Action>
				<p className={css.note}>切断しても、次に Okuyuki TV を開くと、このスマホに自動でつながります。</p>
			</section>
			<section className={css.group}>
				<h3 className={css.groupTitle}>このアプリについて</h3>
				<p className={css.note}>{'Okuyuki TV ' + appInfo.version}</p>
				<p className={css.note}>{updateMessage(update)}</p>
				<Action onClick={onUpdateCheck}>更新を確認</Action>
				<p className={css.note}>開発版の更新は PC の開発者ツールからインストールします。</p>
			</section>
		</div>
	);
};

const LibraryView = ({
	client,
	focusIndex,
	library,
	onDisconnect,
	onExit,
	onFilter,
	onLoadMore,
	onOpen,
	onSettings,
	onUpdateCheck,
	phone,
	sessionVersion,
	settings,
	update
}) => {
	const list = library.lists[library.filter];
	const view = useRef(null);
	const scrollTo = useRef(null);
	const [exitOpen, setExitOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// Back closes the settings, otherwise asks before leaving the app (and a second Back cancels).
	useEffect(() => onBackKey(() => {
		if (settingsOpen) setSettingsOpen(false);
		else setExitOpen((open) => !open);
	}), [settingsOpen]);

	// When the grid appears, the remote starts on the photo shown last, or on the newest one
	// unless it already moved somewhere else on this screen (a filter, say).
	const hasItems = list.items.length > 0;
	useEffect(() => {
		if (!hasItems || !scrollTo.current) return;
		const returning = focusIndex !== null && focusIndex < list.items.length;
		const current = Spotlight.getCurrent();
		if (!returning && current && view.current && view.current.contains(current)) return;
		scrollTo.current({index: returning ? focusIndex : 0, animate: false, focus: true});
		// Only when the grid first appears.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hasItems, library.filter]);

	const items = list.items;
	const renderItem = useCallback(({index, ...rest}) => (
		<Tile
			{...rest}
			client={client}
			index={index}
			item={items[index]}
			nearEnd={index >= items.length - PREFETCH_ITEMS}
			onLoadMore={onLoadMore}
			onOpen={onOpen}
		/>
		// sessionVersion stands for the media key inside the thumbnail URLs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	), [items, client, onLoadMore, onOpen, sessionVersion]);

	const setScrollTo = useCallback((fn) => {
		scrollTo.current = fn;
	}, []);
	const openSettings = useCallback(() => setSettingsOpen(true), []);
	const closeSettings = useCallback(() => setSettingsOpen(false), []);
	const closeExit = useCallback(() => setExitOpen(false), []);

	return (
		<div className={css.view} ref={view}>
			<header className={css.header}>
				<div className={css.heading}>
					<BrandMark className={css.mark} />
					<h1 className={css.title}>ライブラリ</h1>
					{list.total === null ? null : <span className={css.count} data-testid="library-count">{list.total + ' 件'}</span>}
				</div>
				<div className={css.tools}>
					<div className={css.phone} data-testid="phone-name">
						<span className={css.dot} />
						{phone.deviceName || phone.host}
					</div>
					<Action icon="tune" label="設定" onClick={openSettings} />
				</div>
			</header>
			<nav className={css.filters}>
				{FILTERS.map(([filter, label]) => (
					<Chip
						filter={filter}
						key={filter}
						label={label}
						onFilter={onFilter}
						selected={library.filter === filter}
					/>
				))}
			</nav>
			<div className={css.body}>
				{items.length ? (
					<VirtualGridList
						cbScrollTo={setScrollTo}
						className={css.grid}
						dataSize={items.length}
						itemRenderer={renderItem}
						itemSize={{minWidth: ri.scale(660), minHeight: ri.scale(600)}}
						key={library.filter}
						spacing={ri.scale(12)}
					/>
				) : (
					<Empty filter={library.filter} list={list} onRetry={onLoadMore} />
				)}
			</div>
			<Popup className={css.dialog} onClose={closeExit} open={exitOpen} position="center">
				<div className={css.confirm}>
					<BrandMark className={css.confirmMark} />
					<h2 className={css.confirmTitle}>Okuyuki TV を終了しますか？</h2>
					<div className={css.confirmButtons}>
						<Action kind="primary" onClick={onExit}>終了</Action>
						<Action onClick={closeExit}>キャンセル</Action>
					</div>
				</div>
			</Popup>
			<Popup className={css.sheet} onClose={closeSettings} open={settingsOpen} position="right">
				<Settings
					onClose={closeSettings}
					onDisconnect={onDisconnect}
					onSettings={onSettings}
					onUpdateCheck={onUpdateCheck}
					phone={phone}
					settings={settings}
					update={update}
				/>
			</Popup>
		</div>
	);
};

export default LibraryView;
