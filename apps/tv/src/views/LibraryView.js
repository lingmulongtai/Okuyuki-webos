import Alert from '@enact/sandstone/Alert';
import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import ImageItem from '@enact/sandstone/ImageItem';
import {Header, Panel, Panels} from '@enact/sandstone/Panels';
import Popup from '@enact/sandstone/Popup';
import Spinner from '@enact/sandstone/Spinner';
import SwitchItem from '@enact/sandstone/SwitchItem';
import {VirtualGridList} from '@enact/sandstone/VirtualList';
import ri from '@enact/ui/resolution';
import {useCallback, useEffect, useRef, useState} from 'react';

import {formatDate, itemBadges} from '../components/format';
import {onBackKey} from '../platform/webos';

import css from './LibraryView.module.less';

const FILTERS = [
	['all', 'すべて'],
	['photo', '写真'],
	['video', '動画'],
	['stereo', '3D']
];

// Start loading the next page while this many items are still below the last one drawn.
const PREFETCH_ITEMS = 18;

const Empty = ({list, filter, onRetry}) => {
	if (list.error) {
		return (
			<div className={css.empty}>
				<BodyText>{list.error}</BodyText>
				<Button onClick={onRetry}>もう一度読み込む</Button>
			</div>
		);
	}
	if (!list.loaded || list.loading) {
		return (
			<div className={css.empty}>
				<Spinner>読み込んでいます…</Spinner>
			</div>
		);
	}
	const label = FILTERS.find(([value]) => value === filter)[1];
	return (
		<div className={css.empty}>
			<BodyText>{filter === 'all' ? 'スマホに写真や動画がありません。' : label + 'はありません。'}</BodyText>
		</div>
	);
};

const FilterButton = ({filter, label, onFilter, selected}) => {
	const handleClick = useCallback(() => onFilter(filter), [filter, onFilter]);
	return (
		<Button className={css.filter} data-filter={filter} onClick={handleClick} selected={selected} size="small">
			{label}
		</Button>
	);
};

const LibraryItem = ({client, index, item, nearEnd, onLoadMore, onOpen, ...rest}) => {
	// Items are recycled while scrolling, so this runs whenever an item near the end is drawn.
	useEffect(() => {
		if (nearEnd) onLoadMore();
	}, [nearEnd, onLoadMore]);
	const handleClick = useCallback(() => onOpen(index), [index, onOpen]);
	return (
		<ImageItem
			{...rest}
			className={css.item}
			data-item-id={item.id}
			label={itemBadges(item) || ' '}
			onClick={handleClick}
			src={client.thumbUrl(item.id)}
		>
			{formatDate(item.takenAt)}
		</ImageItem>
	);
};

const LibraryView = ({
	client,
	focusIndex,
	library,
	onExit,
	onFilter,
	onLoadMore,
	onOpen,
	onSettings,
	phone,
	sessionVersion,
	settings
}) => {
	const list = library.lists[library.filter];
	const scrollTo = useRef(null);
	const [exitOpen, setExitOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// Back closes the settings, otherwise asks before leaving the app (and a second Back cancels).
	useEffect(() => onBackKey(() => {
		if (settingsOpen) setSettingsOpen(false);
		else setExitOpen((open) => !open);
	}), [settingsOpen]);

	// Coming back from the viewer, focus the photo that was shown last.
	const hasItems = list.items.length > 0;
	useEffect(() => {
		if (hasItems && focusIndex !== null && focusIndex < list.items.length && scrollTo.current) {
			scrollTo.current({index: focusIndex, animate: false, focus: true});
		}
		// Only when the grid first appears.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hasItems, library.filter]);

	const items = list.items;
	const renderItem = useCallback(({index, ...rest}) => (
		<LibraryItem
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
	const toggleBestQuality = useCallback(() => {
		onSettings({...settings, bestQuality: !settings.bestQuality});
	}, [onSettings, settings]);

	const total = list.total === null ? '' : '・' + list.total + ' 件';

	return (
		<Panels noCloseButton>
			<Panel className={css.panel}>
				<Header
					noCloseButton
					slotAfter={<Button icon="gear" onClick={openSettings} size="small">設定</Button>}
					subtitle={(phone.deviceName || phone.host) + total}
					title="ライブラリ"
					type="compact"
				/>
				<div className={css.filters}>
					{FILTERS.map(([filter, label]) => (
						<FilterButton
							filter={filter}
							key={filter}
							label={label}
							onFilter={onFilter}
							selected={library.filter === filter}
						/>
					))}
				</div>
				{items.length ? (
					<VirtualGridList
						cbScrollTo={setScrollTo}
						className={css.grid}
						dataSize={items.length}
						itemRenderer={renderItem}
						itemSize={{minWidth: ri.scale(640), minHeight: ri.scale(540)}}
						key={library.filter}
						spacing={ri.scale(24)}
					/>
				) : (
					<Empty filter={library.filter} list={list} onRetry={onLoadMore} />
				)}
				<Alert onClose={closeExit} open={exitOpen} type="overlay">
					Okuyuki TV を終了しますか？
					<buttons>
						<Button onClick={onExit}>終了</Button>
						<Button onClick={closeExit}>キャンセル</Button>
					</buttons>
				</Alert>
				<Popup onClose={closeSettings} open={settingsOpen}>
					<div className={css.settings}>
						<SwitchItem
							onToggle={toggleBestQuality}
							selected={settings.bestQuality}
						>
							写真を最高画質（4K）で表示する
						</SwitchItem>
						<BodyText size="small">
							オンにすると、まず標準画質を出し、スマホで 4K の準備ができたら切り替えます。オフにすると標準画質（1920×1080）だけで表示します。
						</BodyText>
					</div>
				</Popup>
			</Panel>
		</Panels>
	);
};

export default LibraryView;
