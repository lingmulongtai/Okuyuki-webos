import {InputField} from '@enact/sandstone/Input';
import Spinner from '@enact/sandstone/Spinner';
import Spotlight from '@enact/spotlight';
import classnames from 'classnames';
import {useCallback, useEffect, useState} from 'react';

import Action from '../components/Action';
import {Wordmark} from '../components/Brand';
import Copy from '../components/Copy';
import {named} from '../components/format';
import Glyph from '../components/Glyph';
import {parseAddress} from '../host/client';
import {runtimeMessage} from '../host/runtime-status';
import {onBackKey} from '../platform/webos';

import css from './ConnectView.module.less';

// The phone's own words for each step, as in its "つなぐ" tab.
const STEPS = [
	'スマホで Okuyuki を開く',
	'「つなぐ」タブで「接続を待つ」をオンにする',
	'「テレビで見る」で、このテレビの「開く」を押す'
];

const phoneName = (phone) => (phone && phone.deviceName) || 'スマホ';
const phoneAddress = (phone) => (phone ? phone.host + ':' + phone.port : '');

const Bubble = ({icon, tone}) => (
	<div className={classnames(css.bubble, tone === 'error' && css.error)}>
		<Glyph className={css.bubbleGlyph} name={icon} />
	</div>
);

/** The four digits the phone shows too, one box each like on the phone. */
const Digits = ({code}) => (
	<div aria-label={'確認番号 ' + code.split('').join(' ')} className={css.digits} data-testid="pair-code" role="img">
		{code.split('').map((digit, position) => (
			<span className={css.digit} key={'digit' + position}>{digit}</span>
		))}
	</div>
);

const Status = ({state, onCancel, onRetry}) => {
	const phone = state.phone;
	switch (state.status) {
		case 'connecting':
			return (
				<div className={css.status} data-status="connecting">
					<Spinner className={css.spinner} />
					<h2 className={css.statusTitle}>{named(phoneName(phone), 'につないでいます…')}</h2>
					<p className={css.statusBody}>{phoneAddress(phone)}</p>
					<Action data-action="cancel" onClick={onCancel}>やめる</Action>
				</div>
			);
		case 'pairing':
			return (
				<div className={css.status} data-status="pairing">
					<h2 className={css.statusTitle}>スマホで許可してください</h2>
					<p className={css.statusBody}>
						<Copy>{named(phoneName(phone), 'に同じ番号が出ていれば、スマホで「許可する」を押してください。')}</Copy>
					</p>
					<Digits code={state.code || ''} />
					<div className={css.waiting}>
						<Spinner className={css.smallSpinner} size="small" />
						<span>スマホの操作を待っています</span>
					</div>
					<Action data-action="cancel" onClick={onCancel}>やめる</Action>
				</div>
			);
		case 'error':
			return (
				<div className={css.status} data-status="error">
					<Bubble icon="alert" tone="error" />
					<h2 className={css.statusTitle}>スマホとつながっていません</h2>
					<p className={css.statusBody}><Copy>{state.message}</Copy></p>
					{phone ? <Action data-action="retry" kind="primary" onClick={onRetry}>もう一度つなぐ</Action> : null}
				</div>
			);
		default:
			return (
				<div className={css.status} data-status="idle">
					<Bubble icon="phone" />
					<h2 className={css.statusTitle}>スマホを待っています</h2>
					<p className={css.statusBody}><Copy>スマホの Okuyuki で「開く」を押すと、自動でつながります。</Copy></p>
				</div>
			);
	}
};

/** The way in when the phone cannot open the app itself: the address the phone shows. */
const AddressEntry = ({initial, onConnect}) => {
	const [address, setAddress] = useState(initial);
	const [invalid, setInvalid] = useState(false);

	const submit = useCallback(() => {
		const phone = parseAddress(address);
		setInvalid(!phone);
		if (phone) onConnect(phone);
	}, [address, onConnect]);
	const handleChange = useCallback(({value}) => {
		setAddress(value);
		setInvalid(false);
	}, []);
	// Enter on the TV's keyboard closes it and connects straight away.
	const handleKeyUp = useCallback((event) => {
		if (event.keyCode === 13 && event.target.tagName === 'INPUT') submit();
	}, [submit]);

	return (
		<section className={css.card}>
			<h2 className={css.cardTitle}>アドレスを入力してつなぐ</h2>
			<p className={css.cardBody}>スマホの「つなぐ」タブの下にある、<br />「自動で見つからないとき」のアドレスを入力してください。</p>
			<div className={css.row}>
				<InputField
					className={css.input}
					dismissOnEnter
					onChange={handleChange}
					onKeyUp={handleKeyUp}
					placeholder="192.168.1.23:38765"
					value={address}
				/>
				<Action data-action="connect" kind="primary" onClick={submit}>つなぐ</Action>
			</div>
			{invalid ? <p className={css.invalid} role="alert">スマホに出ているアドレスを、そのまま入力してください。</p> : null}
		</section>
	);
};

// Where the remote goes when the screen changes: the one thing to do next.
const FOCUS = {
	idle: (input) => '.' + input,
	connecting: () => '[data-action="cancel"]',
	pairing: () => '[data-action="cancel"]',
	error: (input, phone) => (phone ? '[data-action="retry"]' : '.' + input)
};

const ConnectView = ({state, onCancel, onConnect, onExit, onRetry, onUpdateCheck, runtimeStatus, runtimeUpdate}) => {
	const typing = state.status === 'idle' || state.status === 'error';

	useEffect(() => onBackKey(onExit), [onExit]);

	useEffect(() => {
		Spotlight.focus(FOCUS[state.status](css.input, state.phone));
	}, [state.status, state.phone]);

	return (
		<div className={css.view}>
			<Wordmark className={css.header} />
			<div className={css.intro}>
				<h1 className={css.title}>スマホとつなぐ</h1>
				<p className={css.lead}>スマホの写真と動画を、テレビの最高画質で見られます。</p>
				<ol className={css.steps}>
					{STEPS.map((step, index) => (
						<li className={css.step} key={step}>
							<span className={css.number}>{index + 1}</span>
							<span>{step}</span>
						</li>
					))}
				</ol>
				<div className={css.notes}>
					<p className={css.note}>
						<Glyph className={css.noteGlyph} name="wifi" />
						<span>テレビとスマホを同じネットワークにつないでください。<br />テレビは有線&nbsp;LAN でもかまいません。</span>
					</p>
					<p className={css.note}>
						<Glyph className={css.noteGlyph} name="lock" />
						<span>写真はクラウドを通らず、テレビにも残りません。</span>
					</p>
					<Action onClick={onUpdateCheck}>更新を確認</Action>
					<p className={css.note} data-testid="runtime-status">{runtimeMessage(runtimeStatus, runtimeUpdate)}</p>
				</div>
			</div>
			<div className={css.side}>
				<section className={css.card}>
					<Status onCancel={onCancel} onRetry={onRetry} state={state} />
				</section>
				{typing ? <AddressEntry initial={phoneAddress(state.phone)} onConnect={onConnect} /> : null}
			</div>
		</div>
	);
};

export default ConnectView;
