"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = __importStar(require("lodash"));
function lookupYear(years, date) {
    for (const entry of years) {
        if (date >= entry.from_date && date <= entry.to_date) {
            return entry.year;
        }
    }
    throw new Error("Fiscal year not found for date: " + date);
}
function paymentTypeKey(paymentType) {
    if (paymentType === "cash.cashback") {
        return "cash";
    }
    return paymentType.replace(".", "-");
}
function lookupVatCode(rate, type, parameters) {
    for (const tax of parameters.tax_codes) {
        if (tax.rate === rate && tax.type === type) {
            return tax.code;
        }
    }
    return undefined;
}
function accountLookup(paymentType, parameters) {
    const key = paymentTypeKey(paymentType);
    const account = parameters.account_map.payments[key];
    if (!_.isNil(account)) {
        return account;
    }
    const fallback = parameters.account_map.general.fallback;
    return {
        description: fallback.description + " " + paymentType,
        account: fallback.account
    };
}
function accountDiffLookup(paymentType, comment, parameters) {
    const key = paymentTypeKey(paymentType);
    const account = parameters.account_map.diffs[key];
    if (!_.isNil(account)) {
        return {
            account: account.account,
            description: account.description + ": " + comment
        };
    }
    const fallback = parameters.account_map.general.fallback;
    return {
        description: fallback.description + ": " + comment + " " + paymentType,
        account: fallback.account
    };
}
function accountDepositLookup(paymentType, parameters) {
    const key = paymentTypeKey(paymentType);
    const account = parameters.account_map.deposits[key];
    if (!_.isNil(account)) {
        return account;
    }
    const fallback = parameters.account_map.general.fallback;
    return {
        description: fallback.description + " " + paymentType,
        account: fallback.account
    };
}
function sourceDescription(source) {
    const shopName = source.shop_name;
    const registerName = source.register_name;
    const cashierInitials = source.cashier_name;
    return ` - ${shopName}, ${registerName}, ${cashierInitials}`;
}
class EconomicTransform {
    constructor(configuration, data) {
        this.data = data;
        this.configuration = configuration;
    }
    economicSaleTransform() {
        const sale = this.data;
        const parameters = this.configuration;
        const summary = sale.summary;
        if (!summary) {
            throw new Error("Cannot find a sales summary");
        }
        const dateString = sale.timing.timestamp_date_string;
        const comps = dateString.split("-");
        const date = `${comps[0]}-${comps[1]}-${comps[2]}`;
        const yearString = lookupYear(parameters.fiscal_years, date);
        const journalEntry = {};
        journalEntry.accountingYear = { year: yearString };
        journalEntry.journal = { journalNumber: parameters.journal_number };
        const vouchers = [];
        const saleAccount = parameters.account_map.general.sale;
        const sourceDesc = sourceDescription(sale.source);
        const taxTotals = {};
        for (const lineItem of sale.summary.line_items) {
            if (lineItem.taxes.length !== 1) {
                throw new Error("All line items must have exactly one tax entry in order to map to e-conomic journal vouchers");
            }
            const tax = lineItem.taxes[0];
            const rate = tax.rate;
            const type = tax.type;
            const key = `${type}-${rate}`;
            const existing = (taxTotals[key] || {}).total || 0;
            taxTotals[key] = {
                total: existing + lineItem.total,
                rate: tax.rate,
                type: tax.type
            };
        }
        for (const key in taxTotals) {
            const totals = taxTotals[key];
            const vatCode = lookupVatCode(totals.rate, totals.type, parameters);
            const voucher = {
                text: saleAccount.description + sourceDesc,
                amount: -totals.total,
                account: {
                    accountNumber: saleAccount.account
                },
                currency: {
                    code: sale.base_currency_code
                },
                date: date
            };
            if (!_.isNil(vatCode)) {
                voucher.vatAccount = {
                    vatCode: "U25"
                };
            }
            vouchers.push(voucher);
        }
        for (const payment of sale.payments) {
            let amount = payment.amount;
            let currencyCode = sale.base_currency_code;
            if (!_.isNil(payment.foreign_currency_amount)) {
                amount = payment.foreign_currency_amount;
                currencyCode = payment.foreign_currency;
            }
            const account = accountLookup(payment.payment_type, parameters);
            const voucher = {
                text: account.description + sourceDesc,
                amount: amount,
                account: {
                    accountNumber: account.account
                },
                currency: {
                    code: currencyCode
                },
                date: date
            };
            if (!_.isNil(payment.foreign_currency_amount)) {
                voucher.baseCurrencyAmount = payment.amount;
                const exchangeRate = payment.amount * 100 / amount;
                // Exchange rate must be rounded to 6 decimals
                voucher.exchangeRate = Math.round(exchangeRate * 1000000) / 1000000;
            }
            vouchers.push(voucher);
        }
        journalEntry.entries = { financeVouchers: vouchers };
        return JSON.stringify(journalEntry);
    }
    economicRegisterCloseStatementTransform() {
        const statement = this.data;
        const parameters = this.configuration;
        let date;
        if (statement.timing) {
            const dateString = statement.timing.timestamp_date_string;
            const comps = dateString.split("-");
            date = `${comps[0]}-${comps[1]}-${comps[2]}`;
        }
        else {
            const timestampNumber = statement.reconciliation_time * 1000;
            const timestamp = new Date(timestampNumber);
            date = timestamp.toISOString().split("T")[0];
        }
        const yearString = lookupYear(parameters.fiscal_years, date);
        const journalEntry = {};
        journalEntry.accountingYear = { year: yearString };
        journalEntry.journal = { journalNumber: parameters.journal_number };
        const vouchers = [];
        const sourceDesc = sourceDescription(statement.source);
        if (!_.isNil(statement.register_summary.cash_diff_at_open)) {
            const diff = statement.register_summary.cash_diff_at_open;
            const comment = statement.register_summary.cash_diff_comment_at_open;
            const paymentTypeAccount = accountLookup("cash", parameters);
            const diffAccount = accountDiffLookup("cash", comment, parameters);
            vouchers.push({
                text: diffAccount.description + sourceDesc,
                amount: diff,
                account: {
                    accountNumber: paymentTypeAccount.account
                },
                currency: {
                    code: statement.base_currency_code
                },
                date: date
            });
            vouchers.push({
                text: diffAccount.description + sourceDesc,
                amount: -diff,
                account: {
                    accountNumber: diffAccount.account
                },
                currency: {
                    code: statement.base_currency_code
                },
                date: date
            });
        }
        for (const reconciliation of statement.reconciliations) {
            if (reconciliation.should_be_reconciled && !_.isNil(reconciliation.counted)) {
                const counted = reconciliation.counted;
                const expected = reconciliation.total;
                const diff = counted - expected;
                if (diff !== 0) {
                    const comment = statement.comment || "";
                    const paymentType = reconciliation.payment_type_identifier;
                    const paymentTypeAccount = accountLookup(paymentType, parameters);
                    const diffAccount = accountDiffLookup(paymentType, comment, parameters);
                    vouchers.push({
                        text: diffAccount.description + sourceDesc,
                        amount: diff,
                        account: {
                            accountNumber: paymentTypeAccount.account
                        },
                        currency: {
                            code: reconciliation.currency_code
                        },
                        date: date
                    });
                    vouchers.push({
                        text: diffAccount.description + sourceDesc,
                        amount: -diff,
                        account: {
                            accountNumber: diffAccount.account
                        },
                        currency: {
                            code: reconciliation.currency_code
                        },
                        date: date
                    });
                }
            }
            if (!_.isNil(reconciliation.deposited_amount)) {
                const deposited = reconciliation.deposited_amount;
                const paymentType = reconciliation.payment_type_identifier;
                const paymentTypeAccount = accountLookup(paymentType, parameters);
                const depositAccount = accountDepositLookup(paymentType, parameters);
                vouchers.push({
                    text: depositAccount.description + sourceDesc,
                    amount: -deposited,
                    account: {
                        accountNumber: paymentTypeAccount.account
                    },
                    currency: {
                        code: reconciliation.currency_code
                    },
                    date: date
                });
                vouchers.push({
                    text: depositAccount.description + sourceDesc,
                    amount: deposited,
                    account: {
                        accountNumber: depositAccount.account
                    },
                    currency: {
                        code: reconciliation.currency_code
                    },
                    date: date
                });
            }
        }
        journalEntry.entries = { financeVouchers: vouchers };
        return JSON.stringify(journalEntry);
    }
}
exports.EconomicTransform = EconomicTransform;
