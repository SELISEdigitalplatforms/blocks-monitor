/** Product facts: the product name. */

export const PRODUCT = "MADP Factory";

export const fmtCHF = (n: number) => `CHF ${n.toLocaleString("de-CH").replace(/,/g, "'")}`;
