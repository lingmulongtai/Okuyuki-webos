import Spottable from '@enact/spotlight/Spottable';
import classnames from 'classnames';

import Glyph from './Glyph';

import css from './Action.module.less';

/**
 * A button for the remote: `primary` for the one thing to do next, `tonal` for the rest, `chip`
 * for a filter (with `selected`). Without children it is a round icon button named by `label`.
 * The OK key clicks it, and it grows and turns white while it has focus.
 */
const ActionBase = ({children, className, disabled, icon, kind = 'tonal', label, onClick, selected, ...rest}) => (
	<div
		{...rest}
		aria-disabled={disabled || null}
		aria-label={label}
		aria-pressed={kind === 'chip' ? Boolean(selected) : null}
		className={classnames(css.action, css[kind], {[css.selected]: selected, [css.round]: !children}, className)}
		onClick={disabled ? null : onClick}
		role="button"
	>
		{icon ? <Glyph className={css.icon} name={icon} /> : null}
		{children ? <span className={css.text}>{children}</span> : null}
	</div>
);

const Action = Spottable(ActionBase);

export default Action;
