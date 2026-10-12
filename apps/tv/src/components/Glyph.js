import classnames from 'classnames';

import css from './Glyph.module.less';

// The phone and Quest apps' line icons: a 24 unit grid, 1.8 unit strokes with round ends.
// A dot is a very short line, which the round caps turn into a circle.
const LINES = {
	alert: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7.5V13M12 16.3h0.01" />
		</>
	),
	check: <path d="M5 12.5L9.5 17L19 7.5" />,
	chevronLeft: <path d="M14.5 6L8.5 12L14.5 18" />,
	chevronRight: <path d="M9.5 6L15.5 12L9.5 18" />,
	cube: <path d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5ZM4 7.5L12 12L20 7.5M12 12V21" />,
	info: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11V16.5M12 7.8h0.01" />
		</>
	),
	lock: (
		<>
			<rect height="10" rx="2.5" width="14" x="5" y="10.5" />
			<path d="M8.5 10.5V8A3.5 3.5 0 0 1 15.5 8V10.5" />
		</>
	),
	phone: (
		<>
			<rect height="19" rx="2.8" width="11" x="6.5" y="2.5" />
			<path d="M10.5 18.2H13.5" />
		</>
	),
	photo: (
		<>
			<rect height="15" rx="2.5" width="17" x="3.5" y="4.5" />
			<path d="M3.8 16.2L8.5 11.5L13.2 16.2M11.6 14.6L14.5 11.8L20.2 17.2" />
			<circle cx="15.5" cy="8.3" r="1.3" />
		</>
	),
	tune: (
		<>
			<path d="M4 7H7.6M12.4 7H20M4 12H13.6M18.4 12H20M4 17H5.6M10.4 17H20" />
			<circle cx="10" cy="7" r="2.2" />
			<circle cx="16" cy="12" r="2.2" />
			<circle cx="8" cy="17" r="2.2" />
		</>
	),
	tv: (
		<>
			<rect height="12" rx="2.5" width="18" x="3" y="4.5" />
			<path d="M8.5 20H15.5" />
		</>
	),
	wifi: <path d="M2.04 10.14A13 13 0 0 1 21.96 10.14M5.11 12.71A9 9 0 0 1 18.89 12.71M8.17 15.29A5 5 0 0 1 15.83 15.29M12 18.5h0.01" />
};

const SOLID = {
	play: <path d="M8 5.5L18.5 12L8 18.5Z" />
};

/** One of the app's icons, sized by `className` and drawn in the current text color. */
const Glyph = ({className, name}) => {
	const solid = SOLID[name];
	return (
		<svg
			aria-hidden="true"
			className={classnames(css.glyph, className)}
			fill={solid ? 'currentColor' : 'none'}
			stroke={solid ? 'none' : 'currentColor'}
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.8"
			viewBox="0 0 24 24"
		>
			{solid || LINES[name]}
		</svg>
	);
};

export default Glyph;
