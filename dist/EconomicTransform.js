"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EconomicTransform = void 0;
const _ = require("lodash");
const SkipExport_1 = require("./SkipExport");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const dayjstimezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(dayjstimezone);
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
    lookupVatCode(rate, type, isIncoming = false) {
        for (const tax of this.configuration.tax_codes) {
            if (tax.rate === rate && tax.type === type) {
                if (isIncoming && tax.incoming !== true) {
                    continue;
                }
                return tax.code;
            }
        }
        return undefined;
    }
    accountLookup(paymentType, cardType) {
        var _a;
        const key = paymentTypeKey(paymentType);
        if (cardType !== undefined) {
            const cardSpecificKey = `${key}-${cardType}`;
            const cardSpecificAccount = this.configuration.account_map.payments[cardSpecificKey];
            if (!_.isNil(cardSpecificAccount)) {
                return cardSpecificAccount;
            }
        }
        const account = this.configuration.account_map.payments[key];
        if (!_.isNil(account)) {
            if (cardType !== undefined) {
                const clone = _.cloneDeep(account);
                clone.description = ((_a = account.description) !== null && _a !== void 0 ? _a : "") + ` (${cardType})`;
                return clone;
            }
            return account;
        }
        const fallback = this.configuration.account_map.general.fallback;
        return {
            description: fallback.description + " " + paymentType,
            account: fallback.account
        };
    }
    accountDiffLookup(paymentType, comment, subType) {
        const key = paymentTypeKey(paymentType);
        if (subType !== undefined) {
            const subTypeSpecificKey = `${key}-${subType}`;
            const subTypeSpecificAccount = this.configuration.account_map.diffs[subTypeSpecificKey];
            if (!_.isNil(subTypeSpecificAccount)) {
                return subTypeSpecificAccount;
            }
        }
        const account = this.configuration.account_map.diffs[key];
        if (!_.isNil(account)) {
            return {
                account: account.account,
                description: account.description + ": " + comment
            };
        }
        const fallback = this.configuration.account_map.general.fallback;
        return {
            description: fallback.description + ": " + comment + " " + paymentType,
            account: fallback.account
        };
    }
    accountDepositLookup(paymentType) {
        const key = paymentTypeKey(paymentType);
        const account = this.configuration.account_map.deposits[key];
        if (!_.isNil(account)) {
            return account;
        }
        const fallback = this.configuration.account_map.general.fallback;
        return {
            description: fallback.description + " " + paymentType,
            account: fallback.account
        };
    }
    accountGenericLookup(type, expenseCode) {
        if (type === "return" && !_.isNil(this.configuration.account_map.general.return)) {
            return this.configuration.account_map.general.return;
        }
        else if (type === "expense") {
            if (!_.isNil(expenseCode)) {
                const key = `expense-${expenseCode}`;
                if (!_.isNil(this.configuration.account_map.general[key])) {
                    return this.configuration.account_map.general[key];
                }
            }
            if (!_.isNil(this.configuration.account_map.general.expense)) {
                return this.configuration.account_map.general.expense;
            }
            else if (!_.isNil(this.configuration.account_map.general.return)) {
                return this.configuration.account_map.general.return;
            }
        }
        return this.configuration.account_map.general.sale;
    }
    localize(input, language) {
        const useLanguage = language !== null && language !== void 0 ? language : "da";
        if (typeof (input) === "string") {
            return input;
        }
        else if (typeof (input) === "object") {
            if (!_.isNil(input[useLanguage])) {
                return input[useLanguage];
            }
            else if (!_.isNil(input["en"])) {
                return input["en"];
            }
            else if (Object.keys(input).length > 0) {
                return input[Object.keys(input)[0]];
            }
        }
        return "-";
    }
    outgoingOrderExport() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const order = this.data;
        const parameters = this.configuration;
        if (parameters.type !== "intercompany_invoicing") {
            console.warn("Only 'intercompany_invoicing' order export is currently supported");
            throw new SkipExport_1.SkipExport("Only 'intercompany_invoicing' order export is currently supported");
        }
        const destinationId = order.order.destination_identifier;
        if (typeof (parameters.filters) === "object" &&
            typeof (parameters.filters.shops) === "object" &&
            (_.isNil(parameters.filters.shops[destinationId]) ||
                parameters.filters.shops[destinationId] === false)) {
            console.info(`Skipping outgoing order export for destination: ${destinationId} since it's not in the shops filter list`);
            throw new SkipExport_1.SkipExport(`Skipping outgoing order export for destination: ${destinationId} since it's not in the shops filter list`);
        }
        const source = order.order.source_identifier;
        let departmentalDistribution = undefined;
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[destinationId]) {
            const department = parseInt(parameters.shop_map[destinationId]);
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            };
        }
        const customerData = ((_a = parameters.customer_map) !== null && _a !== void 0 ? _a : {})[source];
        const layout = (_b = parameters.layout) !== null && _b !== void 0 ? _b : {};
        const language = (_c = parameters.language) !== null && _c !== void 0 ? _c : undefined;
        const timezone = (_d = parameters.timezone) !== null && _d !== void 0 ? _d : "Europe/Copenhagen";
        const paymentTerms = (_e = parameters.payment_terms) !== null && _e !== void 0 ? _e : {};
        const productMap = (_f = parameters.product_map) !== null && _f !== void 0 ? _f : {};
        let costPriceTotal = 0;
        const lines = [];
        let lineNumber = 1;
        for (const item of order.order.basket.line_items) {
            if (!_.isNil(item.behavior) ||
                _.isNil(item.id) ||
                _.isNil(item.cost_price) ||
                _.isNil(item.quantity) ||
                item.quantity === 0) {
                continue;
            }
            costPriceTotal += item.cost_price;
            let template;
            if (!_.isNil(item.variant_id)) {
                template = (_g = productMap.variant) !== null && _g !== void 0 ? _g : "";
            }
            else {
                template = (_h = productMap.product) !== null && _h !== void 0 ? _h : "";
            }
            const productNumber = template.replace(/\{\{([^\}]+)\}\}/g, (match, group) => {
                if (!_.isNil(item[group])) {
                    return `${item[group]}`;
                }
                else {
                    return "";
                }
            });
            const line = {
                lineNumber: lineNumber,
                product: {
                    productNumber: productNumber
                },
                description: this.localize(item.name, language),
                quantity: item.quantity,
                unitNetPrice: item.cost_price / item.quantity
            };
            lines.push(line);
            lineNumber += 1;
        }
        if (lines.length === 0) {
            throw new SkipExport_1.SkipExport("No invoiceable line items");
        }
        const timestamp = dayjs(order.state.created * 1000).tz(timezone);
        const date = timestamp.format("YYYY-MM-DD");
        const invoice = {
            date: date,
            currency: order.order.currency,
            netAmount: costPriceTotal,
            vatAmount: 0,
            paymentTerms: paymentTerms,
            customer: customerData.customer,
            recipient: customerData.recipient,
            references: {
                other: order.order.order_identifier
            },
            layout: layout,
            lines: lines
        };
        return invoice;
    }
    saleExport() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const sale = this.data;
        const parameters = this.configuration;
        const shopId = sale.source.shop_id;
        if (typeof (parameters.filter) === "object" &&
            typeof (parameters.filter.shops) === "object" &&
            (_.isNil(parameters.filter.shops[shopId]) ||
                parameters.filter.shops[shopId] === false)) {
            console.info(`Skipping sales export for shop: ${shopId} since it's not in the shops filter list`);
            return;
        }
        const skipDescription = (_a = parameters.skip_description) !== null && _a !== void 0 ? _a : false;
        const summary = sale.summary;
        if (!summary) {
            throw new Error("Cannot find a sales summary");
        }
        if (sale.voided) {
            throw new SkipExport_1.SkipExport("Voided sale");
        }
        const isReturn = summary.is_return || false;
        const isExpense = !_.isNil(summary.expense_reference);
        const dateString = sale.timing.timestamp_date_string;
        const comps = dateString.split("-");
        const date = `${comps[0]}-${comps[1]}-${comps[2]}`;
        const yearString = lookupYear(parameters.fiscal_years, date);
        const journalEntry = {};
        journalEntry.accountingYear = { year: yearString };
        journalEntry.journal = { journalNumber: parameters.journal_number };
        const vouchers = [];
        let saleAccount = parameters.account_map.general.sale;
        if (isReturn && !_.isNil(parameters.account_map.general.return)) {
            saleAccount = parameters.account_map.general.return;
        }
        else if (isExpense) {
            if (!_.isNil(parameters.account_map.general.expense)) {
                saleAccount = parameters.account_map.general.expense;
            }
            else if (!_.isNil(parameters.account_map.general.return)) {
                saleAccount = parameters.account_map.general.return;
            }
        }
        const sourceDesc = skipDescription ? "" : sourceDescription(sale.source) + " sale id: " + sale.identifier;
        const taxTotals = {};
        let departmentalDistribution = undefined;
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[shopId]) {
            const department = parseInt(parameters.shop_map[shopId]);
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            };
        }
        for (const lineItem of sale.summary.line_items) {
            let taxes = lineItem.taxes;
            if (!taxes) {
                taxes = [{ rate: 0, type: "vat" }];
            }
            if (taxes.length !== 1) {
                console.info("All line items must have exactly one tax entry in order to map to e-conomic journal vouchers", sale);
                continue;
            }
            const tax = taxes[0];
            const rate = tax.rate;
            const type = tax.type;
            let key = `${type}-${rate}`;
            if (isExpense) {
                const expenseCode = (_d = (_c = (_b = lineItem.behavior) === null || _b === void 0 ? void 0 : _b.expense) === null || _c === void 0 ? void 0 : _c.identifier) !== null && _d !== void 0 ? _d : "-";
                key = `${expenseCode}-${type}-${rate}`;
            }
            const existing = (_f = ((_e = taxTotals[key]) !== null && _e !== void 0 ? _e : {}).total) !== null && _f !== void 0 ? _f : 0;
            taxTotals[key] = {
                total: existing + lineItem.total,
                rate: tax.rate,
                type: tax.type
            };
            if (isExpense) {
                const expenseCode = (_j = (_h = (_g = lineItem.behavior) === null || _g === void 0 ? void 0 : _g.expense) === null || _h === void 0 ? void 0 : _h.identifier) !== null && _j !== void 0 ? _j : "-";
                taxTotals[key]["expense_code"] = expenseCode;
            }
        }
        for (const key in taxTotals) {
            const totals = taxTotals[key];
            const vatCode = this.lookupVatCode(totals.rate, totals.type, isExpense);
            if (!_.isNil(totals.expense_code)) {
                if (!_.isNil(parameters.account_map.general[`expense-${totals.expense_code}`]))
                    saleAccount = parameters.account_map.general[`expense-${totals.expense_code}`];
            }
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
            if (!_.isNil(departmentalDistribution)) {
                voucher.departmentalDistribution = departmentalDistribution;
            }
            if (!_.isNil(vatCode)) {
                voucher.vatAccount = {
                    vatCode: vatCode
                };
            }
            vouchers.push(voucher);
        }
        for (const payment of sale.payments) {
            if (!payment.success) {
                continue;
            }
            let amount = payment.amount;
            let currencyCode = sale.base_currency_code;
            if (!_.isNil(payment.foreign_currency_amount)) {
                amount = payment.foreign_currency_amount;
                currencyCode = payment.foreign_currency;
            }
            const account = this.accountLookup(payment.payment_type, (_k = payment.metadata) === null || _k === void 0 ? void 0 : _k.card_type);
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
            if (!_.isNil(departmentalDistribution)) {
                voucher.departmentalDistribution = departmentalDistribution;
            }
            if (!_.isNil(payment.foreign_currency_amount)) {
                voucher.baseCurrencyAmount = payment.amount;
                const exchangeRate = payment.amount * 100 / amount;
                voucher.exchangeRate = Math.round(exchangeRate * 1000000) / 1000000;
            }
            vouchers.push(voucher);
        }
        journalEntry.entries = { financeVouchers: vouchers };
        return journalEntry;
    }
    registerCloseStatementExport() {
        var _a, _b;
        const statement = this.data;
        const parameters = this.configuration;
        const shopId = statement.source.shop_id;
        const skipDescription = (_a = parameters.skip_description) !== null && _a !== void 0 ? _a : false;
        const exportType = (_b = parameters.export_type) !== null && _b !== void 0 ? _b : "diffs";
        switch (exportType) {
            case "totals":
                return this.registerCloseStatementTotalsExport(statement, parameters, skipDescription, shopId);
            case "diffs":
            default:
                return this.registerCloseStatementDiffExport(statement, parameters, skipDescription, shopId);
        }
    }
    addVoucher(vouchers, amount, vatCode, account, currencyCode, config, negate = false) {
        if (_.isNil(amount)) {
            return;
        }
        if (config.skipZeroAmountTransactions === true && amount === 0) {
            return;
        }
        const voucher = {
            text: account.description + config.sourceDescription,
            amount: negate ? -amount : amount,
            account: {
                accountNumber: account.account
            },
            currency: {
                code: currencyCode !== null && currencyCode !== void 0 ? currencyCode : config.currencyCode
            },
            date: config.date
        };
        if (!_.isNil(vatCode)) {
            voucher.vatAccount = {
                vatCode: vatCode
            };
        }
        if (!_.isNil(config.departmentalDistribution)) {
            voucher.departmentalDistribution = config.departmentalDistribution;
        }
        vouchers.push(voucher);
        return voucher;
    }
    addGenericVoucher(vouchers, amount, vatCode, account, config, negate = false) {
        return this.addVoucher(vouchers, amount, vatCode, account, undefined, config, negate);
    }
    addForeignCurrencyVoucher(vouchers, amount, vatCode, account, currencyCode, foreignCurrencyTotal, baseCurrencyTotal, config, negate = false) {
        const voucher = this.addVoucher(vouchers, amount, vatCode, account, currencyCode, config, negate);
        if (voucher === undefined) {
            return;
        }
        if (currencyCode === config.currencyCode) {
            return;
        }
        if (_.isNil(amount) || amount === 0) {
            return;
        }
        if (foreignCurrencyTotal === 0) {
            return;
        }
        if (_.isNil(baseCurrencyTotal)) {
            return;
        }
        const exchangeRate = baseCurrencyTotal * 100 / foreignCurrencyTotal;
        voucher.baseCurrencyAmount = Math.round(amount * exchangeRate * 1000000) / 100000000;
        voucher.exchangeRate = Math.round(exchangeRate * 1000000) / 1000000;
    }
    getReconciliation(statement, paymentType, currencyCode) {
        const reconciliations = statement.reconciliations;
        if (_.isNil(reconciliations)) {
            return undefined;
        }
        return reconciliations.find(r => { return r.payment_type_identifier === paymentType && r.currency_code === currencyCode; });
    }
    registerCloseStatementTotalsExport(statement, parameters, skipDescription, shopId) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
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
        const skipZeroAmountTransactions = (_a = parameters.skip_zero_amount_transactions) !== null && _a !== void 0 ? _a : false;
        const yearString = lookupYear(parameters.fiscal_years, date);
        const journalEntry = {};
        journalEntry.accountingYear = { year: yearString };
        journalEntry.journal = { journalNumber: parameters.journal_number };
        const vouchers = [];
        const sourceDesc = skipDescription ? "" : sourceDescription(statement.source) + " statement number: " + statement.sequence_number;
        const differenceTaxCode = (_b = parameters.difference_tax_code) !== null && _b !== void 0 ? _b : undefined;
        let departmentalDistribution = undefined;
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[shopId]) {
            const department = parseInt(parameters.shop_map[shopId]);
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            };
        }
        const config = {
            skipZeroAmountTransactions: skipZeroAmountTransactions,
            sourceDescription: sourceDesc,
            departmentalDistribution: departmentalDistribution,
            currencyCode: statement.base_currency_code,
            date: date,
            differenceTaxCode: differenceTaxCode
        };
        this.addVoucher(vouchers, statement.register_summary.cash_total_at_open - ((_c = statement.register_summary.cash_diff_at_open) !== null && _c !== void 0 ? _c : 0), undefined, this.accountLookup("cash", "open"), undefined, config, true);
        const comment = statement.register_summary.cash_diff_comment_at_open;
        this.addVoucher(vouchers, statement.register_summary.cash_diff_at_open, config.differenceTaxCode, this.accountDiffLookup("cash", comment, "open"), undefined, config, true);
        const cashReconciliation = this.getReconciliation(statement, "cash", config.currencyCode);
        if (!_.isNil(cashReconciliation)) {
            if (!_.isNil(cashReconciliation.deposited_amount)) {
                const deposited = cashReconciliation.deposited_amount;
                const paymentType = cashReconciliation.payment_type_identifier;
                this.addVoucher(vouchers, deposited, undefined, this.accountDepositLookup(paymentType), undefined, config);
            }
            this.addVoucher(vouchers, cashReconciliation.counted - ((_d = cashReconciliation.deposited_amount) !== null && _d !== void 0 ? _d : 0), undefined, this.accountLookup("cash", "close"), undefined, config);
            const counted = cashReconciliation.counted;
            const expected = cashReconciliation.total;
            const diff = counted - expected;
            if (diff !== 0) {
                const comment = statement.comment || "";
                this.addVoucher(vouchers, diff, config.differenceTaxCode, this.accountDiffLookup("cash", comment, "close"), undefined, config, true);
            }
        }
        for (const reconciliation of statement.reconciliations) {
            const paymentType = reconciliation.payment_type_identifier;
            if (paymentType !== "cash") {
                continue;
            }
            if (reconciliation.currency_code === config.currencyCode) {
                continue;
            }
            this.handleReconciliation(vouchers, statement, reconciliation, paymentType, config);
        }
        for (const reconciliation of statement.reconciliations) {
            const paymentType = reconciliation.payment_type_identifier;
            if (paymentType === "cash") {
                continue;
            }
            this.handleReconciliation(vouchers, statement, reconciliation, paymentType, config);
        }
        this.handleCashRounding(vouchers, statement, config);
        this.addGenericVouchers(vouchers, statement, config, "sale");
        this.addGenericVouchers(vouchers, statement, config, "return");
        const expenses = (_e = statement.register_summary.expenses) !== null && _e !== void 0 ? _e : {};
        if (!_.isNil(expenses.expenses_by_id)) {
            for (const expenseId in expenses.expenses_by_id) {
                const expense = expenses.expenses_by_id[expenseId];
                for (const taxSummary of (_f = expense.tax_summaries) !== null && _f !== void 0 ? _f : []) {
                    const amount = ((_g = taxSummary.source_amount) !== null && _g !== void 0 ? _g : 0) + ((_h = taxSummary.amount) !== null && _h !== void 0 ? _h : 0);
                    const isExpense = true;
                    const vatCode = this.lookupVatCode(taxSummary.rate, taxSummary.type, isExpense);
                    this.addGenericVoucher(vouchers, amount, vatCode, this.accountGenericLookup("expense", expenseId), config, true);
                }
            }
        }
        else {
            this.addGenericVouchers(vouchers, statement, config, "expense");
        }
        journalEntry.entries = { financeVouchers: vouchers.reverse() };
        return journalEntry;
    }
    handleCashRounding(vouchers, statement, config) {
        var _a, _b, _c, _d, _e, _f, _g;
        const transactions = (_c = (_b = (_a = statement.register_summary) === null || _a === void 0 ? void 0 : _a.all) === null || _b === void 0 ? void 0 : _b.transactions) !== null && _c !== void 0 ? _c : [];
        const matchingPaymentType = transactions.find(t => { return t.type === "cash.rounding"; });
        if (!_.isNil(matchingPaymentType)) {
            const byCurrencies = (_f = (_e = (_d = matchingPaymentType.totals) === null || _d === void 0 ? void 0 : _d.all) === null || _e === void 0 ? void 0 : _e.by_currency) !== null && _f !== void 0 ? _f : {};
            for (const currency in byCurrencies) {
                const byCurrency = byCurrencies[currency];
                const total = (_g = byCurrency.foreign_currency_total) !== null && _g !== void 0 ? _g : byCurrency.total;
                const baseCurrencyTotal = byCurrency.total;
                this.addForeignCurrencyVoucher(vouchers, total, config.differenceTaxCode, this.accountDiffLookup("cash", "", "rounding"), currency, total, baseCurrencyTotal, config);
            }
        }
    }
    handleReconciliation(vouchers, statement, reconciliation, paymentType, config) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!_.isNil(reconciliation.deposited_amount)) {
            const deposited = reconciliation.deposited_amount;
            const paymentType = reconciliation.payment_type_identifier;
            this.addForeignCurrencyVoucher(vouchers, deposited, undefined, this.accountDepositLookup(paymentType), reconciliation.currency_code, reconciliation.total, reconciliation.base_currency_total, config);
            const diff = reconciliation.counted - reconciliation.deposited_amount;
            if (diff !== 0) {
                this.addForeignCurrencyVoucher(vouchers, diff, config.differenceTaxCode, this.accountLookup(paymentType), reconciliation.currency_code, reconciliation.total, reconciliation.base_currency_total, config);
            }
        }
        else {
            const currencyCode = reconciliation.currency_code;
            const total = reconciliation.total;
            let remaining = total;
            console.log("A - paymentType", paymentType);
            const transactions = (_c = (_b = (_a = statement.register_summary) === null || _a === void 0 ? void 0 : _a.all) === null || _b === void 0 ? void 0 : _b.transactions) !== null && _c !== void 0 ? _c : [];
            const matchingPaymentType = transactions.find(t => { return t.type === paymentType; });
            if (!_.isNil(matchingPaymentType)) {
                console.log("B - matching paymentType - currency code", currencyCode);
                const byCurrency = (_e = (_d = matchingPaymentType.totals) === null || _d === void 0 ? void 0 : _d.all) === null || _e === void 0 ? void 0 : _e.by_currency[currencyCode];
                if (!_.isNil(byCurrency)) {
                    console.log("C - matching currency");
                    const byCardType = byCurrency.by_card_type;
                    if (!_.isNil(byCardType)) {
                        console.log("D - has by_card_type");
                        for (const cardType in byCardType) {
                            console.log("E - card type", cardType);
                            const totals = byCardType[cardType];
                            const total = (currencyCode === config.currencyCode) ? ((_f = totals === null || totals === void 0 ? void 0 : totals.total) !== null && _f !== void 0 ? _f : 0) : ((_g = totals === null || totals === void 0 ? void 0 : totals.foreign_currency_total) !== null && _g !== void 0 ? _g : 0);
                            remaining -= total;
                            this.addForeignCurrencyVoucher(vouchers, total, undefined, this.accountLookup(paymentType, cardType), reconciliation.currency_code, reconciliation.total, reconciliation.base_currency_total, config);
                        }
                    }
                }
            }
            if (Math.abs(remaining) >= 0.01) {
                this.addForeignCurrencyVoucher(vouchers, remaining, undefined, this.accountLookup(paymentType), reconciliation.currency_code, reconciliation.total, reconciliation.base_currency_total, config);
            }
        }
        if (reconciliation.should_be_reconciled && !_.isNil(reconciliation.counted)) {
            const counted = reconciliation.counted;
            const expected = reconciliation.total;
            const diff = counted - expected;
            if (diff !== 0) {
                const paymentType = reconciliation.payment_type_identifier;
                const comment = (_h = statement.comment) !== null && _h !== void 0 ? _h : "";
                this.addForeignCurrencyVoucher(vouchers, diff, config.differenceTaxCode, this.accountDiffLookup(paymentType, comment, "close"), reconciliation.currency_code, reconciliation.total, reconciliation.base_currency_total, config, true);
            }
        }
    }
    addGenericVouchers(vouchers, statement, config, type) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        let summaries = [];
        let isExpense = false;
        switch (type) {
            case "sale":
                summaries = (_b = (_a = statement.register_summary.sales) === null || _a === void 0 ? void 0 : _a.tax_summaries) !== null && _b !== void 0 ? _b : [];
                break;
            case "return":
                summaries = (_d = (_c = statement.register_summary.returns) === null || _c === void 0 ? void 0 : _c.tax_summaries) !== null && _d !== void 0 ? _d : [];
                break;
            case "expense":
                isExpense = true;
                summaries = (_f = (_e = statement.register_summary.expenses) === null || _e === void 0 ? void 0 : _e.tax_summaries) !== null && _f !== void 0 ? _f : [];
                break;
        }
        for (const taxSummary of summaries) {
            const amount = ((_g = taxSummary.source_amount) !== null && _g !== void 0 ? _g : 0) + ((_h = taxSummary.amount) !== null && _h !== void 0 ? _h : 0);
            const vatCode = this.lookupVatCode(taxSummary.rate, taxSummary.type, isExpense);
            this.addGenericVoucher(vouchers, amount, vatCode, this.accountGenericLookup(type), config, true);
        }
    }
    registerCloseStatementDiffExport(statement, parameters, skipDescription, shopId) {
        var _a;
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
        const sourceDesc = skipDescription ? "" : sourceDescription(statement.source) + " statement number: " + statement.sequence_number;
        const differenceTaxCode = (_a = parameters.difference_tax_code) !== null && _a !== void 0 ? _a : undefined;
        let departmentalDistribution = undefined;
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[shopId]) {
            const department = parseInt(parameters.shop_map[shopId]);
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            };
        }
        if (!_.isNil(statement.register_summary.cash_diff_at_open)) {
            const diff = statement.register_summary.cash_diff_at_open;
            const comment = statement.register_summary.cash_diff_comment_at_open;
            const paymentTypeAccount = this.accountLookup("cash");
            const diffAccount = this.accountDiffLookup("cash", comment);
            const voucher1 = {
                text: paymentTypeAccount.description + sourceDesc,
                amount: diff,
                account: {
                    accountNumber: paymentTypeAccount.account
                },
                currency: {
                    code: statement.base_currency_code
                },
                date: date
            };
            if (!_.isNil(departmentalDistribution)) {
                voucher1.departmentalDistribution = departmentalDistribution;
            }
            vouchers.push(voucher1);
            const voucher2 = {
                text: diffAccount.description + sourceDesc,
                amount: -diff,
                account: {
                    accountNumber: diffAccount.account
                },
                currency: {
                    code: statement.base_currency_code
                },
                date: date
            };
            if (!_.isNil(differenceTaxCode)) {
                voucher2.vatAccount = {
                    vatCode: differenceTaxCode
                };
            }
            if (!_.isNil(departmentalDistribution)) {
                voucher2.departmentalDistribution = departmentalDistribution;
            }
            vouchers.push(voucher2);
        }
        for (const reconciliation of statement.reconciliations) {
            if (reconciliation.should_be_reconciled && !_.isNil(reconciliation.counted)) {
                const counted = reconciliation.counted;
                const expected = reconciliation.total;
                const diff = counted - expected;
                if (diff !== 0) {
                    const comment = statement.comment || "";
                    const paymentType = reconciliation.payment_type_identifier;
                    const paymentTypeAccount = this.accountLookup(paymentType);
                    const diffAccount = this.accountDiffLookup(paymentType, comment);
                    const voucher1 = {
                        text: diffAccount.description + sourceDesc,
                        amount: diff,
                        account: {
                            accountNumber: paymentTypeAccount.account
                        },
                        currency: {
                            code: reconciliation.currency_code
                        },
                        date: date
                    };
                    if (!_.isNil(departmentalDistribution)) {
                        voucher1.departmentalDistribution = departmentalDistribution;
                    }
                    vouchers.push(voucher1);
                    const voucher2 = {
                        text: diffAccount.description + sourceDesc,
                        amount: -diff,
                        account: {
                            accountNumber: diffAccount.account
                        },
                        currency: {
                            code: reconciliation.currency_code
                        },
                        date: date
                    };
                    if (!_.isNil(differenceTaxCode)) {
                        voucher2.vatAccount = {
                            vatCode: differenceTaxCode
                        };
                    }
                    if (!_.isNil(departmentalDistribution)) {
                        voucher2.departmentalDistribution = departmentalDistribution;
                    }
                    vouchers.push(voucher2);
                }
            }
            if (!_.isNil(reconciliation.deposited_amount)) {
                const deposited = reconciliation.deposited_amount;
                const paymentType = reconciliation.payment_type_identifier;
                const paymentTypeAccount = this.accountLookup(paymentType);
                const depositAccount = this.accountDepositLookup(paymentType);
                const voucher1 = {
                    text: depositAccount.description + sourceDesc,
                    amount: -deposited,
                    account: {
                        accountNumber: paymentTypeAccount.account
                    },
                    currency: {
                        code: reconciliation.currency_code
                    },
                    date: date
                };
                if (!_.isNil(departmentalDistribution)) {
                    voucher1.departmentalDistribution = departmentalDistribution;
                }
                vouchers.push(voucher1);
                const voucher2 = {
                    text: depositAccount.description + sourceDesc,
                    amount: deposited,
                    account: {
                        accountNumber: depositAccount.account
                    },
                    currency: {
                        code: reconciliation.currency_code
                    },
                    date: date
                };
                if (!_.isNil(departmentalDistribution)) {
                    voucher2.departmentalDistribution = departmentalDistribution;
                }
                vouchers.push(voucher2);
            }
        }
        journalEntry.entries = { financeVouchers: vouchers };
        return journalEntry;
    }
}
exports.EconomicTransform = EconomicTransform;
//# sourceMappingURL=EconomicTransform.js.map