/* Okuyuki 4K still test for LG webOS TVs.
 *
 * Answers four questions on a real TV before the viewer is built:
 * does a 4K HEVC still on the video plane look sharper than an <img> on the 1080p graphics plane,
 * do HDR10 and HLG stills switch the TV into HDR, how fast can stills be swapped,
 * and does UI drawn on the graphics plane composite over the video.
 */
'use strict';

(function () {
	var KEY = {
		LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, BACKSPACE: 8,
		PLAY: 415, PAUSE: 19, RED: 403, GREEN: 404, CHANNEL_UP: 33, CHANNEL_DOWN: 34,
	};
	var STRATEGIES = ['play-pause', 'first-frame', 'loop'];
	var STRATEGY_LABEL = {
		'play-pause': '再生してすぐ一時停止',
		'first-frame': '再生せず最初のフレームだけ',
		'loop': 'ループ再生',
	};
	var CODECS = [
		['HEVC Main 10 (hvc1)', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
		['HEVC Main 10 (hev1)', 'video/mp4; codecs="hev1.2.4.L153.B0"'],
		['HEVC Main (hvc1)', 'video/mp4; codecs="hvc1.1.6.L153.B0"'],
		['H.264 High 5.1', 'video/mp4; codecs="avc1.640033"'],
		['AV1 Main 10-bit', 'video/mp4; codecs="av01.0.13M.10"'],
		['VP9 Profile 2', 'video/webm; codecs="vp09.02.51.10"'],
		['Dolby Vision 5', 'video/mp4; codecs="dvh1.05.06"'],
	];
	var HDR_CONFIGS = [
		['HEVC 4K60 PQ', 'video/mp4; codecs="hvc1.2.4.L153.B0"', 'pq', 'smpteSt2086'],
		['HEVC 4K60 HLG', 'video/mp4; codecs="hvc1.2.4.L153.B0"', 'hlg', ''],
		['AV1 4K60 PQ', 'video/mp4; codecs="av01.0.13M.10"', 'pq', 'smpteSt2086'],
		['VP9.2 4K60 PQ', 'video/webm; codecs="vp09.02.51.10"', 'pq', 'smpteSt2086'],
	];
	var MEDIA_QUERIES = ['(dynamic-range: high)', '(video-dynamic-range: high)', '(color-gamut: p3)',
		'(color-gamut: rec2020)'];

	var $ = function (id) { return document.getElementById(id); };
	var menu = $('menu');
	var stage = $('stage');
	var panel = $('panel');
	var img = $('still-img');
	var videos = [$('video-a'), $('video-b')];
	var hud = $('hud');
	var help = $('help');
	var overlayDemo = $('overlay-demo');

	var manifest = null;
	var active = null;
	var hudVisible = true;
	var results = {
		app: 'okuyuki-still4k', version: '0.1.0', startedAt: new Date().toISOString(),
		environment: {}, formats: null, resolution: [], hdr: [], switching: { single: [], double: [] }, pc: [],
	};

	function since(t0) { return Math.round(performance.now() - t0); }
	function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
	function asset(name) { return 'assets/' + name; }

	function platform() { return window.webOSSystem || window.PalmSystem || null; }

	function deviceInfo() {
		var system = platform();
		if (!system || !system.deviceInfo) return null;
		try { return JSON.parse(system.deviceInfo); } catch (error) { return String(system.deviceInfo); }
	}

	function platformBack() {
		var system = platform();
		if (system && system.platformBack) system.platformBack();
		else window.close();
	}

	function setStatus(text) { $('menu-status').textContent = text; }

	// ------------------------------------------------------------- focus handling

	function focusables(container) {
		return Array.prototype.slice.call(container.querySelectorAll('button, input'));
	}

	function moveFocus(container, delta) {
		var items = focusables(container);
		if (!items.length) return;
		var index = items.indexOf(document.activeElement);
		var next = index < 0 ? 0 : Math.max(0, Math.min(items.length - 1, index + delta));
		items[next].focus();
	}

	// ------------------------------------------------------------- media helpers

	function describeError(error) {
		if (!error) return 'unknown error';
		var codes = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'source not supported' };
		return (codes[error.code] || ('code ' + error.code)) + (error.message ? ': ' + error.message : '');
	}

	function release(video) {
		video.pause();
		video.removeAttribute('src');
		video.load();
	}

	function releaseAll() {
		videos.forEach(release);
		img.removeAttribute('src');
		img.classList.add('hidden');
	}

	/** Load a still video and report how long each step took. */
	function loadVideo(video, src, strategy) {
		var t0 = performance.now();
		var metrics = {
			src: src, strategy: strategy, loadedmetadata: null, loadeddata: null, canplay: null,
			playing: null, firstFrame: null, error: null, timeout: false,
		};
		return new Promise(function (resolve) {
			var handlers = [];
			var finished = false;
			function on(type, fn) { video.addEventListener(type, fn); handlers.push([type, fn]); }
			function finish() {
				if (finished) return;
				finished = true;
				handlers.forEach(function (h) { video.removeEventListener(h[0], h[1]); });
				metrics.videoWidth = video.videoWidth;
				metrics.videoHeight = video.videoHeight;
				resolve(metrics);
			}
			// Give requestVideoFrameCallback a moment to report the presented frame.
			function finishSoon() { setTimeout(finish, 400); }

			on('loadedmetadata', function () { metrics.loadedmetadata = since(t0); });
			on('loadeddata', function () {
				metrics.loadeddata = since(t0);
				if (strategy === 'first-frame') finishSoon();
			});
			on('canplay', function () {
				if (metrics.canplay !== null) return;
				metrics.canplay = since(t0);
				if (strategy !== 'first-frame') {
					var played = video.play();
					if (played && played.catch) played.catch(function (error) { metrics.playError = String(error); });
				}
			});
			on('playing', function () {
				if (metrics.playing !== null) return;
				metrics.playing = since(t0);
				if (strategy === 'play-pause') video.pause();
				finishSoon();
			});
			on('error', function () { metrics.error = describeError(video.error); finish(); });
			if (typeof video.requestVideoFrameCallback === 'function') {
				video.requestVideoFrameCallback(function (now) { metrics.firstFrame = Math.round(now - t0); });
			} else {
				metrics.firstFrame = 'unsupported';
			}
			video.loop = strategy === 'loop';
			video.src = src;
			video.load();
			setTimeout(function () { metrics.timeout = true; finish(); }, 12000);
		});
	}

	function loadImage(src) {
		var t0 = performance.now();
		img.classList.remove('hidden');
		img.src = src;
		var decoded = img.decode ? img.decode() : new Promise(function (resolve, reject) {
			img.onload = resolve;
			img.onerror = reject;
		});
		return decoded.then(function () {
			return { src: src, decoded: since(t0), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
		}, function (error) {
			return { src: src, error: String(error) };
		});
	}

	function showOnly(video) {
		videos.forEach(function (v) { v.classList.toggle('inactive', v !== video); });
	}

	function formatMetrics(m) {
		if (!m) return '';
		if (m.error) return 'エラー: ' + m.error;
		var lines = [];
		if (m.decoded !== undefined) {
			lines.push('画像の読み込み: ' + m.decoded + ' ms（元 ' + m.naturalWidth + '×' + m.naturalHeight + '）');
			lines.push('表示: グラフィック面（' + window.innerWidth + '×' + window.innerHeight + '）');
			return lines.join('\n');
		}
		lines.push('動画: ' + m.videoWidth + '×' + m.videoHeight + '  方法: ' + STRATEGY_LABEL[m.strategy]);
		lines.push('metadata ' + m.loadedmetadata + ' ms / data ' + m.loadeddata + ' ms / canplay ' + m.canplay +
			' ms / playing ' + m.playing + ' ms');
		lines.push('最初のフレーム（rVFC）: ' + (m.firstFrame === null ? '通知なし' : m.firstFrame +
			(typeof m.firstFrame === 'number' ? ' ms' : '')));
		if (m.timeout) lines.push('12 秒以内に表示されませんでした');
		if (m.playError) lines.push('play(): ' + m.playError);
		return lines.join('\n');
	}

	function setHud(text) { hud.textContent = hudVisible ? text : ''; hud.dataset.text = text; }
	function toggleHud() { hudVisible = !hudVisible; hud.textContent = hudVisible ? (hud.dataset.text || '') : ''; }

	// ------------------------------------------------------------- screens

	function openStage(helpText, hudOnTop) {
		menu.classList.add('hidden');
		panel.classList.add('hidden');
		stage.classList.remove('hidden');
		stage.classList.toggle('hud-top', !!hudOnTop);
		overlayDemo.classList.add('hidden');
		help.textContent = helpText;
		setHud('');
	}

	function openPanel(title) {
		menu.classList.add('hidden');
		stage.classList.add('hidden');
		panel.classList.remove('hidden');
		$('panel-title').textContent = title;
		$('panel-controls').innerHTML = '';
		$('panel-text').textContent = '';
	}

	function backToMenu() {
		if (active && active.stop) active.stop();
		active = null;
		releaseAll();
		stage.classList.add('hidden');
		panel.classList.add('hidden');
		menu.classList.remove('hidden');
		var focused = menu.querySelector('.item[data-last="true"]') || menu.querySelector('.item');
		focused.focus();
	}

	// ------------------------------------------------------------- 1. resolution

	function cycleTest(entries, title, sink) {
		var index = 0;
		var strategy = 0;
		var token = 0;
		openStage('左右: 切り替え  上下: 表示方法  決定: 情報の表示/非表示  戻る: メニュー');

		function show() {
			var mine = ++token;
			var entry = entries[index];
			releaseAll();
			setHud(title + '  ' + (index + 1) + '/' + entries.length + '  ' + entry.label + '\n読み込み中…');
			var loading;
			if (entry.kind === 'image') {
				loading = loadImage(asset(entry.file));
			} else {
				showOnly(videos[0]);
				loading = loadVideo(videos[0], asset(entry.file), STRATEGIES[strategy]);
			}
			loading.then(function (metrics) {
				if (mine !== token) return;
				metrics.label = entry.label;
				sink.push(metrics);
				setHud(title + '  ' + (index + 1) + '/' + entries.length + '  ' + entry.label + '\n' + formatMetrics(metrics));
			});
		}

		show();
		return {
			onKey: function (code) {
				if (code === KEY.LEFT || code === KEY.RIGHT) {
					index = (index + (code === KEY.RIGHT ? 1 : entries.length - 1)) % entries.length;
					show();
				} else if (code === KEY.UP || code === KEY.DOWN) {
					strategy = (strategy + (code === KEY.DOWN ? 1 : STRATEGIES.length - 1)) % STRATEGIES.length;
					show();
				} else if (code === KEY.OK) {
					toggleHud();
				}
			},
			stop: function () { token++; },
		};
	}

	// ------------------------------------------------------------- 3. single video switching

	function singleSwitchTest() {
		var photos = manifest.photos;
		var index = 0;
		var token = 0;
		openStage('自動で 6 枚を順に表示した後、左右で切り替えられます。戻る: メニュー');

		function show(auto) {
			var mine = ++token;
			var photo = photos[index];
			var t0 = performance.now();
			showOnly(videos[0]);
			return loadVideo(videos[0], asset(photo.still), 'play-pause').then(function (metrics) {
				if (mine !== token) return;
				metrics.label = photo.label;
				metrics.total = since(t0);
				metrics.auto = auto;
				results.switching.single.push(metrics);
				setHud('video 1 つ  ' + photo.label + (auto ? '（自動）' : '') + '\n' + formatMetrics(metrics));
			});
		}

		var stopped = false;
		(async function run() {
			for (var i = 0; i < photos.length && !stopped; i++) {
				index = i;
				await show(true);
				await sleep(1500);
			}
			if (!stopped) setHud(hud.dataset.text + '\n自動テスト完了。左右で手動切り替えできます。');
		})();

		return {
			onKey: function (code) {
				if (code === KEY.LEFT || code === KEY.RIGHT) {
					index = (index + (code === KEY.RIGHT ? 1 : photos.length - 1)) % photos.length;
					show(false);
				} else if (code === KEY.OK) {
					toggleHud();
				}
			},
			stop: function () { stopped = true; token++; },
		};
	}

	// ------------------------------------------------------------- 4. double-buffered switching

	function doubleSwitchTest() {
		var photos = manifest.photos;
		var index = 0;
		var front = 0;
		var preload = null;
		var stopped = false;
		openStage('右: 次の写真（裏で先読みした video に切り替え）  左: 前  戻る: メニュー');

		function prepare(slot, photoIndex) {
			var video = videos[slot];
			var started = performance.now();
			var job = { slot: slot, index: photoIndex, ready: false, metrics: null };
			job.promise = loadVideo(video, asset(photos[photoIndex].still), 'play-pause').then(function (metrics) {
				metrics.preloadTotal = since(started);
				job.metrics = metrics;
				job.ready = !metrics.error && !metrics.timeout;
				return job;
			});
			return job;
		}

		function swapTo(job, direction) {
			var t0 = performance.now();
			front = job.slot;
			index = job.index;
			showOnly(videos[front]);
			requestAnimationFrame(function () {
				requestAnimationFrame(function () {
					var record = {
						label: photos[index].label, direction: direction, readyBeforeSwap: job.ready,
						swapToNextPaint: since(t0), preload: job.metrics,
					};
					results.switching.double.push(record);
					setHud('video 2 つ  ' + photos[index].label + '\n' +
						'先読み: ' + (job.ready ? job.metrics.preloadTotal + ' ms で完了' : '未完了') + '\n' +
						'切り替えから描画まで: ' + record.swapToNextPaint + ' ms\n' +
						(job.metrics ? formatMetrics(job.metrics) : ''));
					preload = prepare(1 - front, (index + 1) % photos.length);
				});
			});
		}

		var first = prepare(0, 0);
		showOnly(videos[0]);
		setHud('video 2 つ  読み込み中…');
		first.promise.then(function (job) {
			if (stopped) return;
			swapTo(job, 'start');
		});

		return {
			onKey: function (code) {
				if (stopped) return;
				if (code === KEY.RIGHT && preload) {
					var job = preload;
					preload = null;
					if (job.ready) swapTo(job, 'next');
					else job.promise.then(function (done) { if (!stopped) swapTo(done, 'next-after-wait'); });
				} else if (code === KEY.LEFT) {
					var target = (index + photos.length - 1) % photos.length;
					var slot = 1 - front;
					release(videos[slot]);
					preload = null;
					prepare(slot, target).promise.then(function (done) { if (!stopped) swapTo(done, 'previous'); });
				} else if (code === KEY.OK) {
					toggleHud();
				}
			},
			stop: function () { stopped = true; },
		};
	}

	// ------------------------------------------------------------- 5. overlay

	function overlayTest() {
		openStage('半透明の帯と文字が写真の上に見え、青いバーが滑らかに動くか確かめてください。戻る: メニュー', true);
		showOnly(videos[0]);
		overlayDemo.classList.remove('hidden');
		loadVideo(videos[0], asset(manifest.photos[0].still), 'play-pause').then(function (metrics) {
			results.overlay = { metrics: metrics };
			setHud(formatMetrics(metrics));
		});
		return {
			onKey: function (code) { if (code === KEY.OK) toggleHud(); },
			stop: function () { overlayDemo.classList.add('hidden'); },
		};
	}

	// ------------------------------------------------------------- 6. formats

	function probeImage(src) {
		return new Promise(function (resolve) {
			var probe = new Image();
			probe.onload = function () { resolve(probe.naturalWidth > 0); };
			probe.onerror = function () { resolve(false); };
			probe.src = src;
		});
	}

	function collectFormats() {
		var report = { canPlayType: {}, isTypeSupported: {}, decodingInfo: {}, mediaQueries: {}, images: {} };
		var probe = document.createElement('video');
		CODECS.forEach(function (entry) {
			report.canPlayType[entry[0]] = probe.canPlayType(entry[1]) || 'no';
			if (window.MediaSource && MediaSource.isTypeSupported) {
				report.isTypeSupported[entry[0]] = MediaSource.isTypeSupported(entry[1]);
			}
		});
		MEDIA_QUERIES.forEach(function (query) {
			report.mediaQueries[query] = window.matchMedia ? window.matchMedia(query).matches : 'unsupported';
		});
		var pending = [];
		if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
			HDR_CONFIGS.forEach(function (entry) {
				var video = {
					contentType: entry[1], width: 3840, height: 2160, bitrate: 40000000, framerate: 60,
					transferFunction: entry[2], colorGamut: 'rec2020',
				};
				if (entry[3]) video.hdrMetadataType = entry[3];
				pending.push(navigator.mediaCapabilities.decodingInfo({ type: 'file', video: video }).then(function (info) {
					report.decodingInfo[entry[0]] = { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
				}, function (error) {
					report.decodingInfo[entry[0]] = 'error: ' + error.message;
				}));
			});
		} else {
			report.decodingInfo = 'unsupported';
		}
		pending.push(probeImage(asset('chart.avif')).then(function (ok) { report.images.avif = ok; }));
		pending.push(probeImage('data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==')
			.then(function (ok) { report.images.webp = ok; }));
		return Promise.all(pending).then(function () { return report; });
	}

	function environment() {
		return {
			userAgent: navigator.userAgent,
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
			devicePixelRatio: window.devicePixelRatio,
			screen: window.screen ? { width: screen.width, height: screen.height } : null,
			deviceInfo: deviceInfo(),
			requestVideoFrameCallback: typeof HTMLVideoElement !== 'undefined' &&
				'requestVideoFrameCallback' in HTMLVideoElement.prototype,
		};
	}

	function yesNo(value) {
		if (value === true) return 'はい';
		if (value === false) return 'いいえ';
		return String(value);
	}

	function summarizeFormats(env, report) {
		var lines = [];
		var info = env.deviceInfo && typeof env.deviceInfo === 'object' ? env.deviceInfo : {};
		lines.push('画面: グラフィック ' + env.innerWidth + '×' + env.innerHeight + '、動画 ' +
			(info.screenWidth ? info.screenWidth + '×' + info.screenHeight : '不明') +
			(info.modelName ? '、機種 ' + info.modelName : '') + (info.sdkVersion ? '、webOS ' + info.sdkVersion : ''));
		lines.push('requestVideoFrameCallback: ' + yesNo(env.requestVideoFrameCallback));
		lines.push('');
		lines.push('動画の形式（canPlayType / MSE）');
		CODECS.forEach(function (entry) {
			var mse = report.isTypeSupported[entry[0]];
			lines.push('  ' + entry[0] + ': ' + report.canPlayType[entry[0]] + (mse === undefined ? '' : ' / ' + yesNo(mse)));
		});
		lines.push('');
		lines.push('4K60 HDR の再生（MediaCapabilities）');
		if (typeof report.decodingInfo === 'string') {
			lines.push('  ' + report.decodingInfo);
		} else {
			HDR_CONFIGS.forEach(function (entry) {
				var info2 = report.decodingInfo[entry[0]];
				lines.push('  ' + entry[0] + ': ' + (typeof info2 === 'object' ? '対応 ' + yesNo(info2.supported) +
					'、滑らか ' + yesNo(info2.smooth) + '、省電力 ' + yesNo(info2.powerEfficient) : info2));
			});
		}
		lines.push('');
		lines.push('メディアクエリ');
		MEDIA_QUERIES.forEach(function (query) { lines.push('  ' + query + ': ' + yesNo(report.mediaQueries[query])); });
		lines.push('');
		lines.push('画像: AVIF ' + yesNo(report.images.avif) + '、WebP ' + yesNo(report.images.webp));
		lines.push('');
		lines.push('UA: ' + env.userAgent);
		return lines.join('\n');
	}

	function formatsScreen() {
		openPanel('再生できる形式');
		$('panel-text').textContent = '調べています…';
		results.environment = environment();
		collectFormats().then(function (report) {
			results.formats = report;
			$('panel-text').textContent = summarizeFormats(results.environment, report);
		});
		return { onKey: function () {} };
	}

	// ------------------------------------------------------------- 7. own photos from a PC

	function pcBase() {
		try { return localStorage.getItem('still4k.pc') || 'http://192.168.1.10:8787'; } catch (error) { return 'http://192.168.1.10:8787'; }
	}

	function savePcBase(value) {
		try { localStorage.setItem('still4k.pc', value); } catch (error) { /* storage is optional */ }
	}

	function pcScreen() {
		openPanel('自分の写真で試す');
		var controls = $('panel-controls');
		var input = document.createElement('input');
		input.value = pcBase();
		input.setAttribute('aria-label', 'PC のアドレス');
		var load = document.createElement('button');
		load.textContent = '読み込む';
		controls.appendChild(input);
		controls.appendChild(load);
		$('panel-text').textContent =
			'PC で tools/still4k/serve.mjs を起動し、表示されたアドレスを入力して「読み込む」を押してください。\n' +
			'写真は tools/still4k/convert.py で 4K 静止画動画と 1080p JPEG に変換しておきます。';
		load.addEventListener('click', function () {
			var base = input.value.trim().replace(/\/+$/, '');
			savePcBase(base);
			$('panel-text').textContent = base + '/list.json を読み込んでいます…';
			fetch(base + '/list.json').then(function (response) {
				if (!response.ok) throw new Error('HTTP ' + response.status);
				return response.json();
			}).then(function (list) {
				if (!list.length) throw new Error('写真がありません');
				active = pcViewer(base, list);
			}, function (error) {
				$('panel-text').textContent = '読み込めませんでした: ' + error.message;
			});
		});
		input.focus();
		return { onKey: function () {} };
	}

	function pcViewer(base, list) {
		var index = 0;
		var useVideo = true;
		var token = 0;
		openStage('左右: 写真の切り替え  決定: 1080p 画像と 4K 動画の切り替え  戻る: メニュー');

		function show() {
			var mine = ++token;
			var item = list[index];
			releaseAll();
			var loading;
			if (useVideo) {
				showOnly(videos[0]);
				loading = loadVideo(videos[0], base + '/' + encodeURIComponent(item.still), 'play-pause');
			} else {
				loading = loadImage(base + '/' + encodeURIComponent(item.jpeg));
			}
			setHud(item.name + '  ' + (useVideo ? '4K 静止画動画' : '1080p JPEG') + '\n読み込み中…');
			loading.then(function (metrics) {
				if (mine !== token) return;
				metrics.label = item.name;
				results.pc.push(metrics);
				setHud(item.name + '  ' + (useVideo ? '4K 静止画動画' : '1080p JPEG') + '\n' + formatMetrics(metrics));
			});
		}

		show();
		return {
			onKey: function (code) {
				if (code === KEY.LEFT || code === KEY.RIGHT) {
					index = (index + (code === KEY.RIGHT ? 1 : list.length - 1)) % list.length;
					show();
				} else if (code === KEY.OK) {
					useVideo = !useVideo;
					show();
				}
			},
			stop: function () { token++; },
		};
	}

	// ------------------------------------------------------------- 8. results

	function resultsScreen() {
		openPanel('結果（CH+ / CH- でスクロール）');
		if (!results.environment.userAgent) results.environment = environment();
		var controls = $('panel-controls');
		var send = document.createElement('button');
		send.textContent = 'PC に送る';
		controls.appendChild(send);
		var text = JSON.stringify(results, null, 2);
		$('panel-text').textContent = text;
		send.addEventListener('click', function () {
			var base = pcBase().replace(/\/+$/, '');
			// text/plain keeps this a simple request, so no CORS preflight is needed.
			fetch(base + '/results', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text })
				.then(function (response) {
					$('panel-text').textContent = (response.ok ? base + ' に送りました' : '送信に失敗しました: HTTP ' + response.status) +
						'\n\n' + text;
				}, function (error) {
					$('panel-text').textContent = '送信に失敗しました: ' + error.message + '\n\n' + text;
				});
		});
		send.focus();
		return { onKey: function () {} };
	}

	// ------------------------------------------------------------- wiring

	var TESTS = {
		resolution: function () { return cycleTest(manifest.charts, '解像度', results.resolution); },
		hdr: function () { return cycleTest(manifest.hdr, 'HDR', results.hdr); },
		single: singleSwitchTest,
		double: doubleSwitchTest,
		overlay: overlayTest,
		formats: formatsScreen,
		pc: pcScreen,
		results: resultsScreen,
	};

	function start(name) {
		if (!manifest && name !== 'formats' && name !== 'results' && name !== 'pc') {
			setStatus('テスト素材がありません。npm run still4k:assets で作成してからパッケージしてください。');
			return;
		}
		Array.prototype.forEach.call(menu.querySelectorAll('.item'), function (item) {
			item.dataset.last = String(item.dataset.test === name);
		});
		hudVisible = true;
		active = TESTS[name]();
	}

	menu.addEventListener('click', function (event) {
		var target = event.target.closest('.item');
		if (target) start(target.dataset.test);
	});

	document.addEventListener('keydown', function (event) {
		var code = event.keyCode;
		var isBack = code === KEY.BACK || code === KEY.ESC ||
			(code === KEY.BACKSPACE && document.activeElement.tagName !== 'INPUT');
		if (isBack) {
			event.preventDefault();
			if (!menu.classList.contains('hidden')) platformBack();
			else backToMenu();
			return;
		}
		if (!menu.classList.contains('hidden')) {
			if (code === KEY.UP || code === KEY.DOWN) {
				event.preventDefault();
				moveFocus(menu, code === KEY.DOWN ? 1 : -1);
			}
			return;
		}
		if (!panel.classList.contains('hidden')) {
			var text = $('panel-text');
			var hasControls = focusables(panel).length > 0;
			if (code === KEY.CHANNEL_UP || code === KEY.CHANNEL_DOWN || (!hasControls && (code === KEY.UP || code === KEY.DOWN))) {
				event.preventDefault();
				text.scrollTop += (code === KEY.DOWN || code === KEY.CHANNEL_DOWN ? 1 : -1) * 300;
			} else if (code === KEY.UP || code === KEY.DOWN || ((code === KEY.LEFT || code === KEY.RIGHT) &&
					document.activeElement.tagName !== 'INPUT')) {
				event.preventDefault();
				moveFocus(panel, code === KEY.DOWN || code === KEY.RIGHT ? 1 : -1);
			}
			return;
		}
		if (active && active.onKey) {
			event.preventDefault();
			active.onKey(code);
		}
	});

	document.addEventListener('visibilitychange', function () {
		if (document.hidden && menu.classList.contains('hidden')) backToMenu();
	});

	manifest = window.STILL4K_MANIFEST || null;
	if (manifest) {
		setStatus('テスト素材: 解像度 ' + manifest.charts.length + ' 種類、HDR ' + manifest.hdr.length + ' 種類、写真 ' +
			manifest.photos.length + ' 枚');
	} else {
		setStatus('テスト素材がありません。npm run still4k:assets で作成してからパッケージしてください。');
	}

	menu.querySelector('.item').focus();
	window.okuyukiStill4k = { results: results, start: start, backToMenu: backToMenu };
})();
