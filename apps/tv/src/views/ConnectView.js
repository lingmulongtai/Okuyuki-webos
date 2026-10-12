import BodyText from '@enact/sandstone/BodyText';
import Button from '@enact/sandstone/Button';
import {InputField} from '@enact/sandstone/Input';
import {Header, Panel, Panels} from '@enact/sandstone/Panels';
import Spinner from '@enact/sandstone/Spinner';
import {useCallback, useEffect, useState} from 'react';

import {parseAddress} from '../host/client';
import {onBackKey} from '../platform/webos';

import css from './ConnectView.module.less';

function phoneLabel (phone) {
	if (!phone) return 'スマホ';
	return phone.deviceName || phone.host + ':' + phone.port;
}

const Status = ({state, onRetry}) => {
	switch (state.status) {
		case 'connecting':
			return (
				<div className={css.status} data-status="connecting">
					<Spinner className={css.spinner} />
					<BodyText className={css.lead}>{phoneLabel(state.phone)} に接続しています…</BodyText>
				</div>
			);
		case 'pairing':
			return (
				<div className={css.status} data-status="pairing">
					<BodyText className={css.lead}>{phoneLabel(state.phone)} の Okuyuki に、同じ番号が出ています。</BodyText>
					<div className={css.code} data-testid="pair-code">{state.code}</div>
					<BodyText className={css.lead}>番号が同じなら、スマホで「許可」を押してください。</BodyText>
				</div>
			);
		case 'error':
			return (
				<div className={css.status} data-status="error">
					<BodyText className={css.lead}>{state.message}</BodyText>
					{state.phone ? <Button onClick={onRetry}>もう一度つなぐ</Button> : null}
				</div>
			);
		default:
			return (
				<div className={css.status} data-status="idle">
					<BodyText className={css.lead}>
						スマホの Okuyuki で「テレビで見る」を押すと、このテレビに自動でつながります。
					</BodyText>
				</div>
			);
	}
};

const ConnectView = ({state, onConnect, onRetry, onExit}) => {
	const [address, setAddress] = useState(() => (state.phone ? state.phone.host + ':' + state.phone.port : ''));
	const [invalid, setInvalid] = useState(false);

	useEffect(() => onBackKey(onExit), [onExit]);

	const submit = useCallback(() => {
		const phone = parseAddress(address);
		setInvalid(!phone);
		if (phone) onConnect(phone);
	}, [address, onConnect]);
	const handleChange = useCallback(({value}) => setAddress(value), []);

	return (
		<Panels noCloseButton>
			<Panel className={css.panel}>
				<Header noCloseButton subtitle="スマホの写真と動画を、このテレビの最高画質で" title="Okuyuki TV" />
				<Status onRetry={onRetry} state={state} />
				<div className={css.manual}>
					<BodyText size="small">
						自動でつながらないときは、スマホの Okuyuki に表示されたアドレス（例: 192.168.1.23:38765）を入力してください。
					</BodyText>
					<div className={css.row}>
						<InputField
							className={css.input}
							dismissOnEnter
							invalid={invalid}
							invalidMessage="「IP アドレス:ポート」の形で入力してください"
							onChange={handleChange}
							placeholder="192.168.1.23:38765"
							value={address}
						/>
						<Button onClick={submit}>接続</Button>
					</div>
				</div>
			</Panel>
		</Panels>
	);
};

export default ConnectView;
