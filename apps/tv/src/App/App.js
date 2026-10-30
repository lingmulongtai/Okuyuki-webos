import ThemeDecorator from '@enact/sandstone/ThemeDecorator';
import classnames from 'classnames';
import {useCallback, useEffect, useRef, useState} from 'react';

import appInfo from '../../webos-meta/appinfo.json';
import {detectCapabilities} from '../host/capabilities';
import {lastPhone, loadSettings, saveSettings} from '../host/storage';
import {packageVersion} from '../host/runtime-status';
import {checkUpdates, isReleaseNewer} from '../host/updates';
import {deviceInfo, exitApp, launchParams, onLaunch} from '../platform/webos';
import {Connection} from '../state/connection';
import {Library} from '../state/library';
import useStore from '../state/useStore';
import ConnectView from '../views/ConnectView';
import LibraryView from '../views/LibraryView';
import PhotoViewer from '../views/PhotoViewer';
import VideoViewer from '../views/VideoViewer';

import css from './App.module.less';

function clientName () {
	const info = deviceInfo();
	return ('LG ' + (info.modelName || 'webOS TV')).slice(0, 80);
}

function once (load) {
	let result = null;
	return () => {
		if (!result) result = load();
		return result;
	};
}

/** Names one connection to one phone; viewer state from an earlier connection is dropped. */
function sessionOf (state) {
	if (state.status !== 'ready') return null;
	return state.phone.deviceId + '@' + state.phone.host + ':' + state.phone.port;
}

/** `{host, port, deviceId}` from launch parameters, or null when they do not name a phone. */
function phoneFrom (params) {
	const port = Number(params && params.port);
	if (!params || typeof params.host !== 'string' || !params.host || !(port > 0 && port < 65536)) return null;
	return {host: params.host, port, deviceId: typeof params.deviceId === 'string' ? params.deviceId : null};
}

const AppBase = ({className, ...rest}) => {
	const [connection] = useState(() => new Connection({clientName: clientName(), capabilities: once(detectCapabilities)}));
	const [library] = useState(() => new Library(connection));
	const status = useStore(connection);
	const libraryState = useStore(library);
	const [settings, setSettings] = useState(loadSettings);
	const [update, setUpdate] = useState({status: 'checking'});
	const [runtimeUpdate, setRuntimeUpdate] = useState(() => typeof window === 'undefined' ? null : window.okuyukiRuntimeUpdateReady || null);
	const [runtimeStatus, setRuntimeStatus] = useState({status: 'checking'});
	const [runtimeVersion] = useState(() => window.okuyukiRuntimeVersion || appInfo.version);
	const [installedVersion] = useState(() => packageVersion(window.okuyukiUpdateConfig, appInfo.version));
	useEffect(() => {
		window.dispatchEvent(new Event('okuyuki-runtime-started'));
	}, []);
	const updateRequest = useRef(null);
	const runtimeRequest = useRef(null);
	const checkForUpdates = useCallback(() => {
		if (!updateRequest.current) {
			const controller = new AbortController();
			updateRequest.current = controller;
			const timeout = setTimeout(() => controller.abort(), 15000);
			setUpdate({status: 'checking'});
			checkUpdates(installedVersion, controller.signal).then((found) => {
				if (updateRequest.current === controller) setUpdate(found ? {status: 'available', version: found.version} : {status: 'current'});
			}).catch(() => {
				if (updateRequest.current === controller) setUpdate({status: 'error'});
			}).finally(() => {
				clearTimeout(timeout);
				if (updateRequest.current === controller) updateRequest.current = null;
			});
		}
		if (!runtimeRequest.current) {
			const request = {};
			runtimeRequest.current = request;
			setRuntimeStatus({status: 'checking'});
			Promise.resolve().then(() => typeof window.okuyukiCheckRuntimeUpdate === 'function' ? window.okuyukiCheckRuntimeUpdate() : {status: 'unavailable'}).then((result) => {
				if (runtimeRequest.current === request) setRuntimeStatus(result);
			}).catch(() => {
				if (runtimeRequest.current === request) setRuntimeStatus({status: 'error'});
			}).finally(() => {
				if (runtimeRequest.current === request) runtimeRequest.current = null;
			});
		}
	}, [installedVersion]);
	useEffect(() => {
		let active = true;
		Promise.resolve().then(() => {
			if (active) checkForUpdates();
		});
		const timer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
		return () => {
			active = false;
			clearInterval(timer);
			if (updateRequest.current) updateRequest.current.abort();
			updateRequest.current = null;
			runtimeRequest.current = null;
		};
	}, [checkForUpdates]);
	useEffect(() => {
		let active = true;
		const onRuntimeReady = (event) => {
			setRuntimeUpdate(event.detail);
			setRuntimeStatus({status: 'ready', version: event.detail});
		};
		window.addEventListener('okuyuki-runtime-ready', onRuntimeReady);
		Promise.resolve().then(() => {
			if (active && window.okuyukiRuntimeUpdateReady) onRuntimeReady({detail: window.okuyukiRuntimeUpdateReady});
		});
		return () => {
			active = false;
			window.removeEventListener('okuyuki-runtime-ready', onRuntimeReady);
		};
	}, []);
	// {session, list: Item[] | null (null: the library's current list), index, mode: 'photo' | 'video', fromGrid}
	const [viewerState, setViewer] = useState(null);
	// {session, index}: the grid item to focus when the grid comes back.
	const [gridState, setGridIndex] = useState(null);

	// Launch parameters from the phone win; otherwise try the phone used last time.
	useEffect(() => {
		const phone = phoneFrom(launchParams()) || lastPhone();
		if (phone) connection.connect(phone);
		return onLaunch((params) => {
			const target = phoneFrom(params);
			if (!target) return;
			const current = connection.getState();
			const same = current.phone && current.phone.host === target.host && current.phone.port === target.port;
			if (!same || current.status === 'error' || current.status === 'idle') connection.connect(target);
		});
	}, [connection]);

	const ready = status.status === 'ready';
	const session = sessionOf(status);
	const viewer = viewerState && viewerState.session === session ? viewerState : null;
	const focusIndex = gridState && gridState.session === session ? gridState.index : null;

	// Every new connection starts from a fresh library.
	useEffect(() => {
		if (session) library.reset();
	}, [session, library]);

	// The phone can ask the TV to show one of its photos or videos.
	useEffect(() => connection.onEvent(async (event) => {
		if (event.type !== 'show' || !event.itemId) return;
		const shownFor = sessionOf(connection.getState());
		const listed = library.current().items;
		const found = listed.findIndex((candidate) => candidate.id === event.itemId);
		let target = found >= 0 ? {list: null, index: found} : null;
		if (!target) {
			try {
				const fetched = await connection.request((client) => client.item(event.itemId));
				target = {list: [fetched], index: 0};
			} catch (error) {
				return;
			}
		}
		const shown = (target.list || listed)[target.index];
		setViewer({...target, session: shownFor, mode: shown.kind === 'video' ? 'video' : 'photo', fromGrid: false});
	}), [connection, library]);

	useEffect(() => {
		if (!viewer && ready) connection.send({type: 'viewing', itemId: null});
	}, [viewer, ready, connection]);

	const items = viewer && viewer.list ? viewer.list : libraryState.lists[libraryState.filter].items;

	const handleOpen = useCallback((index) => {
		const item = library.current().items[index];
		if (!item) return;
		setGridIndex({session, index});
		setViewer({session, list: null, index, mode: item.kind === 'video' ? 'video' : 'photo', fromGrid: true});
	}, [library, session]);

	const handleIndex = useCallback((index) => {
		setViewer((current) => current && {...current, index});
		// Back in the grid, focus lands on the last photo seen when it came from the grid's list.
		if (viewer && !viewer.list) setGridIndex({session, index});
	}, [viewer, session]);

	const handleClosePhoto = useCallback(() => setViewer(null), []);
	const handlePlay = useCallback(() => setViewer((current) => current && {...current, mode: 'video', fromGrid: false}), []);
	const handleCloseVideo = useCallback(() => {
		setViewer((current) => (current && !current.fromGrid ? {...current, mode: 'photo'} : null));
	}, []);
	const handleNeedMore = useCallback(() => {
		if (viewer && !viewer.list) library.loadMore();
	}, [viewer, library]);
	const handleSettings = useCallback((next) => {
		saveSettings(next);
		setSettings(next);
	}, []);
	const handleConnect = useCallback((phone) => connection.connect(phone), [connection]);
	const handleRetry = useCallback(() => connection.retry(), [connection]);
	const handleDisconnect = useCallback(() => connection.disconnect(), [connection]);
	const handleFilter = useCallback((filter) => {
		setGridIndex(null);
		library.setFilter(filter);
	}, [library]);
	const handleLoadMore = useCallback(() => library.loadMore(), [library]);

	let content;
	if (!ready) {
		content = (
			<ConnectView
				state={status}
				onCancel={handleDisconnect}
				onConnect={handleConnect}
				onRetry={handleRetry}
				onExit={exitApp}
				onUpdateCheck={checkForUpdates}
				runtimeStatus={runtimeStatus}
			/>
		);
	} else if (viewer && items[viewer.index] && viewer.mode === 'video') {
		content = (
			<VideoViewer
				connection={connection}
				item={items[viewer.index]}
				onClose={handleCloseVideo}
			/>
		);
	} else if (viewer && items[viewer.index]) {
		content = (
			<PhotoViewer
				bestQuality={settings.bestQuality}
				connection={connection}
				index={viewer.index}
				items={items}
				onClose={handleClosePhoto}
				onIndex={handleIndex}
				onNeedMore={handleNeedMore}
				onPlay={handlePlay}
				total={viewer.list ? viewer.list.length : libraryState.lists[libraryState.filter].total}
			/>
		);
	} else {
		content = (
			<LibraryView
				client={connection.client}
				focusIndex={focusIndex}
				library={libraryState}
				onDisconnect={handleDisconnect}
				onExit={exitApp}
				onFilter={handleFilter}
				onLoadMore={handleLoadMore}
				onOpen={handleOpen}
				onSettings={handleSettings}
				onUpdateCheck={checkForUpdates}
				phone={status.phone}
				sessionVersion={status.sessionVersion}
				settings={settings}
				runtimeStatus={runtimeStatus}
				runtimeVersion={runtimeVersion}
				installedVersion={installedVersion}
				update={update}
			/>
		);
	}

	return (
		<div {...rest} className={classnames(className, css.app, viewer && ready ? css.viewing : css.browsing)}>
			{content}
			{runtimeUpdate && !viewer ? (
				<div className={css.updateNotice} role="status">
					{'Okuyuki TV ' + runtimeUpdate + ' の更新を保存しました。次にアプリを開くと適用します。'}
				</div>
			) : null}
			{!runtimeUpdate && update.status === 'available' && isReleaseNewer(update.version, runtimeVersion) && !viewer ? (
				<div className={css.updateNotice} role="status">
					{'Okuyuki TV ' + update.version + ' が公開されました。PC で github.com/lingmulongtai/Okuyuki-webos/releases を開いて更新してください。'}
				</div>
			) : null}
		</div>
	);
};

// overlay: Sandstone paints no background, so photo and video screens can show the video plane.
export default ThemeDecorator({overlay: true}, AppBase);
