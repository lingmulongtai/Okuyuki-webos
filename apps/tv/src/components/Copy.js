import {splitTerms} from './format';

import css from './Copy.module.less';

/** A sentence that never breaks inside the name of a button or setting on the phone. */
const Copy = ({children}) => {
	if (typeof children !== 'string') return children;
	return splitTerms(children).map((part, index) => (
		index % 2 ? <span className={css.term} key={'term' + index}>{part}</span> : part
	));
};

export default Copy;
