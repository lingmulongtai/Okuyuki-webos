import classnames from 'classnames';

import css from './Brand.module.less';

/**
 * The app's mark, as on the phone and Quest: two squares overlapping in depth, the shared part in
 * the page's ink. The overlap keeps the front square's corner at its top left and the back
 * square's at its bottom right.
 */
export const BrandMark = ({className}) => (
	<svg aria-hidden="true" className={classnames(css.mark, className)} viewBox="0 0 100 100">
		<rect fill="#2747e6" height="64" rx="10.24" width="64" />
		<rect fill="#e8603f" height="64" rx="10.24" width="64" x="36" y="36" />
		<path d="M46.24 36H64V53.76A10.24 10.24 0 0 1 53.76 64H36V46.24A10.24 10.24 0 0 1 46.24 36Z" fill="#0b0d12" />
	</svg>
);

/** The mark with the app's name, at the top left of the screens that are not a photo. */
export const Wordmark = ({className}) => (
	<div className={classnames(css.wordmark, className)}>
		<BrandMark className={css.small} />
		<span>Okuyuki TV</span>
	</div>
);
